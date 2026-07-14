/**
 * publish-orchestrator domain types: the read-model refresh options (existing,
 * Story 1.6) plus the public read query types (Story 1.7 feed, Story 1.8
 * detail, Story 2.2 association feed-filter).
 *
 * This module is AD-3's single write-owner of published_hot_events (Story 1.6),
 * published_hot_event_explanations + published_hot_event_evidence (Story 1.8),
 * published_hot_event_reactions (Story 2.1), and
 * published_hot_event_associations (Story 2.2); and the single read-owner for
 * the public read path: listPublishedHotEvents (Story 1.7 feed),
 * getPublishedHotEventDetail (Story 1.8 detail), and listPublishedAssociations
 * (Story 2.2 feed filter) are the only public consumers of these read models.
 * Row existence = currently published (no status column, no WHERE to forget).
 *
 * It never writes hot_events, review_decisions, publication_decisions,
 * explanation_versions, market_reaction_snapshots, event_association_sets, or
 * any evidence/source tables. The detail query is a pure read — it only SELECTs
 * published_hot_events + published_hot_event_explanations +
 * published_hot_event_reactions + published_hot_event_associations +
 * published_hot_event_evidence (never hot_events / evidence_records /
 * review_decisions / publication_decisions / hot_event_evidence /
 * explanation_versions / market_reaction_snapshots / event_association_sets).
 */

import type { PrismaClient } from "../../../generated/client.js";
import type { TargetCandidate } from "../investment-targets/types.js";

/**
 * Options for listPublishedHotEvents. `{ prisma, traceId }` mirrors the
 * established `listPendingCandidates({prisma,traceId})` query pattern. There is
 * deliberately NO `since` / window parameter: the query returns all published
 * rows ordered by priority (evidenceCount DESC + latestEvidenceAt DESC), and the
 * web layer applies any date-window filtering in JS (Design Notes: V1 scale is
 * tiny; windowing is a UI concern, not a domain rule). ponytail: no pre-embedded
 * consumerless `since` parameter.
 */
export interface ListPublishedHotEventsOptions {
  prisma: PrismaClient;
  traceId: string;
}

/**
 * One published hot-event summary — the minimal projection the public feed card
 * needs. Mirrors the published_hot_events read-model columns exactly (no
 * explanation/category/reaction fields — those land with 1.8/Epic 2 when there
 * is data and a consumer).
 *
 *   - hotEventId: stable id (PK of the read model row, FK to hot_events).
 *   - title: copied from the HotEvent at publish time.
 *   - evidenceCount: number of supporting evidence records (multi-source signal).
 *   - latestEvidenceAt: max publishedAt across member records (recency signal).
 *   - publishedAt: when this event first became public (stable across refreshes).
 */
export interface PublishedHotEventSummary {
  hotEventId: string;
  title: string;
  evidenceCount: number;
  latestEvidenceAt: Date;
  publishedAt: Date;
}

// --- Story 1.8: public detail read types -------------------------------------

/**
 * The link-status of a published evidence row. Derived from the evidence
 * record's url at projection time (publish-orchestrator writes it):
 *   - available:   url was present → render "原文链接 ↗".
 *   - unavailable: url was missing/empty → render "无原始链接" badge; the row
 *     is NEVER dropped for a missing link (AC2: dead links keep the record).
 *
 * Active HTTP liveness probing / archive snapshots are a separate deferred
 * concern (no dead-link writer exists today; link_status is derived from url
 * presence only).
 */
export const EvidenceLinkStatus = {
  Available: "available",
  Unavailable: "unavailable",
} as const;

export type EvidenceLinkStatusType = (typeof EvidenceLinkStatus)[keyof typeof EvidenceLinkStatus];

/**
 * One published evidence row — the projection the public detail timeline needs.
 * Mirrors the published_hot_event_evidence columns. `position` is the
 * chronological render order (publishedAt ASC, nulls last), assigned at
 * projection time so the public read is a single `orderBy position`.
 */
export interface PublishedEvidenceRow {
  id: string;
  hotEventId: string;
  sourceName: string;
  url: string | null;
  summary: string | null;
  publishedAt: Date | null;
  linkStatus: EvidenceLinkStatusType;
  position: number;
}

