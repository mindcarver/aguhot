/**
 * review-workflow domain types: the review outcome union, the domain error for
 * illegal transitions, and the command/query option + result shapes.
 *
 * This module is AD-6's single write-owner of review_decisions +
 * publication_decisions, and the field-level owner of hot_events.publication_
 * status (candidate→published / candidate→rejected / published→taken_down).
 * It never writes hot_events.title or hot_events.cluster_signature (event-
 * assembly owns those), and never writes published_hot_events (publish-
 * orchestrator owns that, called from decideReview).
 */

import type { PublicationStatus } from "../../shared/publication-status.js";
import type { ExplanationPartitions } from "../explanation/types.js";
import type {
  RelevanceLabel,
  SaliencyBreakdown,
  AutoPublishOutcome,
} from "../event-assembly/saliency.js";

/**
 * The outcome an operator chooses for a candidate. Stored as a String column
 * (no TS enum, per erasableSyntaxOnly). The legal transitions are:
 *   - Approve:   candidate → published
 *   - Reject:    candidate → rejected
 *   - Takedown:  published → taken_down
 *   - Republish: published → published (Story 1.9 — re-publish after an
 *     operator title/tags/explanation revision; refreshPublishedReadModel
 *     re-projects the effective title/tags + latest explanation into the public
 *     read models). taken_down → published and rejected → published (Story 1.10
 *     — re-publish an event taken down after it had been published, or correct
 *     an erroneous reject; refresh goes through the upsert create branch).
 */
export const ReviewOutcome = {
  Approve: "approve",
  Reject: "reject",
  Takedown: "takedown",
  Republish: "republish",
} as const;

export type ReviewOutcome = (typeof ReviewOutcome)[keyof typeof ReviewOutcome];

/**
 * The action publish-orchestrator must take to refresh the read model for a
 * given transition. Derived from resolveTransition; publish-orchestrator never
 * decides this itself.
 *   - publish:  upsert the published_hot_events row (approve).
 *   - takedown: delete the published_hot_events row (takedown).
 *   - none:     do not touch the read model (reject — never published).
 */
export const PublishAction = {
  Publish: "publish",
  Takedown: "takedown",
  None: "none",
} as const;

export type PublishAction = (typeof PublishAction)[keyof typeof PublishAction];

/**
 * The resolved transition: the target publication_status plus the read-model
 * action. Returned by resolveTransition for legal transitions.
 */
export interface ResolvedTransition {
  to: PublicationStatus;
  action: PublishAction;
}

/**
 * The operator identity. V1 has no real auth (user-profile module deferred);
 * the reviewer string is a placeholder filled by the server action. Real auth
 * drops into the (operator) layout and flows a verified identity here.
 */
export interface DecideReviewOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  hotEventId: string;
  outcome: ReviewOutcome;
  reviewer: string;
  note?: string;
}

/**
 * Summary of one decideReview execution: the ids of the two append-only
 * decision rows, the from→to transition, and the read-model action taken.
 * Returned to the server action for display / redirect.
 */
export interface DecideReviewResult {
  traceId: string;
  hotEventId: string;
  reviewDecisionId: string;
  publicationDecisionId: string;
  fromStatus: PublicationStatus;
  toStatus: PublicationStatus;
  action: PublishAction;
}

export interface ListPendingCandidatesOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
}

/**
 * One row in the pending-candidates list. The projection the operator console
 * needs: title, evidence count, latest evidence time, and current status
 * (always "candidate" for this query). Ordered by most recently updated first.
 */
export interface PendingCandidateSummary {
  id: string;
  title: string;
  evidenceCount: number;
  latestEvidenceAt: Date;
  updatedAt: Date;
  // Story 7.6 — Epic 7 scoring surfaced in the review console so the operator
  // sees WHY a candidate was held (and what the gate would do). event-assembly
  // owns these fields (AD-2b); review-workflow only reads them here. gateOutcome
  // is derived (null when unscored → treated as hold by the gate).
  saliency: number | null;
  relevanceLabel: RelevanceLabel | null;
  saliencyBreakdown: SaliencyBreakdown | null;
  gateOutcome: AutoPublishOutcome | null;
}

