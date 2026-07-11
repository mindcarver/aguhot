/**
 * Seed script for the @search e2e — Story 3.1 (FR12 public search).
 *
 * Run with: pnpm --filter web seed:search
 *           (tsx e2e/seed-search.ts)
 *
 * Self-contained: produces published events that cover the three FR12 search
 * corpora + the relevance-tier ranking row + Latin case-insensitivity + a
 * dedicated takedown target:
 *   - (A) 标题命中 (title hit): a published event whose TITLE contains the
 *     title-query word 「芯片」 AND the shared tiering word 「稀土」. Tier 0
 *     (strong). Carrying 「稀土」 in the title lets the same event serve as the
 *     TITLE-tier side of the relevance-tiering assertion (it is the OLDER
 *     event). 「芯片」 still backs the standalone title-hit test.
 *   - (B) 摘要命中 (summary hit): a published event whose title does NOT contain
 *     「稀土」 but whose explanation summary DOES. Tier 1 (weaker). This requires
 *     a SEED-ONLY deterministic rewrite: `generateExplanation` derives its
 *     summary from the title + latest evidence summary (deterministic template),
 *     so to guarantee the summary contains 「稀土」 while the title does not, we
 *     run the full pipeline (clusterEvents → generateExplanation →
 *     decideReview(approve) → refreshPublishedReadModel(publish)) and then
 *     DIRECTLY upsert the `published_hot_event_explanations` row with a
 *     deterministic summary containing 「稀土」. This is a TEST-ONLY seed
 *     fixture, NOT a production behavior (production explanations are always
 *     derived via generateExplanation + operator review; the seed bypasses that
 *     purely to create a deterministic summary-hit corpus). Comment below flags
 *     this clearly. Event (B) is the NEWER event and serves as the SUMMARY-tier
 *     side of the relevance-tiering assertion.
 *   - (C) 主题命中 (theme hit): published events themed via StubThemeAdapter
 *     (test-only) so the stub theme label 「芯片供应链」 is reachable by
 *     searching 「半导体」 — wait, the stub label does not contain 「半导体」.
 *     Instead we theme event (A) and search for a substring of the stub label
 *     (「芯片」) so the theme hit is reachable via the theme corpus. The theme
 *     member count = number of published events sharing the stub slug.
 *   - (D) 拉丁大小写 (Latin case-insensitivity): a published event whose TITLE
 *     contains the Latin token 「GPU」. Searching 「gpu」 (lowercase) or 「GPU」
 *     must both hit it (toLowerCase normalization). Chinese has no case, so a
 *     Latin token is required to exercise this matrix row.
 *   - (E) 下线目标 (takedown target): a DEDICATED published event used only by
 *     the takedown test (AD-3/AD-8). Its title contains takedownQuery 「光伏」.
 *     The takedown test (run LAST in the serial describe) searches it, then
 *     calls refreshPublishedReadModel({ action: "takedown" }) to delete its
 *     published_* rows, then re-searches and asserts it is gone. No other test
 *     depends on it, so taking it down cannot break siblings.
 *   - (F) + (G) 同层时间序 (within-tier recency): TWO additional published
 *     events whose TITLES both contain the shared within-tier word 「电池」.
 *     Both are title-tier-0 hits for query 「电池」, so the within-tier
 *     recency tiebreaker is the ONLY thing ordering them. (F) is OLDER, (G) is
 *     NEWER; the spec asserts (G) renders BEFORE (F) — proving within-tier
 *     latestEvidenceAt DESC recency holds (a reversal here would be invisible to
 *     the cross-tier test, which only places events in DIFFERENT tiers).
 *   - (H) 主题排序 (theme ranking): a SEED-ONLY second theme slug「chip-design /
 *     芯片设计」 is projected onto BOTH event (A) and event (B) via a direct
 *     published_hot_event_themes upsert (following the same seed-only-fixture
 *     precedent as the deterministic summary upsert — production never writes
 *     published_* outside publish-orchestrator's projectors). Slug A
 *     (chip-supply-chain, 芯片供应链) keeps memberCount=1 (event A only); slug B
 *     (chip-design, 芯片设计) has memberCount=2 (events A + B). Both labels
 *     contain the shared theme-ranking word 「芯片」 so a single query surfaces
 *     BOTH theme hits, and the spec asserts the memberCount=2 slug renders
 *     FIRST (proving memberCount DESC theme ranking — invisible to the existing
 *     single-theme test).
 *
 * Ranking row (AC1 relevance tiering): the shared tiering word 「稀土」 hits
 * event (A) in its TITLE (tier 0) AND event (B) only in its explanation SUMMARY
 * (tier 1); event (A) is OLDER than event (B). The spec asserts (A) renders
 * BEFORE (B) — proving title tier > summary tier regardless of recency.
 *
 * Returns the dynamic ids + titles + the deterministic query strings so
 * search.spec.ts can drive the assertions.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, seed-market-reaction.ts, seed-associations.ts,
 * seed-themes.ts, seed-daily.ts, seed-loop.ts, or any other seed (zero-change
 * contract). Clears the full table set so re-runs are deterministic.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateThemes,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  refreshPublishedReadModel,
  resetPrisma,
  STUB_THEME_LABEL,
  STUB_THEME_SLUG,
  StubThemeAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Query strings used by the spec. Kept as exported consts so the spec can
 * import them and stay in sync with the seed.
 */