/**
 * Options for getPublishedHotEventDetail. Mirrors the established
 * `{ prisma, traceId, hotEventId }` query pattern. The query is a pure read of
 * the three published_* tables; it never touches raw ingest/operator tables.
 */
export interface GetPublishedHotEventDetailOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * The assembled public detail of one published hot event. Returned by
 * getPublishedHotEventDetail. Returns null when the event is not currently
 * published (no published_hot_events row) — the detail page then calls
 * notFound() (404), so unpublished ids do not leak (AD-8).
 *
 *   - hotEventId / title / evidenceCount / latestEvidenceAt / publishedAt:
 *     carried from the published_hot_events summary row (the feed projection).
 *   - explanation: the three partitions + provenance + generatedAt, or null
 *     when the explain job has not produced a version yet (honest degraded
 *     state — never a fabricated explanation).
 *   - reaction: the two market-reaction signals + tradingSession + provenance +
 *     generatedAt, or null when the market-reaction worker has not produced a
 *     snapshot yet (V1 prod: adapter resolves to none → honest degraded state,
 *     never a fabricated reaction). Story 2.1.
 *   - associations: the concept/industry/stock items + provenance + generatedAt,
 *     or null when generateAssociations has not produced a set yet (V1 prod: no
 *     worker, no adapter → honest degraded state, never fabricated items). Story
 *     2.2.
 *   - evidence: the chronological timeline rows (may be empty if projection
 *     happened before any evidence was linked; rare but honest).
 */
export interface PublishedHotEventDetail {
  hotEventId: string;
  title: string;
  /**
   * Operator-authored free-text tags (Story 1.9), projected from the effective
   * HotEventRevision.tags at publish/republish time. Empty array when no
   * revision exists or the revision's tag set is empty. Detail-page display
   * only — NOT surfaced on the feed (listPublishedHotEvents /
   * PublishedHotEventSummary intentionally do NOT carry tags; 1.7 feed contract
   * unchanged). Feed filtering by tag is Epic 2.2 taxonomy.
   */
  tags: string[];
  evidenceCount: number;
  latestEvidenceAt: Date;
  publishedAt: Date;
  explanation: {
    summary: string;
    whyItMatters: string;
    uncertainties: string;
    source: string;
    generatedAt: Date;
  } | null;
  /**
   * The market-reaction block (Story 2.1). Null when no snapshot was projected
   * (worker has not produced one / adapter unavailable / takedown cleared the
   * projection). The detail page renders the honest degraded state in that case.
   */
  reaction: PublishedHotEventReaction | null;
  /**
   * The association block (Story 2.2). Null when no set was projected (no
   * worker / adapter unavailable in V1 prod / takedown cleared the projection).
   * The detail page renders the honest degraded state in that case.
   */
  associations: PublishedHotEventAssociation | null;
  /**
   * The theme membership block (Story 2.3). Null when no theme set was
   * projected (theme-backfill worker resolved no adapter in V1 prod / generation
   * has not run / takedown cleared the projection). The detail page renders the
   * honest degraded state ("暂无已确认的主题关联。") in that case.
   */
  themes: PublishedHotEventTheme | null;
  /**
   * The AI 深读 block (Story 5.2). Null when no deep read was projected (deep-read
   * worker resolved no adapter in V1 prod / generation has not run / takedown
   * cleared the projection). The detail page renders the honest degraded state
   * ("AI 深读生成中。") under the 为什么重要 block in that case. Distinct from
   * `explanation` (which carries the summary/whyItMatters/uncertainties three-
   * partition that stays on the same detail page): deepRead carries a DIFFERENT
   * three-segment set (影响面/受益方/风险点) that coexists with explanation.
   */
  deepRead: PublishedHotEventDeepRead | null;
  /**
   * The 投资标的池 block (candidate pool). Null when no pool was projected
   * (investment-targets worker resolved no adapter / generation has not run /
   * takedown cleared the projection). The detail page renders the honest degraded
   * state in that case. Distinct from deepRead: this is the structured scored
   * candidate table; deepRead is the three-segment prose set.
   */
  investmentTargets: PublishedHotEventInvestmentTargets | null;
  evidence: PublishedEvidenceRow[];
}

