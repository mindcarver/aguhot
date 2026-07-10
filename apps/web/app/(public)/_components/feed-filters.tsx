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

export function FeedFilters({ window }: { window: FeedWindow }) {
  return (
    <nav aria-label="时间窗口筛选" className="flex flex-wrap items-center gap-2">
      {FEED_WINDOWS.map((w) => (
        <FilterPill
          key={w.value}
          href={`?window=${w.value}`}
          active={window === w.value}
        >
          {w.label}
        </FilterPill>
      ))}
    </nav>
  );
}
