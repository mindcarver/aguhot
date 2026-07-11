/**
 * merge-split-service — operator-driven merge & split of published hot events
 * (Story 1.10).
 *
 * This module lives inside event-assembly (AD-2: event-assembly owns HotEvent
 * clustering and merge/split). It is the "operator-explicitly-driven, on
 * already-published events" counterpart to clusterEvents' candidate-level
 * merge primitive. It ONLY writes:
 *
 *   - hot_event_evidence (move links source→target / source→new; the link
 *     table is event-assembly's to reorganize — this story introduces link
 *     deletion as a legitimate cluster-reorganization action),
 *   - hot_events.cluster_signature (recompute via signatureOf after a move;
 *     field-level ownership, signature only),
 *   - hot_events (create one new candidate row on split — same as clusterEvents).
 *
 * It NEVER writes hot_events.title (title stays cluster-derived / a 1.9
 * revision overlay), publication_status, published_*, review_decisions,
 * publication_decisions, or any decision table. The status transitions +
 * read-model refresh that make a merge/split visible publicly are driven by
 * the server action calling decideReview (review-workflow) AFTER this module
 * moves the evidence — the same "reuse, not rebuild, the publish gate" pattern
 * as 1.9 (reviseHotEvent then decideReview(republish)).
 *
 * Merge semantics (single source of truth, per spec Boundaries):
 *   - target ends up holding source ∪ target evidence (shared evidence deduped
 *     via the @@unique([hot_event_id, evidence_record_id]) guard — a shared
 *     record moves as one link on target, the source link is deleted, no dup),
 *   - target.cluster_signature recomputed = signatureOf(all target member
 *     records after the move),
 *   - source's hot_event_evidence links are cleared (all moved or deduped away),
 *   - source≠target is enforced (same id is rejected before any write).
 * The server action then calls decideReview(target, republish) to refresh
 * target's read model (shows the union), and decideReview(source, takedown) to
 * retire the source (delete source's read model; audit chain keeps the note).
 *
 * Split semantics:
 *   - a brand-new candidate HotEvent is created (id: newTraceId(), title from
 *     operator, clusterSignature = signatureOf(selected records),
 *     publicationStatus = Candidate — respects the publish gate; the operator
 *     approves it via the existing 1.6 queue),
 *   - the selected evidence links move source→new (delete source link, create
 *     new link),
 *   - source.cluster_signature recomputed = signatureOf(remaining members),
 *   - the selected subset must be non-empty AND not the full set (leaving at
 *     least 1 record on source — otherwise that's a takedown, not a split).
 * The server action then calls decideReview(source, republish) to refresh
 * source's read model (shows the remaining evidence).
 *
 * NFR: never fabricates evidence. Both functions only move/relink existing
 * evidence records; no record content is synthesized.
 */

import { newTraceId } from "../../shared/ids.js";
import { signatureOf } from "./clustering.js";
import { PublicationStatus } from "./types.js";
import type {
  MergeHotEventsOptions,
  MergeHotEventsResult,
  SplitHotEventOptions,
  SplitHotEventResult,
} from "./types.js";

/**
 * Merge one hot event's evidence into another (operator-driven, Story 1.10).
 *
 * Moves every source evidence link to target (shared evidence deduped by the
 * @@unique guard — a record already on target has its source link deleted, no
 * duplicate created on target), clears source's links, and recomputes target's
 * cluster_signature from the full post-move member set. source≠target is
 * enforced before any write.
 *
 * Returns { movedLinks, dedupedLinks, targetSignature }. The server action
 * then calls decideReview(target, republish) + decideReview(source, takedown).
 *
 * This module does NOT change publication_status or published_* — that is the
 * review-workflow publish gate's job, called after this function returns.
 */
