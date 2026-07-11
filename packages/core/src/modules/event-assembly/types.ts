/**
 * event-assembly domain types: the publication status union (no TS enum, per
 * repo erasableSyntaxOnly convention), clustering options, and the cluster
 * input shape.
 *
 * `PublicationStatus` is now re-exported from the shared kernel
 * (shared/publication-status.ts), which is the single source of truth for the
 * full candidate|published|rejected|taken_down set. event-assembly still only
 * ever assigns `Candidate` — re-exporting the full set here does NOT widen this
 * module's writes; it only keeps the 1-5 public API stable so the 1-5 verify/
 * selfcheck and downstream consumers keep importing `PublicationStatus` from
 * event-assembly unchanged. The DB column is a plain String; reading it back
 * yields Prisma's `string`, not this union.
 */

export { PublicationStatus } from "../../shared/publication-status.js";
export type { PublicationStatus as PublicationStatusType } from "../../shared/publication-status.js";

/**
 * Options for clusterRecords. The defaults are named constants (below) so the
 * self-check and the DB service share the same tuning without magic numbers.
 *
 * `similarityThreshold` is the overlap-coefficient cutoff: two records merge
 * into the same group iff `|A ∩ B| / min(|A|, |B|) >= threshold`. Overlap-
 * coefficient (not Jaccard) so a short headline that is a subset of a longer
 * one ("央行降准" ⊂ "央行宣布降准0.5个百分点") scores 1.0 and merges, which
 * Jaccard would split (see Design Notes).
 *
 * `timeWindowMs` bounds how far apart two otherwise-similar records may be in
 * publication time and still merge: `|ΔpublishedAt| <= timeWindowMs`. Without
 * this, a recurring headline ("央行降准") would collapse distinct events days
 * or weeks apart into one candidate.
 */
export interface ClusterOptions {
  similarityThreshold?: number;
  timeWindowMs?: number;
}

export const SIMILARITY_THRESHOLD = 0.7;
export const TIME_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h

/**
 * Timeline fold threshold (Story 4.1, PRD §12 Q6 closed). A HotEvent with at
 * least this many member EvidenceRecords folds into ONE "同事件精选" timeline
 * entry; a single-source event stays as one independent entry. Owned by
 * event-assembly because folding is clustering semantics (the same kind of
 * "are these one thing?" decision as SIMILARITY_THRESHOLD). publish-orchestrator
 * READS this constant when projecting published_timeline_entries; it never
 * writes it, and it is deliberately NOT in global env.ts (architect review
 * decision: cluster semantics do not belong in global config). Operator-
 * adjustable in a future story by making this a per-deployment override; V1 is
 * the fixed default of 2.
 */
export const TIMELINE_FOLD_THRESHOLD = 2;

/**
 * The input shape for clustering: the minimal projection of an archived
 * EvidenceRecord needed to group records into candidate events. `publishedAt`
 * may be null (a missing_fields record has no publication time); such records
 * never merge with others on the time-window check (they form their own group)
 * and their title tokens (possibly empty) still drive title-based similarity.
 */
export interface ClusterInput {
  id: string;
  title: string | null;
  publishedAt: Date | null;
  ingestedAt: Date;
}

// --- Story 1.9: operator-authored title/tags revision ------------------------

/**
 * Options for reviseHotEvent. `{ prisma, traceId, hotEventId, title, tags,
 * reviewer, note? }` mirrors the established command pattern (decideReview).
 *
 * `title` is the new effective title (operator overlay on the cluster-derived
 * baseline). `tags` is the raw operator tag input — it may be a single string
 * (paste, e.g. "A股,政策\n新闻") or a pre-split array; reviseHotEvent normalizes
 * it (split on separators / trim / dedupe preserve-order). `reviewer` is the
 * operator identity placeholder (V1 no real auth). `note` is an optional
 * revision note (audit).
 */
export interface ReviseHotEventOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  hotEventId: string;
  title: string;
  tags: string | string[];
  reviewer: string;
  note?: string;
}

/**
 * Result of reviseHotEvent. `appended: true` + `revisionId` when a new
 * HotEventRevision row was appended (the title or normalized tags changed).
 * `appended: false` on no-op (no change vs effective — no dirty version, no
 * pending diff). `notFound: true` when the event does not exist.
 * `invalidTitle: true` when the trimmed title is empty (an event must keep a
 * non-empty title).
 */
export interface ReviseHotEventResult {
  appended: boolean;
  revisionId?: string;
  notFound?: boolean;
  invalidTitle?: boolean;
}

// --- Story 1.10: operator-driven merge & split of published hot events -------

/**
 * Options for mergeHotEvents — move source's evidence links into target,
 * dedupe shared evidence, clear source's links, and recompute target's
 * cluster_signature. `{ prisma, traceId, sourceId, targetId }` mirrors the
 * established command pattern. The server action calls this BEFORE
 * decideReview(target, republish) + decideReview(source, takedown) — the
 * evidence move is event-assembly's job; the status transitions + read-model
 * refresh are the publish gate's job (reuse, not rebuild).
 */
export interface MergeHotEventsOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  /** The event whose evidence is absorbed (retired via takedown afterward). */
  sourceId: string;
  /** The event that receives the absorbed evidence (refreshed via republish). */
  targetId: string;
}

/**
 * Result of mergeHotEvents.
 *   - merged: true + counts + targetSignature on success.
 *   - merged: false + sameId: true when sourceId === targetId (rejected before
 *     any write; the server action surfaces an error to the operator).
 *
 * movedLinks = records that were newly linked to target (not already there).
 * dedupedLinks = records that were already on target (shared evidence) — their
 * source link is deleted, no duplicate created on target (the @@unique guard).
 */
export interface MergeHotEventsResult {
  merged: boolean;
  movedLinks?: number;
  dedupedLinks?: number;
  targetSignature?: string;
  sameId?: boolean;
}

/**
 * Options for splitHotEvent — create a new candidate from a selected subset of
 * source's evidence, move the selected links source→new, and recompute both
 * signatures. `{ prisma, traceId, sourceId, evidenceRecordIds, title, reviewer }`
 * mirrors the established command pattern. The server action calls this BEFORE
 * decideReview(source, republish) — the evidence move is event-assembly's job;
 * the source read-model refresh is the publish gate's job. The new candidate is
 * published later through the standard approve gate (1.6), NOT auto-published
 * (the publish gate stays mandatory; auto-publish is an undecided defer).
 */
export interface SplitHotEventOptions {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  /** The event whose evidence subset is carved out into the new candidate. */
  sourceId: string;
  /** The evidence record ids to move to the new candidate (the subset). */
  evidenceRecordIds: string[];
  /** The title for the new candidate (operator-provided). */
  title: string;
  /** Operator identity placeholder (V1 no real auth). */
  reviewer: string;
}

/**
 * Result of splitHotEvent.
 *   - split: true + newHotEventId + movedLinks on success.
 *   - split: false + a flag explaining the rejection (invalidTitle /
 *     emptySelection / fullSetSelected) — each is enforced before any write.
 *
 * fullSetSelected = every source record was selected (that's a takedown, not a
 * split — the operator should use the takedown button to retire source entirely).
 */
export interface SplitHotEventResult {
  split: boolean;
  newHotEventId?: string;
  movedLinks?: number;
  reviewer?: string;
  invalidTitle?: boolean;
  emptySelection?: boolean;
  fullSetSelected?: boolean;
}
