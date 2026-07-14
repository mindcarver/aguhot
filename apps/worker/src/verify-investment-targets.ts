/**
 * Deterministic integration verification for the investment-targets (候选标的池)
 * generation pipeline + projection. Mirrors verify-deepread's shape, adapted for
 * the candidate-pool table + the published_hot_event_investment_targets projection.
 *
 * Run with: pnpm --filter worker verify:investmenttargets
 *           (tsx src/verify-investment-targets.ts).
 *
 * Exercises generateInvestmentTargets with the StubTargetsAdapter (test-only,
 * imported from core — NOT wired in prod: the worker resolves the SDK adapter or
 * none) against real local PostgreSQL (no Redis — the generator is pure logic +
 * DB append). Prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed 1 source + 2 records → clusterEvents (1 candidate) →
 *   generateExplanation → decideReview(approve) → published →
 *   generateInvestmentTargets({adapter: StubTargetsAdapter}) →
 *   assert investment_targets + deep_reads appended →
 *   refreshPublishedReadModel(action:"publish") → assert projection + read model.
 *
 * Assertions:
 *   1. generateInvestmentTargets returns non-null; investment_targets row appended
 *      (source=ai, candidates = STUB_TARGETS.candidates).
 *   2. The run ALSO appended a deep_reads byproduct row (the agent produces both).
 *   3. refreshPublishedReadModel projects published_hot_event_investment_targets
 *      (non-null, candidates match) AND published_hot_event_deep_reads.
 *   4. getPublishedHotEventDetail.investmentTargets carries the projected pool.
 *   5. AD-5 append-only: a second call appends a second investment_targets row.
 *   6. adapter missing → returns null, writes nothing.
 *   7. AC fail-fast: a forbidden-phrase deepRead segment → THROWS.
 *   8. AC fail-fast: an over-length (>120 字) deepRead segment → THROWS.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateInvestmentTargets,
  getLatestInvestmentTargets,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  newTraceId,
  DEEP_READ_SEGMENT_MAX_LENGTH,
  refreshPublishedReadModel,
  resetPrisma,
  StubTargetsAdapter,
  STUB_TARGETS,
  type LlmTargetsResult,
  type TargetsAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const BASE_MS = Date.UTC(2024, 0, 1);
const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();
  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: 1 source + 2 overlapping records → 1 candidate → publish. ---
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-targets-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });
    await seedRecord(prisma, source.id, {
      title: "海外AI芯片需求激增",
      summary: "海外龙头AI芯片订单超预期",
      url: "https://verify.test/ai-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "海外AI芯片需求激增持续",
      summary: "AI芯片产业链出货上修",
      url: "https://verify.test/ai-2",
      publishedAt: new Date(BASE_MS + 2 * HOUR),
    });

    const clusterResult = await clusterEvents({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "seed: cluster produced 1 candidate from 2 overlapping records",
      ok: clusterResult.newCandidates === 1,
      detail: `newCandidates=${clusterResult.newCandidates}`,
    });

    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    if (pending.length !== 1) {
      throw new Error(`[verify-targets] expected 1 candidate, got ${pending.length}`);
    }
    const candidate = pending[0]!;

    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidate.id });
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "approve",
      reviewer: "verify-targets",
      note: "publish for targets verify",
    });

    // --- 1: generateInvestmentTargets appends an investment_targets row. ---
    const adapter = new StubTargetsAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateInvestmentTargets({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateInvestmentTargets returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null)" : "(non-null)",
    });

    const targetsRowsAfter1 = await prisma.investmentTarget.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "investment_targets row appended (count=1, source=ai)",
      ok: targetsRowsAfter1 === 1 && gen1 !== null && gen1.source === "ai",
      detail: `count=${targetsRowsAfter1}`,
    });
    assertions.push({
      name: "appended pool candidates = STUB_TARGETS.candidates (deterministic)",
      ok:
        gen1 !== null &&
        gen1.candidates.length === STUB_TARGETS.candidates.length &&
        gen1.candidates[0]?.name === STUB_TARGETS.candidates[0]?.name,
      detail: gen1 === null ? "(null)" : `n=${gen1.candidates.length}`,
    });
    assertions.push({
      name: "result carries modelId + promptVersion + traceId (NFR-7)",
      ok:
        gen1 !== null &&
        gen1.modelId.trim() !== "" &&
        gen1.promptVersion.trim() !== "" &&
        gen1.traceId === genTrace,
      detail: gen1 === null ? "(null)" : `modelId=${gen1.modelId}`,
    });

    // --- 2: the run ALSO appended a deep_reads byproduct row. ---
    const deepRowsAfter1 = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "byproduct: deep_reads row appended in the same run (count=1)",
      ok: deepRowsAfter1 === 1,
      detail: `count=${deepRowsAfter1}`,
    });

    // --- 3: refresh projects BOTH published_hot_event_investment_targets AND
    // published_hot_event_deep_reads. ---
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const targetsProjection = await prisma.publishedHotEventInvestmentTargets.findUnique({
      where: { hotEventId: candidate.id },
    });
    const deepProjection = await prisma.publishedHotEventDeepRead.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "projection: published_hot_event_investment_targets non-null with stub pool",
      ok:
        targetsProjection !== null &&
        targetsProjection.downgradeNote === STUB_TARGETS.downgradeNote,
      detail: targetsProjection === null ? "(null)" : `note=${targetsProjection.downgradeNote}`,
    });
    assertions.push({
      name: "projection: published_hot_event_deep_reads non-null (byproduct surfaced)",
      ok:
        deepProjection !== null &&
        deepProjection.impactSurface === STUB_TARGETS.deepRead.impactSurface,
      detail: deepProjection === null ? "(null)" : `impact=${deepProjection.impactSurface}`,
    });

    // --- 4: getPublishedHotEventDetail.investmentTargets carries the projected pool. ---
    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "read-model: detail.investmentTargets carries the projected candidates",
      ok:
        detail !== null &&
        detail.investmentTargets !== null &&
        detail.investmentTargets.candidates.length === STUB_TARGETS.candidates.length,
      detail:
        detail === null
          ? "(detail null)"
          : detail.investmentTargets === null
            ? "(targets null)"
            : `n=${detail.investmentTargets.candidates.length}`,
    });

    // --- 5: AD-5 append-only — a second call appends a second investment_targets row. ---
    await sleep(20);
    const gen2 = await generateInvestmentTargets({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const targetsRowsAfter2 = await prisma.investmentTarget.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second investment_targets row",
      ok: targetsRowsAfter2 === 2 && gen2 !== null,
      detail: `count=${targetsRowsAfter2}`,
    });

    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const latestViaRead = await getLatestInvestmentTargets({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "refresh projects the LATEST pool (getLatestInvestmentTargets non-null)",
      ok: latestViaRead !== null,
      detail: latestViaRead === null ? "(null)" : `n=${latestViaRead.candidates.length}`,
    });

    // --- 6: adapter missing → null, no write ---
    const rowsBeforeNoAdapter = await prisma.investmentTarget.count({
      where: { hotEventId: candidate.id },
    });
    const noAdapter = await generateInvestmentTargets({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      // adapter omitted → V1 honest-degradation path.
    });
    const rowsAfterNoAdapter = await prisma.investmentTarget.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "adapter missing: returns null, writes nothing",
      ok: noAdapter === null && rowsAfterNoAdapter === rowsBeforeNoAdapter,
      detail: `before=${rowsBeforeNoAdapter} after=${rowsAfterNoAdapter}`,
    });

    // --- 7: AC fail-fast — forbidden-phrase deepRead segment → THROWS ---
    const forbiddenAdapter: TargetsAdapter = {
      async generateInvestmentTargets(): Promise<LlmTargetsResult | null> {
        return {
          ...STUB_TARGETS,
          deepRead: {
            ...STUB_TARGETS.deepRead,
            impactSurface: "建议买入相关概念股，影响扩散。", // ACTION class 买入
          },
          modelId: "stub:forbidden",
          promptVersion: "targets-stub-v1",
        };
      },
    };
    let threwForbidden = false;
    try {
      await generateInvestmentTargets({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: forbiddenAdapter,
      });
    } catch {
      threwForbidden = true;
    }
    assertions.push({
      name: "AC: forbidden-phrase deepRead segment → throws (fail-fast)",
      ok: threwForbidden,
    });

    // --- 8: AC fail-fast — over-length (>120 字) deepRead segment → THROWS ---
    const overlength = "证".repeat(DEEP_READ_SEGMENT_MAX_LENGTH + 1);
    const overlenAdapter: TargetsAdapter = {
      async generateInvestmentTargets(): Promise<LlmTargetsResult | null> {
        return {
          ...STUB_TARGETS,
          deepRead: { ...STUB_TARGETS.deepRead, impactSurface: overlength },
          modelId: "stub:overlen",
          promptVersion: "targets-stub-v1",
        };
      },
    };
    let threwOverlen = false;
    try {
      await generateInvestmentTargets({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: overlenAdapter,
      });
    } catch {
      threwOverlen = true;
    }
    assertions.push({
      name: "AC: >120 字 deepRead segment → throws (fail-fast)",
      ok: threwOverlen && [...overlength].length > DEEP_READ_SEGMENT_MAX_LENGTH,
      detail: `len=${[...overlength].length}`,
    });

    // --- 8b: fail-fast throws wrote no extra investment_targets rows ---
    const rowsAfterFailFast = await prisma.investmentTarget.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AC: fail-fast throws wrote no extra rows (still count=2)",
      ok: rowsAfterFailFast === 2,
      detail: `count=${rowsAfterFailFast}`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- helpers -----------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Projections before source tables; investment_targets + its projection cleared
  // alongside the deep-read family.
  await prisma.publishedHotEventInvestmentTargets.deleteMany({});
  await prisma.investmentTarget.deleteMany({});
  await prisma.publishedHotEventDeepRead.deleteMany({});
  await prisma.deepRead.deleteMany({});
  await prisma.publishedTimelineEntry.deleteMany({});
  await prisma.recommendationReason.deleteMany({});
  await prisma.publishedDailyDigest.deleteMany({});
  await prisma.dailyDigest.deleteMany({});
  await prisma.publishedHotEventTheme.deleteMany({});
  await prisma.eventThemeSet.deleteMany({});
  await prisma.publishedHotEventAssociation.deleteMany({});
  await prisma.eventAssociationSet.deleteMany({});
  await prisma.publishedHotEventReaction.deleteMany({});
  await prisma.marketReactionSnapshot.deleteMany({});
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.hotEventRevision.deleteMany({});
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

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== investment-targets verification ===");
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
  console.error("[verify-targets] fatal", error);
  process.exit(1);
});