export interface GetCandidateDetailOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * A candidate detail view: the HotEvent, its supporting evidence records (via
 * the link table), and the full decision audit chain (ascending by createdAt).
 */
export interface CandidateDetail {
  id: string;
  title: string;
  publicationStatus: string;
  evidence: CandidateEvidenceItem[];
  decisions: CandidateDecisionEntry[];
  // Story 7.6 — same Epic 7 scoring fields as PendingCandidateSummary, shown in
  // the detail header so the operator can judge a held/rejected candidate.
  saliency: number | null;
  relevanceLabel: RelevanceLabel | null;
  saliencyBreakdown: SaliencyBreakdown | null;
  gateOutcome: AutoPublishOutcome | null;
}

export interface CandidateEvidenceItem {
  evidenceRecordId: string;
  sourceName: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  publishedAt: Date | null;
}

export interface CandidateDecisionEntry {
  type: "review" | "publication";
  id: string;
  createdAt: Date;
  reviewer?: string;
  outcome?: string;
  note?: string | null;
  fromStatus?: string;
  toStatus?: string;
  reason?: string | null;
}

/**
 * Domain error raised when an operator action would drive an illegal
 * publication_status transition (e.g. approving an already-published event,
 * taking down a candidate). The server action surfaces this to the operator.
 * Nothing is written when this is thrown — the transaction rolls back.
 */
export class IllegalTransitionError extends Error {
  readonly fromStatus: string;
  readonly outcome: string;
  constructor(fromStatus: string, outcome: string) {
    super(
      `[review-workflow] illegal transition: cannot apply outcome "${outcome}" to event with publication_status "${fromStatus}"`,
    );
    this.name = "IllegalTransitionError";
    this.fromStatus = fromStatus;
    this.outcome = outcome;
  }
}

/**
 * Domain error raised when a candidate is not found (e.g. already deleted or
 * bad id). The server action surfaces this to the operator.
 */
export class CandidateNotFoundError extends Error {
  readonly hotEventId: string;
  constructor(hotEventId: string) {
    super(`[review-workflow] candidate not found: ${hotEventId}`);
    this.name = "CandidateNotFoundError";
    this.hotEventId = hotEventId;
  }
}

// --- Story 5.4: AI content operator sampling (suppress sibling + SM-6 readout) ----

/**
 * The outcome string written to ReviewDecision.outcome when an operator suppresses
 * a single piece of AI content (one recommendation_reasons or deep_reads row).
 *
 * DELIBERATELY a STANDALONE const — it is NOT added to the `ReviewOutcome` union
 * above, NOT added to `LEGAL_TRANSITIONS`, and NOT routed through `resolveTransition`
 * / `decideReview`. Those three are the HotEvent state machine: their outcome
 * alphabet feeds the `transitions.selfcheck.ts` `LEGAL_TRANSITIONS.length === 6`
 * assertion and the status-graph reachability invariants. Adding suppress to that
 * alphabet would either need a published→published self-loop (which perturbs the
 * selfcheck count + a resolveTransition branch) or force the whole-event
 * PublishAction to express a per-content refresh (PublishAction is whole-event
 * granularity — publish/takedown/none — a mismatch). Instead suppressAiContent is
 * a SIBLING function that reuses decideReview's "single $transaction + append
 * ReviewDecision + call refresh" COORDINATION SHAPE but bypasses the state machine
 * entirely. The outcome string is written directly to ReviewDecision.outcome (a
 * free String column); the state machine stays at zero changes. See spec-5-4
 * Design Notes for the full rationale.
 */
export const SUPPRESS_AI_CONTENT_OUTCOME = "suppress_ai_content" as const;

