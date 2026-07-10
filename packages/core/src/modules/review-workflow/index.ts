/**
 * review-workflow module barrel.
 *
 * AD-6 single write-owner of review_decisions + publication_decisions, and the
 * field-level owner of hot_events.publication_status. Exposes the decideReview
 * command (the publish gate), the listPendingCandidates / getCandidateDetail
 * queries (for the operator console), the pure resolveTransition, and the
 * ReviewOutcome/PublishAction types. The Prisma client lives one level up and
 * is re-exported from the package barrel.
 *
 * This module never writes published_hot_events directly (publish-orchestrator
 * owns that, called from decideReview), never writes hot_events.title /
 * cluster_signature (event-assembly owns those), and never writes
 * evidence_records / evidence_sources.
 */

export { decideReview, listPendingCandidates, getCandidateDetail, getPublishedEventForRevision } from "./review-service.js";
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
} from "./types.js";
export { resolveTransition, LEGAL_TRANSITIONS } from "./transitions.js";
export {
  ReviewOutcome,
  PublishAction,
  IllegalTransitionError,
  CandidateNotFoundError,
} from "./types.js";
export type {
  ReviewOutcome as ReviewOutcomeType,
  PublishAction as PublishActionType,
  ResolvedTransition,
} from "./types.js";