export async function mergeHotEvents(
  options: MergeHotEventsOptions,
): Promise<MergeHotEventsResult> {
  const { prisma, traceId, sourceId, targetId } = options;

  // source≠target is the first guard (before any DB read/write). Merging an
  // event into itself would otherwise delete all its links then fail to
  // re-create them (every record collides with itself on the unique guard).
  if (sourceId === targetId) {
    return { merged: false, sameId: true };
  }

  // Single atomic transaction (Story 1.10 BLOCK fix). All reads + writes
  // (source/target link reads, link creates/deletes, target cluster_signature
  // recompute) commit together or not at all. Without this wrap, a crash between
  // the per-link create-then-delete pairs left evidence half-moved (source
  // drained but target not fully populated) and cluster_signature stale. The tx
  // grants CRASH atomicity only — NOT concurrency serialization. Prisma's
  // default $transaction is Read Committed; locks are taken on write/delete,
  // not on the findMany reads above, so two concurrent merges into the same
  // target do NOT serialize (a loser's link delete may throw P2003/P2025 —
  // only P2002 is swallowed below — or recompute cluster_signature from a
  // stale member set). True serialization (FOR UPDATE / advisory lock /
  // Serializable) is deferred; V1 volume makes concurrent same-target
  // merge/split implausible. This mirrors decideReview's $transaction
  // pattern (review-service.ts:68).
  return prisma.$transaction(async (tx) => {
    // Read the source's evidence links. These are the records to move to target.
    const sourceLinks = await tx.hotEventEvidence.findMany({
      where: { hotEventId: sourceId },
      select: { id: true, evidenceRecordId: true },
    });

    // Read target's existing record ids so we can dedupe (a record already on
    // target should NOT get a second link — the @@unique guard would reject it;
    // we skip the create and just delete the source link).
    const targetExisting = await tx.hotEventEvidence.findMany({
      where: { hotEventId: targetId },
      select: { evidenceRecordId: true },
    });
    const targetRecordIds = new Set(
      targetExisting.map((l) => l.evidenceRecordId),
    );

    let movedLinks = 0;
    let dedupedLinks = 0;

    // Move each source link: if the record is already on target (shared evidence),
    // just delete the source link (dedupe); otherwise create the target link then
    // delete the source link. Creating one-by-one and swallowing P2002 is the
    // same idempotency guard as clusterEvents' createLinks (a race or a re-run
    // that produces a duplicate is skipped silently — the @@unique is the tail
    // guard, not a silent failure).
    for (const link of sourceLinks) {
      if (targetRecordIds.has(link.evidenceRecordId)) {
        // Shared evidence: the record is already on target. Delete the source
        // link; do NOT create a duplicate on target (the unique guard would
        // reject it anyway).
        dedupedLinks += 1;
      } else {
        // Create the link on target. P2002 (race) is swallowed; the record ends
        // up linked to target regardless.
        try {
          await tx.hotEventEvidence.create({
            data: {
              id: newTraceId(),
              hotEventId: targetId,
              evidenceRecordId: link.evidenceRecordId,
              traceId,
            },
          });
          movedLinks += 1;
          targetRecordIds.add(link.evidenceRecordId);
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) {
            throw error;
          }
          // P2002: the link already exists on target (race). Count as deduped.
          dedupedLinks += 1;
        }
      }
      // Delete the source link (whether moved or deduped, source no longer holds it).
      await tx.hotEventEvidence.delete({ where: { id: link.id } });
    }

    // Recompute target.cluster_signature from ALL its post-move member records
    // (old members + moved members). This is the same recompute-and-update pattern
    // as clusterEvents' incremental merge path. signatureOf reads titles via the
    // evidence link chain.
    const targetMembers = await tx.evidenceRecord.findMany({
      where: { evidenceLinks: { some: { hotEventId: targetId } } },
      select: { id: true, title: true, publishedAt: true, ingestedAt: true },
    });
    const targetSignature = signatureOf(targetMembers);
    await tx.hotEvent.update({
      where: { id: targetId },
      data: { clusterSignature: targetSignature, traceId },
    });

    return { merged: true, movedLinks, dedupedLinks, targetSignature };
  });
}

/**
 * Split a hot event: create a new candidate from a selected subset of its
 * evidence (operator-driven, Story 1.10).
 *
 * Creates a brand-new candidate HotEvent (id: newTraceId(), title from operator,
 * clusterSignature = signatureOf(selected records), publicationStatus =
 * Candidate), moves the selected evidence links source→new (delete source link,
 * create new link), and recomputes source.cluster_signature from the remaining
 * members.
 *
 * The selected subset must be non-empty AND not the full set of source's
 * evidence — leaving at least 1 record on source (otherwise that's a takedown,
 * not a split). Both guards run before any write.
 *
 * Returns { newHotEventId, movedLinks }. The server action then calls
 * decideReview(source, republish) to refresh source's read model (shows the
 * remaining evidence). The new candidate appears in the /console review queue
 * (status=candidate); the operator approves it via the existing 1.6 flow.
 *
 * This module does NOT change publication_status or published_* — the source
 * refresh goes through the publish gate (decideReview republish); the new
 * candidate is published later through the standard approve gate.
 */
