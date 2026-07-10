/**
 * publish-orchestrator module barrel.
 *
 * AD-3 single write-owner of the published read models: published_hot_events
 * (Story 1.6) + published_hot_event_explanations + published_hot_event_evidence
 * (Story 1.8) + published_hot_event_reactions (Story 2.1) +
 * published_hot_event_associations (Story 2.2) + published_hot_event_themes
 * (Story 2.3). Exposes the read-model refresh command consumed by
 * review-workflow's decideReview, plus the public read queries (feed + detail +
 * association feed-filter + theme-page membership map). The Prisma client lives
 * one level up and is re-exported from the package barrel.
 *
 * This module never writes hot_events, review_decisions, publication_decisions,
 * explanation_versions, market_reaction_snapshots, event_association_sets,
 * event_theme_sets, or any other module's aggregate — only the six published_*
 * read models.
 */

export {
  refreshPublishedReadModel,
  listPublishedHotEvents,
  getPublishedHotEventDetail,
  listPublishedAssociations,
  listPublishedThemeMemberships,
} from "./publish-service.js";
export type { RefreshPublishedReadModelOptions } from "./publish-service.js";
export type {
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
} from "./types.js";