/**
 * Domain error raised when a suppressAiContent call targets an id that does not
 * exist in the corresponding source table (recommendation_reasons / deep_reads).
 * The findUniqueOrThrow inside the source suppress fn raises Prisma P2025, which
 * the caller can either let propagate or wrap; this class is provided for callers
 * that want a domain-typed catch. Nothing is written when this is thrown — the
 * caller's `$transaction` rolls back (fail-fast, no partial suppress).
 */
export class TargetNotFoundError extends Error {
  readonly targetType: "reason" | "deepread";
  readonly targetId: string;
  constructor(targetType: "reason" | "deepread", targetId: string) {
    super(
      `[review-workflow] suppress target not found: ${targetType} ${targetId}`,
    );
    this.name = "TargetNotFoundError";
    this.targetType = targetType;
    this.targetId = targetId;
  }
}

/**
 * Options for suppressAiContent — the sibling function that surgically takes down
 * one piece of AI content (one reason or one deep read) WITHOUT touching the
 * HotEvent state machine. `{ prisma, traceId, targetType, targetId, hotEventId,
 * reviewer, note? }` mirrors decideReview's `{ prisma, traceId, hotEventId,
 * outcome, reviewer, note? }` shape (the cross-module coordination form), but
 * replaces the state-machine `outcome` with a `targetType` + `targetId` pair
 * identifying which source row to suppress.
 *
 *   - targetType ∈ {"reason","deepread"}: which source table to suppress.
 *     TrendBriefing is excluded (epic Gap 2 — the server-action whitelist rejects
 *     any other value before reaching this layer).
 *   - targetId: the RecommendationReason.id / DeepRead.id to suppress.
 *   - hotEventId: carried into the ReviewDecision row for audit (the decision is
 *     still scoped to a HotEvent even though the state machine is not touched —
 *     the audit chain ties the suppress to the event whose AI content was judged
 *     misleading).
 *   - reviewer: operator identity (V1 placeholder "operator", same as submitReview).
 *   - note?: operator free-text reason (why the content is misleading; recorded
 *     verbatim on the ReviewDecision row for audit).
 */
export interface SuppressAiContentOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  targetType: "reason" | "deepread";
  targetId: string;
  hotEventId: string;
  reviewer: string;
  note?: string;
}

/**
 * The result of a suppress attempt. `{ suppressed: true }` on a fresh suppress
 * (source row was live → suppressedAt set + ReviewDecision appended + projection
 * refreshed if the event is published). `{ suppressed: false, reason:
 * "already-suppressed" }` on an idempotent re-suppress (source row was already
 * suppressed → no second ReviewDecision appended, no refresh — prevents SM-6
 * numerator double-counting). The operator UI hides the suppress button on
 * already-suppressed rows, but this idempotency is the server-side guard.
 */
export interface SuppressAiContentResult {
  suppressed: boolean;
  reason?: "already-suppressed";
}

/**
 * Options for getSm6MisleadingRate — the SM-6 readout query (7-day rolling
 * window). `{ prisma, traceId, windowDays? }` — windowDays defaults to 7 (epic
 * Gap 4 literal). The query counts ReviewDecision rows with outcome=
 * suppress_ai_content + targetType ∈ {reason,deepread} in the window (numerator)
 * and the total reason+deepread rows generated in the same window (denominator).
 * TrendBriefing rows are excluded from both numerator and denominator (epic Gap 2).
 */
export interface GetSm6MisleadingRateOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  windowDays?: number;
}

/**
 * The SM-6 misleading-rate readout. SM-6 target: rate < 10%.
 *   - rate: numerator/denominator (0 when denominator === 0 — UI shows "暂无数据").
 *   - numerator: count of ReviewDecision rows with outcome=suppress_ai_content +
 *     targetType ∈ {reason,deepread} + createdAt ≥ now-windowDays.
 *   - denominator: recommendationReason.count(createdAt ≥ window) +
 *     deepRead.count(createdAt ≥ window) — the aggregate AI content generated in
 *     the same window (TrendBriefing excluded, epic Gap 2).
 *   - windowDays: the window used (echoes the input / default for UI display).
 */
