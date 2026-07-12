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
import { suppressDeepRead } from "../explanation/deep-read-service.js";
import { suppressRecommendationReason } from "../explanation/reason-service.js";
import { refreshPublishedReadModel } from "../publish-orchestrator/publish-service.js";
import { refreshPublishedTimelineForEvent } from "../publish-orchestrator/timeline-read-model.js";
import { resolveTransition } from "./transitions.js";
import type {
  CandidateDecisionEntry,
  CandidateDetail,
  CandidateEvidenceItem,
  DecideReviewOptions,
  DecideReviewResult,
  GetCandidateDetailOptions,
  GetPublishedEventForRevisionOptions,
  GetSm6MisleadingRateOptions,
  ListPendingCandidatesOptions,
  PendingCandidateSummary,
  PublishedEventRevisionView,
  Sm6MisleadingRate,
  SuppressAiContentOptions,
  SuppressAiContentResult,
} from "./types.js";
import {
  CandidateNotFoundError,
  IllegalTransitionError,
  SUPPRESS_AI_CONTENT_OUTCOME,
} from "./types.js";

/**
 * Execute one operator review decision atomically.
 *
 * Single transaction (AD-5 append-only audit + AD-6 publish gate). To close the
 * TOCTOU window under concurrency (two operators racing the same candidate), the
 * status transition is written as a CONDITIONAL updateMany keyed on
 * { id, publicationStatus: fromStatus } — the optimistic lock. If a concurrent
 * decideReview already moved the status, this matches zero rows (updateMany
 * returns count 0, no throw), and we throw IllegalTransitionError so the second
 * concurrent submit is correctly rejected rather than leaving a contradictory
 * PublicationDecision + a race on the final status. Zero schema migration: no
 * SELECT ... FOR UPDATE, no new column — the conditional `where` IS the lock.
 *
 *   1. Read the current publication_status (findUniqueOrThrow — a missing event
 *      still raises P2025 cleanly; the server action maps it to /console). Used
 *      to validate the transition BEFORE writing anything.
 *   2. resolveTransition validates (from, outcome) is one of the legal paths.
 *      Throws IllegalTransitionError otherwise — nothing is written.
 *   3. Write one ReviewDecision (append-only: outcome, reviewer, note, traceId).
 *   4. Write one PublicationDecision (append-only: from→to, linked to the
 *      review decision, traceId).
 *   5. CONDITIONAL updateMany on { id, publicationStatus: fromStatus }. If the
 *      returned count is 0, the status changed under us between step 1 and step
 *      5 → throw IllegalTransitionError (clean rollback; nothing contradictory).
 *      updateMany is used (not update) so a zero-row match is a count we branch
 *      on, NOT a P2025 throw — that keeps the race rejection cleanly separable
 *      from the findUniqueOrThrow P2025 (genuinely missing event).
 *   6. refreshPublishedReadModel (publish upserts, takedown deletes, none no-op).
 *
 * All writes commit together or not at all. An illegal transition (or a lost
 * race) throws before the transaction body returns, so it is a clean rollback.
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

    // 5. CONDITIONAL update — optimistic lock on the expected fromStatus. The
    //    `where` includes publicationStatus: fromStatus; under Read Committed
    //    (Prisma's default), if a concurrent decideReview already moved the
    //    status this matches zero rows. updateMany returns count (no throw on
    //    zero rows, unlike update's P2025) so the race rejection is cleanly
    //    separable from the findUniqueOrThrow P2025 above. count === 0 → the
    //    status raced; throw IllegalTransitionError (server action maps it back
    //    to the detail page, operator sees the true current status). Update ONLY
    //    publication_status (field-level ownership — AD-2; never title/cluster).
    const updated = await tx.hotEvent.updateMany({
      where: { id: hotEventId, publicationStatus: fromStatus },
      data: { publicationStatus: transition.to, traceId },
    });
    if (updated.count === 0) {
      // The status the operator read no longer matches the DB — a concurrent
      // decision won the race. Nothing after this point runs; the thrown
      // IllegalTransitionError rolls the transaction back (the two append-only
      // rows written in steps 3–4 are discarded). We report fromStatus in the
      // error because that is the value the operator acted on; the redirect
      // target's revalidation shows the true (post-race) status.
      throw new IllegalTransitionError(fromStatus, outcome);
    }

    // 6. Refresh the read model inside the same transaction (publish upsert /
    //    takedown delete / none no-op). publish-orchestrator is the sole writer
    //    of published_hot_events; we call it here so the refresh is atomic.
    await refreshPublishedReadModel({
      prisma: tx as unknown as PrismaClient,
      traceId,
      hotEventId,
      action: transition.action,
    });

    // 7. Refresh the timeline read model inside the SAME transaction (Story 4.1,
    //    AD-3b method A). publish-orchestrator is the sole writer of
    //    published_timeline_entries; the per-HotEvent incremental upsert (publish)
    //    / delete (takedown) here is the MAIN refresh path, guaranteeing zero
    //    visibility window between the decision and the home feed. A periodic
    //    self-heal BullMQ job (refreshPublishedTimelineAll) is a corrective safety
    //    net only — never the main path. Same `tx` cast pattern as step 6.
    await refreshPublishedTimelineForEvent({
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

// --- Story 5.4: AI content operator sampling ----------------------------------

/**
 * Suppress one piece of AI content (one recommendation_reasons or deep_reads row)
 * — the SIBLING function to decideReview. Story 5.4.
 *
 * This function reuses decideReview's "single $transaction + append ReviewDecision
 * + call publish-orchestrator refresh" COORDINATION SHAPE but DOES NOT touch the
 * HotEvent state machine: it never calls decideReview / resolveTransition, never
 * writes hot_events.publicationStatus, never appends a PublicationDecision. The
 * outcome string "suppress_ai_content" is written directly to ReviewDecision.outcome
 * (a free String column) — it is NOT added to the ReviewOutcome const / LEGAL_TRANSITIONS
 * (those feed the state-machine selfcheck; adding it would perturb the count + a
 * resolveTransition branch). See spec-5-4 Design Notes for the full rationale.
 *
 * Single transaction (atomic — mirrors decideReview's atomicity guarantee):
 *   1. Call the source-table suppress fn (suppressRecommendationReason /
 *      suppressDeepRead — the SOLE writers of their respective suppressedAt columns).
 *      Pass the tx handle so the suppress is part of this transaction.
 *   2. If the source returns `{ suppressed: false, reason: "already-suppressed" }`
 *      → return the same idempotent result WITHOUT appending a ReviewDecision or
 *      refreshing (prevents SM-6 numerator double-counting on a repeat submit).
 *   3. Append one ReviewDecision (outcome="suppress_ai_content", targetType,
 *      targetId, note, reviewer, traceId). The audit row is scoped to hotEventId
 *      (the event whose AI content was judged misleading) even though the state
 *      machine is not touched.
 *   4. Read hot_events.publicationStatus. If it is "published", call the matching
 *      publish-orchestrator refresh (refreshPublishedTimelineForEvent for a reason,
 *      refreshPublishedReadModel for a deep read) so the public surface reflects
 *      the suppress immediately (timeline reason → null; deep-read row → deleted).
 *      For non-published events (candidate / taken_down / rejected) NO refresh is
 *      issued — refreshPublishedTimelineForEvent({action:"publish"}) would upsert
 *      a published row, which is wrong for an unpublished event; the source
 *      suppressedAt persists, and the next legitimate publish (via decideReview)
 *      naturally skips the suppressed row in its projection (where:{suppressedAt:null}).
 *      Reading publicationStatus does NOT write it — the state-machine-zero-edits
 *      invariant holds.
 *
 * Missing target: the source suppress fn's findUniqueOrThrow raises Prisma P2025
 * → the transaction rolls back (fail-fast, no partial suppress). The verify script
 * asserts the throw.
 *
 * Never calls decideReview / resolveTransition. This is a SIBLING, not a new
 * decideReview outcome — the epic ruling "do not change decideReview's HotEvent
 * state machine" is honored literally.
 */
