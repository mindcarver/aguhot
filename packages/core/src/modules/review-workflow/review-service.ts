/**
 * review-service — the review-workflow DB service (AD-6 single write-owner).
 *
 * Three commands:
 *
 *  - decideReview: the publish gate. Runs in a single Prisma $transaction:
 *    read current publication_status → resolveTransition validates legality →
 *    write ReviewDecision → write PublicationDecision (linked, with from/to) →
 *    update hot_events.publication_status → refreshPublishedReadModel (publish=
 *    upsert, takedown=delete, none=no-op). Illegal transitions throw
 *    IllegalTransitionError and write nothing (the transaction rolls back).
 *
 *  - listPendingCandidates: reads candidates (publication_status="candidate")
 *    with evidence _count + latest-evidence projection, ordered by updatedAt
 *    desc. For the operator console queue.
 *
 *  - getCandidateDetail: reads one event with its evidence records (via the
 *    link table → evidence_records → evidence_sources for the source name) and
 *    the full decision audit chain (review + publication decisions, ascending
 *    by createdAt).
 *
 * This module only writes review_decisions + publication_decisions, and only
 * updates hot_events.publication_status (field-level ownership — event-assembly
 * owns title/cluster_signature, AD-2/AD-6 tension resolved in Design Notes).
 * It never writes published_hot_events directly; it calls publish-orchestrator
 * inside the transaction so the read-model refresh is atomic with the decision.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { refreshPublishedReadModel } from "../publish-orchestrator/publish-service.js";
import { resolveTransition } from "./transitions.js";
import type {
  CandidateDecisionEntry,
  CandidateDetail,
  CandidateEvidenceItem,
  DecideReviewOptions,
  DecideReviewResult,
  GetCandidateDetailOptions,
  ListPendingCandidatesOptions,
  PendingCandidateSummary,
} from "./types.js";
import { CandidateNotFoundError } from "./types.js";

/**
 * Execute one operator review decision atomically.
 *
 * Single transaction (AD-5 append-only audit + AD-6 publish gate):
 *   1. Read the current publication_status of the event (lock via the update
 *      in step 4; serialized at the row level by Postgres).
 *   2. resolveTransition validates (from, outcome) is one of the three legal
 *      paths. Throws IllegalTransitionError otherwise — nothing is written.
 *   3. Write one ReviewDecision (append-only: outcome, reviewer, note, traceId).
 *   4. Write one PublicationDecision (append-only: from→to, linked to the
 *      review decision, traceId). Update hot_events.publication_status to `to`.
 *   5. refreshPublishedReadModel (publish upserts, takedown deletes, none no-op).
 *
 * All writes commit together or not at all. An illegal transition throws before
 * any write, so the transaction is a clean rollback.
 */
export async function decideReview(
  options: DecideReviewOptions,
): Promise<DecideReviewResult> {
  const { prisma, traceId, hotEventId, outcome, reviewer, note } = options;

  return prisma.$transaction(async (tx) => {
    // 1. Read current status. findUniqueOrThrow so a missing event raises
    //    cleanly (CandidateNotFoundError is NOT thrown here — we let Prisma's
    //    P2025 propagate, the server action maps it).
    const event = await tx.hotEvent.findUniqueOrThrow({
      where: { id: hotEventId },
      select: { id: true, publicationStatus: true },
    });

    const fromStatus = event.publicationStatus;

    // 2. Validate the transition. Throws IllegalTransitionError for illegal
    //    paths — nothing is written, the transaction rolls back to the savepoint.
    const transition = resolveTransition(fromStatus, outcome);

    // 3. Write the ReviewDecision (append-only). Never updated or deleted.
    const reviewDecision = await tx.reviewDecision.create({
      data: {
        id: newTraceId(),
        hotEventId,
        outcome,
        reviewer,
        note: note ?? null,
        traceId,
      },
    });

    // 4. Write the PublicationDecision (append-only, linked). Records the
    //    from→to transition + the review decision that triggered it.
    const publicationDecision = await tx.publicationDecision.create({
      data: {
        id: newTraceId(),
        hotEventId,
        fromStatus,
        toStatus: transition.to,
        reviewDecisionId: reviewDecision.id,
        traceId,
      },
    });

    // Update ONLY publication_status (field-level ownership). Never touch
    // title/cluster_signature (event-assembly owns those, AD-2).
    await tx.hotEvent.update({
      where: { id: hotEventId },
      data: { publicationStatus: transition.to, traceId },
    });

    // 5. Refresh the read model inside the same transaction (publish upsert /
    //    takedown delete / none no-op). publish-orchestrator is the sole writer
    //    of published_hot_events; we call it here so the refresh is atomic.
    await refreshPublishedReadModel({
      prisma: tx as unknown as PrismaClient,
      traceId,
      hotEventId,
      action: transition.action,
    });

    return {
      traceId,
      hotEventId,
      reviewDecisionId: reviewDecision.id,
      publicationDecisionId: publicationDecision.id,
      fromStatus: fromStatus as DecideReviewResult["fromStatus"],
      toStatus: transition.to,
      action: transition.action,
    };
  });
}

