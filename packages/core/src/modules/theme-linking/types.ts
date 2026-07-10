/**
 * theme-linking domain types — Story 2.2.
 *
 * The theme-linking module owns EventAssociationSet (AD-2 append-only write
 * table, one row per generation). It derives concept/industry/stock
 * AssociationItems from an AssociationAdapter's output — each item carries a
 * kind, a label (the clickable entity identity), and a NON-EMPTY mappingBasis
 * (provenance — AC2 mandates an explicit mapping basis; adapter output missing
 * a basis is rejected, never silently filled with a default). The public read
 * model is owned by publish-orchestrator (published_hot_event_associations).
 *
 * V1 has NO real association knowledge source (procurement deferred) AND no
 * worker (epic lists only market-signal / digest / theme-backfill BullMQ job
 * categories — association generation is NOT among them). So prod has no
 * trigger → no association generation → honest degradation (AC3).
 * StubAssociationAdapter is test-only (verify/e2e call generateAssociations
 * directly with it to exercise the happy path). apps/worker does NOT import the
 * stub.
 *
 * NFR: associations are explanatory, never advisory. Item labels describe entity
 * identity only (concept name / industry name / "stock name code") and NEVER
 * contain buy/sell/target-price/position wording.
 *
 * `items` is a variable-cardinality, display-only set that is always read whole
 * (detail page renders all groups; feed applies association-dimension filters
 * via an in-memory join). It is stored as a Prisma Json column holding
 * AssociationItem[] rather than a normalized child table (ponytail: no child
 * table for a consumerless per-item SQL query).
 */

import type { PrismaClient } from "../../../generated/client.js";

/**
 * The kind of an association item. concept / industry / stock are the three V1
 * dimensions the detail page groups items into (AC1). The detail page renders
 * one group per kind present (kinds with no confirmed items are omitted — AC3
 * honest degradation per-dimension, never fabricated).
 */
export const AssociationKind = {
  Concept: "concept",
  Industry: "industry",
  Stock: "stock",
} as const;

export type AssociationKind = (typeof AssociationKind)[keyof typeof AssociationKind];

/**
 * The provenance of an association set. Stored on every EventAssociationSet row.
 * The public read model carries this through as `associationSource`.
 *
 *   - template: V1 deterministic fixture-backed derivation
 *     (StubAssociationAdapter, test-only). When a real knowledge source lands,
 *     source becomes the provider id (e.g. "tushare:concept").
 *
 * V1 has no worker and no real adapter, so no set with source="template" is
 * ever written in prod — only by verify/e2e direct calls.
 */
export const AssociationSource = {
  Template: "template",
} as const;

export type AssociationSource =
  (typeof AssociationSource)[keyof typeof AssociationSource];

/**
 * One association item — a clickable entity identity + its explicit mapping
 * basis (AC2). The detail page renders each item as a FilterPill link to
 * `/?<kind>=<label>` (a filtered feed view — the V1 click-through destination;
 * concept/industry/stock standalone detail pages are deferred).
 *
 *   - kind: concept / industry / stock. Drives the detail-page grouping + the
 *     feed filter dimension.
 *   - label: the entity identity. For a stock this is the stock name (a code
 *     may be appended in display, but V1 stub uses the name only). Descriptive,
 *     never advisory.
 *   - mappingBasis: NON-EMPTY provenance (e.g. "knowledge_base:v1"). AC2
 *     mandates an explicit mapping basis; an adapter item with an empty/missing
 *     mappingBasis is rejected by generateAssociations (fail-fast, never
 *     silently filled with a default — otherwise "explicit basis" becomes
 *     decoration).
 */
export interface AssociationItem {
  kind: AssociationKind;
  label: string;
  mappingBasis: string;
}

/**
 * The AssociationAdapter port (AD-7). All association knowledge sources
 * (concept/industry/stock mapping libraries, NER, LLM-based extraction) enter
 * exclusively through this interface; domain modules never import a third-party
 * SDK. V1 has no concrete implementation wired anywhere in prod (procurement
 * deferred, and no worker exists) — verify/e2e pass StubAssociationAdapter
 * directly to generateAssociations. The only concrete implementation today is
 * StubAssociationAdapter (test-only).
 *
 * Defined in adapter.ts and re-exported here for the package barrel.
 */
export interface AssociationAdapter {
  /**
   * Fetch the concept/industry/stock associations for the given hot event.
   * Implementations resolve the event's relevant entities and return them with
   * a NON-EMPTY mappingBasis on each item (AC2). Return null or an empty array
   * when no associations are available (the caller writes nothing and degrades
   * honestly). Each returned item MUST have a non-empty mappingBasis — items
   * missing a basis are rejected by generateAssociations (it throws, never
   * silently fills a default).
   */
  fetchAssociations(args: {
    hotEventId: string;
  }): Promise<AssociationItem[] | null>;
}

/**
 * Options for generateAssociations. `{ prisma, traceId, hotEventId, adapter? }`
 * mirrors the established command pattern (generateMarketReaction,
 * generateExplanation) plus an optional adapter. When adapter is omitted,
 * returns null/[], or returns null, the function returns null and writes
 * nothing (honest degradation — never fabricates a set from no data).
 * Otherwise it validates each item's mappingBasis is non-empty (AC2), normalizes
 * the items (dedup by kind+label, preserve order), and APPENDS one
 * EventAssociationSet row (source="template").
 */
