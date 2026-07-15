/**
 * clusterEvents — the event-assembly DB service.
 *
 * Single write-owner of hot_events + hot_event_evidence (AD-2). It reads
 * archived EvidenceRecords that have no link yet (the "processing set"), groups
 * them with clusterRecords (overlap-coefficient + time-window union-find), then
 * for each group either creates a new candidate HotEvent or merges into an
 * existing one whose signature overlaps, and creates the traceable links.
 *
 * Idempotency: the processing set is "archived records with no evidenceLinks".
 * After a run, every processed record has a link, so a re-run has an empty
 * processing set and produces nothing new. The @@unique([hot_event_id,
 * evidence_record_id]) guards against a duplicate link to the SAME candidate.
 * Candidate-level idempotency (no duplicate HotEvents for one event) relies on
 * serialized execution — the worker runs at BullMQ concurrency 1 in a single
 * process, so two cluster jobs never pull the same unlinked batch and each
 * mint their own candidate. ponytail: if throughput ever needs concurrency > 1
 * or multiple worker processes, add row-level locking / a "claim" on the
 * processing set before clustering; the @@unique guard alone does not prevent
 * duplicate candidates across overlapping jobs.
 *
 * Incremental merge: after clustering the new batch, each group's signature is
 * compared against existing candidates by the same overlap-coefficient rule.
 * A hit merges the group into that candidate (new links + recompute signature +
 * keep the existing candidate title stable — title revision is an operator
 * action in 1.9, not an automatic overwrite). A miss creates a new candidate
 * with the title derived from the latest publishedAt record in the group.
 *
 * This module never writes evidence_records, published_*, or any other module's
 * aggregate. It never sets publication_status to "published" (that transition
 * belongs to review-workflow, 1.6).
 */

import { newTraceId } from "../../shared/ids.js";
import type { PrismaClient, Prisma } from "../../../generated/client.js";
import { clusterRecords, signatureOf, SIGNATURE_DELIMITER } from "./clustering.js";
import { judgeRelevance, scoreSaliency, VELOCITY_WINDOW_MS } from "./saliency.js";
import type { ClusterInput, ClusterOptions } from "./types.js";
import { PublicationStatus, SIMILARITY_THRESHOLD, TIME_WINDOW_MS } from "./types.js";

export interface ClusterEventsOptions {
  prisma: PrismaClient;
  traceId: string;
  /** Clustering tuning (defaults: similarity 0.7, window 72h). */
  clusterOptions?: ClusterOptions;
}

export interface ClusterEventsResult {
  traceId: string;
  /** Number of brand-new candidate HotEvents created this run. */
  newCandidates: number;
  /** Number of existing candidates a group merged into this run. */
  mergedInto: number;
  /** Number of hot_event_evidence links created this run. */
  linksCreated: number;
}

/**
 * The fallback title when a group has no non-null title to derive from (all
 * member records have null titles, or the latest-publishedAt record's title is
 * null). Deliberately a plain string, not AI-generated (no NFR3 AI-label duty
 * — derived, not generated; see Design Notes).
 */
const FALLBACK_TITLE = "未命名候选";

/**
 * Run one clustering pass over unlinked archived records.
 *
 * Returns a summary; never throws on empty processing set (no-op returns zeros).
 */
