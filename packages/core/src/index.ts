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
 * only layout + /design stay static (they do not import core); /daily /topics
 * /favorites are force-dynamic and import core.
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
// Story 7.1/7.2/7.3/7.4 — relevance gate + saliency score + auto-publish decision.
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
} from "./modules/event-assembly/saliency.js";
export type {
  RelevanceJudgement,
  SaliencyInput,
  SaliencyBreakdown,
  SaliencyResult,
  SaliencyTier,
  AutoPublishOutcome,
} from "./modules/event-assembly/saliency.js";
export {
  SIMILARITY_THRESHOLD,
  TIME_WINDOW_MS,
  TIMELINE_FOLD_THRESHOLD,
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
// operator revision view; Story 5.4 — suppressAiContent sibling + SM-6 readout).
export {
  decideReview,
  listPendingCandidates,
  getCandidateDetail,
  getPublishedEventForRevision,
  suppressAiContent,
  getSm6MisleadingRate,
} from "./modules/review-workflow/review-service.js";
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
  SuppressAiContentOptions,
  SuppressAiContentResult,
  GetSm6MisleadingRateOptions,
  Sm6MisleadingRate,
} from "./modules/review-workflow/types.js";
export { resolveTransition, LEGAL_TRANSITIONS } from "./modules/review-workflow/transitions.js";
export {
  ReviewOutcome,
  PublishAction,
  IllegalTransitionError,
  CandidateNotFoundError,
  SUPPRESS_AI_CONTENT_OUTCOME,
  TargetNotFoundError,
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
// listPublishedThemeMemberships theme-page query;
// Story 2.4 — published_daily_digests projection (sibling refreshPublishedDailyDigest,
// coverageDate-keyed) + getPublishedDailyDigest / listPublishedDailyDigestCoverageDates
// /daily-page queries).
// Story 3.1 — listPublishedHotEventExplanations (sibling list fn surfacing
// published_hot_event_explanations.summary for the search-read 3rd corpus).
// Story 4.1 — published_timeline read model (AD-3b): per-HotEvent incremental
// refresh inside decideReview's $transaction (refreshPublishedTimelineForEvent)
// + periodic self-heal job (refreshPublishedTimelineAll) + Web home feed read
// contract (listPublishedTimeline). deriveSessionTag / deriveTradeDate are the
// pure A-share session-boundary functions (AC5).
// Story 4.4 — listPublishedTimelineEntries (filter-free full-table search
// corpus; sibling to the date-scoped listPublishedTimeline feed read).
export {
  refreshPublishedReadModel,
  listPublishedHotEvents,
  getPublishedHotEventDetail,
  listPublishedAssociations,
  listPublishedThemeMemberships,
  listPublishedHotEventExplanations,
  refreshPublishedDailyDigest,
  getPublishedDailyDigest,
  listPublishedDailyDigestCoverageDates,
  refreshPublishedTrendBriefing,
  getPublishedTrendBriefing,
} from "./modules/publish-orchestrator/publish-service.js";
export {
  refreshPublishedTimelineForEvent,
  refreshPublishedTimelineAll,
  listPublishedTimeline,
  listPublishedTimelineEntries,
} from "./modules/publish-orchestrator/timeline-read-model.js";
export {
  deriveSessionTag,
  deriveTradeDate,
  SHANGHAI_OFFSET_MIN,
} from "./modules/publish-orchestrator/session-tag.js";
export type { RefreshPublishedReadModelOptions } from "./modules/publish-orchestrator/publish-service.js";
export { TimelineSessionTag } from "./modules/publish-orchestrator/types.js";
export type {
  RefreshPublishedTimelineForEventOptions,
  RefreshPublishedTimelineAllOptions,
  ListPublishedTimelineOptions,
  ListPublishedTimelineEntriesOptions,
  PublishedTimelineEntry,
  TimelineSessionTagType,
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
  PublishedHotEventExplanationSummaryRow,
  ListPublishedHotEventExplanationsOptions,
  DailyDigestEntry,
  PublishedDailyDigest,
  RefreshPublishedDailyDigestOptions,
  GetPublishedDailyDigestOptions,
  ListPublishedDailyDigestCoverageDatesOptions,
  PublishedHotEventDeepRead,
  PublishedTrendBriefing,
  RefreshPublishedTrendBriefingOptions,
  GetPublishedTrendBriefingOptions,
} from "./modules/publish-orchestrator/types.js";

// explanation module (Story 1.8 — deterministic three-partition generation +
// append-only ExplanationVersion, AD-5; Story 1.9 — saveExplanation operator
// revision write-point, source passed by caller, V1 "human";
// Story 5.1 — LLMAdapter port AD-7 + StubLlmAdapter test-only +
// generateRecommendationReason append-only AD-2 + recommendation_reasons table +
// 6-class wording guardrail; recommendation-reason worker resolves no adapter →
// prod degrades honestly, stub is verify/e2e-only;
// Story 5.2 — LLMAdapter.generateDeepRead (second method on the same port) +
// generateDeepRead append-only AD-2 + deep_reads table + published_hot_event_
// deep_reads projection; deep-read worker resolves no adapter → prod degrades
// honestly, stub is verify/e2e-only; reuses the 5.1 6-class guardrail per
// segment).
export {
  generateExplanation,
  getLatestExplanation,
  derivePartitions,
  saveExplanation,
} from "./modules/explanation/explain-service.js";
export {
  generateRecommendationReason,
  getLatestRecommendationReason,
  suppressRecommendationReason,
  passesRecommendationGuardrail,
  RECOMMENDATION_REASON_MAX_LENGTH,
  RECOMMENDATION_FORBIDDEN_PHRASES,
  generateDeepRead,
  getLatestDeepRead,
  suppressDeepRead,
  DEEP_READ_SEGMENT_MAX_LENGTH,
  listAiContentForSampling,
  AI_CONTENT_SAMPLING_TAKE_LIMIT,
  StubLlmAdapter,
  STUB_RECOMMENDATION_REASON,
  STUB_DEEP_READ,
  STUB_TREND_BRIEFING,
  OpenAiCompatibleLlmAdapter,
} from "./modules/explanation/index.js";
export { ExplanationSource, AiContentType } from "./modules/explanation/types.js";
export type { OpenAiCompatibleLlmAdapterOptions } from "./modules/explanation/index.js";
export type {
  ExplanationSource as ExplanationSourceType,
  ExplanationPartitions,
  GenerateExplanationOptions,
  GenerateExplanationResult,
  GetLatestExplanationOptions,
  ExplanationVersionRecord,
  SaveExplanationOptions,
  SaveExplanationResult,
  LlmSource,
  LlmReasonResult,
  LlmDeepReadResult,
  LlmDeepReadArgs,
  LlmTrendBriefingResult,
  LlmTrendBriefingArgs,
  LLMAdapter,
  GenerateRecommendationReasonOptions,
  GenerateRecommendationReasonResult,
  RecommendationReasonRecord,
  GenerateDeepReadOptions,
  GenerateDeepReadResult,
  DeepReadRecord,
  AiContentType as AiContentTypeType,
  SuppressRecommendationReasonOptions,
  SuppressDeepReadOptions,
  SuppressResult,
  ListAiContentForSamplingOptions,
  AiContentSamplingItem,
} from "./modules/explanation/types.js";

// investment-targets module — agent-driven candidate pool (ashare-news-
// investment-targets skill, 阶段A+B). Owns investment_targets (AD-5 append-only);
// the same run's 影响面/受益方/风险点 byproduct appends to the explanation module's
// deep_reads so the existing detail-page deep-read block surfaces it. TargetsAdapter
// port + service + StubTargetsAdapter (test-only) live here; the concrete SDK-backed
// HeadlessAgentTargetsAdapter lives in apps/worker (keeps the heavy Claude Agent SDK
// dep out of the web build). Worker resolves no adapter → prod degrades honestly.
export {
  generateInvestmentTargets,
  getLatestInvestmentTargets,
  StubTargetsAdapter,
  STUB_TARGETS,
  TargetTier,
} from "./modules/investment-targets/index.js";
export type {
  TargetTier as TargetTierType,
  TargetScores,
  TargetCandidate,
  LlmTargetsResult,
  LlmTargetsArgs,
  TargetsAdapter,
  GenerateInvestmentTargetsOptions,
  GenerateInvestmentTargetsResult,
  InvestmentTargetRecord,
} from "./modules/investment-targets/index.js";

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
export {
  ReactionTone,
  ReactionSource,
  ReactionDimension,
} from "./modules/market-reaction/index.js";
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

// digest module (Story 2.4 — DigestAdapter port AD-7 + StubDigestAdapter
// test-only + generateDailyDigest append-only AD-2 + noInvestAdvice / coverage
// helpers; coverageDate-keyed aggregate, no FK to hot_events; daily-digest
// worker resolves no adapter → prod degrades honestly, stub is verify/e2e-only.
// Story 5.3 — generateTrendBriefing append-only AD-2 (coverageDate-keyed cross-event
// AI 趋势研判) + TREND_BRIEFING_MAX_LENGTH + validateTrendBriefing; reuses explanation's
// LLMAdapter port + passesRecommendationGuardrail; trend_briefings table is data-only
// linked (no FK); daily-digest worker resolves no llmAdapter → prod degrades honestly).
export {
  generateDailyDigest,
  getLatestDigest,
  noInvestAdvice,
  filterByCoverageDay,
  generateTrendBriefing,
  getLatestTrendBriefing,
  validateTrendBriefing,
  TREND_BRIEFING_MAX_LENGTH,
  StubDigestAdapter,
  STUB_DIGEST_CONCLUSION,
  OpenAiCompatibleDigestAdapter,
  DAILY_CATEGORIES,
} from "./modules/digest/index.js";
export { DigestSource } from "./modules/digest/index.js";
export type { OpenAiCompatibleDigestAdapterOptions } from "./modules/digest/index.js";
export type {
  DigestSource as DigestSourceType,
  DigestConclusion,
  DailyDigestEntry as DigestDailyDigestEntry,
  DigestAdapter,
  GenerateDailyDigestOptions,
  GenerateDailyDigestResult,
  GetLatestDigestOptions,
  DigestRecord,
  GenerateTrendBriefingOptions,
  GenerateTrendBriefingResult,
  TrendBriefingRecord,
} from "./modules/digest/index.js";

// search-read module (Story 3.1 — public search over published_* read models;
// FR12 three-corpus coverage: published_hot_events.title +
// published_hot_event_explanations.summary + published_hot_event_themes label.
// Story 4.4 adds the timeline corpus (published_timeline_entries title/summary)
// as the 4th read. Pure read: joins four filter-free sibling list fns from
// publish-orchestrator and matches + ranks in JS — V1 in-memory filter pattern,
// FTS/tsvector deferred).
export { searchPublished } from "./modules/search-read/index.js";
export { SearchHitKind, EventMatchedField } from "./modules/search-read/index.js";
export type {
  SearchHitKindType,
  EventMatchedFieldType,
  SearchPublishedOptions,
  EventSearchHit,
  ThemeSearchHit,
  TimelineSearchHit,
  SearchPublishedResult,
} from "./modules/search-read/index.js";

// user-profile module (Story 3.2 — lightweight account + follow state;
// deferred-login follow action; no credential auth (deferred)). Owns
// user_accounts + follow_targets (AD-2 single ownership boundary). Follow rows
// reference targets by id string ONLY (no FK to hot_events / themes /
// published_*). Cookie/session helpers live in apps/web/lib/session.ts (Next
// runtime concept, not core).
export {
  createAccount,
  tryGetAccount,
  followTarget,
  unfollowTarget,
  listFollows,
  listFollowedTargetIds,
  isFollowing,
  assertValidFollowRef,
  FollowTargetKind,
} from "./modules/user-profile/index.js";
export type {
  FollowTargetKindType,
  FollowRef,
  FollowTarget,
  UserProfileOptions,
  CreateAccountOptions,
  TryGetAccountOptions,
  FollowTargetOptions,
  UnfollowTargetOptions,
  ListFollowsOptions,
  ListFollowedTargetIdsOptions,
  IsFollowingOptions,
} from "./modules/user-profile/index.js";
