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
  GetPublishedEventForRevisionOptions,
  ListPendingCandidatesOptions,
  PendingCandidateSummary,
  PublishedEventRevisionView,
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

/**
 * Get one published event with the operator "revision" view: the currently
 * PUBLIC title/tags/explanation, the LATEST working (effective) title/tags/
 * explanation, and the pending CONTENT DIFF between them. Powers the published
 * branch of /console/[eventId] (Story 1.9): show what is live, what a republish
 * would change, and the revision form.
 *
 * This is an OPERATOR-side cross-aggregate read (same shape as getCandidateDetail
 * reading hot_events + evidence_records + decisions). It reads hot_events +
 * hot_event_revisions + explanation_versions + the published_* read models to
 * compute the diff. AD-3 still holds: the PUBLIC detail page only reads
 * published_* via getPublishedHotEventDetail (this function is never on the
 * public path). Throws CandidateNotFoundError if the event is missing.
 *
 *   - effective title  = latest revision.title ?? hotEvent.title (cluster baseline)
 *   - effective tags   = latest revision.tags   ?? [] (clustering derives no tags)
 *   - effective explanation = latest ExplanationVersion ?? null
 *   - published = the published_* read-model rows (null if not currently published)
 *   - pending = CONTENT diff (title string / tags array / explanation partitions),
 *     NOT a timestamp diff (content diff is robust; timestamps are fragile).
 */
export async function getPublishedEventForRevision(
  options: GetPublishedEventForRevisionOptions,
): Promise<PublishedEventRevisionView> {
  const { prisma, hotEventId } = options;

  // Single findUnique with reverse-navigation includes — one round-trip. Reads
  // the HotEvent (baseline title + status) + its published read models (the
  // current public surface) + the latest revision + the latest explanation
  // version (the effective working copy). All are read-only navigation metadata
  // (same pattern as getCandidateDetail reading evidence + decisions).
  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
    select: {
      id: true,
      title: true,
      publicationStatus: true,
      publishedReadModel: {
        select: {
          title: true,
          tags: true,
          publishedAt: true,
        },
      },
      publishedExplanation: {
        select: {
          summary: true,
          whyItMatters: true,
          uncertainties: true,
        },
      },
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { title: true, tags: true },
      },
      explanationVersions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { summary: true, whyItMatters: true, uncertainties: true },
      },
    },
  });

  if (event === null) {
    throw new CandidateNotFoundError(hotEventId);
  }

  // effective = latest revision ?? baseline.
  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const effectiveTags = latestRevision !== null ? latestRevision.tags : [];
  const latestExplanation = event.explanationVersions[0] ?? null;
  const effectiveExplanation =
    latestExplanation === null
      ? null
      : {
          summary: latestExplanation.summary,
          whyItMatters: latestExplanation.whyItMatters,
          uncertainties: latestExplanation.uncertainties,
        };

  // published = the read-model rows. Null when not currently published (taken_down,
  // or never published). For a published event the published row always exists.
  const publishedRow = event.publishedReadModel;
  const publishedExplanation = event.publishedExplanation;
  const published =
    publishedRow === null
      ? null
      : {
          title: publishedRow.title,
          tags: publishedRow.tags,
          explanation:
            publishedExplanation === null
              ? null
              : {
                  summary: publishedExplanation.summary,
                  whyItMatters: publishedExplanation.whyItMatters,
                  uncertainties: publishedExplanation.uncertainties,
                },
          publishedAt: publishedRow.publishedAt,
        };

  // pending = CONTENT diff (effective vs published). When published is null
  // (not currently published), every non-empty effective field is "pending" in
  // the sense that a republish would publish it — but republish is illegal on
  // non-published statuses, so the operator UI hides the republish button and
  // these booleans are informational only in that case.
  const pendingTitle =
    published === null ? effectiveTitle !== event.title : effectiveTitle !== published.title;
  const pendingTags =
    published === null ? effectiveTags.length > 0 : !tagsEqual(effectiveTags, published.tags);
  const pendingExplanation =
    published === null
      ? effectiveExplanation !== null
      : (effectiveExplanation === null) !== (published.explanation === null) ||
        (effectiveExplanation !== null &&
          published.explanation !== null &&
          (effectiveExplanation.summary !== published.explanation.summary ||
            effectiveExplanation.whyItMatters !== published.explanation.whyItMatters ||
            effectiveExplanation.uncertainties !== published.explanation.uncertainties));

  return {
    hotEventId: event.id,
    publicationStatus: event.publicationStatus,
    published,
    effective: {
      title: effectiveTitle,
      tags: effectiveTags,
      explanation: effectiveExplanation,
    },
    pending: {
      title: pendingTitle,
      tags: pendingTags,
      explanation: pendingExplanation,
    },
  };
}

/**
 * Order-sensitive tag-array equality (same rule as reviseHotEvent's normalize:
 * preserve-order dedupe, so a reordering is a real change). Shared local helper
 * — not exported; the operator view only compares two already-normalized arrays.
 */
function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
