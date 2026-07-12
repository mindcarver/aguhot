/**
 * ai-content-sampling-service — the operator sampling-console data source (Story 5.4).
 *
 * This module is a READ service (no writes — the suppress writes live in
 * reason-service.suppressRecommendationReason + deep-read-service.suppressDeepRead,
 * which own their respective source tables per AD-2). It exposes one query:
 *
 *   - listAiContentForSampling: returns a unified list across recommendation_reasons
 *     + deep_reads (TrendBriefing is EXCLUDED — epic Gap 2: V1 does not allow
 *     marking / taking down trend briefings; the sampling console is browse-only
 *     for them, and SM-6 numerator / denominator both exclude them). Each row is
 *     mapped to a unified AiContentSamplingItem carrying a `type` discriminator
 *     ("reason" | "deepread") so the UI can render a type tag + route the suppress
 *     form. The list is NOT filtered by suppressedAt (operators need to see already-
 *     suppressed rows + their "已下线" marker, UX-DR14). Ordered by createdAt desc
 *     across both kinds. No pagination (V1 volume is tiny; matches the
 *     listPendingCandidates / listPublishedHotEvents no-pagination precedent —
 *     real pagination is deferred, see spec Design Notes).
 *
 * The eventTitle for each row is the EFFECTIVE title (latest HotEventRevision.title
 * ?? baseline HotEvent.title) — the same overlay rule publish-orchestrator's
 * timeline + detail projections use — so the sampling console shows the same title
 * the public surface does (operator audit parity). Loaded via Prisma's nested
 * `_count`/relation include in one findMany per kind.
 *
 * `take` is capped (AI_CONTENT_SAMPLING_TAKE_LIMIT, default 200 per kind) as a
 * blowout guard. V1 volume is tiny; a real pagination cursor is deferred (spec
 * Design Notes: listAiContentForSampling's take 上限改真分页归 deferred).
 *
 * This module never writes any table and never reads published_* (it reads the
 * source truth tables the operator needs to judge — the projections are the
 * public surface, not the audit surface).
 */

import type {
  AiContentSamplingItem,
  AiContentType,
  ListAiContentForSamplingOptions,
} from "./types.js";

/**
 * Per-kind take cap (blowout guard). V1 published volume is tiny; 200/kind is
 * comfortably above any realistic near-term load and keeps the sampling-console
 * render bounded. Real cursor pagination is deferred (spec Design Notes). The
 * ponytail choice: a take cap is one line; a full cursor-pagination layer is
 * consumerless complexity today.
 */
export const AI_CONTENT_SAMPLING_TAKE_LIMIT = 200;

/**
 * List AI content (reason + deepread) for the operator sampling console. Returns
 * a unified, createdAt-desc-ordered list across both kinds. TrendBriefing is
 * deliberately excluded (epic Gap 2). `type?` filters to one kind; omitted returns
 * both. NOT filtered by suppressedAt (operators see suppressed rows + their
 * marker). See module header for the full contract.
 */
export async function listAiContentForSampling(
  options: ListAiContentForSamplingOptions,
): Promise<AiContentSamplingItem[]> {
  const { prisma, type } = options;

  const wantReason = type === undefined || type === ("reason" satisfies AiContentType);
  const wantDeepRead = type === undefined || type === ("deepread" satisfies AiContentType);

  // Run the two findMany queries (in parallel — independent reads). Each selects
  // the content + the event title (via the hotEvent relation + its revisions
  // relation for the effective-title overlay). suppressedAt is included so the UI
  // can render the "已下线" marker.
  const [reasonRows, deepReadRows] = await Promise.all([
    wantReason
      ? prisma.recommendationReason.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: AI_CONTENT_SAMPLING_TAKE_LIMIT,
          select: {
            id: true,
            hotEventId: true,
            reason: true,
            source: true,
            createdAt: true,
            suppressedAt: true,
            hotEvent: {
              select: {
                title: true,
                revisions: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { title: true },
                },
              },
            },
          },
        })
      : [],
    wantDeepRead
      ? prisma.deepRead.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: AI_CONTENT_SAMPLING_TAKE_LIMIT,
          select: {
            id: true,
            hotEventId: true,
            impactSurface: true,
            beneficiaries: true,
            riskPoints: true,
            source: true,
            createdAt: true,
            suppressedAt: true,
            hotEvent: {
              select: {
                title: true,
                revisions: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { title: true },
                },
              },
            },
          },
        })
      : [],
  ]);

  const items: AiContentSamplingItem[] = [];

  for (const r of reasonRows) {
    // Effective title overlay (same rule as publish-orchestrator's timeline +
    // detail projections): latest revision.title ?? baseline hotEvent.title.
    const latestRevision = r.hotEvent.revisions[0] ?? null;
    const eventTitle = latestRevision !== null ? latestRevision.title : r.hotEvent.title;
    items.push({
      type: "reason",
      id: r.id,
      hotEventId: r.hotEventId,
      eventTitle,
      content: r.reason,
      source: r.source,
      createdAt: r.createdAt,
      suppressedAt: r.suppressedAt,
    });
  }

  for (const d of deepReadRows) {
    const latestRevision = d.hotEvent.revisions[0] ?? null;
    const eventTitle = latestRevision !== null ? latestRevision.title : d.hotEvent.title;
    // Deep-read content preview: concatenate the three segments so the sampling
    // console shows a single-line preview (the detail-page block render is not
    // needed here — the operator is judging the content, not laying out the page).
    // Separated by a space so segment boundaries are visible in the preview.
    items.push({
      type: "deepread",
      id: d.id,
      hotEventId: d.hotEventId,
      eventTitle,
      content: `${d.impactSurface} ${d.beneficiaries} ${d.riskPoints}`,
      source: d.source,
      createdAt: d.createdAt,
      suppressedAt: d.suppressedAt,
    });
  }

  // Merge-sort by createdAt desc (id desc tiebreaker for deterministic order when
  // two rows share the same createdAt millisecond — UUIDv7 ids embed a monotonic
  // timestamp so the tiebreaker is stable). Both input lists are already
  // createdAt-desc, so a single sort of the merged array is O(n log n).
  items.sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    if (byTime !== 0) return byTime;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  return items;
}
