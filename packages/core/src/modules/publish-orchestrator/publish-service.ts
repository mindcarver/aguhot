/**
 * publish-orchestrator: refreshPublishedReadModel + public read queries.
 *
 * AD-3 single write-owner of the published read models:
 *   - published_hot_events (Story 1.6): the feed summary row. Row existence =
 *     currently published (no status column; the feed reads a plain SELECT).
 *   - published_hot_event_explanations (Story 1.8): the projected latest
 *     ExplanationVersion for the detail page's three-partition block.
 *   - published_hot_event_evidence (Story 1.8): the projected evidence timeline
 *     rows (so the public detail page never reads evidence_records /
 *     hot_event_evidence / evidence_sources directly).
 *   - published_hot_event_reactions (Story 2.1): the projected latest
 *     MarketReactionSnapshot for the detail page's market-reaction block.
 *   - published_hot_event_associations (Story 2.2): the projected latest
 *     EventAssociationSet for the detail page's association block + the feed's
 *     association-dimension filter.
 *   - published_hot_event_themes (Story 2.3): the projected latest EventThemeSet
 *     for the detail page's theme block + the /topics theme-page membership map.
 *
 * Story 2.4 adds a coverageDate-keyed read model alongside the hotEventId-keyed
 * ones:
 *   - published_daily_digests (Story 2.4): the projected latest DailyDigest for
 *     one coverageDate. Row existence = a published digest for that day. This
 *     projection is driven by a SIBLING function refreshPublishedDailyDigest
 *     (not a branch inside refreshPublishedReadModel) because the digest is
 *     coverageDate-keyed (aggregates multiple events), not hotEventId-keyed.
 *
 * refreshPublishedReadModel is called inside decideReview's transaction (and by
 * the market-reaction worker after it appends a snapshot):
 *   - publish: upsert published_hot_events + project explanation (latest
 *     ExplanationVersion → upsert, or deleteMany if none) + rewrite evidence
 *     timeline (deleteMany then re-insert from member records, link_status
 *     derived from url) + project market reaction (latest MarketReactionSnapshot
 *     → upsert, or deleteMany if none) + project associations (latest
 *     EventAssociationSet → upsert, or deleteMany if none). Atomic with the
 *     status transition.
 *   - takedown: delete all five tables for the hotEventId (row-gone =
 *     public-invisible). Idempotent.
 *   - none: no-op.
 *
 * Public read queries (pure reads of the published_* tables only):
 *   - listPublishedHotEvents (Story 1.7): the feed list.
 *   - getPublishedHotEventDetail (Story 1.8): the detail assembly. Returns null
 *     when no published_hot_events row exists (unpublished id → notFound()).
 *   - listPublishedAssociations (Story 2.2): the hotEventId→items map the feed
 *     uses for the association-dimension JS filter.
 *   - listPublishedThemeMemberships (Story 2.3): the hotEventId→ThemeRef[] map
 *     the /topics directory + /topics/[slug] page use.
 *   - getPublishedDailyDigest (Story 2.4): the /daily page's digest for one
 *     coverageDate (or null → degrade).
 *   - listPublishedDailyDigestCoverageDates (Story 2.4): the distinct
 *     coverageDates that have a published digest (the /daily page's default-
 *     view resolver).
 *
 * This module never writes hot_events, review_decisions, publication_decisions,
 * explanation_versions, market_reaction_snapshots, evidence_records, or
 * evidence_sources. It reads explanation_versions (latest version),
 * market_reaction_snapshots (latest snapshot), and the evidence link chain only
 * inside the publish projection, then writes only the published_* tables. The
 * daily-digest projection reads daily_digests (latest row per coverageDate) and
 * writes published_daily_digests — it never reads hot_events / evidence_*.
 */

import type { Prisma, PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import type { PublishAction } from "../review-workflow/types.js";
import type { TargetCandidate } from "../investment-targets/types.js";
import { EvidenceLinkStatus } from "./types.js";
import type {
  AssociationItem,
  DailyDigestEntry,
  GetPublishedDailyDigestOptions,
  GetPublishedHotEventDetailOptions,
  GetPublishedTrendBriefingOptions,
  ListPublishedAssociationsOptions,
  ListPublishedDailyDigestCoverageDatesOptions,
  ListPublishedHotEventExplanationsOptions,
  ListPublishedHotEventsOptions,
  ListPublishedThemeMembershipsOptions,
  PublishedAssociationRow,
  PublishedDailyDigest,
  PublishedEvidenceRow,
  PublishedHotEventDetail,
  PublishedHotEventExplanationSummaryRow,
  PublishedHotEventSummary,
  PublishedHotEventInvestmentTargets,
  PublishedThemeMembershipRow,
  PublishedTrendBriefing,
  RefreshPublishedDailyDigestOptions,
  RefreshPublishedTrendBriefingOptions,
  ThemeRef,
} from "./types.js";

export interface RefreshPublishedReadModelOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  action: PublishAction;
}

/**
 * Refresh the published read models for one event.
 *
 * - action=publish: recompute evidenceCount/latestEvidenceAt from the member
 *   records and upsert published_hot_events. Then project the explanation (read
 *   the latest ExplanationVersion → upsert published_hot_event_explanations, or
 *   deleteMany that hotEventId's explanation row if no version exists) and
 *   rewrite the evidence timeline (deleteMany published_hot_event_evidence then
 *   re-insert from member records in publishedAt ASC order, link_status derived
 *   from url). publishedAt on the summary row is set on first insert only.
 * - action=takedown: delete all three published_* tables for the hotEventId
 *   (idempotent — a takedown on already-absent rows is a no-op).
 * - action=none: no-op.
 *
 * This is called inside decideReview's transaction, so all writes are atomic
 * with the status transition. Never throws on missing read-model rows
 * (takedown/deleteMany is idempotent); throws only on genuine DB errors.
 */
