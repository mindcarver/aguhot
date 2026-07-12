import { FilterPill } from "@/components/chips";

/**
 * Session + category filter pills for the public timeline feed — Story 4.3
 * (Epic 4 时间流首页).
 *
 * URL-driven server component (zero client JS / no useState). Each pill is a
 * `<Link href="?session=…">` / `<Link href="?category=…">` so filter state lives
 * entirely in the URL: shareable, refresh-keeps-filter, back/forward works
 * (FR-2). This mirrors the 1.7 FeedFilters native-platform (URL/query string)
 * approach — the home page is `force-dynamic` and reads `searchParams` at
 * request time, so pills render in whatever active state the URL dictates.
 *
 * Two orthogonal dimensions coexist without clobbering each other:
 *   - `?session=` (盘前 / 盘中 / 盘后 / 全天) — SERVER-side filter, passed
 *     straight through to `listPublishedTimeline({ sessionTag })` (hits the
 *     `(trade_date, session_tag, occurred_at)` composite index built in 4.1).
 *     「全天」is the clear control (no `sessionTag` passed → includes
 *     `non_trading`). It is ALWAYS visible so the active session is always
 *     clearable.
 *   - `?category=` (概念 / 行业 / 个股) — IN-MEMORY JS-join filter, reusing the
 *     Story 2.2 feed-filter pattern: `listPublishedAssociations` → build
 *     `hotEventId → Set<AssociationKind>` → filter the already-session-filtered
 *     timeline entries in memory. The spec Never forbids adding a `category`
 *     param to `listPublishedTimeline` (same rationale as 2.2's filter-free
 *     `listPublishedHotEvents`): it would split "no association at all" vs
 *     "dimension has no matches" across two SQL reads. V1 scale is tiny; the
 *     Json-column sub-table normalization is a logged scale-ceiling defer.
 *
 * `aria-label="时间流筛选"` is deliberate (spec Always): 4.2's e2e pins
 * `nav[aria-label='筛选']` count = 0 (the V1 FeedFilters was removed). Reusing
 * 「筛选」would collide; 「时间流筛选」keeps that assertion green and gives screen
 * readers a distinguishing semantic.
 *
 * Invalid values (`?session=foo`, `?category=bar`) are silently ignored by the
 * whitelist parsers below — they fall back to the default (no filter), never
 * 500. Repeated keys (`?session=a&session=b`) collapse to the first via
 * `firstString` (Next.js delivers arrays for repeated keys; calling `.trim()`
 * on an array throws TypeError, which would 500 the public nav).
 *
 * Does NOT import `@aguhot/core` — this file is pure URL rendering. The page
 * parses searchParams (via the exported `parseTimelineFilters`) and passes the
 * resolved state down as props; this component only builds hrefs.
 */

// --- session dimension (server-filtered via listPublishedTimeline) -----------

/**
 * The session values the home honors, in display order. 「全天」(all-day) is the
 * clear control and sits last so the always-visible clear path is at the end of
 * the row — mirroring the 1.7 `FEED_WINDOWS` layout where 「全部」is last.
 *
 * `value` is the URL token (matches the `TimelineSessionTag` union for the
 * three real sessions; 「全天」has no URL token — its href clears `?session=`
 * while preserving any sibling `?category=`). `tag` is the core
 * `TimelineSessionTagType` this value maps to on the server, or `undefined` for
 * 「全天」(no sessionTag passed → listPublishedTimeline returns every entry
 * including non_trading).
 *
 * Kept in sync with core's `TimelineSessionTag` value object by the
 * `SessionFilter` union below (whitelist parser rejects anything else).
 */
const TIMELINE_SESSION_PRE_OPEN = "pre_open";
const TIMELINE_SESSION_INTRADAY = "intraday";
const TIMELINE_SESSION_POST_CLOSE = "post_close";

export const TIMELINE_SESSIONS: ReadonlyArray<{
  value: SessionUrlValue;
  label: string;
  tag: TimelineSessionLiteral | undefined;
}> = [
  { value: TIMELINE_SESSION_PRE_OPEN, label: "盘前", tag: TIMELINE_SESSION_PRE_OPEN },
  { value: TIMELINE_SESSION_INTRADAY, label: "盘中", tag: TIMELINE_SESSION_INTRADAY },
  { value: TIMELINE_SESSION_POST_CLOSE, label: "盘后", tag: TIMELINE_SESSION_POST_CLOSE },
  { value: "all", label: "全天", tag: undefined },
] as const;

/**
 * The URL values the session dimension owns (the three real sessions + the
 * clear control). 「全天」lives in the URL as `?session=all`; the page's parser
 * maps it back to "no sessionTag" before calling listPublishedTimeline.
 */
type SessionUrlValue = "pre_open" | "intraday" | "post_close" | "all";

/**
 * The three real `TimelineSessionTag` literals that have a server-side filter
 * (non_trading has no independent pill — it appears only under 「全天」with no
 * standalone toggle, per spec Never: defensible because non_trading is not a
 * trading session users seek out). Exported so the page can cast a parsed
 * session value to the core `TimelineSessionTagType` it passes to
 * `listPublishedTimeline` (the cast is total: the whitelist parser only
 * accepts these three literals or "all").
 */
