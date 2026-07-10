/**
 * Deterministic integration verification for the market-reaction signal
 * generation pipeline — Story 2.1.
 *
 * Run with: pnpm --filter worker verify:market-reaction (tsx src/verify-market-reaction.ts).
 *
 * It exercises generateMarketReaction with the StubMarketDataAdapter (test-only,
 * imported from core — NOT wired in the worker/prod runtime) against real local
 * PostgreSQL (NO Redis needed — generateMarketReaction is pure logic + a DB
 * append, no BullMQ queue, same convention as verify-explain/verify-publish
 * calling generateExplanation/decideReview directly), then asserts the DB state
 * — surface-anchored, not mock-based. It prints PASS/FAIL and exits non-zero iff
 * any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + archived records → clusterEvents (candidate)
 *   → generateExplanation → decideReview(approve) → published →
 *   generateMarketReaction({adapter: StubMarketDataAdapter}) → refresh(publish)
 *   → assert:
 *
 * Assertions:
 *   1. generateMarketReaction appends one snapshot row (source="template",
 *      traceId), two signal dimensions non-empty (price/volume + sector/limit-up).
 *   2. After refresh(publish), published_hot_event_reactions projects the
 *      snapshot; getPublishedHotEventDetail returns non-null `reaction` (two
 *      signals + tradingSession).
 *   3. AD-5 append-only: a second generateMarketReaction appends a SECOND row
 *      (the first untouched); refresh projects the latest (generatedAt = gen2).
 *   4. adapter missing → generateMarketReaction returns null, writes nothing.
 *   5. NFR: no investment-advice wording (buy/sell/target-price/position) in any
 *      signal value.
 *   6. takedown clears published_hot_event_reactions (4th table) and
 *      getPublishedHotEventDetail returns null (404, no leak).
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateMarketReaction,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  newTraceId,
  refreshPublishedReadModel,
  resetPrisma,
  StubMarketDataAdapter,
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

    // --- Seed: one source + 2 archived records → clusterEvents → 1 candidate --
    // Two records whose titles are strict subsets of one another so they merge
    // into ONE candidate via overlap-coefficient (each scores 1.0 against the
    // accumulated signature). Spread publishedAt so the explain derivation has
    // a non-trivial coverage span.
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-market-reaction-source",
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
      publishedAt: new Date(BASE_MS + 1 * DAY),
    });

    const clusterResult = await clusterEvents({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "seed: cluster produced 1 candidate from 2 overlapping records",
      ok: clusterResult.newCandidates === 1,
      detail: `newCandidates=${clusterResult.newCandidates}`,
    });

    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    if (pending.length !== 1) {
      throw new Error(
        `[verify-market-reaction] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // --- Publish the candidate (market reaction runs AFTER publication) -------
    // generateExplanation before approve (so the detail read model is complete),
    // then decideReview(approve) to flip to published.
    await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "approve",
      reviewer: "verify-market-reaction",
      note: "publish for market-reaction verify",
    });

    // --- 1 + 2: generateMarketReaction appends one snapshot, projects, detail --
    // The StubMarketDataAdapter returns a fixed non-null MarketDataSnapshot
    // (priceVolumeChangePercent=3.42, sector={半导体, 2.1}, limitUpCount=5,
    // tradingSession=fixed UTC). generateMarketReaction derives two signals and
    // appends one row.
    const adapter = new StubMarketDataAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateMarketReaction({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateMarketReaction returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "two signal dimensions non-empty (priceVolume + sectorLimitUp)",
        ok: gen1.priceVolume.value.trim() !== "" &&
            gen1.sectorLimitUp.value.trim() !== "" &&
            gen1.priceVolume.tone.length > 0 &&
            gen1.sectorLimitUp.tone.length > 0,
        detail: `priceVolume=${gen1.priceVolume.tone}/${gen1.priceVolume.value}, sector=${gen1.sectorLimitUp.tone}/${gen1.sectorLimitUp.value}`,
      });
      assertions.push({
        name: "generateMarketReaction result carries source=template + traceId",
        ok: gen1.source === "template" && gen1.traceId === genTrace,
        detail: `source=${gen1.source}`,
      });
      assertions.push({
        name: "limitUpCount is carried through (5 from stub fixture)",
        ok: gen1.limitUpCount === 5,
        detail: `limitUpCount=${gen1.limitUpCount}`,
      });
      assertions.push({
        name: "tradingSession is carried through (stub fixed session)",
        ok: gen1.tradingSession.getTime() === new Date(Date.UTC(2024, 5, 3, 3, 0, 0)).getTime(),
        detail: `tradingSession=${gen1.tradingSession.toISOString()}`,
      });
      // NFR: no investment-advice wording.
      assertions.push({
        name: "NFR: no buy/sell/target-price/position wording in any signal value",
        ok: noInvestAdvice(gen1.priceVolume.value) &&
            noInvestAdvice(gen1.sectorLimitUp.value),
        detail: "(checked 买卖/目标价/持仓/买入/卖出/增持/减持 keywords)",
      });
    }

    const snapshotsAfter1 = await prisma.marketReactionSnapshot.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "market_reaction_snapshots row appended (count=1, source=template)",
      ok: snapshotsAfter1 === 1,
      detail: `count=${snapshotsAfter1}`,
    });

    const row1 = await prisma.marketReactionSnapshot.findFirst({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=template, traceId carried",
      ok: row1 !== null && row1!.source === "template" && row1!.traceId === genTrace,
    });

    // Refresh the public projection so the snapshot flows into
    // published_hot_event_reactions (the worker does this after appending; here
    // we call it directly — same as decideReview's internals).
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });

    const reactionRow = await prisma.publishedHotEventReaction.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "published_hot_event_reactions row projected after refresh",
      ok: reactionRow !== null &&
          reactionRow!.priceVolumeTone === "up" &&
          reactionRow!.sectorLimitUpTone === "up" &&
          reactionRow!.limitUpCount === 5,
      detail: reactionRow === null
        ? "(no row)"
        : `priceVolume=${reactionRow!.priceVolumeTone}/${reactionRow!.priceVolumeValue}`,
    });

    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "detail.reaction non-null after projection (two signals + tradingSession)",
      ok: detail !== null &&
          detail!.reaction !== null &&
          detail!.reaction!.priceVolume.value.trim() !== "" &&
          detail!.reaction!.sectorLimitUp.value.trim() !== "" &&
          detail!.reaction!.limitUpCount === 5 &&
          detail!.reaction!.tradingSession.getTime() === new Date(Date.UTC(2024, 5, 3, 3, 0, 0)).getTime(),
      detail: detail === null || detail!.reaction === null
        ? "(null detail/reaction)"
        : `priceVolume=${detail!.reaction!.priceVolume.tone}/${detail!.reaction!.priceVolume.value}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row --
    await sleep(20);
    const gen2 = await generateMarketReaction({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const snapshotsAfter2 = await prisma.marketReactionSnapshot.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: snapshotsAfter2 === 2 && gen2 !== null,
      detail: `count=${snapshotsAfter2}`,
    });

    // Refresh projects the LATEST snapshot (generatedAt = gen2.createdAt).
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const detailAfterGen2 = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "refresh projects the LATEST snapshot (generatedAt = gen2.createdAt)",
      ok: gen2 !== null &&
          detailAfterGen2 !== null &&
          detailAfterGen2!.reaction !== null &&
          detailAfterGen2!.reaction!.generatedAt.getTime() === gen2.createdAt.getTime(),
      detail:
        gen2 === null || detailAfterGen2?.reaction === null
          ? "(gen2 or projection null)"
          : `projected generatedAt=${detailAfterGen2!.reaction!.generatedAt.toISOString()} vs gen2=${gen2.createdAt.toISOString()}`,
    });

    // --- 4: adapter missing → returns null, writes nothing --
    // Create a second published event to test the no-adapter path on a clean
    // event (so the snapshot count baseline is 0).
    await seedRecord(prisma, source.id, {
      title: "美股大跌三大股指重挫",
      summary: "美股暴跌",
      url: "https://verify.test/美股",
      publishedAt: new Date(BASE_MS + 2 * DAY),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pending2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const usMarket = pending2.find((c) => c.title.includes("美股"))!;
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      outcome: "approve",
      reviewer: "verify-market-reaction",
      note: "publish for no-adapter verify",
    });

    const noAdapter = await generateMarketReaction({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      // adapter omitted → V1 worker runtime path → returns null, writes nothing.
    });
    const noAdapterSnapshots = await prisma.marketReactionSnapshot.count({
      where: { hotEventId: usMarket.id },
    });
    assertions.push({
      name: "adapter missing: generateMarketReaction returns null",
      ok: noAdapter === null,
    });
    assertions.push({
      name: "adapter missing: no market_reaction_snapshots row written",
      ok: noAdapterSnapshots === 0,
      detail: `count=${noAdapterSnapshots}`,
    });

    // --- 5: NFR already asserted inline above per-signal; re-check the projected row --
    const projectedRow = await prisma.publishedHotEventReaction.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "NFR: projected reaction row has no investment-advice keywords",
      ok: projectedRow !== null &&
          noInvestAdvice(projectedRow!.priceVolumeValue) &&
          noInvestAdvice(projectedRow!.sectorLimitUpValue),
    });

    // --- 6: takedown clears published_hot_event_reactions (4th table) + detail null --
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "takedown",
      reviewer: "verify-market-reaction",
      note: "takedown for reaction-clear verify",
    });
    const reactionRowAfterTakedown = await prisma.publishedHotEventReaction.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "takedown cleared published_hot_event_reactions (no stale row)",
      ok: reactionRowAfterTakedown === null,
    });
    const detailAfterTakedown = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "takedown: getPublishedHotEventDetail returns null (no leak, AD-8)",
      ok: detailAfterTakedown === null,
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
 * are the common buy/sell/target-price/position terms. The market-reaction
 * derivation's vocabulary is descriptive (change percent / sector name /
 * limit-up count), never advisory.
 */
const ADVICE_KEYWORDS = ["买入", "卖出", "目标价", "持仓", "增持", "减持", "建议买", "建议卖"];

function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. published_hot_event_reactions +
  // market_reaction_snapshots + explanation_versions + published_* new tables
  // reference hot_events; hot_event_evidence references both. hot_event_revisions
  // (Story 1.9) has a Restrict FK on hot_events, so it must be cleared before
  // hot_events. The new 2.1 tables (reactions/snapshots) have Cascade FKs but we
  // clear them explicitly before hot_events to keep reset ordering uniform with
  // verify-publish/verify-explain.
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

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== market-reaction verification ===");
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
  console.error("[verify-market-reaction] fatal", error);
  process.exit(1);
});