export async function clusterEvents(
  options: ClusterEventsOptions,
): Promise<ClusterEventsResult> {
  const { prisma, traceId } = options;
  const clusterOptions = options.clusterOptions ?? {};

  // Processing set: archived records not yet linked to any candidate. The
  // `evidenceLinks: { none: {} }` compiles to a NOT EXISTS against
  // hot_event_evidence, so this stays efficient as the link table grows.
  const unlinked = await prisma.evidenceRecord.findMany({
    where: {
      status: "archived",
      evidenceLinks: { none: {} },
    },
    select: {
      id: true,
      sourceId: true,
      title: true,
      summary: true,
      publishedAt: true,
      ingestedAt: true,
    },
    orderBy: { publishedAt: "asc" },
  });

  if (unlinked.length === 0) {
    return { traceId, newCandidates: 0, mergedInto: 0, linksCreated: 0 };
  }

  const inputs: ClusterInput[] = unlinked.map((r) => ({
    id: r.id,
    title: r.title,
    publishedAt: r.publishedAt,
    ingestedAt: r.ingestedAt,
  }));

  const groups = clusterRecords(inputs, clusterOptions);

  // Index unlinked records by id for O(1) lookup when resolving group members
  // (clusterRecords returns ids only; we need title/summary/publishedAt for
  // candidate title derivation).
  const byId = new Map(unlinked.map((r) => [r.id, r]));

  // Load existing candidates once for the signature-merge pass, including the
  // min/max publishedAt of their members so the time-window gate can be
  // enforced on incremental merge (a >72h-apart same-title record must NOT
  // merge even if its signature overlaps). V1 candidate volume is tiny
  // (handful per cluster job); a full scan + aggregate is fine. The ponytail
  // ceiling is noted in deferred-work.
  const existingCandidatesRaw = await prisma.hotEvent.findMany({
    select: {
      id: true,
      title: true,
      clusterSignature: true,
      evidence: { select: { evidenceRecord: { select: { publishedAt: true } } } },
    },
  });
  const existingCandidates = existingCandidatesRaw.map((c) => ({
    id: c.id,
    title: c.title,
    clusterSignature: c.clusterSignature,
    publishedBounds: publishedBoundsOf(
      c.evidence.map((l) => l.evidenceRecord.publishedAt),
    ),
  }));

  let newCandidates = 0;
  let mergedInto = 0;
  let linksCreated = 0;

  for (const group of groups) {
    const members = group.ids
      .map((id) => byId.get(id))
      .filter((r) => r !== undefined) as (typeof unlinked)[number][];
    if (members.length === 0) continue;

    const groupSignature = signatureOf(
      members.map((m) => ({ id: m.id, title: m.title, publishedAt: m.publishedAt, ingestedAt: m.ingestedAt })),
    );
    const groupPublishedBounds = publishedBoundsOf(members.map((m) => m.publishedAt));

    // Try to merge into an existing candidate by signature overlap + time window.
    const match = findCandidateBySignature(
      existingCandidates,
      groupSignature,
      groupPublishedBounds,
    );
    if (match !== null) {
      // Merge: create links to the existing candidate, recompute its signature
      // from the full member set (existing members + new group), keep its title
      // stable (title revision is an operator action, 1.9).
      const created = await createLinks(prisma, match.id, group.ids, traceId);
      linksCreated += created;

      // Recompute the candidate's signature from ALL its member records (old +
      // new), so future incremental merges compare against the full union.
      const allMembers = await prisma.evidenceRecord.findMany({
        where: { evidenceLinks: { some: { hotEventId: match.id } } },
        select: { id: true, sourceId: true, title: true, summary: true, publishedAt: true, ingestedAt: true },
      });
      const newSig = signatureOf(allMembers);
      // Re-score the merged candidate: more members may have changed breadth /
      // velocity / relevance (Story 7.1/7.2). event-assembly stays the sole
      // writer of these fields (AD-2b).
      const mergedScore = scoreGroup(allMembers);
      await prisma.hotEvent.update({
        where: { id: match.id },
        data: {
          clusterSignature: newSig,
          relevanceLabel: mergedScore.label,
          saliency: mergedScore.score,
          // Prisma's Json envelope does not infer the object's element type; the
          // cast is the documented TS↔Json boundary (mirrors theme-service.ts).
          saliencyBreakdown: mergedScore.breakdown as unknown as Prisma.InputJsonValue,
          traceId,
        },
      });
      // Keep the in-memory snapshot in sync for subsequent groups in this run:
      // signature + published-bounds both expand to cover the merged members.
      match.clusterSignature = newSig;
      match.publishedBounds = publishedBoundsOf(allMembers.map((m) => m.publishedAt));
      mergedInto += 1;
    } else {
      // Create a new candidate. Title = the latest publishedAt record's title
      // (publishedAt asc sort means the last member), fallback to summary
      // fragment, then the placeholder.
      const title = deriveTitle(members);
      // Score the candidate at creation (Story 7.1/7.2): relevance gate +
      // cluster-time saliency from the group's member evidence. event-assembly
      // is the sole writer of these fields (AD-2b); the publish gate (Story
      // 7.3) reads them to decide reject / hold / auto-publish.
      const createdScore = scoreGroup(members);
      const candidate = await prisma.hotEvent.create({
        data: {
          id: newTraceId(),
          title,
          clusterSignature: groupSignature,
          publicationStatus: PublicationStatus.Candidate,
          relevanceLabel: createdScore.label,
          saliency: createdScore.score,
          saliencyBreakdown: createdScore.breakdown as unknown as Prisma.InputJsonValue,
          traceId,
        },
      });
      const created = await createLinks(prisma, candidate.id, group.ids, traceId);
      linksCreated += created;
      existingCandidates.push({
        id: candidate.id,
        title: candidate.title,
        clusterSignature: candidate.clusterSignature,
        publishedBounds: groupPublishedBounds,
      });
      newCandidates += 1;
    }
  }

  return { traceId, newCandidates, mergedInto, linksCreated };
}

