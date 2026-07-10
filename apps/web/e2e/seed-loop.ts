/**
 * Seed script for the @loop e2e — Story 2.5 (cross-surface return loop).
 *
 * Run with: pnpm --filter web seed:loop
 *           (tsx e2e/seed-loop.ts)
 *
 * Self-contained: produces ONE published hot event that is SIMULTANEOUSLY a
 * member of all three forward surfaces:
 *   - in the homepage feed (published → published_hot_events summary row),
 *   - a theme member via generateThemes + refreshPublishedReadModel
 *     (StubThemeAdapter, test-only) → /topics/{slug} member link,
 *   - a daily entry via generateDailyDigest + refreshPublishedDailyDigest
 *     (StubDigestAdapter, test-only) → /daily?date={coverageDate} entry link.
 *
 * This is the precondition for testing the UX-DR12 reading-context return path
 * on all three list origins (home / theme / daily): the same published event
 * must be reachable as a detail-navigation target from all three, so that
 * BackLink's originating-context restoration can be exercised in each
 * direction.
 *
 * Coverage date: uses the CURRENT UTC day (not a fixed historical date) so the
 * single event simultaneously passes the feed `?window=today` recency filter
 * (>= start of current UTC day) AND the daily digest eligible filter
 * (latestEvidenceAt UTC day = coverageDate). A fixed historical date would make
 * the feed `?window=today` filter exclude the event. The coverageDate is
 * captured in the return value so the spec is date-independent.
 *
 * Timezone determinism (P1 fix): when the seed runs in the 00:00–02:00 UTC
 * window, a naive `nowMs - 2*HOUR` timestamp lands on the PREVIOUS UTC day, so
 * the feed `?window=today` filter AND the daily-digest coverageDate UTC-day-
 * equality filter BOTH exclude the event → the cross-surface test breaks
 * deterministically. To stay safe at any run time, event timestamps are clamped
 * to `Math.max(nowMs - 2*HOUR, coverageMs + 3*HOUR)` (always at least 3h into
 * the current UTC day), where coverageMs = start-of-current-UTC-day. The feed
 * today-window is `>= start-of-current-UTC-day` and the daily coverageDate
 * filter is UTC-day-equality, so the clamp satisfies both.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, seed-market-reaction.ts, seed-associations.ts,
 * seed-themes.ts, seed-daily.ts, or any other seed (zero-change contract).
 * Clears the full table set (including the 2.3 theme tables + 2.4 digest
 * tables) so re-runs are deterministic.
 */

