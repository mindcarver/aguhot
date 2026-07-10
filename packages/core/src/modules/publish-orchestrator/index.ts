/**
 * publish-orchestrator module barrel.
 *
 * AD-3 single write-owner of the published_hot_events read model. Exposes the
 * read-model refresh command consumed by review-workflow's decideReview. The
 * Prisma client lives one level up and is re-exported from the package barrel.
 *
 * This module never writes hot_events, review_decisions, publication_decisions,
 * or any other module's aggregate — only published_hot_events.
 */

export { refreshPublishedReadModel } from "./publish-service.js";
export type { RefreshPublishedReadModelOptions } from "./publish-service.js";
