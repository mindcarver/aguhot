/**
 * publish-orchestrator domain types: the read-model refresh options (existing,
 * Story 1.6) plus the public read query types (Story 1.7).
 *
 * This module is AD-3's single write-owner of published_hot_events, and as of
 * Story 1.7 the single read-owner for the public read path: listPublishedHotEvents
 * is the first public consumer of the published_hot_events read model. Row
 * existence = currently published (no status column, no WHERE to forget).
 *
 * It never writes hot_events, review_decisions, publication_decisions, or any
 * evidence/source tables. listPublishedHotEvents is a pure read — it only SELECTs
 * published_hot_events (never hot_events / evidence_records / review_decisions /
 * publication_decisions / hot_event_evidence).
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