/**
 * The projected public market-reaction block for one published hot event
 * (Story 2.1). Mirrors published_hot_event_reactions. The two signal dimensions
 * (priceVolume + sectorLimitUp) each map directly to a ReactionChip's
 * {tone, value}. tradingSession is the shared time context (epic: every signal
 * carries an explicit trading-session time context).
 *
 * Row existence = currently published reaction (no status column). Absent when
 * the worker has not produced a snapshot (V1 prod degrades honestly) — the
 * detail page shows the "市场反应数据暂不可用" degraded state.
 */
export interface PublishedHotEventReaction {
  priceVolume: { tone: string; value: string };
  sectorLimitUp: { tone: string; value: string };
  limitUpCount: number;
  tradingSession: Date;
  source: string;
  generatedAt: Date;
}

// --- Story 2.2: public association read types ---------------------------------

/**
 * One association item projected for public read — mirrors the
 * AssociationItem the theme-linking module stores in the Json `items` column.
 * The detail page groups items by `kind` (concept/industry/stock) and renders
 * each as a FilterPill link to `/?<kind>=<label>` (a filtered feed view). The
 * non-empty `mappingBasis` is AC2's explicit-mapping-basis guarantee, surfaced
 * on the detail page as the "关联依据：系统映射" provenance line.
 *
 *   - kind: concept / industry / stock. Drives the detail grouping + the feed
 *     filter dimension.
 *   - label: the entity identity (concept name / industry name / stock name).
 *     Descriptive, never advisory.
 *   - mappingBasis: NON-EMPTY provenance (e.g. "knowledge_base:v1"). AC2.
 */
export interface AssociationItem {
  kind: "concept" | "industry" | "stock";
  label: string;
  mappingBasis: string;
}

/**
 * The projected public association block for one published hot event
 * (Story 2.2). Mirrors published_hot_event_associations. `items` is the Json
 * column value typed as AssociationItem[].
 *
 * Row existence = currently published associations (no status column). Absent
 * when generateAssociations has not produced a set (V1 prod: no worker, no
 * adapter → never produced) — the detail page shows the "暂无已确认的概念 /
 * 行业 / 个股关联。" degraded state (AC3).
 */
export interface PublishedHotEventAssociation {
  items: AssociationItem[];
  source: string;
  generatedAt: Date;
}

/**
 * One row of listPublishedAssociations — the hotEventId→items projection the
 * feed uses for the association-dimension JS filter (Story 2.2). The web layer
 * builds a hotEventId→items map from this and filters the published event list
 * in memory (mirroring the 1.7 filterByWindow pattern; listPublishedHotEvents
 * stays filter-free).
 */
export interface PublishedAssociationRow {
  hotEventId: string;
  items: AssociationItem[];
}

/**
 * Options for listPublishedAssociations. `{ prisma, traceId }` mirrors the
 * established query pattern. There is deliberately NO filter parameter: the
 * query returns all published association rows and the web layer applies the
 * concept/industry/stock dimension filter in JS (same design as
 * listPublishedHotEvents — V1 scale is tiny, filtering is a UI concern, and a
 * SQL-level filter would split the "no associations at all" vs "dimension has
 * no matches" states across two reads). ponytail: no pre-embedded consumerless
 * filter parameter.
 */
export interface ListPublishedAssociationsOptions {
  prisma: PrismaClient;
  traceId: string;
}

// --- Story 2.3: public theme membership read types ----------------------------

/**
 * One theme membership reference projected for public read — mirrors the
 * ThemeRef the theme-linking module stores in the Json `items` column. The
 * detail page renders each theme as a FilterPill link to
 * `/topics/{slug}` (FR9, the theme-continuity jump). The /topics directory and
 * the /topics/[slug] page use the slug as the URL/addressing key and the label
 * for display (editorial serif title).
 *
 *   - slug: NON-EMPTY URL-safe identity (e.g. "chip-supply-chain"). Drives the
 *     /topics/{slug} route + the directory's distinct-theme set.
 *   - label: the theme's display identity (e.g. "芯片供应链"). Descriptive,
 *     never advisory.
 *   - mappingBasis: NON-EMPTY provenance (e.g. "knowledge_base:v1"). AC2.
 */
