/**
 * Deterministic integration verification for the explanation generation
 * pipeline — Story 1.8.
 *
 * Run with: pnpm --filter worker verify:explain (tsx src/verify-explain.ts).
 *
 * It exercises the generateExplanation derivation against real local PostgreSQL
 * (NO Redis needed — generateExplanation is pure logic + a DB append, no BullMQ
 * queue, same convention as verify:cluster/verify:publish calling clusterEvents/
 * decideReview directly), then asserts the DB state — surface-anchored, not
 * mock-based. It prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + archived records → clusterEvents (produce a
 *   candidate) → generateExplanation (append one version) → assert:
 *
 * Assertions:
 *   1. generateExplanation returns non-null with all three partitions non-empty.
 *   2. An ExplanationVersion row was appended (source="template", traceId).
 *   3. AD-5 append-only: calling generateExplanation AGAIN appends a SECOND row
 *      (the first row is untouched; both exist).
 *   4. getLatestExplanation returns the most recent (createdAt desc first).
 *   5. Determinism: derivePartitions is a pure function — the same input
 *      produces byte-identical partitions across two calls.
 *   6. No-evidence: generateExplanation on a candidate with no member evidence
 *      returns null and writes nothing.
 *   7. NFR: no investment-advice wording (buy/sell/target-price/position) in
 *      any partition.
 */