export const TITLE_QUERY = "芯片";
export const SUMMARY_QUERY = "稀土";
/**
 * Shared tiering word: appears in event (A)'s TITLE (tier 0) AND event (B)'s
 * explanation SUMMARY (tier 1), but NOT in event (B)'s title. Event (A) is
 * OLDER than event (B). Searching this word must render (A) before (B) — title
 * tier overrides recency.
 */
export const TIERING_QUERY = "稀土";
/**
 * Substring of STUB_THEME_LABEL (「芯片供应链」) — exercises theme corpus.
 */
export const THEME_QUERY = "供应链";
/** Latin token seeded into a published event's title for case-insensitive tests. */
export const LATIN_TOKEN = "GPU";
/** Query matching the dedicated takedown-target event's title. */
export const TAKEDOWN_QUERY = "光伏";
/**
 * Shared within-tier recency word: appears in events (F) and (G)'s TITLES. Both
 * are title-tier-0 hits, so within-tier recency (latestEvidenceAt DESC) is the
 * ONLY ordering signal. (F) is OLDER, (G) is NEWER; the spec asserts (G) first.
 */
export const WITHIN_TIER_QUERY = "电池";
/**
 * Shared theme-ranking word: appears in BOTH theme labels (芯片供应链 slug A +
 * 芯片设计 slug B). One query surfaces both theme hits so memberCount DESC
 * ranking is observable. Slug B (memberCount=2) must render before slug A
 * (memberCount=1).
 */
export const THEME_RANKING_QUERY = "芯片";
/** Seed-only second theme slug for the theme-ranking fixture (memberCount=2). */
export const THEME_RANKING_SLUG_B = "chip-design";
/** Seed-only second theme label for the theme-ranking fixture. */
export const THEME_RANKING_LABEL_B = "芯片设计";
/** Deterministic summary injected into the summary-hit event's published row. */
const SUMMARY_HIT_INJECTED_SUMMARY = "本轮稀土出口配额调整影响下游磁材与电机供应链。";

