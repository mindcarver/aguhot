/**
 * event-assembly domain types: the publication status union (no TS enum, per
 * repo erasableSyntaxOnly convention), clustering options, and the cluster
 * input shape.
 *
 * `PublicationStatus` is stored as a String column with a TS union (not a
 * Prisma enum). This story (1.5) only ever assigns `Candidate`. The
 * transitions to "published"/"taken_down" etc. are owned by review-workflow
 * (1.6) via application commands and are intentionally NOT enumerated here —
 * this module never assigns them. Enumerating future statuses here would
 * imply this module owns them, violating the single-writer discipline (AD-2).
 */

/**
 * The publication lifecycle value this module may assign.
 *
 * - `Candidate`: produced by clustering (this story). Not visible on the public
 *   site. The transition to "published" (and "taken_down" etc.) is driven by
 *   review-workflow (1.6), not by this module.
 *
 * The union is derived solely from the const object above, so it contains only
 * the value(s) event-assembly writes (`"candidate"`). This type-enforces the
 * single-writer claim: `publicationStatus: "published"` does NOT type-check
 * here, so a stray publish cannot slip in via this module. The DB column itself
 * is a plain String and may hold other values written by review-workflow (1.6);
 * those are typed in that module's scope, not here. Reading the column back
 * yields Prisma's `string`, not this union, so narrowing does not affect reads.
 */
export const PublicationStatus = {
  Candidate: "candidate",
} as const;

export type PublicationStatus = (typeof PublicationStatus)[keyof typeof PublicationStatus];

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
