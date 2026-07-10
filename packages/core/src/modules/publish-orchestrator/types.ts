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