export interface ThemeRef {
  slug: string;
  label: string;
  mappingBasis: string;
}

/**
 * The projected public theme membership block for one published hot event
 * (Story 2.3). Mirrors published_hot_event_themes. `items` is the Json column
 * value typed as ThemeRef[].
 *
 * Row existence = currently published theme membership (no status column).
 * Absent when generateThemes has not produced a set (V1 prod: theme-backfill
 * worker resolves no adapter → never produced) — the detail page shows the
 * "暂无已确认的主题关联。" degraded state (AC3). Absent does NOT block the
 * existing summary/explanation/evidence/reaction/associations rendering.
 */
export interface PublishedHotEventTheme {
  items: ThemeRef[];
  source: string;
  generatedAt: Date;
}

// --- Story 5.2: public deep-read (AI 深读) read types ------------------------

/**
 * The projected public AI 深读 block for one published hot event (Story 5.2).
 * Mirrors published_hot_event_deep_reads. The three segments (影响面/受益方/风险点)
 * are each ≤ DEEP_READ_SEGMENT_MAX_LENGTH (120 字) and pass the 6-class wording
 * guardrail, enforced at deep-read write time (fail-fast). The detail page renders
 * them under the 为什么重要 block with the uniform <AiLabel>.
 *
 * Row existence = currently published deep read (no status column). Absent when the
 * deep-read worker has not produced a row (V1 prod: worker resolves no adapter →
 * never produced) — the detail page shows the "AI 深读生成中。" degraded state (AC3).
 * Absent does NOT block the existing summary/explanation/evidence/reaction/
 * associations/themes rendering.
 */
export interface PublishedHotEventDeepRead {
  /** 影响面 (impact surface). Descriptive, never advisory. */
  impactSurface: string;
  /** 受益方 (beneficiaries). Descriptive, never advisory. */
  beneficiaries: string;
  /** 风险点 (risk points). Descriptive, never advisory. */
  riskPoints: string;
  /** ExplanationSource union value carried from the latest DeepRead row ("ai" in V1). */
  source: string;
  generatedAt: Date;
}

/**
 * The projected public 投资标的池 block for one published hot event. Mirrors
 * published_hot_event_investment_targets. candidates is the Json column cast to
 * TargetCandidate[] (the investment-targets module's candidate shape). Row
 * existence = currently published pool. Absent when the worker has not produced
 * one (V1 degrades honestly) — the detail page shows the degraded state.
 */
export interface PublishedHotEventInvestmentTargets {
  newsConclusion: string;
  transmissionPath: string;
  candidates: TargetCandidate[];
  downgradeNote: string;
  /** ExplanationSource union value ("ai"). */
  source: string;
  generatedAt: Date;
}

/**
 * One row of listPublishedThemeMemberships — the hotEventId→ThemeRef[] map the
 * /topics directory and /topics/[slug] page use to derive the distinct-theme
 * set and filter member events (Story 2.3). The web layer builds a
 * hotEventId→items map from this and a slug→events reverse index in memory
 * (mirroring the 2.2 listPublishedAssociations + 1.7 filterByWindow JS-join
 * pattern; listPublishedHotEvents stays filter-free).
 */
export interface PublishedThemeMembershipRow {
  hotEventId: string;
  items: ThemeRef[];
}

/**
 * Options for listPublishedThemeMemberships. `{ prisma, traceId }` mirrors the
 * established query pattern. There is deliberately NO filter parameter: the
 * query returns all published theme-membership rows and the web layer applies
 * the slug filter + directory distinct-derivation in JS (same design as
 * listPublishedHotEvents / listPublishedAssociations — V1 scale is tiny,
 * filtering is a UI concern). ponytail: no pre-embedded consumerless filter
 * parameter.
 */
export interface ListPublishedThemeMembershipsOptions {
  prisma: PrismaClient;
  traceId: string;
}

// --- Story 3.1: public explanation summary read types (search 3rd corpus) -----

