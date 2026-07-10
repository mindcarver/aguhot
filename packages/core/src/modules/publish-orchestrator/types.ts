/**
 * publish-orchestrator domain types: the read-model refresh options (existing,
 * Story 1.6) plus the public read query types (Story 1.7 feed, Story 1.8 detail).
 *
 * This module is AD-3's single write-owner of published_hot_events (Story 1.6),
 * published_hot_event_explanations + published_hot_event_evidence (Story 1.8),
 * and the single read-owner for the public read path: listPublishedHotEvents
 * (Story 1.7 feed) and getPublishedHotEventDetail (Story 1.8 detail) are the
 * only public consumers of these read models. Row existence = currently
 * published (no status column, no WHERE to forget).
 *
 * It never writes hot_events, review_decisions, publication_decisions, or any
 * evidence/source tables. The detail query is a pure read — it only SELECTs
 * published_hot_events + published_hot_event_explanations +
 * published_hot_event_evidence (never hot_events / evidence_records /
 * review_decisions / publication_decisions / hot_event_evidence /
 * explanation_versions).
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