/**
 * The publishedAt window of a candidate's (or group's) members: the min and max
 * non-null publishedAt. Null if all members have null publishedAt — such a
 * candidate can never satisfy a time-window check against anything.
 */
type PublishedBounds = { min: number; max: number } | null;

/**
 * Find an existing candidate whose signature overlaps the group signature by
 * the overlap-coefficient threshold AND whose publishedAt window is within
 * timeWindowMs of the group's publishedAt window. The time-window gate is
 * critical: without it, a recurring headline ("央行降准") days apart would
 * collapse distinct events into one candidate via signature overlap alone.
 * This mirrors the withinTimeWindow gate in clusterRecords.
 *
 * Returns the first match (candidates are few in V1) or null. The returned
 * reference is the same object in the list so the caller can mutate its
 * signature/publishedBounds in the merge path.
 */
function findCandidateBySignature(
  candidates: {
    id: string;
    title: string;
    clusterSignature: string;
    publishedBounds: PublishedBounds;
  }[],
  groupSignature: string,
  groupBounds: PublishedBounds,
): {
  id: string;
  title: string;
  clusterSignature: string;
  publishedBounds: PublishedBounds;
} | null {
  const groupTokens = signatureToTokenSet(groupSignature);
  if (groupTokens.size === 0) return null;
  for (const c of candidates) {
    if (!publishedWindowsOverlap(c.publishedBounds, groupBounds, TIME_WINDOW_MS)) continue;
    const candTokens = signatureToTokenSet(c.clusterSignature);
    if (candTokens.size === 0) continue;
    if (overlapOf(groupTokens, candTokens) >= SIMILARITY_THRESHOLD) {
      return c;
    }
  }
  return null;
}

/**
 * Two publishedAt windows overlap within windowMs iff their gap (the distance
 * between the closer of each pair) is <= windowMs. Concretely: the newest of
 * the older pair and the oldest of the newer pair must be within windowMs.
 * Equivalently: |groupMin - candMax| <= windowMs AND |candMin - groupMax| <=
 * windowMs is wrong — the correct check is that there exist a cand time and a
 * group time within windowMs, i.e. the ranges are not separated by more than
 * windowMs. That is: max(0, groupMin - candMax, candMin - groupMax) <= windowMs.
 *
 * Returns false if either side has null bounds (no usable publishedAt).
 */
function publishedWindowsOverlap(
  a: PublishedBounds,
  b: PublishedBounds,
  windowMs: number,
): boolean {
  if (a === null || b === null) return false;
  const gap = Math.max(0, a.min - b.max, b.min - a.max);
  return gap <= windowMs;
}

/**
 * Compute the min/max publishedAt bounds from a list of (possibly null) dates.
 * Returns null if all dates are null.
 */