export async function splitHotEvent(
  options: SplitHotEventOptions,
): Promise<SplitHotEventResult> {
  const { prisma, traceId, sourceId, evidenceRecordIds, title, reviewer } = options;

  const trimmedTitle = title.trim();
  if (trimmedTitle === "") {
    return { split: false, invalidTitle: true };
  }

  // Resolve the selected record ids into a deduped set (the form may post
  // duplicates if the operator double-toggles; dedupe so the count checks are
  // against distinct records).
  const selectedSet = new Set(
    evidenceRecordIds.filter((id) => typeof id === "string" && id.trim() !== ""),
  );
  if (selectedSet.size === 0) {
    return { split: false, emptySelection: true };
  }

  // Single atomic transaction (Story 1.10 BLOCK fix). All reads + writes
  // (source link read + subset guard, new candidate create, selected-link moves,
  // source cluster_signature recompute) commit together or not at all. Without
  // this wrap, the old sequence created the new candidate FIRST then moved
  // links — a crash mid-loop left an orphan candidate with a partial link set
  // AND a source whose evidence was partially drained but whose
  // cluster_signature was stale. The tx makes the whole split atomic. Mirrors
  // decideReview's $transaction pattern (review-service.ts:68). The pure-form
  // guards (invalidTitle / emptySelection) run before the tx (no writes); the
  // fullSetSelected guard runs inside the tx so the source-link read + the
  // subset check serialize against concurrent moves on the same source.
  return prisma.$transaction(async (tx) => {
    // Read the source's current evidence record ids to enforce the subset guard:
    // the selection must be non-empty (checked above) AND not the full set
    // (leaving at least 1 record on source — a full-set move is a takedown, not a
    // split, and the operator has a separate takedown button for that).
    const sourceLinks = await tx.hotEventEvidence.findMany({
      where: { hotEventId: sourceId },
      select: { id: true, evidenceRecordId: true },
    });
    const sourceRecordIds = new Set(sourceLinks.map((l) => l.evidenceRecordId));

    // If every source record is selected, that's a full-set move — reject (the
    // operator should use takedown to retire source entirely if that's the intent).
    let allSelected = true;
    for (const id of sourceRecordIds) {
      if (!selectedSet.has(id)) {
        allSelected = false;
        break;
      }
    }
    if (allSelected) {
      return { split: false, fullSetSelected: true };
    }

    // Read the selected evidence records (for the new candidate's signature + the
    // move). signatureOf needs title/publishedAt/ingestedAt.
    const selectedRecords = await tx.evidenceRecord.findMany({
      where: { id: { in: [...selectedSet] } },
      select: { id: true, title: true, publishedAt: true, ingestedAt: true },
    });
    const newSignature = signatureOf(selectedRecords);

    // Create the new candidate HotEvent. publicationStatus = Candidate (respect
    // the publish gate — the operator approves it via the existing 1.6 queue;
    // auto-publish is an undecided defer per the architecture spine).
    const newEvent = await tx.hotEvent.create({
      data: {
        id: newTraceId(),
        title: trimmedTitle,
        clusterSignature: newSignature,
        publicationStatus: PublicationStatus.Candidate,
        traceId,
      },
    });

    // Move the selected links source→new: create the new link, then delete the
    // source link. One-by-one with P2002 swallowed (same guard as clusterEvents).
    let movedLinks = 0;
    for (const link of sourceLinks) {
      if (!selectedSet.has(link.evidenceRecordId)) continue;
      try {
        await tx.hotEventEvidence.create({
          data: {
            id: newTraceId(),
            hotEventId: newEvent.id,
            evidenceRecordId: link.evidenceRecordId,
            traceId,
          },
        });
        movedLinks += 1;
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
        // P2002: link already exists on the new event (race). Skip; the source
        // link is still deleted below so the record ends up on the new event only.
      }
      await tx.hotEventEvidence.delete({ where: { id: link.id } });
    }

    // Recompute source.cluster_signature from its REMAINING member records (the
    // ones not selected). Same recompute pattern as clusterEvents + mergeHotEvents.
    const remainingMembers = await tx.evidenceRecord.findMany({
      where: { evidenceLinks: { some: { hotEventId: sourceId } } },
      select: { id: true, title: true, publishedAt: true, ingestedAt: true },
    });
    const sourceSignature = signatureOf(remainingMembers);
    await tx.hotEvent.update({
      where: { id: sourceId },
      data: { clusterSignature: sourceSignature, traceId },
    });

    return {
      split: true,
      newHotEventId: newEvent.id,
      movedLinks,
      reviewer,
    };
  });
}

/**
 * Prisma P2002 (unique constraint violation) guard — the same idempotency
 * helper as clusterEvents' createLinks. The @@unique([hot_event_id,
 * evidence_record_id]) is the tail guard against a duplicate link; we swallow
 * P2002 on the move path because a duplicate just means the record is already
 * on the destination (race or re-run), which is the intended end state.
 */
function isUniqueConstraintViolation(error:unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
