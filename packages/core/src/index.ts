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
// Story 1.9: operator-authored title/tags revision (reviseHotEvent) +
// normalizeTags (split/trim/dedupe the raw operator tag input). reviseHotEvent
// only writes hot_event_revisions (append-only, AD-5); effective title/tags =
// latest revision ?? baseline. publish-orchestrator projects the effective on
// republish; review-workflow computes the pending diff.
// Story 1.10: operator-driven merge & split (mergeHotEvents / splitHotEvent).
// Only writes hot_event_evidence (move/dedupe links) + hot_events (cluster_
// signature recompute; new candidate on split). Status transitions + read-model
// refresh go through decideReview afterward (reuse the publish gate).
export { reviseHotEvent, normalizeTags } from "./modules/event-assembly/revise-service.js";
export { mergeHotEvents, splitHotEvent } from "./modules/event-assembly/merge-split-service.js";
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
  ReviseHotEventOptions,
  ReviseHotEventResult,
  MergeHotEventsOptions,
  MergeHotEventsResult,
  SplitHotEventOptions,
  SplitHotEventResult,
} from "./modules/event-assembly/types.js";

// review-workflow module (Story 1.6 — the publish gate; Story 1.9 — republish +
// operator revision view).
export { decideReview, listPendingCandidates, getCandidateDetail, getPublishedEventForRevision } from "./modules/review-workflow/review-service.js";
export type {
  DecideReviewOptions,
  DecideReviewResult,
  ListPendingCandidatesOptions,
  PendingCandidateSummary,
  GetCandidateDetailOptions,
  CandidateDetail,
  CandidateEvidenceItem,
  CandidateDecisionEntry,
  GetPublishedEventForRevisionOptions,
  PublishedEventRevisionView,
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
// Story 1.8 — getPublishedHotEventDetail public detail read + explanation/evidence projection;
// Story 2.1 — published_hot_event_reactions projection + detail.reaction field;
// Story 2.2 — published_hot_event_associations projection + detail.associations field +
// listPublishedAssociations feed-filter query;
// Story 2.3 — published_hot_event_themes projection + detail.themes field +
// listPublishedThemeMemberships theme-page query).
export {
  refreshPublishedReadModel,
  listPublishedHotEvents,
  getPublishedHotEventDetail,
  listPublishedAssociations,
  listPublishedThemeMemberships,
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
  PublishedHotEventReaction,
  AssociationItem,
  PublishedHotEventAssociation,
  PublishedAssociationRow,
  ListPublishedAssociationsOptions,
  ThemeRef,
  PublishedHotEventTheme,
  PublishedThemeMembershipRow,
  ListPublishedThemeMembershipsOptions,
} from "./modules/publish-orchestrator/types.js";

// explanation module (Story 1.8 — deterministic three-partition generation +
// append-only ExplanationVersion, AD-5; Story 1.9 — saveExplanation operator
// revision write-point, source passed by caller, V1 "human").
export {
  generateExplanation,
  getLatestExplanation,
  derivePartitions,
  saveExplanation,
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
  SaveExplanationOptions,
  SaveExplanationResult,
} from "./modules/explanation/types.js";

// market-reaction module (Story 2.1 — MarketDataAdapter port AD-7 +
// StubMarketDataAdapter test-only + generateMarketReaction append-only AD-2 +
// deriveSignals pure two-dimension derivation; V1 worker resolves no adapter →
// prod degrades honestly, stub is verify/e2e-only).
export {
  generateMarketReaction,
  getLatestMarketReaction,
  deriveSignals,
  StubMarketDataAdapter,
} from "./modules/market-reaction/index.js";
export { ReactionTone, ReactionSource, ReactionDimension } from "./modules/market-reaction/index.js";
export type {
  ReactionTone as ReactionToneType,
  ReactionSource as ReactionSourceType,
  ReactionDimension as ReactionDimensionType,
  ReactionSignal,
  MarketDataSnapshot,
  MarketDataAdapter,
  GenerateMarketReactionOptions,
  GenerateMarketReactionResult,
  GetLatestMarketReactionOptions,
  MarketReactionSnapshotRecord,
} from "./modules/market-reaction/index.js";

// theme-linking module (Story 2.2 — AssociationAdapter port AD-7 +
// StubAssociationAdapter test-only + generateAssociations append-only AD-2 +
// normalizeItems pure derivation with AC2 mappingBasis enforcement; V1 has NO
// worker — epic lists no association-generation job category — so prod has no
// trigger and degrades honestly, stub is verify/e2e-only.
// Story 2.3 — ThemeAdapter port + StubThemeAdapter test-only + generateThemes
// append-only AD-2 + normalizeThemeItems pure derivation with AC2 enforcement;
// theme-backfill worker resolves no adapter → prod degrades honestly).
export {
  generateAssociations,
  getLatestAssociationSet,
  normalizeItems,
  StubAssociationAdapter,
  STUB_CONCEPT_LABEL,
  generateThemes,
  getLatestThemeSet,
  normalizeThemeItems,
  StubThemeAdapter,
  STUB_THEME_SLUG,
  STUB_THEME_LABEL,
} from "./modules/theme-linking/index.js";
export { AssociationKind, AssociationSource, ThemeSource } from "./modules/theme-linking/index.js";
export type {
  AssociationKind as AssociationKindType,
  AssociationSource as AssociationSourceType,
  AssociationItem as ThemeLinkingAssociationItem,
  AssociationAdapter,
  GenerateAssociationsOptions,
  GenerateAssociationsResult,
  GetLatestAssociationSetOptions,
  AssociationSetRecord,
  ThemeSource as ThemeSourceType,
  ThemeRef as ThemeLinkingThemeRef,
  ThemeAdapter,
  GenerateThemesOptions,
  GenerateThemesResult,
  GetLatestThemeSetOptions,
  ThemeSetRecord,
} from "./modules/theme-linking/index.js";
