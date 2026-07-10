/**
 * theme-service — derive theme memberships from an adapter's output and append
 * an EventThemeSet row (AD-2/AD-5 append-only).
 *
 * Story 2.3. This module owns the event_theme_sets table (AD-2 append-only). It
 * derives ThemeRef[] memberships from a ThemeAdapter's output, each item
 * carrying a slug (URL identity), a label (display identity), and a NON-EMPTY
 * mappingBasis (provenance — AC2).
 *
 *   - generateThemes: read the adapter → validate each item's mappingBasis/
 *     slug/label is non-empty (throw on any missing field — AC2 fail-fast, never
 *     silently fill a default) → normalize (dedup by slug, preserve order) →
 *     APPEND one EventThemeSet (never update/delete prior rows — AD-5). Returns
 *     null when adapter is missing, returns null, or returns an empty array (no
 *     honest derivation possible; never writes a fabricated set).
 *     source="template" in V1.
 *   - getLatestThemeSet: createdAt desc + id desc first row, or null.
 *     publish-orchestrator reads this at projection time.
 *   - normalizeThemeItems: pure function (items → deduped items), testable
 *     without a DB. Same input → identical output (deterministic).
 *
 * This module never writes published_* (publish-orchestrator owns those
 * projections) and never writes hot_events (event-assembly owns those). It only
 * appends event_theme_sets.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed
 * scripts can call it directly without Redis — same convention as
 * generateAssociations / generateMarketReaction / generateExplanation /
 * clusterEvents. The theme-backfill worker calls this with adapter = undefined
 * in V1 prod (procurement deferred) → honest degradation.
 */

import type { Prisma } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { ThemeSource } from "./types.js";
import type {
  GenerateThemesOptions,
  GenerateThemesResult,
  GetLatestThemeSetOptions,
  ThemeRef,
  ThemeSetRecord,
} from "./types.js";

/**
 * Generate theme memberships from the adapter's output, then APPEND one
 * EventThemeSet row (source="template"). Returns null and writes nothing when:
 *   - adapter is undefined (V1 prod: theme-backfill worker resolves none), OR
 *   - adapter.fetchThemes returns null, OR
 *   - adapter.fetchThemes returns an empty array (no themes).
 *
 * Honest degradation (NFR: never fake data): no adapter / no data → no set →
 * the public detail page shows the "暂无已确认的主题关联。" degraded state
 * (AC3). Never fabricates a set from nothing.
 *
 * AC2 explicit mapping basis + identity: every adapter-returned item MUST have
 * a non-empty mappingBasis AND a non-empty slug AND a non-empty label. An item
 * missing any field is rejected — generateThemes THROWS (fail-fast). It never
 * silently fills a default, because that would make AC2's "explicit basis"
 * requirement decorative (any source, including future hand-filled, could
 * produce basis-less / identity-less themes).
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are
 * never updated or deleted — the full set history is the version series.
 * publish-orchestrator projects the LATEST row (createdAt desc, id desc
 * tiebreaker) into the public read model.
 *
 * NFR: the item labels describe theme concept identity only (e.g. "芯片供应链")
 * and NEVER contain buy/sell/target-price/position wording (explanatory, not
 * advisory).
 */