export type TimelineSessionLiteral = "pre_open" | "intraday" | "post_close";

/**
 * The resolved session filter: the URL value (or undefined when `?session=` is
 * absent / invalid / "all"). The page reads this and maps `value` → the core
 * `TimelineSessionTagType` it passes to `listPublishedTimeline`.
 */
export interface SessionFilter {
  value: SessionUrlValue;
}

// --- category dimension (in-memory JS-join via listPublishedAssociations) ---

/**
 * The category values the home honors, in display order. There is no 「全部类
 * 别」clear pill — instead the active category pill itself flips to a clear href
 * (its own label, but pointing at the URL with `?category=` dropped). This
 * matches 4.2's "clear path always visible" (FR-2) without adding a redundant
 * always-present pill. When no category is active, none of these pills render
 * active — they are all default-state links that set `?category=<value>`.
 *
 * `value` is the URL token AND the `AssociationItem.kind` literal (concept /
 * industry / stock — the canonical kinds core stores). The whitelist parser
 * rejects anything else.
 */
const TIMELINE_CATEGORY_CONCEPT = "concept";
const TIMELINE_CATEGORY_INDUSTRY = "industry";
const TIMELINE_CATEGORY_STOCK = "stock";

export const TIMELINE_CATEGORIES: ReadonlyArray<{
  value: CategoryUrlValue;
  label: string;
}> = [
  { value: TIMELINE_CATEGORY_CONCEPT, label: "概念" },
  { value: TIMELINE_CATEGORY_INDUSTRY, label: "行业" },
  { value: TIMELINE_CATEGORY_STOCK, label: "个股" },
] as const;

/**
 * The URL values the category dimension owns. These ARE the
 * `AssociationItem["kind"]` literals — the page reads the resolved value and
 * matches it against the in-memory `hotEventId → Set<kind>` map built from
 * `listPublishedAssociations`.
 */
export type CategoryUrlValue = "concept" | "industry" | "stock";

/**
 * The resolved category filter, or null when no category dimension is active.
 */
export interface CategoryFilter {
  value: CategoryUrlValue;
}

// --- searchParams boundary helpers (timeline-specific) ----------------------

/**
 * The raw shape of the homepage searchParams this module owns. Matches
 * PageProps.searchParams (resolved) in page.tsx so the filter pills can preserve
 * the sibling key (session↔category) when changing one — bare `?session=…`
 * concatenation would drop an active `?category=`, and vice versa.
 *
 * Values are `string | string[] | undefined` because Next.js searchParams
 * deliver arrays for repeated keys (e.g. `?session=a&session=b`). Callers that
 * touch `.trim()` must route through `firstString` first.
 */
export interface TimelineSearchParams {
  session?: string | string[];
  category?: string | string[];
}

/**
 * Normalize a Next.js searchParams value to a single string (or undefined).
 * Next.js hands searchParams values as `string | string[] | undefined` — a URL
 * like `?session=a&session=b` produces `string[]`. Calling `.trim()` on an
 * array throws TypeError, which would 500 the public timeline nav. This
 * collapses arrays to their first element before any string method is called,
 * at the boundary where searchParams enter this module. Pure + total. Mirrors
 * the feed-filters `firstString` (kept local — spec Never: this story does NOT
 * reuse feed-filters.tsx; it ships a self-contained new component).
 */