/**
 * List all pending candidates (publication_status="candidate"), ordered by most
 * recently updated first. Each row includes the evidence count and latest
 * evidence time (for the operator queue display).
 */
export async function listPendingCandidates(
  options: ListPendingCandidatesOptions,
): Promise<PendingCandidateSummary[]> {
  const { prisma } = options;

  const candidates = await prisma.hotEvent.findMany({
    where: { publicationStatus: "candidate" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      evidence: {
        select: {
          evidenceRecord: {
            select: { publishedAt: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Project: evidenceCount + latestEvidenceAt (max publishedAt across members).
  return candidates.map((c) => {
    let latest: Date | null = null;
    for (const link of c.evidence) {
      const p = link.evidenceRecord.publishedAt;
      if (p !== null && (latest === null || p > latest)) {
        latest = p;
      }
    }
    return {
      id: c.id,
      title: c.title,
      evidenceCount: c.evidence.length,
      latestEvidenceAt: latest ?? c.updatedAt,
      updatedAt: c.updatedAt,
    };
  });
}

/**
 * Get one event with its evidence records and the full decision audit chain.
 * The audit chain merges review_decisions + publication_decisions, sorted
 * ascending by createdAt so the operator sees the chronological decision
 * history (append-only, AD-5). Throws CandidateNotFoundError if missing.
 */
export async function getCandidateDetail(
  options: GetCandidateDetailOptions,
): Promise<CandidateDetail> {
  const { prisma, hotEventId } = options;

  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
    select: {
      id: true,
      title: true,
      publicationStatus: true,
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              id: true,
              title: true,
              summary: true,
              url: true,
              publishedAt: true,
              source: { select: { name: true } },
            },
          },
        },
        orderBy: { evidenceRecord: { publishedAt: "asc" } },
      },
      reviewDecisions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          outcome: true,
          reviewer: true,
          note: true,
          createdAt: true,
        },
      },
      publicationDecisions: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          reason: true,
          createdAt: true,
        },
      },
    },
  });

  if (event === null) {
    throw new CandidateNotFoundError(hotEventId);
  }

  const evidence: CandidateEvidenceItem[] = event.evidence.map((link) => ({
    evidenceRecordId: link.evidenceRecord.id,
    sourceName: link.evidenceRecord.source.name,
    title: link.evidenceRecord.title,
    summary: link.evidenceRecord.summary,
    url: link.evidenceRecord.url,
    publishedAt: link.evidenceRecord.publishedAt,
  }));

  // Merge the two audit streams into one chronological chain.
  const decisions: CandidateDecisionEntry[] = [
    ...event.reviewDecisions.map((rd): CandidateDecisionEntry => ({
      type: "review",
      id: rd.id,
      createdAt: rd.createdAt,
      reviewer: rd.reviewer,
      outcome: rd.outcome,
      note: rd.note,
    })),
    ...event.publicationDecisions.map((pd): CandidateDecisionEntry => ({
      type: "publication",
      id: pd.id,
      createdAt: pd.createdAt,
      fromStatus: pd.fromStatus,
      toStatus: pd.toStatus,
      reason: pd.reason,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    id: event.id,
    title: event.title,
    publicationStatus: event.publicationStatus,
    evidence,
    decisions,
  };
}
