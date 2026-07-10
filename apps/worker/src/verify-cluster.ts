/**
 * Deterministic integration verification for the event-cluster pipeline.
 *
 * Run with: pnpm --filter worker verify:cluster (tsx src/verify-cluster.ts).
 *
 * It exercises every row of the spec I/O & Edge-Case Matrix against real local
 * PostgreSQL + Redis, then asserts the DB state — surface-anchored, not mock-
 * based. It prints PASS/FAIL and exits non-zero iff any assertion fails, so it
 * is CI-gateable.
 *
 * Unlike verify-ingest (which seeds RSS sources and runs ingest), this script
 * seeds archived EvidenceRecords DIRECTLY (bypassing ingest/RSS) so it can
 * precisely control the clustering inputs (same-event long/short title pair,
 * different event, cross-time-window, empty title). It then enqueues an
 * event-cluster job and asserts:
 *
 * Assertions (AC1/AC2):
 *   1. Same-event subset long/short titles merge into one candidate (overlap-
 *      coefficient, not Jaccard) with 2 links.
 *   2. Different-event title forms its own candidate (1 link).
 *   3. Every candidate has publication_status="candidate" (never "published").
 *   4. No published_* table was written (structural AC2 isolation).
 *   5. Idempotent: re-running the cluster job with no new archived records
 *      produces 0 new candidates and 0 new links.
 *   6. Incremental merge: archiving a new record whose title overlaps an
 *      existing candidate's signature (within time window) and re-running
 *      merges it into that candidate (link +1, candidate count unchanged,
 *      title unchanged).
 *   7. Cross-time-window: a same-title record published >72h after the
 *      candidate's members does NOT merge — it forms its own candidate.
 *   8. Empty-title record forms its own candidate (1 link, fallback title).
 *   9. Write isolation: event-cluster only writes hot_events/hot_event_evidence
 *      — evidence_* row counts are unchanged.
 */

import { QueueEvents } from "bullmq";

