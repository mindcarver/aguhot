/**
 * The authoritative PublicationStatus union, shared across event-assembly and
 * review-workflow.
 *
 * 1.5 placed `PublicationStatus = { Candidate }` in event-assembly/types.ts —
 * event-assembly was the only writer at the time. 1.6 introduces review-
 * workflow, which owns the published/rejected/taken_down transitions. Defining
 * the full set in review-workflow would either clash with event-assembly's
 * same-named export or create a reversed dependency (the publish gate depending
 * on the clustering module). The shared kernel is the natural home for a cross-
 * module status concept — the same role shared/ids.ts plays for trace ids.
 *
 * event-assembly re-exports this from its types.ts so the 1-5 public API (and
 * the 1-5 verify/selfcheck) stays unchanged. The DB column remains a plain
 * String; reading it back yields Prisma's `string`, not this union.
 */

export const PublicationStatus = {
  Candidate: "candidate",
  Published: "published",
  Rejected: "rejected",
  TakenDown: "taken_down",
} as const;

export type PublicationStatus = (typeof PublicationStatus)[keyof typeof PublicationStatus];
