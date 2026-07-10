/**
 * @aguhot/core — AGUHOT domain modules, contracts, and shared kernel.
 *
 * Story 1.4 introduced the `source-ingest` module (evidence source ingest &
 * archive). Story 1.5 added the `event-assembly` module (candidate hot-event
 * clustering). Story 1.6 adds `review-workflow` (the publish gate: decideReview
 * + list/get queries) and `publish-orchestrator` (the published_hot_events read
 * model owner). Later stories add theme-linking, market-reaction, etc. under
 * this package, per ARCHITECTURE-SPINE.md Structural Seed.
 *
 * The public web app does NOT import this package: public routes must stay
 * DATABASE_URL-free (AD-3/AD-6). Only the worker runtime and the operator
 * routes consume these exports.
 */

// Shared kernel.
export { uuidv7, newTraceId } from "./shared/ids.js";
export { PublicationStatus } from "./shared/publication-status.js";
export type { PublicationStatus as PublicationStatusType } from "./shared/publication-status.js";

// Prisma client singleton (worker-only; never imported by the web app).
export { getPrisma, resetPrisma } from "./db.js";

// source-ingest module.
export type { SourceAdapter } from "./modules/source-ingest/adapter.js";
export { RssAdapter } from "./modules/source-ingest/rss-adapter.js";
export type { RssAdapterOptions } from "./modules/source-ingest/rss-adapter.js";
export { ingestSources } from "./modules/source-ingest/ingest-service.js";
export type {
  AdapterFactory,
  IngestSourcesOptions,
  IngestSourcesResult,
  SourceIngestSummary,
} from "./modules/source-ingest/ingest-service.js";
export { IngestStatus, SourceKind, contentHash } from "./modules/source-ingest/types.js";
export type {
  EvidenceItem,
  IngestStatus as IngestStatusType,
  SourceKind as SourceKindType,
} from "./modules/source-ingest/types.js";

// event-assembly module.
export { clusterEvents } from "./modules/event-assembly/cluster-events.js";
export type {
  ClusterEventsOptions,
  ClusterEventsResult,
} from "./modules/event-assembly/cluster-events.js";
export {
  clusterRecords,
  overlapCoefficient,
  signatureOf,
  tokenize,
  SIGNATURE_DELIMITER,
} from "./modules/event-assembly/clustering.js";
export type { ClusterGroup } from "./modules/event-assembly/clustering.js";
export {
  SIMILARITY_THRESHOLD,
  TIME_WINDOW_MS,
} from "./modules/event-assembly/types.js";
// `PublicationStatus` is exported from the shared kernel above (line 18). It is
// also re-exported by event-assembly/types.ts for API stability, but TypeScript
// flags a duplicate if both are in the same barrel — so only the shared export
// is in this package barrel. Downstream code importing `PublicationStatus` from
// `@aguhot/core` gets the authoritative shared value either way.
export type {
  ClusterInput,
  ClusterOptions,
} from "./modules/event-assembly/types.js";

// review-workflow module (Story 1.6 — the publish gate).
export { decideReview, listPendingCandidates, getCandidateDetail } from "./modules/review-workflow/review-service.js";
export type {
  DecideReviewOptions,
  DecideReviewResult,
  ListPendingCandidatesOptions,
  PendingCandidateSummary,
  GetCandidateDetailOptions,
  CandidateDetail,
  CandidateEvidenceItem,
  CandidateDecisionEntry,
} from "./modules/review-workflow/types.js";
export { resolveTransition, LEGAL_TRANSITIONS } from "./modules/review-workflow/transitions.js";
export {
  ReviewOutcome,
  PublishAction,
  IllegalTransitionError,
  CandidateNotFoundError,
} from "./modules/review-workflow/types.js";
export type {
  ReviewOutcome as ReviewOutcomeType,
  PublishAction as PublishActionType,
  ResolvedTransition,
} from "./modules/review-workflow/types.js";

// publish-orchestrator module (Story 1.6 — the published_hot_events read-model owner).
export { refreshPublishedReadModel } from "./modules/publish-orchestrator/publish-service.js";
export type { RefreshPublishedReadModelOptions } from "./modules/publish-orchestrator/publish-service.js";