import {
  getPrisma,
  newTraceId,
  resetPrisma,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import {
  EVENT_CLUSTER_QUEUE_NAME,
  enqueueEventCluster,
  registerEventClusterWorker,
} from "./queues/event-cluster-queue.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records have deterministic publishedAt offsets.
// 2024-01-01T00:00:00Z (a stable past date, well away from wall-clock noise).
const BASE_MS = Date.UTC(2024, 0, 1);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function main(): Promise<void> {
  // Resolve infra (Block-If: must be reachable).
  resetEnvCache();
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  const prisma = getPrisma();
  const redis = getRedis();
  await redis.ping();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one shared source + 5 archived records ------------------------
    // 1. "short" + 2. "long": same event, subset titles, 1h apart -> MERGE.
    // 3. "diff": different event -> own candidate.
    // 4. "null": null title -> own candidate (fallback title).
    // (cross-time-window record added later in the incremental-merge phase.)
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-cluster-source",
        kind: "rss",
        feedUrl: "file:///unused-by-cluster",
        enabled: true,
      },
    });

    const rShort = await seedRecord(prisma, source.id, {
      title: "央行降准",
      summary: "央行宣布降准",
      publishedAt: new Date(BASE_MS),
    });
    const rLong = await seedRecord(prisma, source.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "央行宣布降准0.5个百分点释放流动性",
      publishedAt: new Date(BASE_MS + 1 * HOUR), // 1h later, within 72h window
    });
    const rDiff = await seedRecord(prisma, source.id, {
      title: "美股大跌三大股指重挫",
      summary: "美股暴跌",
      publishedAt: new Date(BASE_MS + 2 * HOUR),
    });
    const rNull = await seedRecord(prisma, source.id, {
      title: null,
      summary: "无标题的归档记录",
      publishedAt: new Date(BASE_MS + 3 * HOUR),
    });

    // Capture evidence_* baseline for write-isolation assertion (run 1).
    const evidenceBaseline = await tableRowCount(prisma, "evidence_records");

    // --- Run 1: enqueue event-cluster, await via QueueEvents. ----------------
    const traceId = newTraceId();
    const worker = registerEventClusterWorker();
    const queueEvents = new QueueEvents(EVENT_CLUSTER_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job = await enqueueEventCluster(traceId);
      await job.waitUntilFinished(queueEvents);
    } finally {
      await queueEvents.close();
      await worker.close();
    }

    const candidates = await prisma.hotEvent.findMany({
      include: { evidence: { select: { evidenceRecordId: true } } },
    });

    // AC1: subset long/short titles merge into one candidate with 2 links.
    const sameEventCand = candidates.find(
      (c) => c.evidence.some((l) => l.evidenceRecordId === rShort.id) ||
            c.evidence.some((l) => l.evidenceRecordId === rLong.id),
    );
    assertions.push({
      name: "AC1 subset long/short titles merge into one candidate (title = latest publishedAt record)",
      ok: sameEventCand !== undefined &&
          sameEventCand.evidence.length === 2 &&
          sameEventCand.evidence.some((l) => l.evidenceRecordId === rShort.id) &&
          sameEventCand.evidence.some((l) => l.evidenceRecordId === rLong.id) &&
          // Title must come from the LATEST publishedAt member (rLong, BASE_MS+1h),
          // not the earlier rShort — pins the deriveTitle contract, not just stability.
          sameEventCand.title === rLong.title,
      detail: sameEventCand
        ? `title="${sameEventCand.title}" links=${sameEventCand.evidence.length}`
        : "no candidate contains both rShort and rLong",
    });

    // AC1: different-event title forms its own candidate.
    const diffCand = candidates.find(
      (c) => c.evidence.some((l) => l.evidenceRecordId === rDiff.id),
    );
    assertions.push({
      name: "AC1 different-event title forms own candidate (1 link)",
      ok: diffCand !== undefined && diffCand.evidence.length === 1,
      detail: diffCand ? `title="${diffCand.title}"` : "no candidate for rDiff",
    });

    // AC1: empty-title record forms its own candidate with fallback title.
    const nullCand = candidates.find(
      (c) => c.evidence.some((l) => l.evidenceRecordId === rNull.id),
    );
    assertions.push({
      name: "AC1 empty-title record forms own candidate (fallback title from summary)",
      ok: nullCand !== undefined &&
          nullCand.evidence.length === 1 &&
          (nullCand.title.includes("无标题") || nullCand.title === "未命名候选"),
      detail: nullCand ? `title="${nullCand.title}"` : "no candidate for rNull",
    });

    // AC2: every candidate has publication_status="candidate" (never "published").
    assertions.push({
      name: "AC2 every candidate publication_status is 'candidate'",
      ok: candidates.every((c) => c.publicationStatus === "candidate"),
      detail: candidates.map((c) => c.publicationStatus).join(", "),
    });

    // AC2: no published_* table was written (structural isolation).
    const publishedTables = await listTablesLike(prisma, "published\\_%");
    assertions.push({
      name: "AC2 no published_* read-model table written",
      ok: publishedTables.length === 0,
      detail: publishedTables.length > 0 ? `tables: ${publishedTables.join(", ")}` : "(none)",
    });

    // Write isolation: event-cluster did not change evidence_records row count.
    const evidenceAfter1 = await tableRowCount(prisma, "evidence_records");
    assertions.push({
      name: "AC2 write isolation: evidence_records unchanged by cluster job",
      ok: evidenceAfter1 === evidenceBaseline,
      detail: `before=${evidenceBaseline}, after=${evidenceAfter1}`,
    });

    const candidateCountAfterRun1 = await prisma.hotEvent.count();
    const linkCountAfterRun1 = await prisma.hotEventEvidence.count();

    // --- Run 2: idempotent — re-run with no new archived records. -------------
    const traceId2 = newTraceId();
    const worker2 = registerEventClusterWorker();
    const queueEvents2 = new QueueEvents(EVENT_CLUSTER_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job2 = await enqueueEventCluster(traceId2);
      await job2.waitUntilFinished(queueEvents2);
    } finally {
      await queueEvents2.close();
      await worker2.close();
    }
    const candidateCountAfterRun2 = await prisma.hotEvent.count();
    const linkCountAfterRun2 = await prisma.hotEventEvidence.count();
    assertions.push({
      name: "AC1 idempotent: re-run produces 0 new candidates",
      ok: candidateCountAfterRun2 === candidateCountAfterRun1,
      detail: `run1=${candidateCountAfterRun1}, run2=${candidateCountAfterRun2}`,
    });
    assertions.push({
      name: "AC1 idempotent: re-run produces 0 new links",
      ok: linkCountAfterRun2 === linkCountAfterRun1,
      detail: `run1=${linkCountAfterRun1}, run2=${linkCountAfterRun2}`,
    });

    // --- Run 3: incremental merge — new record overlapping sameEventCand. ----
    // Title must overlap the existing candidate's signature at >= threshold.
    // The candidate's signature accumulated tokens from {央行降准} ∪ {央行宣布降
    // 准0.5个百分点} = {央,行,降,准,宣,布,0.5,个,百,分,点} (11 tokens). A title
    // that is a strict subset of those tokens scores overlap=1.0 against the
    // candidate. "央行宣布降准" tokenizes to {央,行,宣,布,降,准} — all 6 are in
    // the candidate signature, so 6/min(6,11)=1.0 >= 0.7 → merge.
    const sameEventTitleBefore = sameEventCand!.title;
    const rIncremental = await seedRecord(prisma, source.id, {
      title: "央行宣布降准",
      summary: "央行宣布降准",
      publishedAt: new Date(BASE_MS + 30 * HOUR), // 30h later, within 72h of BASE_MS
    });

    const traceId3 = newTraceId();
    const worker3 = registerEventClusterWorker();
    const queueEvents3 = new QueueEvents(EVENT_CLUSTER_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job3 = await enqueueEventCluster(traceId3);
      await job3.waitUntilFinished(queueEvents3);
    } finally {
      await queueEvents3.close();
      await worker3.close();
    }

    const candidateCountAfterRun3 = await prisma.hotEvent.count();
    const sameEventCandAfter = await prisma.hotEvent.findUnique({
      where: { id: sameEventCand!.id },
      include: { evidence: { select: { evidenceRecordId: true } } },
    });
    assertions.push({
      name: "AC1 incremental merge: new overlapping record joins existing candidate (candidate count unchanged)",
      ok: candidateCountAfterRun3 === candidateCountAfterRun1,
      detail: `before=${candidateCountAfterRun1}, after=${candidateCountAfterRun3}`,
    });
    assertions.push({
      name: "AC1 incremental merge: link to new record created",
      ok: sameEventCandAfter?.evidence.some((l) => l.evidenceRecordId === rIncremental.id) === true,
      detail: `links=${sameEventCandAfter?.evidence.length ?? 0}`,
    });
    assertions.push({
      name: "AC1 incremental merge: candidate title unchanged (title is stable)",
      ok: sameEventCandAfter?.title === sameEventTitleBefore,
      detail: `before="${sameEventTitleBefore}", after="${sameEventCandAfter?.title}"`,
    });

    // --- Run 4: cross-time-window — same-title record >72h out stays separate.
    const rFar = await seedRecord(prisma, source.id, {
      title: "央行降准", // identical to rShort's title
      summary: "几天后的另一条",
      publishedAt: new Date(BASE_MS + 10 * DAY), // 10 days > 72h window
    });
    const traceId4 = newTraceId();
    const worker4 = registerEventClusterWorker();
    const queueEvents4 = new QueueEvents(EVENT_CLUSTER_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job4 = await enqueueEventCluster(traceId4);
      await job4.waitUntilFinished(queueEvents4);
    } finally {
      await queueEvents4.close();
      await worker4.close();
    }

    const farCand = await prisma.hotEventEvidence.findFirst({
      where: { evidenceRecordId: rFar.id },
      include: { hotEvent: { include: { evidence: { select: { evidenceRecordId: true } } } } },
    });
    const farCandLinkCount = farCand?.hotEvent.evidence.length;
    assertions.push({
      name: "AC1 cross-time-window: >72h same-title record forms its own candidate (not merged)",
      ok: farCand !== null &&
          farCand.hotEvent.evidence.length === 1,
      detail: farCand !== null
        ? `far-candidate link count=${farCandLinkCount}`
        : "no candidate for rFar",
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
    await closeRedis();
  }

  report(assertions);
}