export async function generateThemes(
  options: GenerateThemesOptions,
): Promise<GenerateThemesResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // No adapter → honest degradation (V1 prod: theme-backfill worker resolves
  // none). Never fabricate.
  if (adapter === undefined) return null;

  const rawItems = await adapter.fetchThemes({ hotEventId });
  if (rawItems === null) return null;
  if (rawItems.length === 0) return null;

  // AC2: validate every item has non-empty mappingBasis + slug + label. Throw
  // on any missing field rather than silently filling a default (fail-fast).
  const normalized = normalizeThemeItems(rawItems);
  if (normalized.length === 0) return null;

  // APPEND a new set row (source="template"). Never update or delete prior
  // rows (AD-5). The items Json column accepts the typed array via a cast to
  // Prisma.InputJsonValue (Prisma's Json envelope does not infer the element
  // type; the cast is the documented boundary between TS types and the Json
  // column — same role as in association-service.ts).
  const created = await prisma.eventThemeSet.create({
    data: {
      id: newTraceId(),
      hotEventId,
      items: normalized as unknown as Prisma.InputJsonValue,
      source: ThemeSource.Template,
      traceId,
    },
    select: {
      id: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  return {
    eventThemeSetId: created.id,
    hotEventId,
    items: created.items as unknown as ThemeRef[],
    source: created.source as ThemeSource,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest EventThemeSet for an event (createdAt desc, id desc
 * tiebreaker — UUIDv7 ids embed a monotonic timestamp so two sets sharing the
 * same createdAt millisecond resolve deterministically to the newer one), or
 * null if none exist. publish-orchestrator uses this at projection time to
 * surface the current set into the public read model.
 */
export async function getLatestThemeSet(
  options: GetLatestThemeSetOptions,
): Promise<ThemeSetRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.eventThemeSet.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    hotEventId: latest.hotEventId,
    items: latest.items as unknown as ThemeRef[],
    source: latest.source as ThemeSource,
    createdAt: latest.createdAt,
  };
}

// --- deterministic normalization --------------------------------------------

/**
 * Normalize the adapter's raw items into the stored form:
 *   - validate each item has NON-EMPTY mappingBasis + slug + label (AC2). An
 *     item missing any field THROWS (fail-fast, never silently filled). This is
 *     the AC2 data-level enforcement.
 *   - dedup by slug, preserving first-seen order so re-projection is
 *     deterministic across runs (multiple events sharing the same slug is the
 *     intended continuity-substrate behavior — they aggregate on the theme
 *     page; within one event's set, slug is unique).
 *
 * Pure function: same input → identical output. No clocks, no randomness.
 */
export function normalizeThemeItems(rawItems: ThemeRef[]): ThemeRef[] {
  const seen = new Set<string>();
  const out: ThemeRef[] = [];
  for (const item of rawItems) {
    // AC2 hard gate: every item must carry non-empty mappingBasis + slug +
    // label. Throw on any missing/empty field — never silently fill a default.
    if (
      item.mappingBasis === undefined ||
      item.mappingBasis === null ||
      item.mappingBasis.trim() === ""
    ) {
      throw new Error(
        `[theme-linking] adapter returned a theme item without a mappingBasis (slug=${item.slug}, label=${item.label}); AC2 requires an explicit mapping basis on every item`,
      );
    }
    if (item.slug === undefined || item.slug === null || item.slug.trim() === "") {
      throw new Error(
        `[theme-linking] adapter returned a theme item without a slug (label=${item.label}); AC2 requires a non-empty slug (URL identity) on every item`,
      );
    }
    // AC2 fail-fast: the slug is the /topics/{slug} URL segment, so it MUST be
    // URL-safe kebab-case ASCII (no '/', '?', '#', or whitespace, which would
    // break the route). Throw rather than silently URL-encoding — an adapter
    // emitting an unsafe slug is a contract violation worth surfacing.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug)) {
      throw new Error(
        `[theme-linking] adapter returned a theme item with a non-URL-safe slug (slug=${item.slug}, label=${item.label}); AC2 requires kebab-case ASCII slugs (pattern ^[a-z0-9]+(-[a-z0-9]+)*$) so /topics/{slug} resolves`,
      );
    }
    if (item.label === undefined || item.label === null || item.label.trim() === "") {
      throw new Error(
        `[theme-linking] adapter returned a theme item without a label (slug=${item.slug}); AC2 requires a non-empty label on every item`,
      );
    }
    const key = item.slug;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      slug: item.slug,
      label: item.label,
      mappingBasis: item.mappingBasis,
    });
  }
  return out;
}
