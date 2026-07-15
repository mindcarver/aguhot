/**
 * event-assembly module barrel.
 *
 * The single write-owner of hot_events + hot_event_evidence (AD-2). Exports the
 * clustering pure logic (tokenize/signatureOf/clusterRecords), the DB service
 * (clusterEvents), and the publication-status/options/types. The Prisma client
 * and the shared id helpers live one level up and are re-exported from the
 * package barrel.
 *
 * This module never writes evidence_records (source-ingest owns those),
 * published_* read models (publish-orchestrator owns those), or any other
 * module's aggregate. It never sets publication_status to "published" — that
 * transition belongs to review-workflow (1.6).
 */

export { clusterEvents } from "./cluster-events.js";
export type {
  ClusterEventsOptions,
  ClusterEventsResult,
} from "./cluster-events.js";
export {
  clusterRecords,
  overlapCoefficient,
  signatureOf,
  tokenize,
  SIGNATURE_DELIMITER,
} from "./clustering.js";
export type { ClusterGroup } from "./clustering.js";
export { reviseHotEvent, normalizeTags } from "./revise-service.js";
// Story 7.1/7.2/7.4 — investment-relevance gate + saliency score (cluster-time
// base + publish-time market/association bonuses). Pure logic; event-assembly is
// the sole writer of the HotEvent fields it produces (AD-2b). publish-orchestrator
// reads the cluster base + market/association data read-only and writes the
// combined score into published_hot_events.saliency (its own read model).
export {
  judgeRelevance,
  scoreSaliency,
  saliencyTier,
  decideAutoPublishOutcome,
  marketReactionBonus,
  associationBonusPoints,
  combineSaliency,
  RelevanceLabel,
  SALIENCY_WEIGHTS,
  SALIENCY_BONUS_CAPS,
  SALIENCY_LOW_THRESHOLD,
  SALIENCY_HIGH_THRESHOLD,
  BREADTH_SATURATION_SOURCES,
  VELOCITY_WINDOW_MS,
} from "./saliency.js";
export type {
  RelevanceJudgement,
  SaliencyInput,
  SaliencyBreakdown,
  SaliencyResult,
  SaliencyTier,
} from "./saliency.js";
// Story 1.10: operator-driven merge & split of published hot events. Only
// writes hot_event_evidence (move/dedupe links) + hot_events (cluster_signature
// recompute; new candidate on split). Status transitions + read-model refresh
// are driven by the server action calling decideReview afterward (reuse, not
// rebuild, the publish gate).
export { mergeHotEvents, splitHotEvent } from "./merge-split-service.js";
export {
  PublicationStatus,
  SIMILARITY_THRESHOLD,
  TIME_WINDOW_MS,
  TIMELINE_FOLD_THRESHOLD,
} from "./types.js";
export type {
  ClusterInput,
  ClusterOptions,
  PublicationStatus as PublicationStatusType,
  ReviseHotEventOptions,
  ReviseHotEventResult,
  MergeHotEventsOptions,
  MergeHotEventsResult,
  SplitHotEventOptions,
  SplitHotEventResult,
} from "./types.js";