function publishedBoundsOf(dates: (Date | null)[]): PublishedBounds {
  let min = Infinity;
  let max = -Infinity;
  for (const d of dates) {
    if (d === null) continue;
    const t = d.getTime();
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (min === Infinity) return null;
  return { min, max };
}

/**
 * Create links for a group of evidence record ids to a candidate. The
 * @@unique([hot_event_id, evidence_record_id]) is the tail guard: a duplicate
 * link (e.g. from a race) is skipped via `onConflict: DoNothing`-style
 * upsert-ish create. Prisma 7 does not have a per-row onConflict for createMany
 * here, so we create one-by-one and swallow the unique-constraint error (P2002)
 * — this is the documented idempotency guard, not a silent failure.
 */
async function createLinks(
  prisma: PrismaClient,
  hotEventId: string,
  evidenceRecordIds: string[],
  traceId: string,
): Promise<number> {
  let created = 0;
  for (const evidenceRecordId of evidenceRecordIds) {
    try {
      await prisma.hotEventEvidence.create({
        data: {
          id: newTraceId(),
          hotEventId,
          evidenceRecordId,
          traceId,
        },
      });
      created += 1;
    } catch (error) {
      // P2002 = unique constraint violation: the link already exists (race or
      // re-run). This is the idempotency guard at work — skip silently.
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }
  return created;
}

/**
 * The DB-row shape deriveTitle needs: the archived record projection carried
 * from the findMany select. Summary is included for the title fallback chain.
 */
type DeriveTitleMember = {
  id: string;
  title: string | null;
  summary: string | null;
  publishedAt: Date | null;
  ingestedAt: Date;
};

/**
 * Derive the candidate title from a group: the latest publishedAt record's
 * title. If that is null/empty, fall back to a summary fragment (first 40 chars
 * of the latest record's summary). If that is also null/empty, use the
 * placeholder. This is a pure derivation (non-AI); real title/explanation
 * generation is the explain job (1.8).
 *
 * `members` is in publishedAt asc order (the findMany sort), so iterating from
 * the end prefers the latest publishedAt record. Null publishedAt sorts first
 * (asc), so a null-title late record correctly indicates "no usable title in
 * the group".
 */
function deriveTitle(members: DeriveTitleMember[]): string {
  // Pass 1: latest non-empty title.
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i]!;
    if (m.title !== null && m.title.trim() !== "") {
      return m.title;
    }
  }
  // Pass 2: latest non-empty summary fragment.
  for (let i = members.length - 1; i >= 0; i--) {
    const m = members[i]!;
    if (m.summary !== null && m.summary.trim() !== "") {
      const frag = m.summary.trim().slice(0, 40);
      return frag.length < (m.summary.trim().length) ? `${frag}…` : frag;
    }
  }
  return FALLBACK_TITLE;
}

/**
 * The member shape scoreGroup needs: the projection carried from the findMany
 * selects (which now include sourceId + summary for the relevance text + breadth
 * distinct-source count). Structural typing accepts the DB rows' extra fields
 * (id, ingestedAt) silently.
 */
type ScoreMember = {
  sourceId: string;
  title: string | null;
  summary: string | null;
  publishedAt: Date | null;
};

/**
 * Compute the relevance label + cluster-time saliency for a group of member
 * evidence records (Story 7.1/7.2). Relevance runs over the concatenated
 * title+summary text; breadth keys off distinct EvidenceSource feeds; velocity
 * off the publishedAt span (only when ≥2 distinct sources AND ≥2 non-null
 * timestamps — otherwise unmeasurable, so velocity contributes 0 by passing the
 * full window as the span). Returns the label + score + Json breakdown to write
 * onto the HotEvent row (event-assembly sole writer, AD-2b).
 */
function scoreGroup(members: ScoreMember[]): {
  label: ReturnType<typeof judgeRelevance>["label"];
  score: number;
  breakdown: ReturnType<typeof scoreSaliency>["breakdown"];
} {
  const text = members.map((m) => `${m.title ?? ""} ${m.summary ?? ""}`).join(" ");
  const { label } = judgeRelevance(text);
  const distinctSourceCount = new Set(members.map((m) => m.sourceId)).size;
  const nonNull = members
    .map((m) => m.publishedAt)
    .filter((d): d is Date => d !== null);
  // Unmeasurable timing (<2 timestamps) → span = full window → velocity 0.
  const spanMs =
    nonNull.length >= 2
      ? Math.max(...nonNull.map((d) => d.getTime())) - Math.min(...nonNull.map((d) => d.getTime()))
      : VELOCITY_WINDOW_MS;
  const { score, breakdown } = scoreSaliency({
    evidenceCount: members.length,
    distinctSourceCount,
    spanMs,
  });
  return { label, score, breakdown };
}

// --- helpers -----------------------------------------------------------------

function signatureToTokenSet(signature: string): Set<string> {
  if (signature === "") return new Set();
  return new Set(signature.split(SIGNATURE_DELIMITER));
}

function overlapOf(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const t of small) {
    if (large.has(t)) intersection += 1;
  }
  return intersection / small.size;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