import {
  clusterEvents,
  derivePartitions,
  generateExplanation,
  getLatestExplanation,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records have deterministic publishedAt offsets.
const BASE_MS = Date.UTC(2024, 0, 1);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — the
  // derivation is pure logic + a DB append, no BullMQ queue.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 3 archived records → clusterEvents → 1 candidate --
    // Three records whose titles are strict subsets of one another so they
    // reliably merge into ONE candidate via overlap-coefficient (each scores
    // 1.0 against the accumulated signature). Spread publishedAt over > 1 day
    // so the whyItMatters coverage span is non-trivial. One record lacks a url
    // so the derivation's uncertainties partition has a real data gap to surface.
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-explain-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    await seedRecord(prisma, source.id, {
      title: "央行降准",
      summary: "央行宣布降准释放长期资金",
      url: "https://verify.test/降准-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "本次降准为全面降准",
      url: "https://verify.test/降准-2",
      publishedAt: new Date(BASE_MS + 1 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "央行宣布降准",
      summary: "降准措施正式实施",
      url: null, // missing url → uncertainties should surface this gap
      publishedAt: new Date(BASE_MS + 2 * DAY),
    });

    const clusterResult = await clusterEvents({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "seed: cluster produced 1 candidate from 3 overlapping records",
      ok: clusterResult.newCandidates === 1,
      detail: `newCandidates=${clusterResult.newCandidates}`,
    });

    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    if (pending.length !== 1) {
      throw new Error(
        `[verify-explain] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // --- 1 + 2: generateExplanation appends one version, three partitions non-empty --
    const genTrace = newTraceId();
    const gen1 = await generateExplanation({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "generateExplanation returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "three partitions are non-empty (summary / whyItMatters / uncertainties)",
        ok: gen1.summary.trim() !== "" &&
            gen1.whyItMatters.trim() !== "" &&
            gen1.uncertainties.trim() !== "",
        detail: `summary=${gen1.summary.length}c, why=${gen1.whyItMatters.length}c, unc=${gen1.uncertainties.length}c`,
      });
      assertions.push({
        name: "generateExplanation result carries source=template + traceId",
        ok: gen1.source === "template" && gen1.traceId === genTrace,
        detail: `source=${gen1.source}`,
      });
      assertions.push({
        name: "summary partition leads with the event title",
        ok: gen1.summary.startsWith(candidate.title),
        detail: `summary starts with: "${gen1.summary.slice(0, 20)}…"`,
      });
      // NFR: no investment-advice wording.
      assertions.push({
        name: "NFR: no buy/sell/target-price/position wording in any partition",
        ok: noInvestAdvice(gen1.summary) &&
            noInvestAdvice(gen1.whyItMatters) &&
            noInvestAdvice(gen1.uncertainties),
        detail: "(checked 买卖/目标价/持仓/买入/卖出/增持/减持 keywords)",
      });
    }

    const versionsAfter1 = await prisma.explanationVersion.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "explanation_versions row appended (count=1, source=template)",
      ok: versionsAfter1 === 1,
      detail: `count=${versionsAfter1}`,
    });

    const row1 = await prisma.explanationVersion.findFirst({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=template, traceId carried",
      ok: row1 !== null && row1!.source === "template" && row1!.traceId === genTrace,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row --
    // Wait a moment so createdAt differs (DB TIMESTAMP(3) = ms precision; two
    // inserts in the same ms could tie). A short delay guarantees strict order.
    await sleep(20);
    const gen2 = await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    const versionsAfter2 = await prisma.explanationVersion.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: versionsAfter2 === 2 && gen2 !== null,
      detail: `count=${versionsAfter2}`,
    });

    // --- 4: getLatestExplanation returns the most recent --
    const latest = await getLatestExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "getLatestExplanation returns the most recent version (createdAt desc)",
      ok: latest !== null && latest!.id === gen2!.explanationVersionId,
      detail: latest === null ? "(null)" : `id matches gen2`,
    });

    // --- 5: Determinism — derivePartitions is pure (same input, identical text) --
    // Reconstruct the derivation input from the same evidence set and assert
    // byte-identical partitions across two calls.
    const detInput = await collectDeriveInput(prisma, candidate.id);
    const det1 = derivePartitions(detInput.title, detInput.records);
    const det2 = derivePartitions(detInput.title, detInput.records);
    assertions.push({
      name: "determinism: derivePartitions is pure (two calls byte-identical)",
      ok: det1.summary === det2.summary &&
          det1.whyItMatters === det2.whyItMatters &&
          det1.uncertainties === det2.uncertainties,
    });
    // And the derivation matches what generateExplanation wrote (same input).
    assertions.push({
      name: "determinism: derivePartitions output matches the appended row",
      ok: gen1 !== null &&
          det1.summary === gen1.summary &&
          det1.whyItMatters === gen1.whyItMatters &&
          det1.uncertainties === gen1.uncertainties,
    });

    // --- 6: No-evidence — generateExplanation returns null, writes nothing --
    // Create a candidate with no member evidence by inserting a hot_events row
    // directly (event-assembly always links ≥1 record, so we bypass it for this
    // edge case — this mirrors how an evidence-less event would behave).
    const evidenceLessId = newTraceId();
    await prisma.hotEvent.create({
      data: {
        id: evidenceLessId,
        title: "无证据候选",
        clusterSignature: "无证据",
        publicationStatus: "candidate",
        traceId: newTraceId(),
      },
    });
    const versionsBeforeNoEv = await prisma.explanationVersion.count({
      where: { hotEventId: evidenceLessId },
    });
    const noEv = await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: evidenceLessId,
    });
    const versionsAfterNoEv = await prisma.explanationVersion.count({
      where: { hotEventId: evidenceLessId },
    });
    assertions.push({
      name: "no-evidence: generateExplanation returns null",
      ok: noEv === null,
    });
    assertions.push({
      name: "no-evidence: no explanation_versions row written",
      ok: versionsAfterNoEv === versionsBeforeNoEv,
      detail: `before=${versionsBeforeNoEv}, after=${versionsAfterNoEv}`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- helpers -----------------------------------------------------------------

/**
 * The investment-advice keywords the derivation must NEVER emit (NFR: the
 * product must not imply investment advice). The check is conservative — these
 * are the common buy/sell/target-price/position terms. The deterministic
 * derivation's vocabulary is descriptive (来源/覆盖/缺口/核验), never advisory.
 */
const ADVICE_KEYWORDS = ["买入", "卖出", "目标价", "持仓", "增持", "减持", "建议买", "建议卖"];

function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

interface DeriveInput {
  title: string;
  records: Array<{
    id: string;
    sourceName: string;
    title: string | null;
    summary: string | null;
    url: string | null;
    publishedAt: Date | null;
    status: string;
  }>;
}

/**
 * Collect the derivation input (title + member records) for a hot event, in the
 * same publishedAt-asc order generateExplanation uses. Used to feed
 * derivePartitions for the determinism assertion.
 */
async function collectDeriveInput(
  prisma: ReturnType<typeof getPrisma>,
  hotEventId: string,
): Promise<DeriveInput> {
  const event = await prisma.hotEvent.findUniqueOrThrow({
    where: { id: hotEventId },
    select: {
      title: true,
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              id: true,
              title: true,
              summary: true,
              url: true,
              publishedAt: true,
              status: true,
              source: { select: { name: true } },
            },
          },
        },
        orderBy: { evidenceRecord: { publishedAt: "asc" } },
      },
    },
  });
  return {
    title: event.title,
    records: event.evidence.map((l) => ({
      id: l.evidenceRecord.id,
      sourceName: l.evidenceRecord.source.name,
      title: l.evidenceRecord.title,
      summary: l.evidenceRecord.summary,
      url: l.evidenceRecord.url,
      publishedAt: l.evidenceRecord.publishedAt,
      status: l.evidenceRecord.status,
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. explanation_versions + published_* new
  // tables reference hot_events; hot_event_evidence references both.
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.explanationVersion.deleteMany({});
  await prisma.publicationDecision.deleteMany({});
  await prisma.reviewDecision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string; summary: string; url: string | null; publishedAt: Date },
): Promise<void> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: data.url,
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
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await resetState(prisma);
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== explain verification ===");
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
  console.error("[verify-explain] fatal", error);
  process.exit(1);
});
