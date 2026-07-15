/**
 * publish-orchestrator module barrel.
 *
 * AD-3 single write-owner of the published read models: published_hot_events
 * (Story 1.6) + published_hot_event_explanations + published_hot_event_evidence
 * (Story 1.8) + published_hot_event_reactions (Story 2.1) +
 * published_hot_event_associations (Story 2.2) + published_hot_event_themes
 * (Story 2.3) + published_timeline_entries (Story 4.1, AD-3b). Exposes the
 * read-model refresh commands consumed by review-workflow's decideReview (the
 * per-event refresh runs inside decideReview's $transaction, gate-atomic), plus
 * the public read queries (feed + detail + association feed-filter + theme-page
 * membership map + timeline home feed). The Prisma client lives one level up
 * and is re-exported from the package barrel.
 *
 * This module never writes hot_events, review_decisions, publication_decisions,
 * explanation_versions, market_reaction_snapshots, event_association_sets,
 * event_theme_sets, or any other module's aggregate — only the published_*
 * read models.
 */

export {
  refreshPublishedReadModel,
  listPublishedHotEvents,
  getPublishedHotEventDetail,
  listPublishedAssociations,
  listPublishedThemeMemberships,
  listPublishedHotEventExplanations,
  refreshPublishedDailyDigest,
  getPublishedDailyDigest,
  listPublishedDailyDigestCoverageDates,
  refreshPublishedTrendBriefing,
  getPublishedTrendBriefing,
  refreshPublishedCrashDays,
  listPublishedCrashDays,
} from "./publish-service.js";
// Story 4.1 (AD-3b): the published_timeline read model. The per-event refresh
// (refreshPublishedTimelineForEvent) runs inside decideReview's $transaction;
// the full self-heal (refreshPublishedTimelineAll) runs as a BullMQ job;
// listPublishedTimeline is the Web home feed read contract.
// Story 4.4: listPublishedTimelineEntries is the filter-free full-table search
// corpus (sibling to the date-scoped listPublishedTimeline feed read).
export {
  refreshPublishedTimelineForEvent,
  refreshPublishedTimelineAll,
  listPublishedTimeline,
  listPublishedTimelineEntries,
} from "./timeline-read-model.js";
export {
  deriveSessionTag,
  deriveTradeDate,
  SHANGHAI_OFFSET_MIN,
} from "./session-tag.js";
export type { RefreshPublishedReadModelOptions } from "./publish-service.js";
export {
  TimelineSessionTag,
} from "./types.js";
export type {
  RefreshPublishedTimelineForEventOptions,
  RefreshPublishedTimelineAllOptions,
  ListPublishedTimelineOptions,
  ListPublishedTimelineEntriesOptions,
  PublishedTimelineEntry,
  TimelineSessionTagType,
  ListPublishedHotEventsOptions,
  PublishedHotEventSummary,
  GetPublishedHotEventDetailOptions,
  PublishedHotEventDetail,
  PublishedEvidenceRow,
  EvidenceLinkStatus,
  EvidenceLinkStatusType,
  PublishedHotEventReaction,
  AssociationItem,
  PublishedHotEventAssociation,
  PublishedAssociationRow,
  ListPublishedAssociationsOptions,
  ThemeRef,
  PublishedHotEventTheme,
  PublishedThemeMembershipRow,
  ListPublishedThemeMembershipsOptions,
  PublishedHotEventExplanationSummaryRow,
  ListPublishedHotEventExplanationsOptions,
  DailyDigestEntry,
  PublishedDailyDigest,
  RefreshPublishedDailyDigestOptions,
  GetPublishedDailyDigestOptions,
  ListPublishedDailyDigestCoverageDatesOptions,
  PublishedHotEventDeepRead,
  PublishedTrendBriefing,
  RefreshPublishedTrendBriefingOptions,
  GetPublishedTrendBriefingOptions,
  LeadingSector,
  PublishedCrashDay,
  RefreshPublishedCrashDaysOptions,
  ListPublishedCrashDaysOptions,
} from "./types.js";