export async function refreshPublishedReadModel(
  options: RefreshPublishedReadModelOptions,
): Promise<void> {
  const { prisma, traceId, hotEventId, action } = options;

  if (action === "none") return;

  if (action === "takedown") {
    // Idempotent delete across all six published_* tables. Order does not
    // matter (no inter-table FKs among the published_* models), but we delete
    // the evidence + explanation + reaction + association + theme rows
    // alongside the summary row so "row exists = currently published" holds for
    // all six read models uniformly. Story 2.1 added published_hot_event_reactions;
    // Story 2.2 added published_hot_event_associations; Story 2.3 added
    // published_hot_event_themes to this batch.
    await prisma.publishedHotEventEvidence.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventExplanation.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventReaction.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventAssociation.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventTheme.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventDeepRead.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEventInvestmentTargets.deleteMany({
      where: { hotEventId },
    });
    await prisma.publishedHotEvent.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  // action === "publish": refresh the summary row + project explanation +
  // rewrite the evidence timeline.

  // 1. Summary row (published_hot_events).
  // Story 1.9: the title now comes from the EFFECTIVE source — the latest
  // HotEventRevision.title (operator overlay) ?? the cluster-derived baseline
  // HotEvent.title. We also project the effective tags (latest revision.tags ??
  // []). Clustering does not derive tags, so the baseline tag set is []. This
  // keeps the public read model in sync with operator revisions after a
  // republish (refreshPublishedReadModel is called inside decideReview's
  // transaction for both approve and republish). publishedAt stays stable on
  // the update path (set on first insert only).
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
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { title: true, tags: true },
      },
    },
  });

  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const effectiveTags = latestRevision !== null ? latestRevision.tags : [];

  const evidenceCount = event.evidence.length;
  // latestEvidenceAt: the max publishedAt across member records. Falls back to
  // now() if all members have null publishedAt (the column needs a non-null
  // value; now is the honest "we don't have an earlier time" choice).
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
      title: effectiveTitle,
      tags: effectiveTags,
      evidenceCount,
      latestEvidenceAt,
      publishedAt: new Date(),
      traceId,
    },
    update: {
      title: effectiveTitle,
      tags: effectiveTags,
      evidenceCount,
      latestEvidenceAt,
      traceId,
      // publishedAt deliberately omitted on update: preserve first-publish time.
    },
  });

  // 2. Explanation projection (published_hot_event_explanations).
  await projectExplanation(prisma, traceId, hotEventId);

  // 3. Evidence timeline projection (published_hot_event_evidence).
  await projectEvidenceTimeline(prisma, traceId, hotEventId);

  // 4. Market-reaction projection (published_hot_event_reactions, Story 2.1).
  await projectMarketReaction(prisma, traceId, hotEventId);

  // 5. Association projection (published_hot_event_associations, Story 2.2).
  await projectAssociations(prisma, traceId, hotEventId);

  // 6. Theme membership projection (published_hot_event_themes, Story 2.3).
  await projectThemes(prisma, traceId, hotEventId);

  // 7. Deep-read projection (published_hot_event_deep_reads, Story 5.2).
  await projectDeepRead(prisma, traceId, hotEventId);

  // 8. Investment-targets projection (published_hot_event_investment_targets).
  await projectInvestmentTargets(prisma, traceId, hotEventId);
}

/**
 * Project the latest ExplanationVersion into published_hot_event_explanations.
 * If a version exists, upsert the row (1:1 per hotEventId). If no version exists
 * (explain job has not run), deleteMany that hotEventId's explanation row so
 * the detail page renders the honest degraded state (explanation: null) rather
 * than a stale prior projection. Called inside the publish transaction.
 */
