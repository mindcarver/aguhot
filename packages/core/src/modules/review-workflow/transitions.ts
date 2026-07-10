/**
 * Pure transition resolver for review-workflow: given the current
 * publication_status and an operator outcome, return the legal target status +
 * read-model action, or throw IllegalTransitionError.
 *
 * No DB, no side-effects — fully unit-checkable in isolation (the self-check
 * runs via tsx with no infra). The DB service (review-service.ts) calls this
 * inside its transaction to validate before writing anything.
 *
 * Legal paths (the only ones):
 *   candidate → published  (approve)    → publish  (upsert read model)
 *   candidate → rejected   (reject)     → none     (no read-model touch)
 *   published → taken_down (takedown)   → takedown (delete read model)
 *   published → published  (republish)  → publish  (re-project effective title/
 *     tags + latest explanation into the read models; Story 1.9 re-publish after
 *     an operator revision)
 *
 * Everything else is illegal and throws — including:
 *   - reject/takedown on a published event (published events are taken down,
 *     not rejected; reject is only for not-yet-published candidates)
 *   - approve/takedown/republish on a rejected event (rejected is terminal in
 *     V1; re-publish of a taken_down/rejected event is 1.10, deferred)
 *   - approve/takedown/republish on a taken_down event (re-publish is 1.10)
 *   - takedown/republish on a candidate (never published, nothing to take down
 *     or refresh)
 */

import { PublicationStatus } from "../../shared/publication-status.js";
import type { PublishAction, ResolvedTransition } from "./types.js";
import { PublishAction as PublishActionConst } from "./types.js";
import type { ReviewOutcome } from "./types.js";
import { IllegalTransitionError } from "./types.js";

/**
 * Resolve the target publication_status + read-model action for a (from,
 * outcome) pair. Throws IllegalTransitionError for any path outside the legal
 * ones. The caller passes the CURRENT status (read from the DB inside the
 * transaction); the returned `to` is what review-service writes.
 */
export function resolveTransition(
  from: string,
  outcome: ReviewOutcome,
): ResolvedTransition {
  // The legal paths. Each is exact-match on (from, outcome) so an unexpected
  // status string (data drift) falls through to the illegal throw.
  if (from === PublicationStatus.Candidate && outcome === "approve") {
    return { to: PublicationStatus.Published, action: PublishActionConst.Publish };
  }
  if (from === PublicationStatus.Candidate && outcome === "reject") {
    return { to: PublicationStatus.Rejected, action: PublishActionConst.None };
  }
  if (from === PublicationStatus.Published && outcome === "takedown") {
    return { to: PublicationStatus.TakenDown, action: PublishActionConst.Takedown };
  }
  if (from === PublicationStatus.Published && outcome === "republish") {
    // published → published: re-project the EFFECTIVE title/tags + latest
    // explanation into the read models. publish-orchestrator's refresh now
    // reads the latest HotEventRevision overlay + the latest ExplanationVersion,
    // so a republish after a revision surfaces the new content publicly.
    // publishedAt stays stable (publish-orchestrator keeps it on the update path).
    return { to: PublicationStatus.Published, action: PublishActionConst.Publish };
  }
  throw new IllegalTransitionError(from, outcome);
}

/**
 * The set of legal (from, outcome) pairs, for introspection / self-check. Not
 * used by the DB service; exposed so the self-check can assert the exhaustive
 * coverage without hardcoding the table a second time.
 */
export const LEGAL_TRANSITIONS: ReadonlyArray<{
  from: string;
  outcome: ReviewOutcome;
  to: string;
  action: PublishAction;
}> = [
  { from: PublicationStatus.Candidate, outcome: "approve", to: PublicationStatus.Published, action: PublishActionConst.Publish },
  { from: PublicationStatus.Candidate, outcome: "reject", to: PublicationStatus.Rejected, action: PublishActionConst.None },
  { from: PublicationStatus.Published, outcome: "takedown", to: PublicationStatus.TakenDown, action: PublishActionConst.Takedown },
  { from: PublicationStatus.Published, outcome: "republish", to: PublicationStatus.Published, action: PublishActionConst.Publish },
];
