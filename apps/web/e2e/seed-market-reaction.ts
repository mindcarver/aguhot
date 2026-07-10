/**
 * Seed script for the @market-reaction e2e — Story 2.1.
 *
 * Run with: pnpm --filter web seed:market-reaction
 *           (tsx e2e/seed-market-reaction.ts)
 *
 * Self-contained: produces TWO published events to cover the two I/O matrix rows
 * for the market-reaction block:
 *   - 新能源 (2 evidence rows) → PUBLISHED WITH a generated market-reaction
 *     snapshot (StubMarketDataAdapter, test-only) → exercises AC2 (two reaction
 *     chips + tradingSession time context visible).
 *   - 锂矿 (1 evidence row) → PUBLISHED WITHOUT any market-reaction snapshot →
 *     exercises AC3 (honest degraded state "市场反应数据暂不可用。", no chips).
 * Returns each hotEventId + title so market-reaction.spec.ts can drive
 * /events/{id} assertions.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, or any other seed (zero-change contract). Clears
 * the full table set (including the new market-reaction tables) so re-runs are
 * deterministic.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateMarketReaction,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
  StubMarketDataAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function seedMarketReactionEvents(): Promise<{
  withReactionHotEventId: string;
  withReactionTitle: string;
  withoutReactionHotEventId: string;
  withoutReactionTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts + the new 2.1
  // market-reaction tables, order respects FK constraints). hot_event_revisions
  // (Story 1.9) has a Restrict FK on hot_events, so it must be cleared before
  // hot_events. The new 2.1 tables (reactions/snapshots) have Cascade FKs but we
  // clear them explicitly before hot_events to keep reset ordering uniform.
  // Deterministic re-runs; does NOT touch seed-console/feed/detail.
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "market-reaction-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event record groups → 2 candidates. The 新能源 group is a
  // short-title + long-superset pair (overlap-coefficient = 1.0 → merge) with 2
  // records. The 锂矿 group stays a single record. Both get published; only
  // 新能源 gets a market-reaction snapshot.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const dayAgo = new Date(Date.now() - 1 * DAY);

  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量",
    summary: "新能源车销量突破历史峰值",
    url: `https://verify.test/新能源-销量`,
    publishedAt: recentAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "本月新能源乘用车零售销量同比大增",
    url: `https://verify.test/新能源-新高`,
    publishedAt: dayAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "锂矿资源储量公布",
    summary: "锂矿储量数据公布",
    url: `https://verify.test/锂矿`,
    publishedAt: dayAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 2) {
    throw new Error(
      `[seed-market-reaction] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  const toPublishWithReaction = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;
  const toPublishWithoutReaction = pending.find((c) => c.title.includes("锂矿")) ?? pending[1]!;

  // PUBLISHED WITH reaction: generate explanation, approve (flips to published),
  // then generateMarketReaction with the StubMarketDataAdapter (test-only), then
  // the publish refresh inside decideReview already projected the explanation +
  // evidence; we call refreshPublishedReadModel(publish) once more so the newly-
  // appended snapshot flows into published_hot_event_reactions (mirrors what the
  // market-reaction worker does after appending).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithReaction.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithReaction.id,
    outcome: "approve",
    reviewer: "market-reaction-e2e-seeder",
    note: "seed published with reaction for market-reaction e2e",
  });
  await generateMarketReaction({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithReaction.id,
    adapter: new StubMarketDataAdapter(),
  });
  // Re-refresh to project the appended snapshot into the public read model.
  // (decideReview's internal refresh ran before the snapshot existed; this second
  // refresh projects it — same pattern the market-reaction worker uses.)
  const { refreshPublishedReadModel } = await import("@aguhot/core");
  await refreshPublishedReadModel({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithReaction.id,
    action: "publish",
  });

  // PUBLISHED WITHOUT reaction: generate explanation + approve directly (no
  // generateMarketReaction) → the detail read model has a summary row but NO
  // reaction projection row, so the detail page renders the degraded state (AC3).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithoutReaction.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithoutReaction.id,
    outcome: "approve",
    reviewer: "market-reaction-e2e-seeder",
    note: "seed published without reaction for degraded-state e2e",
  });

  resetPrisma();

  return {
    withReactionHotEventId: toPublishWithReaction.id,
    withReactionTitle: toPublishWithReaction.title,
    withoutReactionHotEventId: toPublishWithoutReaction.id,
    withoutReactionTitle: toPublishWithoutReaction.title,
  };
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

// Run directly (tsx e2e/seed-market-reaction.ts) — but NOT when imported by the
// e2e spec (which calls seedMarketReactionEvents() itself in a beforeAll to
// capture the ids). ESM direct-run detection: only auto-run + exit when this
// module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedMarketReactionEvents();
  console.log(
    `[seed-market-reaction] withReaction: ${result.withReactionHotEventId} (${result.withReactionTitle}) | withoutReaction: ${result.withoutReactionHotEventId} (${result.withoutReactionTitle})`,
  );
  process.exit(0);
}