async function projectExplanation(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.explanationVersion.findFirst({
    where: { hotEventId },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) so two versions sharing the same createdAt
    // millisecond resolve deterministically to the newer one.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      summary: true,
      whyItMatters: true,
      uncertainties: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No explanation version yet: clear any stale projection so the detail page
    // shows the degraded state (no fabricated explanation).
    await prisma.publishedHotEventExplanation.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventExplanation.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      summary: latest.summary,
      whyItMatters: latest.whyItMatters,
      uncertainties: latest.uncertainties,
      explanationSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      summary: latest.summary,
      whyItMatters: latest.whyItMatters,
      uncertainties: latest.uncertainties,
      explanationSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Rewrite the evidence timeline projection (published_hot_event_evidence) from
 * the member evidence records. deleteMany first (so a refresh after evidence
 * was added/removed produces the exact current set), then insert one row per
 * member record in publishedAt ASC order (nulls last), with link_status derived
 * from the url's presence. position is assigned sequentially from 0. Called
 * inside the publish transaction.
 *
 * A row is NEVER dropped for a missing link: url present → "available", url
 * missing/empty → "unavailable" (the row stays, rendered with a "无原始链接"
 * badge on the detail page — AC2).
 */
async function projectEvidenceTimeline(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  // Load the member records via the link chain, in publishedAt ASC order so
  // position assignment is deterministic. Null publishedAt sorts first in asc,
  // but we want nulls LAST on the timeline (records with a known time come
  // first); so we sort in JS after fetching to put nulls at the end.
  const links = await prisma.hotEventEvidence.findMany({
    where: { hotEventId },
    select: {
      evidenceRecord: {
        select: {
          id: true,
          url: true,
          summary: true,
          publishedAt: true,
          source: { select: { name: true } },
        },
      },
    },
  });

  // Sort: non-null publishedAt ASC first, then nulls last. Ties (equal
  // publishedAt, or both null) break by evidence record id so position
  // assignment is deterministic across re-projections (otherwise two rows
  // sharing a timestamp could swap positions on refresh). This is the timeline
  // render order (epic: evidence timeline default chronological).
  const sorted = links.map((l) => l.evidenceRecord).sort((a, b) => {
    const at = a.publishedAt;
    const bt = b.publishedAt;
    if (at === null && bt === null) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (at === null) return 1; // a goes last
    if (bt === null) return -1; // b goes last
    const byTime = at.getTime() - bt.getTime();
    if (byTime !== 0) return byTime;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  await prisma.publishedHotEventEvidence.deleteMany({
    where: { hotEventId },
  });

  // Insert one row per member, position ascending. Skip createMany so we can
  // use newTraceId per row (V1 volume is tiny — one published event has a
  // handful of evidence rows). link_status derived from url presence.
  for (let i = 0; i < sorted.length; i++) {
    const rec = sorted[i]!;
    const url = rec.url;
    const linkStatus =
      url !== null && url.trim() !== ""
        ? EvidenceLinkStatus.Available
        : EvidenceLinkStatus.Unavailable;
    await prisma.publishedHotEventEvidence.create({
      data: {
        id: newTraceId(),
        hotEventId,
        sourceName: rec.source.name,
        url: rec.url,
        summary: rec.summary,
        publishedAt: rec.publishedAt,
        linkStatus,
        position: i,
        traceId,
      },
    });
  }
}

/**
 * Project the latest MarketReactionSnapshot into published_hot_event_reactions
 * (Story 2.1). If a snapshot exists, upsert the row (1:1 per hotEventId). If no
 * snapshot exists (market-reaction worker has not run, or V1 prod adapter
 * resolves to none), deleteMany that hotEventId's reaction row so the detail
 * page renders the honest degraded state (reaction: null) rather than a stale
 * prior projection. Called inside the publish transaction and by the market-
 * reaction worker after it appends a snapshot.
 *
 * Mirrors projectExplanation: read latest → upsert or deleteMany.
 */
async function projectMarketReaction(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.marketReactionSnapshot.findFirst({
    where: { hotEventId },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) — same convention as projectExplanation.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      priceVolumeTone: true,
      priceVolumeValue: true,
      sectorLimitUpTone: true,
      sectorLimitUpValue: true,
      limitUpCount: true,
      tradingSession: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No snapshot yet: clear any stale projection so the detail page shows the
    // degraded state (no fabricated reaction).
    await prisma.publishedHotEventReaction.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventReaction.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      priceVolumeTone: latest.priceVolumeTone,
      priceVolumeValue: latest.priceVolumeValue,
      sectorLimitUpTone: latest.sectorLimitUpTone,
      sectorLimitUpValue: latest.sectorLimitUpValue,
      limitUpCount: latest.limitUpCount,
      tradingSession: latest.tradingSession,
      reactionSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      priceVolumeTone: latest.priceVolumeTone,
      priceVolumeValue: latest.priceVolumeValue,
      sectorLimitUpTone: latest.sectorLimitUpTone,
      sectorLimitUpValue: latest.sectorLimitUpValue,
      limitUpCount: latest.limitUpCount,
      tradingSession: latest.tradingSession,
      reactionSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Project the latest EventAssociationSet into published_hot_event_associations
 * (Story 2.2). If a set exists, upsert the row (1:1 per hotEventId, items as
 * Json). If no set exists (no adapter in V1 prod / generation has not run),
 * deleteMany that hotEventId's association row so the detail page renders the
 * honest degraded state (associations: null) rather than a stale prior
 * projection. Called inside the publish transaction. Mirrors
 * projectMarketReaction / projectExplanation: read latest → upsert or deleteMany.
 */
async function projectAssociations(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.eventAssociationSet.findFirst({
    where: { hotEventId },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) — same convention as projectExplanation /
    // projectMarketReaction.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No set yet: clear any stale projection so the detail page shows the
    // degraded state (no fabricated associations).
    await prisma.publishedHotEventAssociation.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventAssociation.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      // The items Json column already holds the typed array from the source
      // EventAssociationSet row; re-project it verbatim. Cast through
      // InputJsonValue (Prisma's Json envelope does not carry the element type
      // across the read→write boundary).
      items: latest.items as unknown as Prisma.InputJsonValue,
      associationSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      items: latest.items as unknown as Prisma.InputJsonValue,
      associationSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Project the latest EventThemeSet into published_hot_event_themes (Story 2.3).
 * If a set exists, upsert the row (1:1 per hotEventId, items as Json). If no set
 * exists (V1 prod: theme-backfill worker resolves no adapter / generation has
 * not run), deleteMany that hotEventId's theme row so the detail page renders
 * the honest degraded state (themes: null) rather than a stale prior projection.
 * Called inside the publish transaction and by the theme-backfill worker after
 * it appends a set. Mirrors projectAssociations / projectMarketReaction /
 * projectExplanation: read latest → upsert or deleteMany.
 */
async function projectThemes(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.eventThemeSet.findFirst({
    where: { hotEventId },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) — same convention as projectExplanation /
    // projectMarketReaction / projectAssociations.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No set yet: clear any stale projection so the detail page shows the
    // degraded state (no fabricated themes).
    await prisma.publishedHotEventTheme.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventTheme.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      // The items Json column already holds the typed array (ThemeRef[]) from
      // the source EventThemeSet row; re-project it verbatim. Cast through
      // InputJsonValue (Prisma's Json envelope does not carry the element type
      // across the read→write boundary).
      items: latest.items as unknown as Prisma.InputJsonValue,
      themeSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      items: latest.items as unknown as Prisma.InputJsonValue,
      themeSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Project the latest DeepRead into published_hot_event_deep_reads (Story 5.2). If a
 * deep read exists, upsert the row (1:1 per hotEventId, three segments + source +
 * generatedAt). If no deep read exists (deep-read worker has not run, or V1 prod
 * adapter resolves to none), deleteMany that hotEventId's deep-read row so the detail
 * page renders the honest degraded state (deepRead: null → "AI 深读生成中。") rather
 * than a stale prior projection. Called inside the publish transaction and by the
 * deep-read worker after it appends a deep read.
 *
 * Mirrors projectExplanation / projectThemes: read latest → upsert or deleteMany.
 * publish-orchestrator stays the SOLE writer of published_hot_event_deep_reads
 * (AD-2/AD-3); the deep-read worker only appends deep_reads + calls this projection.
 */
async function projectDeepRead(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.deepRead.findFirst({
    // Story 5.4: skip suppressed deep reads so a surgical takedown survives the
    // whole-event refresh (republish / self-heal). The latest non-suppressed row
    // wins; all suppressed → null → published row deleted (honest degraded state).
    // The signal is co-located on the source row (suppressedAt), which the
    // projection already reads — no cross-module reverse dependency on
    // review-workflow / ReviewDecision.
    where: { hotEventId, suppressedAt: null },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) — same convention as projectExplanation /
    // projectMarketReaction / projectAssociations / projectThemes.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      impactSurface: true,
      beneficiaries: true,
      riskPoints: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No deep read yet: clear any stale projection so the detail page shows the
    // degraded state (no fabricated deep read — "AI 深读生成中。").
    await prisma.publishedHotEventDeepRead.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventDeepRead.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      impactSurface: latest.impactSurface,
      beneficiaries: latest.beneficiaries,
      riskPoints: latest.riskPoints,
      deepReadSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      impactSurface: latest.impactSurface,
      beneficiaries: latest.beneficiaries,
      riskPoints: latest.riskPoints,
      deepReadSource: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Project the latest InvestmentTarget row into published_hot_event_investment_targets.
 * Mirrors projectDeepRead but WITHOUT the suppressedAt filter (the investment-targets
 * table has no suppress column — no operator path; a bad run writes nothing). If a
 * row exists, upsert (1:1 per hotEventId); if none exists, deleteMany so the detail
 * page renders the honest degraded state rather than a stale prior projection.
 * publish-orchestrator stays the SOLE writer of published_hot_event_investment_targets
 * (AD-2/AD-3).
 */
async function projectInvestmentTargets(
  prisma: PrismaClient,
  traceId: string,
  hotEventId: string,
): Promise<void> {
  const latest = await prisma.investmentTarget.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      newsConclusion: true,
      transmissionPath: true,
      candidates: true,
      downgradeNote: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    await prisma.publishedHotEventInvestmentTargets.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  await prisma.publishedHotEventInvestmentTargets.upsert({
    where: { hotEventId },
    create: {
      hotEventId,
      newsConclusion: latest.newsConclusion,
      transmissionPath: latest.transmissionPath,
      candidates: latest.candidates as unknown as Prisma.InputJsonValue,
      downgradeNote: latest.downgradeNote,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      newsConclusion: latest.newsConclusion,
      transmissionPath: latest.transmissionPath,
      candidates: latest.candidates as unknown as Prisma.InputJsonValue,
      downgradeNote: latest.downgradeNote,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * List all currently-published hot events for the public feed — Story 1.7.
 *
 * This is the first public consumer of the published_hot_events read model (AD-3:
 * public reads only published_* read models). Row existence = currently
 * published, so this is a plain `SELECT published_hot_events` with NO where
 * filter (no status column to forget). Ordering is the product's priority rule:
 * evidenceCount DESC (multi-source coverage first), then latestEvidenceAt DESC
 * (more recently updated first).
 *
 * Returns the minimal projection the public feed card needs (title,
 * evidenceCount, latestEvidenceAt, publishedAt). There is no `since`/window
 * parameter: the query returns every published row and the web layer applies any
 * date-window filter in JS (Design Notes — V1 published volume is tiny, and
 * windowing is a UI concern that lets the same query distinguish "no published
 * events" empty state from "window has no results" state via one fetch).
 *
 * This query only SELECTs published_hot_events. It never reads hot_events,
 * evidence_records, review_decisions, publication_decisions, or hot_event_evidence
 * — the read model is the sole public surface (AD-3).
 */
export async function listPublishedHotEvents(
  options: ListPublishedHotEventsOptions,
): Promise<PublishedHotEventSummary[]> {
  const { prisma } = options;

  const rows = await prisma.publishedHotEvent.findMany({
    select: {
      hotEventId: true,
      title: true,
      evidenceCount: true,
      latestEvidenceAt: true,
      publishedAt: true,
    },
    orderBy: [{ evidenceCount: "desc" }, { latestEvidenceAt: "desc" }],
  });

  return rows;
}

/**
 * Read the public detail of one published hot event — Story 1.8.
 *
 * This is the first public DETAIL consumer of the published read models (AD-3:
 * public reads only published_* read models). It assembles the summary row
 * (published_hot_events), the explanation block (published_hot_event_explanations,
 * nullable), the market-reaction block (published_hot_event_reactions, nullable,
 * Story 2.1), the association block (published_hot_event_associations, nullable,
 * Story 2.2), and the evidence timeline (published_hot_event_evidence, ordered
 * by position). It returns null when the summary row does not exist — the detail
 * page then calls notFound() (404) so unpublished ids do not leak (AD-8: no
 * candidate/rejected/taken_down title or content surfaces).
 *
 * This query only SELECTs published_hot_events + published_hot_event_explanations
 * + published_hot_event_reactions + published_hot_event_associations +
 * published_hot_event_evidence. It NEVER reads hot_events, evidence_records,
 * evidence_sources, hot_event_evidence, explanation_versions,
 * market_reaction_snapshots, event_association_sets, review_decisions, or
 * publication_decisions — the read models are the sole public surface (AD-3).
 * Row existence = currently published; there is no status column and no WHERE
 * filter to forget.
 */
export async function getPublishedHotEventDetail(
  options: GetPublishedHotEventDetailOptions,
): Promise<PublishedHotEventDetail | null> {
  const { prisma, hotEventId } = options;

  // Summary row. If absent, the event is not currently published → return null
  // (the caller 404s). One round-trip; the explanation + evidence are only
  // fetched when the summary exists.
  const summary = await prisma.publishedHotEvent.findUnique({
    where: { hotEventId },
    select: {
      hotEventId: true,
      title: true,
      tags: true,
      evidenceCount: true,
      latestEvidenceAt: true,
      publishedAt: true,
    },
  });

  if (summary === null) return null;

  // Explanation block (nullable). Absent when the explain job has not produced
  // a version yet → the detail page renders the honest degraded state.
  const explanationRow = await prisma.publishedHotEventExplanation.findUnique({
    where: { hotEventId },
    select: {
      summary: true,
      whyItMatters: true,
      uncertainties: true,
      explanationSource: true,
      generatedAt: true,
    },
  });

  // Evidence timeline rows, in render order (position ASC). Each row already
  // carries link_status (derived from url at projection time).
  const evidenceRows = await prisma.publishedHotEventEvidence.findMany({
    where: { hotEventId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      hotEventId: true,
      sourceName: true,
      url: true,
      summary: true,
      publishedAt: true,
      linkStatus: true,
      position: true,
    },
  });

  // Market-reaction block (nullable, Story 2.1). Absent when the market-reaction
  // worker has not produced a snapshot yet (V1 prod: adapter resolves to none) →
  // the detail page renders the honest degraded state.
  const reactionRow = await prisma.publishedHotEventReaction.findUnique({
    where: { hotEventId },
    select: {
      priceVolumeTone: true,
      priceVolumeValue: true,
      sectorLimitUpTone: true,
      sectorLimitUpValue: true,
      limitUpCount: true,
      tradingSession: true,
      reactionSource: true,
      generatedAt: true,
    },
  });

  // Association block (nullable, Story 2.2). Absent when generateAssociations
  // has not produced a set yet (V1 prod: no worker, no adapter) → the detail
  // page renders the honest degraded state.
  const associationRow = await prisma.publishedHotEventAssociation.findUnique({
    where: { hotEventId },
    select: {
      items: true,
      associationSource: true,
      generatedAt: true,
    },
  });

  // Theme membership block (nullable, Story 2.3). Absent when generateThemes has
  // not produced a set yet (V1 prod: theme-backfill worker resolves no adapter) →
  // the detail page renders the honest degraded state.
  const themeRow = await prisma.publishedHotEventTheme.findUnique({
    where: { hotEventId },
    select: {
      items: true,
      themeSource: true,
      generatedAt: true,
    },
  });

  // Deep-read block (nullable, Story 5.2). Absent when the deep-read worker has
  // not produced a row yet (V1 prod: worker resolves no adapter) → the detail page
  // renders the honest degraded state ("AI 深读生成中。").
  const deepReadRow = await prisma.publishedHotEventDeepRead.findUnique({
    where: { hotEventId },
    select: {
      impactSurface: true,
      beneficiaries: true,
      riskPoints: true,
      deepReadSource: true,
      generatedAt: true,
    },
  });

  // Investment-targets block (nullable). Absent when the investment-targets worker
  // has not produced a pool yet (V1: worker resolves no adapter) → honest degraded.
  const targetsRow = await prisma.publishedHotEventInvestmentTargets.findUnique({
    where: { hotEventId },
    select: {
      newsConclusion: true,
      transmissionPath: true,
      candidates: true,
      downgradeNote: true,
      generatedAt: true,
    },
  });

  const evidence: PublishedEvidenceRow[] = evidenceRows.map((r) => ({
    id: r.id,
    hotEventId: r.hotEventId,
    sourceName: r.sourceName,
    url: r.url,
    summary: r.summary,
    publishedAt: r.publishedAt,
    linkStatus: r.linkStatus as PublishedEvidenceRow["linkStatus"],
    position: r.position,
  }));

  return {
    hotEventId: summary.hotEventId,
    title: summary.title,
    tags: summary.tags,
    evidenceCount: summary.evidenceCount,
    latestEvidenceAt: summary.latestEvidenceAt,
    publishedAt: summary.publishedAt,
    explanation:
      explanationRow === null
        ? null
        : {
            summary: explanationRow.summary,
            whyItMatters: explanationRow.whyItMatters,
            uncertainties: explanationRow.uncertainties,
            source: explanationRow.explanationSource,
            generatedAt: explanationRow.generatedAt,
          },
    reaction:
      reactionRow === null
        ? null
        : {
            priceVolume: {
              tone: reactionRow.priceVolumeTone,
              value: reactionRow.priceVolumeValue,
            },
            sectorLimitUp: {
              tone: reactionRow.sectorLimitUpTone,
              value: reactionRow.sectorLimitUpValue,
            },
            limitUpCount: reactionRow.limitUpCount,
            tradingSession: reactionRow.tradingSession,
            source: reactionRow.reactionSource,
            generatedAt: reactionRow.generatedAt,
          },
    associations:
      associationRow === null
        ? null
        : {
            items: associationRow.items as unknown as AssociationItem[],
            source: associationRow.associationSource,
            generatedAt: associationRow.generatedAt,
          },
    themes:
      themeRow === null
        ? null
        : {
            items: themeRow.items as unknown as ThemeRef[],
            source: themeRow.themeSource,
            generatedAt: themeRow.generatedAt,
          },
    deepRead:
      deepReadRow === null
        ? null
        : {
            impactSurface: deepReadRow.impactSurface,
            beneficiaries: deepReadRow.beneficiaries,
            riskPoints: deepReadRow.riskPoints,
            source: deepReadRow.deepReadSource,
            generatedAt: deepReadRow.generatedAt,
          },
    investmentTargets:
      targetsRow === null
        ? null
        : ({
            newsConclusion: targetsRow.newsConclusion,
            transmissionPath: targetsRow.transmissionPath,
            candidates: targetsRow.candidates as unknown as TargetCandidate[],
            downgradeNote: targetsRow.downgradeNote,
            source: "ai",
            generatedAt: targetsRow.generatedAt,
          } satisfies PublishedHotEventInvestmentTargets),
    evidence,
  };
}

/**
 * List all currently-published associations — the hotEventId→items map the feed
 * uses for the association-dimension JS filter (Story 2.2).
 *
 * The feed's `?concept=|?industry=|?stock=` URL dimensions filter the published
 * event list in JS (mirroring the 1.7 `filterByWindow` pattern).
 * `listPublishedHotEvents` stays filter-free (no signature change, no
 * consumerless parameter); the web layer joins this association map to the
 * event list in memory and applies the dimension filter. V1 published volume is
 * tiny, so a second read + an in-memory join is the ponytail choice over a SQL
 * join or per-dimension index (deferred as a scale ceiling).
 *
 * Returns `{ hotEventId, items }` for every published_hot_event_associations
 * row. It only SELECTs published_hot_event_associations — never
 * event_association_sets / hot_events / evidence_* (AD-3). Row existence =
 * currently published associations.
 */
export async function listPublishedAssociations(
  options: ListPublishedAssociationsOptions,
): Promise<PublishedAssociationRow[]> {
  const { prisma } = options;

  const rows = await prisma.publishedHotEventAssociation.findMany({
    select: {
      hotEventId: true,
      items: true,
    },
  });

  return rows.map((r) => ({
    hotEventId: r.hotEventId,
    items: r.items as unknown as AssociationItem[],
  }));
}

/**
 * List all currently-published theme memberships — the hotEventId→ThemeRef[] map
 * the /topics directory and /topics/[slug] page use to derive the distinct-theme
 * set and filter member events (Story 2.3).
 *
 * The /topics directory derives its distinct-theme list from this in JS (dedup
 * by slug, preserve first-seen order). The /topics/[slug] page filters members
 * by slug in JS (events whose items contain that slug). Both mirror the 2.2
 * listPublishedAssociations + 1.7 filterByWindow JS-join pattern.
 * `listPublishedHotEvents` stays filter-free. V1 published volume is tiny, so a
 * full read + an in-memory join is the ponytail choice over a SQL join or
 * per-slug index (deferred as a scale ceiling).
 *
 * Returns `{ hotEventId, items }` for every published_hot_event_themes row. It
 * only SELECTs published_hot_event_themes — never event_theme_sets / hot_events
 * / evidence_* (AD-3). Row existence = currently published theme membership.
 */
export async function listPublishedThemeMemberships(
  options: ListPublishedThemeMembershipsOptions,
): Promise<PublishedThemeMembershipRow[]> {
  const { prisma } = options;

  // orderBy hotEventId ASC so the row order is deterministic across loads.
  // The /topics/[slug] page derives the theme label as "first-seen ThemeRef.label
  // for this slug"; without a deterministic row order, Postgres could return
  // rows in unspecified order and the label would flicker when multiple events
  // share a slug. hotEventId ASC makes first-seen stable.
  const rows = await prisma.publishedHotEventTheme.findMany({
    select: {
      hotEventId: true,
      items: true,
    },
    orderBy: { hotEventId: "asc" },
  });

  return rows.map((r) => ({
    hotEventId: r.hotEventId,
    items: r.items as unknown as ThemeRef[],
  }));
}

/**
 * List all currently-published explanation summaries — the hotEventId→summary
 * map the public search-read path uses to match against explanation summary text
 * (Story 3.1).
 *
 * This is a SIBLING list fn to listPublishedAssociations /
 * listPublishedThemeMemberships: the search-read module (Story 3.1) joins all
 * three corpora (event titles from listPublishedHotEvents, explanation summaries
 * from this fn, theme labels from listPublishedThemeMemberships) in JS and
 * applies case-insensitive substring matching (mirroring the 1.7 filterByWindow
 * / 2.2 association-join / 2.3 theme-derive in-memory filter pattern). FR12 names
 * "标题、解释摘要和主题名称" as the three search corpora; without this fn the
 * explanation summary corpus would be unreachable from the public read path.
 *
 * `listPublishedHotEvents` / `listPublishedAssociations` /
 * `listPublishedThemeMemberships` signatures stay filter-free and unchanged.
 * V1 published volume is tiny, so a full read is the ponytail choice over a SQL
 * filter (FTS/tsvector/GIN deferred — real query load has not appeared).
 *
 * Returns `{ hotEventId, summary }` for every published_hot_event_explanations
 * row, ordered by hotEventId ASC so the row order is deterministic across loads
 * (mirroring the sibling listPublishedThemeMemberships contract — the current
 * search-read caller builds a Map and does not depend on order, but the sibling
 * contract holds for future direct-iteration callers). It only SELECTs
 * published_hot_event_explanations — never explanation_versions / hot_events /
 * evidence_* (AD-3). Row existence = currently published explanation (no status
 * column). An event with no projected explanation has no row here, so it is
 * simply absent from the summary corpus (its title/theme can still match via
 * the other two corpora).
 */
export async function listPublishedHotEventExplanations(
  options: ListPublishedHotEventExplanationsOptions,
): Promise<PublishedHotEventExplanationSummaryRow[]> {
  const { prisma } = options;

  // orderBy hotEventId ASC mirrors listPublishedThemeMemberships: deterministic
  // row order across loads even though the current search-read caller builds a
  // Map. Sibling contract — future direct-iteration callers can rely on it.
  const rows = await prisma.publishedHotEventExplanation.findMany({
    select: {
      hotEventId: true,
      summary: true,
    },
    orderBy: { hotEventId: "asc" },
  });

  return rows.map((r) => ({
    hotEventId: r.hotEventId,
    summary: r.summary,
  }));
}

// --- Story 2.4: daily-digest projection + reads -------------------------------

/**
 * Refresh the published daily-digest read model for one coverageDate (Story
 * 2.4). This is a SIBLING function to refreshPublishedReadModel, NOT a new
 * branch inside it. Reason: refreshPublishedReadModel is hotEventId-keyed
 * (projects one hot event's published_* tables on publish/takedown), whereas
 * the daily digest is coverageDate-keyed (aggregates multiple events into one
 * versioned artifact). Mixing the two keys in one function would conflate two
 * distinct aggregate contracts (see spec Design Notes). Same module
 * (publish-orchestrator, AD-3's single write-owner), different aggregate key,
 * independent function.
 *
 * Reads the latest daily_digests row for the coverageDate (createdAt desc, id
 * desc tiebreaker) → upsert published_daily_digests (items Json). If no
 * daily_digests row exists (generateDailyDigest has not run / returned null /
 * V1 prod adapter resolves none), deleteMany that coverageDate's row so the
 * /daily page renders the honest degraded state rather than a stale prior
 * projection. Idempotent.
 *
 * Unlike the hotEventId-keyed projections, the digest has NO FK to hot_events —
 * hotEventId in each entry is a data-only link. A hotEvent takedown does NOT
 * trigger this refresh (the digest is a versioned point-in-time artifact; the
 * link honestly 404s, staleness recompute is deferred).
 *
 * This query only reads daily_digests and writes published_daily_digests. It
 * never reads hot_events / evidence_* / published_hot_event_* (AD-3: the digest
 * read model is the sole public surface for /daily).
 */
export async function refreshPublishedDailyDigest(
  options: RefreshPublishedDailyDigestOptions,
): Promise<void> {
  const { prisma, traceId, coverageDate } = options;

  const latest = await prisma.dailyDigest.findFirst({
    where: { coverageDate },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids
    // embed a monotonic timestamp) — same convention as the hotEventId-keyed
    // projections.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No digest row: clear any stale projection so the /daily page shows the
    // degraded state (no fabricated digest).
    await prisma.publishedDailyDigest.deleteMany({
      where: { coverageDate },
    });
    return;
  }

  await prisma.publishedDailyDigest.upsert({
    where: { coverageDate },
    create: {
      coverageDate,
      // The items Json column already holds the typed array
      // (DailyDigestEntry[]) from the source daily_digests row; re-project it
      // verbatim. Cast through InputJsonValue (Prisma's Json envelope does not
      // carry the element type across the read→write boundary).
      items: latest.items as unknown as Prisma.InputJsonValue,
      source: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      items: latest.items as unknown as Prisma.InputJsonValue,
      source: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Read the public daily digest for one coverageDate — Story 2.4.
 *
 * This is the public read query the /daily page consumes (AD-3: public reads
 * only published_* read models). It returns the projected digest for that
 * coverageDate, or null when no published_daily_digests row exists (digest not
 * generated / adapter unavailable in V1 prod / coverageDate has no eligible
 * events) — the /daily page then renders the honest degraded state (AC3).
 *
 * This query only SELECTs published_daily_digests. It NEVER reads daily_digests
 * / hot_events / evidence_* (AD-3). Row existence = a published digest for that
 * coverageDate (no status column).
 */
export async function getPublishedDailyDigest(
  options: GetPublishedDailyDigestOptions,
): Promise<PublishedDailyDigest | null> {
  const { prisma, coverageDate } = options;

  const row = await prisma.publishedDailyDigest.findUnique({
    where: { coverageDate },
    select: {
      coverageDate: true,
      items: true,
      source: true,
      generatedAt: true,
    },
  });

  if (row === null) return null;
  return {
    coverageDate: row.coverageDate,
    entries: row.items as unknown as DailyDigestEntry[],
    source: row.source,
    generatedAt: row.generatedAt,
  };
}

/**
 * List the distinct coverageDates that have a published daily digest — Story
 * 2.4. The /daily page uses the first row (max coverageDate) as the default
 * view when no ?date= query param is present (the "latest digest").
 *
 * Returns `{ coverageDate }` for every published_daily_digests row, ordered by
 * coverageDate DESC so the first row is the latest. It only SELECTs
 * published_daily_digests — never daily_digests / hot_events / evidence_*
 * (AD-3).
 *
 * Note: coverageDate is the PK of published_daily_digests, so findMany +
  orderBy coverageDate DESC already returns distinct coverageDates (one row per
  coverageDate). No SQL DISTINCT needed.
 */
export async function listPublishedDailyDigestCoverageDates(
  options: ListPublishedDailyDigestCoverageDatesOptions,
): Promise<{ coverageDate: Date }[]> {
  const { prisma } = options;

  const rows = await prisma.publishedDailyDigest.findMany({
    select: { coverageDate: true },
    orderBy: { coverageDate: "desc" },
  });

  return rows;
}

// --- Story 5.3: trend-briefing projection + reads -----------------------------

/**
 * Refresh the published trend-briefing read model for one coverageDate (Story 5.3). This
 * is a SIBLING function to refreshPublishedDailyDigest AND to refreshPublishedReadModel,
 * NOT a new branch inside either. Reason: the trend briefing is coverageDate-keyed
 * (aggregates the day's events into one paragraph), just like the daily digest; and the
 * hot-event projections are hotEventId-keyed. Mixing coverageDate + hotEventId keys in one
 * function would conflate distinct aggregate contracts. Same module (publish-orchestrator,
 * AD-3's single write-owner), coverageDate-keyed aggregate, independent sibling function
 * mirroring refreshPublishedDailyDigest's shape.
 *
 * Reads the latest trend_briefings row for the coverageDate (createdAt desc, id desc
 * tiebreaker) → upsert published_trend_briefings. If no trend_briefings row exists
 * (generateTrendBriefing has not run / returned null / V1 prod adapter resolves none),
 * deleteMany that coverageDate's row so the /daily page renders the honest degraded state
 * rather than a stale prior projection. Idempotent.
 *
 * Unlike the hotEventId-keyed projections, the trend briefing has NO FK to hot_events —
 * basedOnHotEventIds is a data-only Json link. A hotEvent takedown does NOT trigger this
 * refresh (the briefing is a versioned point-in-time artifact; the link honestly 404s,
 * staleness recompute is deferred — same rule as the daily digest).
 *
 * This query only reads trend_briefings and writes published_trend_briefings. It never
 * reads hot_events / evidence_* / published_hot_event_* (AD-3: the trend-briefing read
 * model is the sole public surface for the /daily trend-briefing block).
 */
export async function refreshPublishedTrendBriefing(
  options: RefreshPublishedTrendBriefingOptions,
): Promise<void> {
  const { prisma, traceId, coverageDate } = options;

  const latest = await prisma.trendBriefing.findFirst({
    where: { coverageDate },
    // createdAt desc, then id desc as a deterministic tiebreaker (UUIDv7 ids embed a
    // monotonic timestamp) — same convention as refreshPublishedDailyDigest + the
    // hotEventId-keyed projections.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      briefing: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) {
    // No briefing row: clear any stale projection so the /daily page shows the degraded
    // state (no fabricated briefing).
    await prisma.publishedTrendBriefing.deleteMany({
      where: { coverageDate },
    });
    return;
  }

  await prisma.publishedTrendBriefing.upsert({
    where: { coverageDate },
    create: {
      coverageDate,
      briefing: latest.briefing,
      source: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
    update: {
      briefing: latest.briefing,
      source: latest.source,
      generatedAt: latest.createdAt,
      traceId,
    },
  });
}

/**
 * Read the public trend briefing for one coverageDate — Story 5.3.
 *
 * This is the public read query the /daily page consumes (AD-3: public reads only
 * published_* read models). It returns the projected briefing for that coverageDate, or
 * null when no published_trend_briefings row exists (briefing not generated / llmAdapter
 * unavailable in V1 prod / coverageDate has no eligible events) — the /daily page then
 * renders the honest degraded state ("AI 趋势研判生成中。", AC3).
 *
 * This query only SELECTs published_trend_briefings. It NEVER reads trend_briefings /
 * hot_events / evidence_* (AD-3). Row existence = a published briefing for that
 * coverageDate (no status column).
 */
export async function getPublishedTrendBriefing(
  options: GetPublishedTrendBriefingOptions,
): Promise<PublishedTrendBriefing | null> {
  const { prisma, coverageDate } = options;

  const row = await prisma.publishedTrendBriefing.findUnique({
    where: { coverageDate },
    select: {
      coverageDate: true,
      briefing: true,
      source: true,
      generatedAt: true,
    },
  });

  if (row === null) return null;
  return {
    coverageDate: row.coverageDate,
    briefing: row.briefing,
    source: row.source,
    generatedAt: row.generatedAt,
  };
}
