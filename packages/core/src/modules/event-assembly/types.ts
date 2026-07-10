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