export async function seedSearchContext(): Promise<{
  titleHitId: string;
  titleHitTitle: string;
  summaryHitId: string;
  summaryHitTitle: string;
  tieringTitleHitId: string;
  tieringSummaryHitId: string;
  tieringQuery: string;
  latinToken: string;
  latinHitId: string;
  takedownHitId: string;
  takedownQuery: string;
  themeSlug: string;
  themeLabel: string;
  themeMemberCount: number;
  titleQuery: string;
  summaryQuery: string;
  themeQuery: string;
  withinTierOlderId: string;
  withinTierNewerId: string;
  withinTierQuery: string;
  themeRankingSlugA: string;
  themeRankingLabelA: string;
  themeRankingSlugB: string;
  themeRankingLabelB: string;
  themeRankingMemberCountA: number;
  themeRankingMemberCountB: number;
  themeRankingQuery: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as seed-themes / seed-loop, order
  // respects FK constraints). The 2.4 digest tables are included for uniform
  // reset even though search does not read them. Deterministic re-runs; does
  // NOT touch other seeds.
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
  // Story 4.4: clear published_timeline_entries explicitly. decideReview(approve)
  // already writes timeline rows in-transaction (4.1 method A), so the seeded
  // events below get timeline rows — this clear guarantees no stale timeline
  // rows from a prior run survive (deterministic timeline-search assertions).
  // Placed near the other published_* clears; the hotEventId FK would cascade
  // on publishedHotEvent clear, but explicit is clearer + matches seed-timeline.
  await prisma.publishedTimelineEntry.deleteMany({});
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
      name: "search-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event record groups → 2 candidates. Event (A) has an EARLIER
  // latestEvidenceAt (so event B is newer — the ranking test asserts the
  // title-tier-0 event A ranks ABOVE the summary-tier-1 event B despite B being
  // newer). Event (A)'s title contains TITLE_QUERY 「芯片」. Event (B)'s title
  // does NOT contain SUMMARY_QUERY 「稀土」 (its summary will be deterministically
  // rewritten to contain it — see SUMMARY_HIT_INJECTED_SUMMARY below).
  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const recentAgo = new Date(Date.now() - 2 * HOUR);

  // Group A: 稀土芯片短缺 (title contains BOTH 「芯片」 for the title-hit test
  // AND 「稀土」 for the shared tiering word; earlier evidence → older
  // latestEvidenceAt). Carrying 「稀土」 in the title lets event A serve as the
  // TITLE-tier side of the relevance-tiering assertion while「芯片」 still backs
  // the standalone title-hit test.
  await seedRecord(prisma, source.id, {
    title: "稀土芯片短缺加剧全球供应链紧张",
    summary: "全球芯片供应链短缺影响汽车与手机行业",
    url: `https://verify.test/稀土芯片短缺-1`,
    publishedAt: twoDaysAgo,
  });
  // Add a second record in group A so its evidence count is > 1 (older record
  // keeps latestEvidenceAt at twoDaysAgo; this second record has the same times-
  // tamp to keep the event's latestEvidenceAt deterministic). Title also carries
  // both 「芯片」 and 「稀土」 so the cluster's canonical title keeps the shared
  // tiering word.
  await seedRecord(prisma, source.id, {
    title: "稀土芯片短缺加剧全球供应链紧张持续蔓延",
    summary: "芯片代工产能覆盖多个下游行业",
    url: `https://verify.test/稀土芯片短缺-2`,
    publishedAt: twoDaysAgo,
  });

  // Group B: 锂矿 (title does NOT contain 稀土; summary will be rewritten to
  // contain 稀土). Later evidence → newer latestEvidenceAt than event A.
  await seedRecord(prisma, source.id, {
    title: "锂矿资源储量勘探数据公布",
    summary: "锂矿储量勘探数据影响下游电池材料",
    url: `https://verify.test/锂矿`,
    publishedAt: recentAgo,
  });

  // Group D: GPU (Latin token in title for case-insensitive matching). Distinct
  // vocabulary so it clusters into its own event.
  await seedRecord(prisma, source.id, {
    title: "GPU算力需求推动先进制程扩产",
    summary: "AI训练与推理拉动GPU出货量增长",
    url: `https://verify.test/GPU算力`,
    publishedAt: recentAgo,
  });

  // Group E: 光伏 (dedicated takedown target; used ONLY by the takedown test
  // which runs LAST in the serial describe and mutates DB). Distinct vocabulary
  // so it clusters into its own event and no other test depends on it.
  await seedRecord(prisma, source.id, {
    title: "光伏组件价格波动影响装机预期",
    summary: "光伏产业链硅料价格调整传导至组件端",
    url: `https://verify.test/光伏价格`,
    publishedAt: recentAgo,
  });

  // Groups F + G: WITHIN-TIER RECENCY pair (T1). Both titles contain the shared
  // within-tier word 「电池」 but use DISTINCT surrounding vocabulary so they
  // cluster into TWO events (storage-battery vs materials-battery). F is OLDER
  // (threeDaysAgo, earlier than event A's twoDaysAgo) and G is NEWER (oneDayAgo,
  // between A and B). Both are title-tier-0 hits for query 「电池」; the only
  // ordering signal left is within-tier latestEvidenceAt DESC, so G must render
  // BEFORE F. A recency reversal WITHIN a tier would be invisible to the cross-
  // tier test (A vs B) which only exercises the tier boundary.
  const threeDaysAgo = new Date(Date.now() - 3 * DAY);
  const oneDayAgo = new Date(Date.now() - 1 * DAY);
  // Group F: 储能电池 (older).
  await seedRecord(prisma, source.id, {
    title: "储能电池产能扩张覆盖电网侧调峰需求",
    summary: "储能电池产业链扩产影响电网调峰配置",
    url: `https://verify.test/储能电池`,
    publishedAt: threeDaysAgo,
  });
  // Group G: 电池材料 (newer).
  await seedRecord(prisma, source.id, {
    title: "电池材料前驱体供应紧张推动价格上行",
    summary: "电池材料前驱体供应紧张影响正极材料成本",
    url: `https://verify.test/电池材料`,
    publishedAt: oneDayAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 6) {
    throw new Error(
      `[seed-search] expected >= 6 candidates after cluster, got ${pending.length}`,
    );
  }

  // Identify the candidates by their title vocabulary. Event A = title
  // containing 「芯片短缺」. Event B = title containing 「锂矿」. Event D = title
  // containing 「GPU」. Event E = title containing 「光伏」. Event F = title
  // containing 「储能电池」 (older within-tier pair). Event G = title containing
  // 「电池材料」 (newer within-tier pair). 「电池」 alone is too broad — F and G
  // both contain it; the distinct surrounding vocabulary uniquely identifies each.
  const titleCandidate = pending.find((c) => c.title.includes("芯片短缺"));
  const summaryCandidate = pending.find((c) => c.title.includes("锂矿"));
  const latinCandidate = pending.find((c) => c.title.includes("GPU"));
  const takedownCandidate = pending.find((c) => c.title.includes("光伏"));
  const withinTierOlderCandidate = pending.find((c) => c.title.includes("储能电池"));
  const withinTierNewerCandidate = pending.find((c) => c.title.includes("电池材料"));
  if (
    titleCandidate === undefined ||
    summaryCandidate === undefined ||
    latinCandidate === undefined ||
    takedownCandidate === undefined ||
    withinTierOlderCandidate === undefined ||
    withinTierNewerCandidate === undefined
  ) {
    throw new Error(
      `[seed-search] could not identify all 6 candidates among: ${pending.map((p) => p.title).join(" | ")}`,
    );
  }

  // --- Event A: title hit + theme membership (so theme corpus also resolves) ---
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: titleCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: titleCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published with title-hit + theme for search e2e",
  });
  // Add theme membership (StubThemeAdapter, test-only) so the stub slug/label is
  // reachable via the theme corpus.
  await generateThemes({
    prisma,
    traceId: newTraceId(),
    hotEventId: titleCandidate.id,
    adapter: new StubThemeAdapter(),
  });
  await refreshPublishedReadModel({
    prisma,
    traceId: newTraceId(),
    hotEventId: titleCandidate.id,
    action: "publish",
  });

  // --- Event B: summary hit (deterministic rewrite of published explanation) ---
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: summaryCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: summaryCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published with summary-hit for search e2e",
  });
  // refreshPublishedReadModel runs inside decideReview's transaction; no extra
  // generateThemes here (event B is NOT a theme member — keeps the theme member
  // count deterministic at 1, attributable solely to event A).

  // --- Event D: Latin token in title (case-insensitive matching) ---
  // Published so its title (containing 「GPU」) enters the published_hot_events
  // read model and is reachable by both 「gpu」 and 「GPU」 queries.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: latinCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: latinCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published with Latin title token for search e2e",
  });

  // --- Event E: dedicated takedown target (used ONLY by the takedown test) ---
  // Published so it initially appears in search; the takedown test (run LAST in
  // the serial describe) will call refreshPublishedReadModel({ action:
  // "takedown" }) to delete its published_* rows and assert it disappears.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: takedownCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: takedownCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published as dedicated takedown target for search e2e",
  });

  // --- Events F + G: within-tier recency pair (T1). Both published so their
  // titles enter published_hot_events. Both titles contain the shared within-
  // tier word 「电池」 so both are title-tier-0 hits for that query; the only
  // remaining ordering signal is within-tier latestEvidenceAt DESC. F is OLDER
  // (threeDaysAgo), G is NEWER (oneDayAgo) — the spec asserts G renders first.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: withinTierOlderCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: withinTierOlderCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published as older within-tier-recency event for search e2e",
  });
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: withinTierNewerCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: withinTierNewerCandidate.id,
    outcome: "approve",
    reviewer: "search-e2e-seeder",
    note: "seed published as newer within-tier-recency event for search e2e",
  });

  // SEED-ONLY DETERMINISTIC SUMMARY REWRITE (NOT a production behavior).
  //
  // generateExplanation derives summary from title + latest evidence summary
  // (deterministic template), so the derived summary for event B would NOT
  // contain SUMMARY_QUERY 「稀土」. To create a deterministic summary-hit corpus
  // (title excludes 「稀土」 but summary includes it), we directly upsert the
  // published_hot_event_explanations row with a fixed summary containing 「稀土」.
  // This bypasses the normal explanation pipeline PURELY to construct the test
  // fixture — production never writes published_* outside publish-orchestrator's
  // projectors, and the summary content here is an honest fixture (the word is
  // genuinely in the summary, matching what a real explanation might say about
  // a lithium/rare-earth-adjacent event).
  await prisma.publishedHotEventExplanation.upsert({
    where: { hotEventId: summaryCandidate.id },
    create: {
      hotEventId: summaryCandidate.id,
      summary: SUMMARY_HIT_INJECTED_SUMMARY,
      whyItMatters: "稀土与锂矿同属关键矿物，供应链调整影响下游。",
      uncertainties: "具体配额比例尚未公布。",
      explanationSource: "template",
      generatedAt: new Date(),
      traceId: newTraceId(),
    },
    update: {
      summary: SUMMARY_HIT_INJECTED_SUMMARY,
      traceId: newTraceId(),
    },
  });

  // TEST-ONLY: keep event B's timeline row summary in sync with the rewritten
  // explanation summary above. The direct explanation upsert above does NOT
  // refresh published_timeline_entries.summary (that row was projected earlier
  // inside decideReview(approve) from the THEN-current ExplanationVersion, so
  // its summary is stale relative to the injected 「稀土」 summary). Without
  // this, the timeline-search summary-hit row (Story 4.4 I/O-matrix) would not
  // match SUMMARY_QUERY 「稀土」 even though the event-side summary does — the
  // two corpora would drift, breaking the timeline summary-hit assertion. This
  // mirrors the explanation upsert's seed-only-fixture precedent (production
  // never writes published_* outside publish-orchestrator's projectors).
  // Only `summary` is mutated — the row keeps its original projection traceId
  // (overwriting the audit-origin field here would only confuse a future
  // "traceId must be the original projection traceId" invariant; the seed needs
  // nothing but the summary sync).
  await prisma.publishedTimelineEntry.update({
    where: { hotEventId: summaryCandidate.id },
    data: {
      summary: SUMMARY_HIT_INJECTED_SUMMARY,
    },
  });

  // SEED-ONLY THEME-RANKING FIXTURE (T2) (NOT a production behavior).
  //
  // The existing single-theme test seeds only STUB_THEME_SLUG (event A, label
  // 芯片供应链, memberCount=1), so memberCount DESC theme ranking is invisible.
  // To create a TWO-theme ranking fixture, we project a SECOND slug
  // (chip-design / 芯片设计) onto BOTH event A and event B via direct
  // published_hot_event_themes upserts. This mirrors the deterministic-summary-
  // upsert precedent above (seed-only fixture; production never writes
  // published_* outside publish-orchestrator's projectors). After the upserts:
  //   - slug A (chip-supply-chain, 芯片供应链): members {A} → memberCount 1.
  //     Event A's items become [stub_item, new_item] so it keeps its stub
  //     membership AND gains the new slug (the existing THEME_QUERY=供应链 test
  //     still resolves because the stub slug is still present).
  //   - slug B (chip-design, 芯片设计): members {A, B} → memberCount 2.
  //     Event B had no theme row; we CREATE one with [new_item].
  // Both labels contain 「芯片」 so a single query surfaces both theme hits and
  // the spec asserts memberCount=2 slug B renders FIRST. The items arrays below
  // match the ThemeRef[] shape ({slug,label,mappingBasis}) the projector writes.
  const themeRankingItemB = {
    slug: THEME_RANKING_SLUG_B,
    label: THEME_RANKING_LABEL_B,
    mappingBasis: "knowledge_base:v1",
  } as const;
  // Event A: merge new slug onto its existing stub theme row.
  await prisma.publishedHotEventTheme.upsert({
    where: { hotEventId: titleCandidate.id },
    create: {
      hotEventId: titleCandidate.id,
      items: [
        { slug: STUB_THEME_SLUG, label: STUB_THEME_LABEL, mappingBasis: "knowledge_base:v1" },
        themeRankingItemB,
      ],
      themeSource: "stub",
      generatedAt: new Date(),
      traceId: newTraceId(),
    },
    update: {
      items: [
        { slug: STUB_THEME_SLUG, label: STUB_THEME_LABEL, mappingBasis: "knowledge_base:v1" },
        themeRankingItemB,
      ],
      traceId: newTraceId(),
    },
  });
  // Event B: create its theme row carrying the new slug (memberCount for slug B
  // becomes {A, B} = 2).
  await prisma.publishedHotEventTheme.upsert({
    where: { hotEventId: summaryCandidate.id },
    create: {
      hotEventId: summaryCandidate.id,
      items: [themeRankingItemB],
      themeSource: "stub",
      generatedAt: new Date(),
      traceId: newTraceId(),
    },
    update: {
      items: [themeRankingItemB],
      traceId: newTraceId(),
    },
  });

  // Determine the actual publishedAt / latestEvidenceAt of the two events (read
  // from the published read model so the spec reasons about the same values the
  // search page sees). Event A is OLDER (twoDaysAgo evidence), event B is NEWER
  // (recentAgo evidence) — the ranking test asserts title-tier-0 A still ranks
  // above summary-tier-1 B despite B's recency.

  resetPrisma();

  // Theme member counts: slug A (chip-supply-chain) = 1 (event A only); slug B
  // (chip-design) = 2 (events A + B). The single-theme THEME_QUERY=供应链 test
  // still resolves to slug A (count 1); the THEME_RANKING_QUERY=芯片 test
  // surfaces BOTH slugs so memberCount DESC is observable.
  return {
    titleHitId: titleCandidate.id,
    titleHitTitle: titleCandidate.title,
    summaryHitId: summaryCandidate.id,
    summaryHitTitle: summaryCandidate.title,
    tieringTitleHitId: titleCandidate.id,
    tieringSummaryHitId: summaryCandidate.id,
    tieringQuery: TIERING_QUERY,
    latinToken: LATIN_TOKEN,
    latinHitId: latinCandidate.id,
    takedownHitId: takedownCandidate.id,
    takedownQuery: TAKEDOWN_QUERY,
    themeSlug: STUB_THEME_SLUG,
    themeLabel: STUB_THEME_LABEL,
    themeMemberCount: 1,
    titleQuery: TITLE_QUERY,
    summaryQuery: SUMMARY_QUERY,
    themeQuery: THEME_QUERY,
    withinTierOlderId: withinTierOlderCandidate.id,
    withinTierNewerId: withinTierNewerCandidate.id,
    withinTierQuery: WITHIN_TIER_QUERY,
    themeRankingSlugA: STUB_THEME_SLUG,
    themeRankingLabelA: STUB_THEME_LABEL,
    themeRankingSlugB: THEME_RANKING_SLUG_B,
    themeRankingLabelB: THEME_RANKING_LABEL_B,
    themeRankingMemberCountA: 1,
    themeRankingMemberCountB: 2,
    themeRankingQuery: THEME_RANKING_QUERY,
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

// Run directly (tsx e2e/seed-search.ts) — but NOT when imported by the e2e spec
// (which calls seedSearchContext() itself in a beforeAll to capture the ids). ESM
// direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedSearchContext();
  console.log(
    `[seed-search] titleHit: ${result.titleHitId} (${result.titleHitTitle}) | summaryHit: ${result.summaryHitId} (${result.summaryHitTitle}) | tiering: title=${result.tieringTitleHitId} summary=${result.tieringSummaryHitId} q=${result.tieringQuery} | latin: ${result.latinHitId} (${result.latinToken}) | takedown: ${result.takedownHitId} (${result.takedownQuery}) | theme: ${result.themeSlug} (${result.themeLabel}, members=${result.themeMemberCount}) | withinTier: older=${result.withinTierOlderId} newer=${result.withinTierNewerId} q=${result.withinTierQuery} | themeRanking: slugA=${result.themeRankingSlugA} (members=${result.themeRankingMemberCountA}) slugB=${result.themeRankingSlugB} (members=${result.themeRankingMemberCountB}) q=${result.themeRankingQuery}`,
  );
  process.exit(0);
}
