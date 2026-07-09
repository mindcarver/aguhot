/**
 * Deterministic integration verification for the source-ingest pipeline.
 *
 * Run with: pnpm --filter worker verify:ingest (tsx src/verify-ingest.ts).
 *
 * It exercises every row of the spec I/O & Edge-Case Matrix against real local
 * PostgreSQL + Redis, then asserts the DB state — surface-anchored, not mock-
 * based. It prints PASS/FAIL and exits non-zero iff any assertion fails, so it
 * is CI-gateable.
 *
 * Assertions (AC1/AC2/AC3):
 *   1. Well-formed fixture items -> status "archived".
 *   2. Re-run -> record count does not increase (content_hash dedup, AC1).
 *   3. Items missing url / published_at -> status "missing_fields", traceable
 *      failure_reason (AC3).
 *   4. Broken source B -> EvidenceSource.lastError non-empty, but source A's
 *      items still archived (single-source isolation, AC3).
 *   5. Only evidence_ tables were written (no published_ or HotEvent tables,
 *      AC2 1.4 part: ingest product isolated from public read path).
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { QueueEvents } from "bullmq";

import {
  getPrisma,
  ingestSources,
  newTraceId,
  RssAdapter,
  resetPrisma,
} from "@aguhot/core";
import type { AdapterFactory } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import {
  SOURCE_INGEST_QUEUE_NAME,
  enqueueSourceIngest,
  registerSourceIngestWorker,
} from "./queues/source-ingest-queue.js";

const FIXTURE_PATH = await resolveFixturePath();

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

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
    // uuidv7 self-check — the system-wide id generator is hand-rolled RFC 9562
    // bit manipulation with no other coverage. Pin version/variant/timestamp/
    // uniqueness so a silent mask bug cannot ship green. Runs first; needs no
    // infra. (ponytail: non-trivial logic leaves one runnable check behind.)
    const idSamples = Array.from({ length: 1000 }, () => newTraceId());
    const first = idSamples[0]!;
    const embeddedMs = Number.parseInt(first.replace(/-/g, "").slice(0, 12), 16);
    assertions.push(
      {
        name: "uuidv7 version nibble is 7",
        ok: idSamples.every((id) => id[14] === "7"),
        detail: first,
      },
      {
        name: "uuidv7 variant high bits (8/9/a/b)",
        ok: first[19] === "8" || first[19] === "9" || first[19] === "a" || first[19] === "b",
        detail: first,
      },
      {
        name: "uuidv7 embeds current unix-ms timestamp",
        ok: Math.abs(embeddedMs - Date.now()) < 60_000,
        detail: `${first} (embedded ${embeddedMs})`,
      },
      {
        name: "uuidv7 1000-sample uniqueness",
        ok: new Set(idSamples).size === 1000,
      },
    );

    await resetState(prisma);
    const sourceA = await seedSourceA(prisma);
    const sourceB = await seedSourceB(prisma);

    // --- Run 1: enqueue a source-ingest job and await it via QueueEvents. ---
    const traceId = newTraceId();
    const worker = registerSourceIngestWorker();
    const queueEvents = new QueueEvents(SOURCE_INGEST_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job = await enqueueSourceIngest(traceId);
      await job.waitUntilFinished(queueEvents);
    } finally {
      await queueEvents.close();
      await worker.close();
    }

    // AC1: well-formed items archived.
    const recordsA = await prisma.evidenceRecord.findMany({
      where: { sourceId: sourceA.id },
    });
    const archived = recordsA.filter((r) => r.status === "archived");
    assertions.push({
      name: "AC1 well-formed fixture items archived",
      ok: archived.length === 2,
      detail: `expected 2 archived, got ${archived.length}`,
    });

    // AC3: missing-fields items traceable.
    const missingFields = recordsA.filter((r) => r.status === "missing_fields");
    assertions.push({
      name: "AC3 missing-fields items archived as missing_fields",
      ok: missingFields.length === 2,
      detail: `expected 2 missing_fields, got ${missingFields.length}`,
    });
    assertions.push({
      name: "AC3 missing-fields failure_reason names the field",
      ok: missingFields.every(
        (r) =>
          r.failureReason === "missing url" ||
          r.failureReason === "missing published_at",
      ),
      detail: missingFields.map((r) => r.failureReason).join(", "),
    });

    // AC3: broken source B isolated — lastError set, A still archived.
    const sourceBRow = await prisma.evidenceSource.findUnique({
      where: { id: sourceB.id },
    });
    assertions.push({
      name: "AC3 broken source B lastError recorded",
      ok: sourceBRow?.lastError !== null && sourceBRow?.lastError !== "",
      detail: `lastError=${sourceBRow?.lastError ?? "<null>"}`,
    });
    assertions.push({
      name: "AC3 broken source B produced zero records",
      ok: (await prisma.evidenceRecord.count({ where: { sourceId: sourceB.id } })) === 0,
    });

    // AC2 (1.4 part): only evidence_* written.
    const tables = await listTables(prisma);
    const nonEvidence = tables.filter(
      (t) => !t.startsWith("evidence_") && t !== "_prisma_migrations",
    );
    assertions.push({
      name: "AC2 only evidence_ tables present (no published_ or HotEvent)",
      ok: nonEvidence.length === 0,
      detail: `unexpected tables: ${nonEvidence.join(", ") || "(none)"}`,
    });

    // --- Run 2: dedup — same source, expect no new records. ---
    const countBefore = await prisma.evidenceRecord.count();
    const traceId2 = newTraceId();
    const worker2 = registerSourceIngestWorker();
    const queueEvents2 = new QueueEvents(SOURCE_INGEST_QUEUE_NAME, {
      connection: getRedis(),
    });
    try {
      const job2 = await enqueueSourceIngest(traceId2);
      await job2.waitUntilFinished(queueEvents2);
    } finally {
      await queueEvents2.close();
      await worker2.close();
    }
    const countAfter = await prisma.evidenceRecord.count();
    assertions.push({
      name: "AC1 dedup: re-run does not increase record count",
      ok: countAfter === countBefore,
      detail: `before=${countBefore}, after=${countAfter}`,
    });

    // Existing records unchanged (not rewritten) — spot check first archived.
    const archivedAfter = await prisma.evidenceRecord.findFirst({
      where: { sourceId: sourceA.id, status: "archived" },
    });
    assertions.push({
      name: "AC1 dedup: existing archived record trace_id unchanged (not rewritten)",
      ok: archivedAfter?.traceId === traceId,
      detail: `traceId=${archivedAfter?.traceId} (expected ${traceId})`,
    });

    // --- Cross-check the domain service directly (no queue) for parity. ---
    const directTraceId = newTraceId();
    await ingestSources({
      prisma,
      traceId: directTraceId,
      adapterFor: fixtureAdapterFactory,
    });
    const countAfterDirect = await prisma.evidenceRecord.count();
    assertions.push({
      name: "domain service direct call honors dedup (count stable)",
      ok: countAfterDirect === countAfter,
      detail: `direct=${countAfterDirect}, queue=${countAfter}`,
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
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function seedSourceA(
  prisma: ReturnType<typeof getPrisma>,
): Promise<{ id: string }> {
  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "verify-fixture-A",
      kind: "rss",
      feedUrl: `file://${FIXTURE_PATH}`,
      enabled: true,
    },
  });
  return { id: source.id };
}

async function seedSourceB(
  prisma: ReturnType<typeof getPrisma>,
): Promise<{ id: string }> {
  // A deliberately broken feed URL: the adapter will throw on fetch, which the
  // per-source try/catch in ingestSources isolates (AC3).
  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "verify-broken-B",
      kind: "rss",
      feedUrl: "file:///nonexistent/this-feed-does-not-exist.xml",
      enabled: true,
    },
  });
  return { id: source.id };
}

/**
 * Adapter factory that points rss at the committed fixture. Used for the
 * direct domain-service parity cross-check (the worker path already uses the
 * queue which resolves the same factory).
 */
const fixtureAdapterFactory: AdapterFactory = (source) => {
  if (source.kind === "rss") {
    return new RssAdapter({ feedUrl: source.feedUrl });
  }
  throw new Error(`[verify] unknown source kind: ${source.kind}`);
};

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function listTables(prisma: ReturnType<typeof getPrisma>): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return rows.map((r) => r.tablename);
}

// --- fixture path resolution -------------------------------------------------

async function resolveFixturePath(): Promise<string> {
  // apps/worker/src/verify-ingest.ts -> packages/core/test/fixtures/sample-feed.xml
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up from apps/worker/src to repo root, then into packages/core/test.
  const repoRoot = join(here, "..", "..", "..");
  return join(repoRoot, "packages", "core", "test", "fixtures", "sample-feed.xml");
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== source-ingest verification ===");
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
  console.error("[verify-ingest] fatal", error);
  process.exit(1);
});
