/**
 * publish-orchestrator: refreshPublishedReadModel.
 *
 * AD-3 single write-owner of the published_hot_events read model. Row existence
 * = currently published: publish upserts the row (public-visible), takedown
 * deletes it (public-invisible), none is a no-op. There is no status column on
 * the read model — existence IS the visibility contract, so public reads are a
 * plain "SELECT * FROM published_hot_events" with no WHERE to forget.
 *
 * This module never writes hot_events, review_decisions, or publication_
 * decisions (review-workflow owns those). It only writes published_hot_events.
 * review-workflow's decideReview calls this inside its transaction so the read
 * model is refreshed atomically with the status transition — no window where
 * "decision committed but read model stale" is visible to public reads.
 *
 * The read model is a minimal projection: title (copied from the HotEvent),
 * evidence_count + latest_evidence_at (recomputed from the member evidence
 * records), published_at (set on first publish, kept stable on refreshes).
 * ponytail: no explanation/theme/reaction columns — those land with 1.8/epic 2
 * when there are consumers; pre-embedding them here would be dead flexibility.
 */

import type { PrismaClient } from "../../../generated/client.js";
import type { PublishAction } from "../review-workflow/types.js";

export interface RefreshPublishedReadModelOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  action: PublishAction;
}

/**
 * Refresh the published_hot_events row for one event.
 *
 * - action=publish: recompute evidenceCount/latestEvidenceAt from the member
 *   records and upsert the row. publishedAt is set on first insert only (kept
 *   stable on subsequent refreshes so the "first published" time is preserved).
 * - action=takedown: delete the row if it exists (idempotent — a takedown on an
 *   already-absent row is a no-op).
 * - action=none: no-op.
 *
 * This is called inside decideReview's transaction, so the upsert/delete is
 * atomic with the status transition. Never throws on missing read-model row
 * (takedown is idempotent); throws only on genuine DB errors.
 */
export async function refreshPublishedReadModel(
  options: RefreshPublishedReadModelOptions,
): Promise<void> {
  const { prisma, traceId, hotEventId, action } = options;

  if (action === "none") return;

  if (action === "takedown") {
    // Idempotent delete: if the row never existed (e.g. a takedown raced with
    // another takedown), deleteMany returns 0 and that is fine.
    await prisma.publishedHotEvent.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  // action === "publish": upsert. Recompute the projection from the member
  // evidence records so the read model reflects the current evidence set (a
  // refresh after new evidence was linked updates evidenceCount/latestEvidenceAt).
  const event = await prisma.hotEvent.findUniqueOrThrow({
    where: { id: hotEventId },
    select: {
      title: true,
      evidence: {
        select: {
          evidenceRecord: {
            select: { publishedAt: true },
          },
        },
      },
    },
  });

  const evidenceCount = event.evidence.length;
  // latestEvidenceAt: the max publishedAt across member records. Falls back to
  // now() if all members have null publishedAt (the row needs a non-null value
  // for the column; now is the honest "we don't have an earlier time" choice).
  let latest: Date | null = null;
  for (const link of event.evidence) {
    const p = link.evidenceRecord.publishedAt;
    if (p !== null && (latest === null || p > latest)) {
      latest = p;
    }
  }
  const latestEvidenceAt = latest ?? new Date();

  await prisma.publishedHotEvent.upsert({
    where: { hotEventId },
    // On a first publish, set publishedAt to now. On a re-publish (refresh),
    // keep the existing publishedAt stable (do not overwrite — it is the
    // "first became public" timestamp). updatedAt auto-updates via @updatedAt.
    create: {
      hotEventId,
      title: event.title,
      evidenceCount,
      latestEvidenceAt,
      publishedAt: new Date(),
      traceId,
    },
    update: {
      title: event.title,
      evidenceCount,
      latestEvidenceAt,
      traceId,
      // publishedAt deliberately omitted on update: preserve first-publish time.
    },
  });
}
