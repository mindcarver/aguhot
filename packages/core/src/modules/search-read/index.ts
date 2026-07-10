/**
 * search-read module barrel — Story 3.1 (FR12 public search).
 *
 * Owns the public search read path over the published_* read models. Exposes
 * searchPublished, which joins listPublishedHotEvents +
 * listPublishedHotEventExplanations + listPublishedThemeMemberships (all
 * filter-free sibling list fns owned by publish-orchestrator) and matches +
 * ranks in JS. The Prisma client lives one level up and is re-exported from the
 * package barrel.
 *
 * This module NEVER writes anything (pure read) and never reads raw
 * hot_events / explanation_versions / event_theme_sets / evidence_* tables —
 * only the published_* read models (AD-3). Row existence = currently published
 * (no status column); a taken-down event automatically disappears from search.
 */

export { searchPublished } from "./search-service.js";
export { SearchHitKind, EventMatchedField } from "./types.js";
export type {
  SearchHitKindType,
  EventMatchedFieldType,
  SearchPublishedOptions,
  EventSearchHit,
  ThemeSearchHit,
  SearchPublishedResult,
} from "./types.js";
