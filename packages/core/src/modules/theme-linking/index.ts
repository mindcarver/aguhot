/**
 * theme-linking module barrel — Story 2.2 (associations) + Story 2.3 (themes).
 *
 * Owns the event_association_sets table (AD-2 append-only, Story 2.2) and the
 * event_theme_sets table (AD-2 append-only, Story 2.3). Exposes the association
 * + theme generators, the latest-set read queries, the AssociationAdapter +
 * ThemeAdapter ports, and the test-only stubs. The Prisma client lives one
 * level up and is re-exported from the package barrel.
 *
 * This module never writes published_* (publish-orchestrator owns the public
 * projections) or hot_events (event-assembly owns those). It only appends
 * event_association_sets + event_theme_sets; publish-orchestrator reads the
 * latest at projection time and writes the public read models.
 *
 * V1 has NO worker for association generation (epic lists only market-signal /
 * digest / theme-backfill BullMQ job categories — association generation is NOT
 * among them). So generateAssociations is invoked by verify/seed only, never by
 * an apps/worker queue. apps/worker does NOT import StubAssociationAdapter.
 *
 * Story 2.3 adds a theme-backfill worker (epic lists theme-backfill as a job
 * category). The worker resolves adapter = undefined (procurement deferred) so
 * generateThemes returns null and prod degrades honestly. The worker does NOT
 * import StubThemeAdapter; verify/e2e pass it to generateThemes directly.
 */

export {
  generateAssociations,
  getLatestAssociationSet,
  normalizeItems,
} from "./association-service.js";
export { StubAssociationAdapter, STUB_CONCEPT_LABEL } from "./stub-adapter.js";
export { AssociationKind, AssociationSource } from "./types.js";
export type {
  AssociationKind as AssociationKindType,
  AssociationSource as AssociationSourceType,
  AssociationItem,
  AssociationAdapter,
  GenerateAssociationsOptions,
  GenerateAssociationsResult,
  GetLatestAssociationSetOptions,
  AssociationSetRecord,
} from "./types.js";

// Story 2.3: theme membership sub-domain (continuity substrate). Same shape as
// the association sub-domain: port + test-only stub + append-only generator +
// latest-set read query + pure normalizer with AC2 enforcement.
export {
  generateThemes,
  getLatestThemeSet,
  normalizeThemeItems,
} from "./theme-service.js";
export { StubThemeAdapter, STUB_THEME_SLUG, STUB_THEME_LABEL } from "./stub-theme-adapter.js";
export { ThemeSource } from "./types.js";
export type {
  ThemeSource as ThemeSourceType,
  ThemeRef,
  ThemeAdapter,
  GenerateThemesOptions,
  GenerateThemesResult,
  GetLatestThemeSetOptions,
  ThemeSetRecord,
} from "./types.js";
