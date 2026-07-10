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

/**
 * The outcome an operator chooses for a candidate. Stored as a String column
 * (no TS enum, per erasableSyntaxOnly). The legal transitions are:
 *   - Approve:  candidate → published
 *   - Reject:   candidate → rejected
 *   - Takedown: published → taken_down
 */
export const ReviewOutcome = {
  Approve: "approve",
  Reject: "reject",
  Takedown: "takedown",
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