export interface Sm6MisleadingRate {
  rate: number;
  numerator: number;
  denominator: number;
  windowDays: number;
}

// --- Story 7.6: SM-9 gate-distribution readout --------------------------------

/**
 * Options for getSm9GateDistribution. `{ prisma, traceId }`. The readout applies
 * the Epic 7 auto-publish gate (decideAutoPublishOutcome) to every scored
 * hot_event and tallies the approve/hold/reject split, alongside the raw
 * relevance split and the actual publication_status split — so the operator can
 * see what the gate recommends vs what is actually published (the gap = manual
 * overrides) and watch the rejection rate over time (operationalizes SM-C2).
 */
export interface GetSm9GateDistributionOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
}

/**
 * The SM-9 gate-distribution readout.
 *   - gate: approve/hold/reject counts over all scored hot_events (the gate's
 *     recommendation). Unscored rows (null saliency/label) count as hold.
 *   - relevance: pass/suspicious/fail/unscored counts.
 *   - status: actual publication_status counts (candidate/published/rejected/
 *     taken_down) — the real current state, for comparing against `gate`.
 *   - thresholds: the current LOW/HIGH (echoed for display; tuning is a code
 *     constant change, live-tuning is deferred).
 *   - total: scored + unscored hot_events.
 */
export interface Sm9GateDistribution {
  gate: { approve: number; hold: number; reject: number };
  relevance: { pass: number; suspicious: number; fail: number; unscored: number };
  status: { candidate: number; published: number; rejected: number; taken_down: number };
  thresholds: { low: number; high: number };
  total: number;
}

// --- Story 1.9: published-event revision view (operator side) ----------------

/**
 * Options for getPublishedEventForRevision — the operator-side read that powers
 * the "published event revision" branch of /console/[eventId]. Reads the
 * HotEvent with its published read models + the latest revision + the latest
 * explanation version, then assembles published-vs-effective-vs-pending for the
 * operator diff. Mirrors the established `{ prisma, traceId, hotEventId }`
 * query pattern (same shape as getCandidateDetail). Throws CandidateNotFoundError
 * if the event is missing.
 */
export interface GetPublishedEventForRevisionOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * The assembled published-event revision view. This is the OPERATOR-side read
 * (NOT a public read — it reads hot_events + hot_event_revisions +
 * explanation_versions + the published_* read models to compute the pending
 * diff). It is the same kind of cross-aggregate operator read as getCandidateDetail
 * (which reads hot_events + evidence_records + decisions). AD-3 still holds:
 * the PUBLIC detail page only reads published_* via getPublishedHotEventDetail.
 *
 *   - published: the CURRENTLY PUBLIC title/tags/explanation (from the
 *     published_* read models) + publishedAt, or null if the event is not
 *     currently published (e.g. taken_down — the operator can still revise
 *     the working copy, but there is no public version to diff against).
 *   - effective: the LATEST working title/tags/explanation (latest revision ??
 *     baseline title + [] tags; latest ExplanationVersion ?? null). This is
 *     what a republish would project onto the public surface.
 *   - pending: the CONTENT DIFF between effective and published — three booleans
 *     (title/tags/explanation). When all three are false, there is nothing to
 *     republish. The diff is a content comparison (string / array / partition),
 *     NOT a timestamp comparison (timestamps are fragile; content diff is robust).
 */
export interface PublishedEventRevisionView {
  hotEventId: string;
  publicationStatus: string;
  published: {
    title: string;
    tags: string[];
    explanation: ExplanationPartitions | null;
    publishedAt: Date;
  } | null;
  effective: {
    title: string;
    tags: string[];
    explanation: ExplanationPartitions | null;
  };
  pending: {
    title: boolean;
    tags: boolean;
    explanation: boolean;
  };
}