export async function suppressAiContent(
  options: SuppressAiContentOptions,
): Promise<SuppressAiContentResult> {
  const { prisma, traceId, targetType, targetId, hotEventId, reviewer, note } = options;

  return prisma.$transaction(async (tx) => {
    const client = tx as unknown as PrismaClient;

    // 1. Suppress the source row (sole writer of suppressedAt). The fn is
    //    idempotent: an already-suppressed row returns {suppressed:false} and we
    //    short-circuit WITHOUT appending a duplicate ReviewDecision (prevents
    //    SM-6 numerator double-counting). findUniqueOrThrow raises P2025 on a
    //    missing target → tx rolls back (fail-fast).
    const suppressResult =
      targetType === "reason"
        ? await suppressRecommendationReason({ prisma: client, traceId, id: targetId })
        : await suppressDeepRead({ prisma: client, traceId, id: targetId });

    if (!suppressResult.suppressed) {
      // Idempotent: already suppressed — no duplicate audit row, no refresh.
      return { suppressed: false, reason: "already-suppressed" } satisfies SuppressAiContentResult;
    }

    // 2. Append the audit row (outcome="suppress_ai_content", targetType, targetId).
    //    Scoped to hotEventId for audit even though the state machine is not touched.
    await client.reviewDecision.create({
      data: {
        id: newTraceId(),
        hotEventId,
        outcome: SUPPRESS_AI_CONTENT_OUTCOME,
        reviewer,
        note: note ?? null,
        targetType,
        targetId,
        traceId,
      },
    });

    // 3. Refresh the public projection ONLY when the event is currently published.
    //    refreshPublishedTimelineForEvent({action:"publish"}) upserts a published
    //    row — calling it on a candidate/taken_down event would wrongly publish it.
    //    The source suppressedAt persists regardless; a non-published event's next
    //    legitimate publish (via decideReview) naturally skips the suppressed row.
    //    Reading publicationStatus does NOT write it (state machine untouched).
    const event = await client.hotEvent.findUniqueOrThrow({
      where: { id: hotEventId },
      select: { publicationStatus: true },
    });
    if (event.publicationStatus === "published") {
      if (targetType === "reason") {
        // Timeline projection: re-derives recommendation_reason from the latest
        // non-suppressed reason row → null when all are suppressed.
        await refreshPublishedTimelineForEvent({
          prisma: client,
          traceId,
          hotEventId,
          action: "publish",
        });
      } else {
        // Read-model projection: projectDeepRead's where:{suppressedAt:null} skips
        // the suppressed row → published row deleted (or falls back to an earlier
        // unsuppressed version). refreshPublishedReadModel(publish) re-projects
        // the whole event read model atomically.
        await refreshPublishedReadModel({
          prisma: client,
          traceId,
          hotEventId,
          action: "publish",
        });
      }
    }

    return { suppressed: true } satisfies SuppressAiContentResult;
  });
}