export function firstString(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Merge a partial searchParams update into the current params and return a
 * pathname-relative href string (`?a=1&b=2`, or `/` when empty). Used by the
 * filter pills so a session change never clobbers a sibling category key, and a
 * category change never clobbers the session. This is the querystring-merge fix
 * for the same review finding that hit 1.7 FeedFilters (C2) — bare
 * `?session=…` / `?category=…` concatenation would drop any other active
 * filter.
 *
 * `updates`/`deletes` accept only the keys this component owns (session +
 * category). The merge order is deterministic (TIMELINE_QUERY_KEYS) so URLs
 * stay stable across renders.
 */
const TIMELINE_QUERY_KEYS = ["session", "category"] as const;
type TimelineQueryKey = (typeof TIMELINE_QUERY_KEYS)[number];

export function mergeTimelineSearchParams(
  current: TimelineSearchParams,
  updates: Partial<Record<TimelineQueryKey, string>> = {},
  deletes: TimelineQueryKey[] = [],
): string {
  const next = new Map<string, string>();
  for (const key of TIMELINE_QUERY_KEYS) {
    // Normalize at the boundary: searchParams values may be string[] for a
    // repeated key; firstString collapses to the first element before trim.
    const raw = firstString(current[key]);
    if (raw !== undefined && raw.trim() !== "") {
      next.set(key, raw);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value.trim() !== "") {
      next.set(key, value);
    }
  }
  for (const key of deletes) {
    next.delete(key);
  }
  if (next.size === 0) return "/";
  const pairs: string[] = [];
  for (const key of TIMELINE_QUERY_KEYS) {
    const value = next.get(key);
    if (value !== undefined) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return `?${pairs.join("&")}`;
}

// --- whitelist parsers (invalid value → no filter, never 500) ---------------

/**
 * Parse the raw `?session=` searchParams value into a known SessionFilter, or
 * undefined when the value is absent / invalid / "all". Invalid values
 * (`?session=foo`) silently fall back to "no session filter" (the page does not
 * pass sessionTag → listPublishedTimeline returns every entry) — this is the
 * I/O matrix's "非法 session 值 → 忽略 → 视同「全天」" row. NEVER throws / 500s.
 *
 * "all" is the explicit clear token: it means the user clicked 「全天」, so the
 * filter is conceptually active (the 「全天」pill renders in brand active state)
 * but maps to no server-side sessionTag. We still return a SessionFilter so the
 * pill can render active — `value: "all"` is the signal.
 */
export function parseSessionFilter(params: {
  session?: string | string[];
}): SessionFilter | undefined {
  const raw = firstString(params.session);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  for (const s of TIMELINE_SESSIONS) {
    if (s.value === trimmed) {
      return { value: s.value };
    }
  }
  // Unknown value — ignore, fall back to default (no filter). Do NOT echo the
  // garbage back into the URL; the pills render against the canonical values.
  return undefined;
}

/**
 * Parse the raw `?category=` searchParams value into a known CategoryFilter, or
 * undefined when the value is absent / invalid. Invalid values (`?category=foo`)
 * silently fall back to "no category filter" — I/O matrix's "非法 category 值 →
 * 忽略 → 视同无 category 筛选" row. NEVER throws / 500s.
 */
export function parseCategoryFilter(params: {
  category?: string | string[];
}): CategoryFilter | undefined {
  const raw = firstString(params.category);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  for (const c of TIMELINE_CATEGORIES) {
    if (c.value === trimmed) {
      return { value: c.value };
    }
  }
  return undefined;
}

/**
 * Convenience: parse both dimensions at once. The page calls this on its
 * resolved searchParams to get the full filter state in one shot.
 */
export interface TimelineFilterState {
  session: SessionFilter | undefined;
  category: CategoryFilter | undefined;
}

export function parseTimelineFilters(params: TimelineSearchParams): TimelineFilterState {
  return {
    session: parseSessionFilter(params),
    category: parseCategoryFilter(params),
  };
}

// --- component --------------------------------------------------------------

/**
 * Render the session + category filter nav. Pure URL rendering — the page has
 * already parsed the filter state and passes it down as props. Each pill builds
 * its href via `mergeTimelineSearchParams` so toggling one dimension preserves
 * the other (session↔category never clobber).
 */
export interface TimelineFiltersProps {
  session: SessionFilter | undefined;
  category: CategoryFilter | undefined;
  /**
   * The resolved homepage searchParams, forwarded by the page so filter pills
   * can merge their own key into the existing querystring instead of clobbering
   * the sibling key. Optional (defaults to empty) for callers that don't care
   * about sibling keys.
   */
  searchParams?: TimelineSearchParams;
}

export function TimelineFilters({
  session,
  category,
  searchParams = {},
}: TimelineFiltersProps) {
  return (
    <nav aria-label="时间流筛选" className="flex flex-wrap items-center gap-2">
      {/*
        Session pills (盘前 / 盘中 / 盘后 / 全天). 「全天」is the clear control —
        its href drops `?session=` (preserving any active `?category=`). The
        current session pill renders active (brand state); the active 「全天」
        also renders active so the user sees the "no session filter" state
        explicitly.
      */}
      {TIMELINE_SESSIONS.map((s) => {
        const isActive = session?.value === s.value;
        // 「全天」(value "all", tag undefined) clears the session key; the three
        // real sessions set it. mergeTimelineSearchParams preserves any sibling
        // ?category= so the two dimensions don't clobber each other.
        const href =
          s.tag === undefined
            ? mergeTimelineSearchParams(searchParams, {}, ["session"])
            : mergeTimelineSearchParams(searchParams, { session: s.value });
        return (
          <FilterPill key={s.value} href={href} active={isActive}>
            {s.label}
          </FilterPill>
        );
      })}

      {/*
        Category pills (概念 / 行业 / 个股). When a category is active, ITS OWN
        pill flips to a clear href (drops ?category=, preserves ?session=) —
        this is the always-visible clear path (FR-2). When no category is
        active, each pill is a default-state link that sets ?category=<value>.
        There is no redundant 「全部类别」pill; the active pill IS the clear
        control, and inactive pills never need clearing.
      */}
      {TIMELINE_CATEGORIES.map((c) => {
        const isActive = category?.value === c.value;
        const href = isActive
          ? mergeTimelineSearchParams(searchParams, {}, ["category"])
          : mergeTimelineSearchParams(searchParams, { category: c.value });
        return (
          <FilterPill key={c.value} href={href} active={isActive}>
            {c.label}
          </FilterPill>
        );
      })}
    </nav>
  );
}
