/**
 * @aguhot/core — AGUHOT domain modules, contracts, and shared kernel.
 *
 * Story 1.4 introduced the `source-ingest` module (evidence source ingest &
 * archive). Story 1.5 added the `event-assembly` module (candidate hot-event
 * clustering). Story 1.6 added `review-workflow` (the publish gate: decideReview
 * + list/get queries) and `publish-orchestrator` (the published_hot_events read
 * model owner). Story 1.7 adds `listPublishedHotEvents` — the first public read
 * of the published read model — consumed by the public homepage `(public)/page.tsx`
 * (the homepage declares `force-dynamic` so its core import / getPrisma() call is
 * not evaluated at build time, keeping the public build DATABASE_URL-free).
 * Story 1.8 adds the `explanation` module (deterministic three-partition
 * generation + append-only ExplanationVersion) and `getPublishedHotEventDetail`
 * (the first public detail read of the published read model) consumed by the
 * public detail route `(public)/events/[hotEventId]/page.tsx` (also force-
 * dynamic). Later stories add theme-linking, market-reaction, etc. under this
 * package, per ARCHITECTURE-SPINE.md Structural Seed.
 *
 * Public read note: as of 1.7 the public homepage imports this package, and as
 * of 1.8 the public detail page does too (AD-3 public-read via the read model).
 * DB-read routes declare `force-dynamic` so `next build` stays DATABASE_URL-free;
 * static public routes (layout, /daily, /topics, /favorites, /design) still do
 * NOT import core.
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

// publish-orchestrator module (Story 1.6 — the published_hot_events read-model owner;
// Story 1.7 — listPublishedHotEvents public read query, first consumer of the read model;
// Story 1.8 — getPublishedHotEventDetail public detail read + explanation/evidence projection).
export {
  refreshPublishedReadModel,
  listPublishedHotEvents,
  getPublishedHotEventDetail,
} from "./modules/publish-orchestrator/publish-service.js";
export type { RefreshPublishedReadModelOptions } from "./modules/publish-orchestrator/publish-service.js";
export type {
  ListPublishedHotEventsOptions,
  PublishedHotEventSummary,
  GetPublishedHotEventDetailOptions,
  PublishedHotEventDetail,
  PublishedEvidenceRow,
  EvidenceLinkStatus,
  EvidenceLinkStatusType,
} from "./modules/publish-orchestrator/types.js";

// explanation module (Story 1.8 — deterministic three-partition generation +
// append-only ExplanationVersion, AD-5).
export {
  generateExplanation,
  getLatestExplanation,
  derivePartitions,
} from "./modules/explanation/explain-service.js";
export {
  ExplanationSource,
} from "./modules/explanation/types.js";
export type {
  ExplanationSource as ExplanationSourceType,
  ExplanationPartitions,
  GenerateExplanationOptions,
  GenerateExplanationResult,
  GetLatestExplanationOptions,
  ExplanationVersionRecord,
} from "./modules/explanation/types.js";