export interface GenerateAssociationsOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: AssociationAdapter;
}

/**
 * The result of a successful generation: the newly-appended set's id + the
 * normalized items + provenance + createdAt. Callers (publish-orchestrator
 * projection, verify/seed) consume the items directly.
 */
export interface GenerateAssociationsResult {
  eventAssociationSetId: string;
  hotEventId: string;
  items: AssociationItem[];
  source: AssociationSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestAssociationSet — returns the most recent
 * EventAssociationSet for an event (createdAt desc, id desc tiebreaker) or null
 * if none exist. publish-orchestrator uses this at projection time.
 */
export interface GetLatestAssociationSetOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * One association-set row projected for read. Mirrors the EventAssociationSet
 * columns the public projection + operator audit need (no write paths here).
 */
export interface AssociationSetRecord {
  id: string;
  hotEventId: string;
  items: AssociationItem[];
  source: AssociationSource;
  createdAt: Date;
}

// --- Story 2.3: theme membership (continuity substrate) ----------------------

/**
 * The provenance of a theme set. Stored on every EventThemeSet row. The public
 * read model carries this through as `themeSource`.
 *
 *   - template: V1 deterministic fixture-backed derivation
 *     (StubThemeAdapter, test-only). When a real theme knowledge source lands,
 *     source becomes the provider id (e.g. "tushare:theme").
 *
 * V1 worker resolves NO adapter (real theme knowledge source procurement is
 * deferred), so no set with source="template" is ever written in prod by the
 * worker — only by verify/e2e direct calls. The worker exists (epic lists
 * theme-backfill as a job category) but its adapter resolves to undefined →
 * generateThemes returns null → honest degradation.
 */
export const ThemeSource = {
  Template: "template",
} as const;

export type ThemeSource = (typeof ThemeSource)[keyof typeof ThemeSource];

/**
 * One theme membership reference — a theme identity + its explicit mapping
 * basis (AC2). The detail page renders each theme as a FilterPill link to
 * `/topics/{slug}` (FR9, the theme-continuity jump). The /topics directory and
 * the /topics/[slug] page use the slug as the URL/addressing key and the label
 * for display.
 *
 *   - slug: NON-EMPTY URL-safe identity (e.g. "chip-supply-chain"). Drives the
 *     /topics/{slug} route and the /topics directory's distinct-theme set.
 *   - label: the theme's display identity (e.g. "芯片供应链"). Descriptive,
 *     never advisory.
 *   - mappingBasis: NON-EMPTY provenance (e.g. "knowledge_base:v1"). AC2
 *     mandates an explicit mapping basis; an adapter item with an empty/missing
 *     mappingBasis is rejected by generateThemes (fail-fast, never silently
 *     filled with a default).
 */
export interface ThemeRef {
  slug: string;
  label: string;
  mappingBasis: string;
}

/**
 * The ThemeAdapter port (AD-7). All theme knowledge sources (theme mapping
 * libraries, NER, LLM-based theme extraction) enter exclusively through this
 * interface; domain modules never import a third-party SDK. V1 has no concrete
 * implementation wired in prod (procurement deferred) — the theme-backfill
 * worker resolves `adapter = undefined` so generateThemes returns null and prod
 * degrades honestly (AC3). verify/e2e pass StubThemeAdapter directly to
 * generateThemes. The only concrete implementation today is StubThemeAdapter
 * (test-only).
 *
 * Defined in theme-adapter.ts and re-exported here for the package barrel.
 */
export interface ThemeAdapter {
  /**
   * Fetch the theme memberships for the given hot event. Implementations
   * resolve the event's relevant themes and return them with a NON-EMPTY
   * mappingBasis + non-empty slug + non-empty label on each item (AC2). Return
   * null or an empty array when no themes are available (the caller writes
   * nothing and degrades honestly). Each returned item MUST have all three
   * fields non-empty — items missing any field are rejected by generateThemes
   * (it throws, never silently fills a default).
   */
  fetchThemes(args: { hotEventId: string }): Promise<ThemeRef[] | null>;
}

/**
 * Options for generateThemes. `{ prisma, traceId, hotEventId, adapter? }`
 * mirrors generateAssociations plus an optional adapter. When adapter is
 * omitted, returns null, or returns null/[], the function returns null and
 * writes nothing (honest degradation — never fabricates a set from no data).
 * Otherwise it validates each item's mappingBasis/slug/label is non-empty (AC2),
 * normalizes the items (dedup by slug, preserve order), and APPENDS one
 * EventThemeSet row (source="template").
 */
export interface GenerateThemesOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: ThemeAdapter;
}

/**
 * The result of a successful theme generation: the newly-appended set's id +
 * the normalized items + provenance + createdAt.
 */
export interface GenerateThemesResult {
  eventThemeSetId: string;
  hotEventId: string;
  items: ThemeRef[];
  source: ThemeSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestThemeSet — returns the most recent EventThemeSet for an
 * event (createdAt desc, id desc tiebreaker) or null if none exist.
 * publish-orchestrator uses this at projection time.
 */
export interface GetLatestThemeSetOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * One theme-set row projected for read. Mirrors the EventThemeSet columns the
 * public projection + operator audit need (no write paths here).
 */
export interface ThemeSetRecord {
  id: string;
  hotEventId: string;
  items: ThemeRef[];
  source: ThemeSource;
  createdAt: Date;
}
