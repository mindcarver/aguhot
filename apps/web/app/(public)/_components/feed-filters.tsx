import { FilterPill } from "@/components/chips";

/**
 * Date-window filter pills for the public feed — Story 1.7. Server component.
 *
 * URL-driven: each pill is a `<Link href="?window=…">` so the filter state lives
 * in the URL (server-rendered, shareable, back/forward works, refresh keeps the
 * filter, zero client JS / useState). This is the native-platform (URL/query
 * string) approach over a client-side filter store.
 *
 * The "全部" pill (window=all) is the clear control — it is ALWAYS visible (epic:
 * active filters are always visible and clearable without losing reading context).
 * The current window pill gets the brand active state; the rest are default.
 *
 * Does not import @aguhot/core (pure URL rendering). Uses real @theme tokens via
 * FilterPill (bg-brand / bg-surface-base / text-ink-secondary / rounded-full).
 */

export type FeedWindow = "today" | "7d" | "30d" | "all";

// --- Story 2.2: association-dimension filter ---------------------------------

/**
 * The three association dimensions the feed honors via URL searchParams
 * (`?concept=|?industry=|?stock=`). Each links to a filtered feed view — the
 * V1 click-through destination for a detail-page association item (AC1).
 */
export const ASSOCIATION_KINDS = ["concept", "industry", "stock"] as const;

export type AssociationFilterKind = (typeof ASSOCIATION_KINDS)[number];

/**
 * A resolved association-dimension filter: {kind, label}. At most one dimension
 * is active at a time (V1 single-dimension, per spec Never: no explicit
 * "clear all" control for multi-dimension). Null when no association dimension
 * is in the URL (zero-regression with 1.7 behavior).
 */
export interface AssociationFilter {
  kind: AssociationFilterKind;
  label: string;
}

/**
 * The Chinese label for each association kind, used in the active-filter pill
 * and the clear-link href.
 */
const ASSOCIATION_KIND_LABEL: Record<AssociationFilterKind, string> = {
  concept: "概念",
  industry: "行业",
  stock: "个股",
};

/**
 * Parse the association-dimension searchParams into a single active filter (or
 * null). V1 honors exactly one dimension (the first present, in ASSOCIATION_KINDS
 * order); a multi-dimension URL collapses to one. An empty label value is
 * ignored (treated as no filter). Kept here so the page and the filter component
 * share one authority on valid association dimensions.
 */
export function parseAssociationFilter(params: {
  concept?: string;
  industry?: string;
  stock?: string;
}): AssociationFilter | null {
  for (const kind of ASSOCIATION_KINDS) {
    const raw = params[kind];
    if (raw !== undefined && raw.trim() !== "") {
      return { kind, label: raw };
    }
  }
  return null;
}

/**
 * The authoritative window list + labels. Order is display order. "all" is last
 * so the clear control sits at the end of the row (and is the default).
 */
export const FEED_WINDOWS: ReadonlyArray<{ value: FeedWindow; label: string }> = [
  { value: "today", label: "今日" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
  { value: "all", label: "全部" },
] as const;

export const DEFAULT_WINDOW: FeedWindow = "all";

/**
 * Parse an arbitrary searchParams string into a known FeedWindow, falling back
 * to "all" for unknown/missing values. Kept here so the page and the filter
 * component share one authority on valid windows.
 */
export function parseFeedWindow(raw: string | undefined): FeedWindow {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "all") {
    return raw;
  }
  return DEFAULT_WINDOW;
}

/**
 * Build the href that clears the association dimension while preserving the
 * current window. Used by the active association pill (clear control).
 */
function buildClearAssociationHref(window: FeedWindow): string {
  return window === "all" ? "/?window=all" : `/?window=${window}`;
}

export function FeedFilters({
  window,
  association = null,
}: {
  window: FeedWindow;
  association?: AssociationFilter | null;
}) {
  return (
    <nav aria-label="筛选" className="flex flex-wrap items-center gap-2">
      {FEED_WINDOWS.map((w) => (
        <FilterPill
          key={w.value}
          href={`?window=${w.value}`}
          active={window === w.value}
        >
          {w.label}
        </FilterPill>
      ))}
      {/* Story 2.2: the active association dimension renders as a clearable
          FilterPill (active state). Its href clears the association dimension
          while preserving the current window (return to the window-filtered
          feed, no reading-context loss — UX-DR12). Only one association
          dimension is active at a time in V1. */}
      {association !== null ? (
        <FilterPill
          active
          href={buildClearAssociationHref(window)}
        >
          {ASSOCIATION_KIND_LABEL[association.kind]}：{association.label}
        </FilterPill>
      ) : null}
    </nav>
  );
}