import {
  clusterEvents,
  decideReview,
  generateDailyDigest,
  generateExplanation,
  generateThemes,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  refreshPublishedDailyDigest,
  resetPrisma,
  STUB_THEME_LABEL,
  STUB_THEME_SLUG,
  StubDigestAdapter,
  StubThemeAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;

/**
 * Minimum number of filler events that share the stub theme slug + the daily
 * coverageDate. Exposed so loop.spec.ts can assert feed/theme/daily pages are
 * tall enough to scroll (P5: a future drop in filler count fails with a clear
 * signal). >=10 published members on every surface makes each list page taller
 * than 1500px on a 1280x720 viewport, enough for a >1000px pre-click scroll.
 */
export const MIN_FILLER_COUNT = 10;

export async function seedLoopContext(): Promise<{
  loopHotEventId: string;
  loopTitle: string;
  themeSlug: string;
  themeLabel: string;
  coverageDate: string; // ISO YYYY-MM-DD
  /** Number of filler members that share the stub slug + coverageDate. */
  fillerCount: number;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts + the 2.3
  // theme tables + 2.4 digest tables, order respects FK constraints). The 2.4
  // digest tables (daily_digests + published_daily_digests) have NO FK to
  // hot_events so they are independent of the hot_events clear order — but we
  // clear them at the top to keep reset ordering uniform. Deterministic
  // re-runs; does NOT touch other seeds.
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "loop-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Use the CURRENT UTC day as the coverage date. This is required so the
  // single seeded event simultaneously:
  //   - appears in the homepage feed under the `?window=today` filter
  //     (latestEvidenceAt >= start of current UTC day), AND
  //   - is eligible for the daily digest whose coverageDate = today UTC
  //     (generateDailyDigest filters by latestEvidenceAt UTC day = coverageDate).
  // A fixed historical date would make the feed `?window=today` filter exclude
  // the event (latestEvidenceAt too old), breaking the three-way return test.
  // The coverageDate is captured in the return value so the spec is
  // date-independent (re-runs work on any day).
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  // Normalize to the UTC day start (midnight) for coverageDate so it matches
  // the daily digest's coverageDate key (Date equality is by instant).
  const coverageMs = Date.UTC(
    nowDate.getUTCFullYear(),
    nowDate.getUTCMonth(),
    nowDate.getUTCDate(),
  );
  const coverageDate = new Date(coverageMs);
  // Timezone-deterministic clamp (P1): when the seed runs in 00:00–02:00 UTC,
  // `nowMs - 2*HOUR` lands on the previous UTC day and BOTH the feed
  // `?window=today` filter (`>= start of current UTC day`) AND the daily
  // `coverageDate` UTC-day-equality filter exclude the event. Clamp to
  // `coverageMs + 3*HOUR` so the timestamp is always at least 3h into the
  // current UTC day regardless of run time. The 3h offset is a safety margin:
  // it is well past midnight UTC and still comfortably within today's window
  // for feed `?window=today` and daily coverageDate filters.
  const eventTime = new Date(Math.max(nowMs - 2 * HOUR, coverageMs + 3 * HOUR));

  await seedRecord(prisma, source.id, {
    title: "芯片代工产能紧张加剧",
    summary: "晶圆代工产能持续紧张影响多个下游行业",
    url: `https://verify.test/芯片代工-loop`,
    publishedAt: eventTime, // always on the current UTC day (P1 clamp)
  });

  // Filler events (P2): these are ADDITIONAL published events that are members
  // of ALL THREE forward surfaces alongside the loop target. They are NOT the
  // cross-surface loop target (only the first event above carries the
  // loopHotEventId / loopTitle contract), but they ALL share the stub theme
  // slug AND land on the same coverageDate so the theme page (`/topics/{slug}`)
  // and the daily page (`/daily?date=…`) list >=10 entries and are naturally
  // tall enough to scroll past 1000px on a 1280x720 viewport. Previously the
  // theme + daily pages had only ONE member and needed an injected spacer;
  // making them naturally tall means the spacer-injection hack can be dropped
  // and the scroll restore assertion is meaningful on ALL three list surfaces.
  // Each filler has a unique title so clustering produces distinct candidates
  // (no merge). They land on the current UTC day (P1 clamp) so `?window=today`
  // and the daily coverageDate filter both include them.
  const FILLER_TITLES = [
    "稀土出口配额调整",
    "锂矿资源储量公布",
    "新能源汽车销量再创新高",
    "光伏产业链价格波动",
    "风电装机容量持续增长",
    "储能招投标规模扩大",
    "氢能产业规划落地",
    "特高压建设工程启动",
    "智能电网改造加速",
    "抽水蓄能电站投产",
    "核电项目核准批复",
    "煤炭产能核增落地",
    "天然气管道贯通",
    "电网投资计划下达",
    "充电桩建设加速",
    "动力电池产能扩张",
    "废旧电池回收体系建立",
    "碳酸锂期货上市",
    "钴镍资源海外布局",
    "铜矿产量预期调整",
  ];
  for (const title of FILLER_TITLES) {
    await seedRecord(prisma, source.id, {
      title,
      summary: "填充事件用于 feed / 主题 / 日报滚动测试",
      url: `https://verify.test/filler-${title}`,
      publishedAt: eventTime, // same UTC day as the loop target (P1 clamp)
    });
  }

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < MIN_FILLER_COUNT + 1) {
    throw new Error(
      `[seed-loop] expected >= ${MIN_FILLER_COUNT + 1} candidates after cluster, got ${pending.length}`,
    );
  }
  // The loop target is the 芯片代工 event. The filler events are also published
  // (with theme + daily membership) so the feed / theme page / daily page are
  // all naturally tall enough for scroll testing.
  const loopCandidate = pending.find((c) => c.title.includes("芯片代工"))!;
  const fillerCandidates = pending.filter((c) => c.id !== loopCandidate.id);

  // Publish the loop event: generate explanation, then approve. approve flips
  // to published and refreshPublishedReadModel projects the summary row into
  // published_hot_events (so it appears in the homepage feed).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: loopCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: loopCandidate.id,
    outcome: "approve",
    reviewer: "loop-e2e-seeder",
    note: "seed published for cross-surface return-loop e2e",
  });

  // Publish the filler events (explanation + approve) so they appear in the
  // feed alongside the loop event, making the feed naturally scrollable.
  for (const filler of fillerCandidates) {
    await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: filler.id,
    });
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: filler.id,
      outcome: "approve",
      reviewer: "loop-e2e-seeder",
      note: "seed filler published for feed / theme / daily scroll height",
    });
  }

  // Make EVERY published event a theme member via generateThemes
  // (StubThemeAdapter, test-only). All members share the stub slug, so
  // /topics/{slug} lists >=10 member links — tall enough to scroll without an
  // injected spacer. After appending each theme set, refreshPublishedReadModel
  // (publish) projects it into published_hot_event_themes (same pattern as
  // seed-themes.ts).
  const { refreshPublishedReadModel } = await import("@aguhot/core");
  for (const candidate of [loopCandidate, ...fillerCandidates]) {
    await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter: new StubThemeAdapter(),
    });
    // Re-refresh to project the appended set. (decideReview's internal refresh
    // ran before the set existed; this second refresh projects it — same
    // pattern the themes/associations/market-reaction seeds use.)
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
  }

  // Make EVERY published event a daily entry via generateDailyDigest
  // (StubDigestAdapter, test-only). All events' latestEvidenceAt UTC day =
  // coverageDate (seeded above via the P1 clamp), so the eligible filter
  // includes ALL of them. The digest is generated ONCE with all eligible
  // hotEventIds (the StubDigestAdapter returns a conclusion for each), so
  // /daily?date={coverageDate} lists >=10 entry links — tall enough to scroll
  // without an injected spacer.
  const digestResult = await generateDailyDigest({
    prisma,
    traceId: newTraceId(),
    coverageDate,
    adapter: new StubDigestAdapter(),
  });
  if (digestResult === null) {
    throw new Error(
      `[seed-loop] generateDailyDigest returned null — expected a digest with the seeded events`,
    );
  }
  if (digestResult.entries.length < MIN_FILLER_COUNT + 1) {
    throw new Error(
      `[seed-loop] digest entries ${digestResult.entries.length} < expected ${MIN_FILLER_COUNT + 1} (loop + fillers all on coverageDate)`,
    );
  }
  await refreshPublishedDailyDigest({
    prisma,
    traceId: newTraceId(),
    coverageDate,
  });

  resetPrisma();

  return {
    loopHotEventId: loopCandidate.id,
    loopTitle: loopCandidate.title,
    themeSlug: STUB_THEME_SLUG,
    themeLabel: STUB_THEME_LABEL,
    coverageDate: coverageDate.toISOString().slice(0, 10), // YYYY-MM-DD
    fillerCount: fillerCandidates.length,
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

// Run directly (tsx e2e/seed-loop.ts) — but NOT when imported by the e2e spec
// (which calls seedLoopContext() itself in a beforeAll to capture the ids). ESM
// direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedLoopContext();
  console.log(
    `[seed-loop] loopHotEventId: ${result.loopHotEventId} (${result.loopTitle}) | theme: ${result.themeSlug} (${result.themeLabel}) | coverageDate: ${result.coverageDate} | fillers: ${result.fillerCount}`,
  );
  process.exit(0);
}