/**
 * One row of listPublishedHotEventExplanations — the hotEventId→summary
 * projection the public search-read path uses to match explanation summaries
 * (Story 3.1). FR12 names three search corpora: event titles, explanation
 * summaries, and theme names. The first corpus comes from
 * listPublishedHotEvents (title); the third from listPublishedThemeMemberships
 * (theme label). This sibling list fn surfaces `published_hot_event_explanations.summary`
 * so the search-read module can join all three corpora in JS (mirroring the
 * 2.2 association + 2.3 theme sibling-list pattern). Row existence = currently
 * published explanation (no status column, AD-3).
 */
export interface PublishedHotEventExplanationSummaryRow {
  hotEventId: string;
  summary: string;
}

/**
 * Options for listPublishedHotEventExplanations. `{ prisma, traceId }` mirrors
 * ListPublishedAssociationsOptions / ListPublishedThemeMembershipsOptions. There
 * is deliberately NO filter parameter: the query returns all published
 * explanation summary rows and the caller (search-read) joins + matches in JS
 * (same design as the other sibling list fns — V1 scale is tiny, filtering is
 * a search-read concern). ponytail: no pre-embedded consumerless filter
 * parameter.
 */
export interface ListPublishedHotEventExplanationsOptions {
  prisma: PrismaClient;
  traceId: string;
}

// --- Story 2.4: public daily-digest read types --------------------------------

/**
 * One daily-digest entry projected for public read — mirrors the
 * DailyDigestEntry the digest module stores in the Json `items` column. The
 * /daily page renders each entry as a clickable row linking to
 * `/events/{hotEventId}` (FR10, the daily→detail jump). hotEventId is a
 * data-only foreign-key-style link (the digest has NO FK to hot_events — it is
 * a coverageDate-keyed aggregate).
 *
 *   - hotEventId: data-only link to /events/{hotEventId}. If the event is later
 *     taken down, the link honestly 404s (AD-8) — the digest is a versioned
 *     point-in-time artifact and does NOT auto-recompute (staleness recompute
 *     deferred).
 *   - title: the event's title at digest generation time. Descriptive, never
 *     advisory.
 *   - conclusion: NON-EMPTY brief summary (from the adapter). AC2: descriptive,
 *     never advisory (no buy/sell/target-price/position).
 *   - latestEvidenceAt: ISO 8601 string of the event's most recent evidence
 *     time (for display — when did this event last update).
 *   - evidenceCount: number of supporting evidence records (multi-source signal
 *     for display).
 */
export interface DailyDigestEntry {
  hotEventId: string;
  title: string;
  conclusion: string;
  latestEvidenceAt: string; // ISO 8601
  evidenceCount: number;
  /** Editorial category (LLM-assigned). Mirrors digest/types.DailyDigestEntry. */
  category: string;
  /** Primary evidence source name (信源 attribution). Mirrors digest/types. */
  sourceName: string;
}

/**
 * The projected public daily digest for one coverageDate (Story 2.4). Mirrors
 * published_daily_digests. `entries` is the Json column value typed as
 * DailyDigestEntry[].
 *
 * Row existence = a currently-published digest for that coverageDate (no status
 * column). Absent when generateDailyDigest has not produced a digest (V1 prod:
 * daily-digest worker resolves no adapter → skip → never produced, OR the
 * coverageDate has no eligible published events) — the /daily page shows the
 * honest degraded state ("该覆盖日期的日报尚未生成。" + current coverage scope,
 * AC3). Absent does NOT block the existing feed/detail/theme rendering.
 */
export interface PublishedDailyDigest {
  coverageDate: Date;
  entries: DailyDigestEntry[];
  source: string;
  generatedAt: Date;
}

/**
 * One row of listPublishedDailyDigestCoverageDates — the coverageDate values
 * for which a published_daily_digests row exists. The /daily page uses this to
 * resolve the "latest digest" (the max coverageDate) when no ?date= query param
 * is present.
 */
export interface DigestCoverageDateRow {
  coverageDate: Date;
}

/**
 * Options for refreshPublishedDailyDigest. `{ prisma, traceId, coverageDate }`
 * — coverageDate-keyed (NOT hotEventId-keyed like refreshPublishedReadModel).
 * This is a SIBLING function to refreshPublishedReadModel, not a new branch:
 * the digest is a coverageDate-keyed aggregate (multiple events per digest),
 * so its projection key differs from the hotEventId-keyed published_hot_event_*
 * projections. See spec Design Notes for why a sibling function was chosen over
 * overloading refreshPublishedReadModel's contract.
 */
export interface RefreshPublishedDailyDigestOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
}

/**
 * Options for getPublishedDailyDigest. `{ prisma, traceId, coverageDate }` —
 * returns the published digest for that coverageDate, or null when none exists
 * (the /daily page degrades honestly).
 */
export interface GetPublishedDailyDigestOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
}

/**
 * Options for listPublishedDailyDigestCoverageDates. `{ prisma, traceId }` —
 * returns the distinct coverageDates that have a published digest, descending.
 * The /daily page uses the first row (latest coverageDate) as the default view.
 */
export interface ListPublishedDailyDigestCoverageDatesOptions {
  prisma: PrismaClient;
  traceId: string;
}

// --- Story 5.3: public trend-briefing (AI 趋势研判) read types -------------------

/**
 * The projected public AI 趋势研判 (cross-event trend briefing) for one coverageDate
 * (Story 5.3). Mirrors published_trend_briefings. The single briefing paragraph is
 * ≤ TREND_BRIEFING_MAX_LENGTH (200 字) and passes the 6-class wording guardrail, enforced
 * at trend-briefing write time (fail-fast). The /daily page renders it between the
 * coverage/generation metadata and the event list with the uniform <AiLabel>.
 *
 * Row existence = a currently-published trend briefing for that coverageDate (no status
 * column). Absent when generateTrendBriefing has not produced a briefing (V1 prod:
 * daily-digest worker resolves no llmAdapter → skip → never produced, OR the coverageDate
 * has no eligible published events) — the /daily page shows the "AI 趋势研判生成中。"
 * degraded state (AC3). Absent does NOT block the existing daily-digest rendering.
 *
 * Mirrors PublishedDailyDigest (coverageDate-keyed, no FK to hot_events).
 */
export interface PublishedTrendBriefing {
  coverageDate: Date;
  briefing: string;
  source: string;
  generatedAt: Date;
}

/**
 * Options for refreshPublishedTrendBriefing. `{ prisma, traceId, coverageDate }` —
 * coverageDate-keyed (NOT hotEventId-keyed like refreshPublishedReadModel). This is a
 * SIBLING function to refreshPublishedReadModel AND to refreshPublishedDailyDigest, not a
 * new branch: the trend briefing is a coverageDate-keyed aggregate (one paragraph
 * spanning the day's events), so its projection key differs from the hotEventId-keyed
 * published_hot_event_* projections. Mirrors refreshPublishedDailyDigest's sibling shape.
 */
export interface RefreshPublishedTrendBriefingOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
}

/**
 * Options for getPublishedTrendBriefing. `{ prisma, traceId, coverageDate }` — returns
 * the published trend briefing for that coverageDate, or null when none exists (the
 * /daily page degrades honestly).
 */
export interface GetPublishedTrendBriefingOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
}

// --- Story 4.1: published_timeline read model (AD-3b) ------------------------

/**
 * The A-share trading session a timeline entry's `occurredAt` falls into.
 * Stored as a String column (no TS enum, per erasableSyntaxOnly). Boundary
 * instants are Asia/Shanghai-local; see deriveSessionTag for the exact ranges:
 *   - pre_open:    09:00 <= local < 09:30 (集合竞价 + 开盘前)
 *   - intraday:    09:30 <= local < 11:30 or 13:00 <= local < 15:00 (连续竞价)
 *   - post_close:  15:00 <= local < 23:59:59 (收盘后) — also covers 11:30–13:00
 *                  (午间休市) since neither intraday continuous auction applies.
 *   - non_trading: any other local time on a non-trading day OR outside the
 *                  trading window (weekends, holidays, before 09:00).
 * Non-trading days fall back to natural-day grouping for trade_date (PRD §12 Q5).
 */
export const TimelineSessionTag = {
  PreOpen: "pre_open",
  Intraday: "intraday",
  PostClose: "post_close",
  NonTrading: "non_trading",
} as const;

export type TimelineSessionTagType =
  (typeof TimelineSessionTag)[keyof typeof TimelineSessionTag];