/**
 * Compute the SM-6 misleading-rate readout — the 7-day rolling window ratio of
 * suppressed AI content decisions to total AI content generated. Story 5.4.
 *
 * Epic Gap 4 literal, operationalized on structured columns (Design Notes: the
 * epic's "note misleading" phrasing is a sketch; the structured query needs
 * indexable columns, so "misleading" = the existence of a suppress_ai_content
 * decision, expressed as `outcome="suppress_ai_content" AND targetType∈{reason,
 * deepread}`; note is operator free-text, not a query field):
 *   - numerator = ReviewDecision.count({ outcome: "suppress_ai_content",
 *       targetType ∈ {"reason","deepread"}, createdAt ≥ now-windowDays }).
 *   - denominator = recommendationReason.count({ createdAt ≥ window }) +
 *       deepRead.count({ createdAt ≥ window }) — aggregate AI content generated
 *       in the same window (TrendBriefing EXCLUDED, epic Gap 2).
 *   - rate = denominator === 0 ? 0 : numerator/denominator (the UI shows "暂无数据"
 *     when denominator is 0 — the readout is meaningless until there is generated
 *     content to judge).
 *
 * Lives in review-workflow because it owns the ReviewDecision numerator table.
 * The denominator reads cross into explanation's source tables (read-only counts;
 * no write dependency). SM-6 target: rate < 10%.
 */
export async function getSm6MisleadingRate(
  options: GetSm6MisleadingRateOptions,
): Promise<Sm6MisleadingRate> {
  const { prisma, windowDays = 7 } = options;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Numerator: suppress decisions in the window targeting reason or deepread
  // (TrendBriefing targets never reach ReviewDecision — the server-action
  // whitelist rejects them — but the targetType:{in:[...]} belt-and-suspenders
  // ensures a forged row cannot inflate the numerator).
  const numerator = await prisma.reviewDecision.count({
    where: {
      outcome: SUPPRESS_AI_CONTENT_OUTCOME,
      targetType: { in: ["reason", "deepread"] },
      createdAt: { gte: since },
    },
  });

  // Denominator: total reason + deepread rows generated in the same window
  // (TrendBriefing excluded — it is not suppressible in V1, so counting it would
  // dilute the ratio with un-judgeable content).
  const [reasonCount, deepReadCount] = await Promise.all([
    prisma.recommendationReason.count({ where: { createdAt: { gte: since } } }),
    prisma.deepRead.count({ where: { createdAt: { gte: since } } }),
  ]);
  const denominator = reasonCount + deepReadCount;

  return {
    rate: denominator === 0 ? 0 : numerator / denominator,
    numerator,
    denominator,
    windowDays,
  };
}