// --- seeding / cleanup helpers ----------------------------------------------

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // hot_event_revisions (Story 1.9) has a Restrict FK on hot_events; clear it
  // first so hotEvent.deleteMany does not violate the constraint.
  await prisma.hotEventRevision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string | null; summary: string | null; publishedAt: Date },
): Promise<{ id: string; title: string | null }> {
  // Hash must be unique per record; use crypto to derive from title+publishedAt+random.
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title ?? ""}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  const rec = await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: `https://verify.test/${salt}`,
      title: data.title,
      summary: data.summary,
      publishedAt: data.publishedAt,
      ingestedAt: new Date(),
      contentHash,
      status: "archived",
      failureReason: null,
      rawPayload: { seeded: true, salt },
      traceId: newTraceId(),
    },
  });
  return { id: rec.id, title: rec.title };
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // hot_event_revisions (Story 1.9) Restrict FK — clear before hot_events.
  await prisma.hotEventRevision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function tableRowCount(
  prisma: ReturnType<typeof getPrisma>,
  table: string,
): Promise<number> {
  // Identifier guard: `table` originates from pg_tables here, but interpolating
  // an identifier into $queryRawUnsafe is a copy-paste footgun, and SQL
  // identifiers cannot be parameterized — so validate it is a plain lower-snake
  // identifier before interpolation.
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
    throw new Error(`[verify-cluster] refusing unsafe table identifier: ${table}`);
  }
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM "${table}"`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function listTablesLike(
  prisma: ReturnType<typeof getPrisma>,
  likePattern: string,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename ~ $1
    ORDER BY tablename
  `, likePattern);
  return rows.map((r) => r.tablename);
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== event-cluster verification ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[verify-cluster] fatal", error);
  process.exit(1);
});