/**
 * Options for refreshPublishedTimelineForEvent — the per-HotEvent incremental
 * upsert/delete that runs INSIDE decideReview's $transaction beside
 * refreshPublishedReadModel (AD-3b method A, gate-atomic, zero visibility
 * window). `action` is the same PublishAction resolved by resolveTransition;
 * publish → upsert this event's folded timeline row, takedown → delete it,
 * none → no-op. The caller passes its `tx` transaction client cast to
 * PrismaClient (same pattern as refreshPublishedReadModel).
 */
export interface RefreshPublishedTimelineForEventOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  action: import("../review-workflow/types.js").PublishAction;
}

/**
 * Options for refreshPublishedTimelineAll — the periodic full self-heal
 * recompute (BullMQ job, AD-4). It recomputes the published_timeline_entries
 * projection for ALL currently-published HotEvents: re-inserts any missing
 * rows, deletes any rows whose HotEvent is no longer published, and re-derives
 * trade_date/session_tag/title/summary/folded ids for the current published
 * set. Corrective only — the main refresh path is the in-transaction
 * refreshPublishedTimelineForEvent. Idempotent (full overwrite of the table's
 * published content); failure leaves the prior projection readable.
 */
export interface RefreshPublishedTimelineAllOptions {
  prisma: PrismaClient;
  traceId: string;
}

/**
 * Options for listPublishedTimeline — the Web home feed read contract (AD-3 /
 * AD-3b). Reads only published_timeline_entries; never assembles time-order SQL
 * on the request path. `tradeDate` filters to one trading day (YYYY-MM-DD);
 * when omitted, returns the latest day that has entries. `sessionTag` filters
 * by A-share session (Story 4.3). `limit` caps the page (default 50). No cursor
 * pagination in V1 — tiny scale; mirror listPublishedHotEvents' full-read shape.
 */
export interface ListPublishedTimelineOptions {
  prisma: PrismaClient;
  traceId: string;
  tradeDate?: string;
  sessionTag?: TimelineSessionTagType;
  limit?: number;
}

/**
 * Options for listPublishedTimelineEntries — the filter-free full-table read
 * used by the search-read path (Story 4.4). Mirrors the established
 * `{ prisma, traceId }` query pattern. Deliberately NO `tradeDate` /
 * `sessionTag` / `category` parameter: the search corpus MUST cover all trade
 * dates, so this fn is the filter-free sibling of the date-scoped
 * `listPublishedTimeline` (which defaults to the latest trade_date, limit 50,
 * and therefore cannot serve as the search corpus). The caller (search-read)
 * matches + ranks in JS. ponytail: no pre-embedded consumerless filter param.
 */
export interface ListPublishedTimelineEntriesOptions {
  prisma: PrismaClient;
  traceId: string;
}

/**
 * One published timeline entry — the per-HotEvent folded projection the home
 * feed card renders. Mirrors published_timeline_entries columns. The 4.2 card
 * renders: occurredAt (timestamp) → sourceName → title → summary → evidence_count,
 * with `recommendationReason` as the Story 5.1 AI 解读 slot (NULL until 5.1).
 *   - hotEventId: stable FK to hot_events (whole card clicks into the detail page).
 *   - tradeDate / occurredAt / sessionTag: derived from the latest member
 *     evidence publishedAt (Asia/Shanghai trading-day framing).
 *   - sourceName: representative source name (latest member's source.name).
 *   - title: effective HotEvent title (latest revision overlay ?? HotEvent.title).
 *   - summary: one-line summary (latest ExplanationVersion.summary ?? "").
 *   - evidenceCount: number of member EvidenceRecords.
 *   - foldedEvidenceRecordIds: the set of member EvidenceRecord ids this entry
 *     folds (>= threshold → "同事件精选"; 1 source → single-element set).
 *   - recommendationReason: Story 5.1 AI 解读 slot; NULL here.
 */
export interface PublishedTimelineEntry {
  id: string;
  hotEventId: string;
  tradeDate: string;
  occurredAt: Date;
  sessionTag: TimelineSessionTagType;
  sourceName: string;
  title: string;
  summary: string;
  evidenceCount: number;
  foldedEvidenceRecordIds: string[];
  recommendationReason: string | null;
}

