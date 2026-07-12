import type { Metadata } from "next";

import {
  getPrisma,
  listPublishedAssociations,
  listPublishedHotEvents,
  listPublishedTimeline,
  newTraceId,
  type AssociationItem,
  type PublishedTimelineEntry,
  type TimelineSessionTagType,
} from "@aguhot/core";

import { NumberedHotList } from "./_components/numbered-hot-list";
import {
  TimelineFilters,
  mergeTimelineSearchParams,
  parseTimelineFilters,
  type TimelineSearchParams,
  type TimelineSessionLiteral,
} from "./_components/timeline-filters";
import { TimelineCard } from "./_components/timeline-card";
import { DateSectionDivider } from "./_components/date-section-divider";

export const metadata: Metadata = {
  title: "首页",
};

/**
 * Public timeline feed homepage — Story 4.2 (Epic 4 时间流首页) + Story 4.3
 * (session/category filters).
 *
 * This is the Epic 4 pivot: the home body changed from the V1 priority-sorted
 * `listPublishedHotEvents` feed (Story 1.7) to a minute-level chronological
 * `时间流` reading the new `published_timeline` read model (Story 4.1, AD-3b).
 * The page now reads up to THREE published read models:
 *   - `listPublishedTimeline` (default = latest trade_date, ordered
 *     `occurredAt DESC`) → the timeline cards (minute-level dynamics).
 *     Story 4.3: now accepts `{ sessionTag }` so the session dimension (盘前 /
 *     盘中 / 盘后 / 全天) is filtered on the SERVER — it hits 4.1's
 *     `(trade_date, session_tag, occurred_at)` composite index directly.
 *   - `listPublishedHotEvents` (ordered `evidenceCount DESC + latestEvidenceAt
 *     DESC`) → the top-N `numbered-hot-list` ("当前热点", Story 6.2 — replaced
 *     the 4.2 `main-line-band`). The list reuses the existing saliency read
 *     because `published_timeline` has no saliency/pin field (it is a pure
 *     time-order projection). Two read models coexist: the numbered list
 *     answers "what is the market trading", the timeline answers "minute-level
 *     dynamics" (spec Design Notes).
 *   - `listPublishedAssociations` (Story 2.2) → ONLY read when a `?category=`
 *     filter is active. Builds a `hotEventId → Set<AssociationKind>` map in
 *     memory and filters the (already session-filtered) timeline entries. This
 *     is the 2.2 feed-filter JS-join pattern, reapplied to the timeline (spec
 *     Never: do NOT add a `category` param to `listPublishedTimeline` — same
 *     rationale as 2.2's filter-free `listPublishedHotEvents`). The Json-column
 *     sub-table normalization is a logged scale-ceiling defer.
 *
 * URL-driven filters (Story 4.3, FR-2): all filter state lives in the URL
 * (`?session=` / `?category=`) — shareable, refresh-keeps-filter, back/forward
 * works. Pills render server-side via `<TimelineFilters>`; zero client JS.
 *
 * Masthead (H1「AGUHOT」+ subtitle「可信热点发布闭环」) is preserved byte-for-
 * byte from 1.1 so `home.spec.ts` stays green. `(public)/layout.tsx` public
 * shell is unchanged.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build (unchanged
 * rationale from 1.7):
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`.
 *     This keeps the public web build DATABASE_URL-free.
 *
 * Honest states (NFR-2: never fake data):
 *   - Read model empty (no `published_timeline` rows at all) → "暂无公开展示的
 *     时间流。" empty state + the page's render time as "最近更新". No skeleton,
 *     no cards, no fabricated content. masthead still visible, no /login
 *     redirect (AD-8). The filter nav STILL renders (so the user sees the
 *     affordance even on an empty read model), but no cards can match.
 *   - Filter empty (read model has rows, but the current filter matches none) →
 *     a DISTINCT copy: "当前筛选条件下暂无时间流条目。" + a clear-filter link, and
 *     NO "最近更新" line (data exists, just filtered out — showing 最近更新
 *     would mislead the user into thinking the page is stale rather than
 *     narrowed). The spec Design Notes pins this distinction: conflating the
 *     two empty states would make users think the product has no data when it
 *     just has no matches for their filter.
 *   - `listPublishedTimeline` returns `[]` (not an error) → read-model empty
 *     state (or filter empty state, depending on whether filters are active).
 *   - `listPublishedHotEvents` empty → the band does NOT render (no fabricated
 *     "今日重点" copy). The timeline empty state is independent: either read
 *     model can be empty without affecting the other.
 *   - getPrisma throws when DATABASE_URL is missing at runtime → loud failure
 *     (the error propagates to a route error), NOT a silent empty state. DB is
 *     core infra; its absence is an incident, not graceful degradation.
 *
 * Removed (4.2): the V1 priority-feed filter UI (`FeedFilters`, the `?window=`
 * /`?concept=`/`?industry=`/`?stock=` searchParams, the association-dimension
 * in-memory join, the FollowButton-on-card follow-state read). 4.3 ships a NEW
 * self-contained `<TimelineFilters>` (it does NOT reuse `feed-filters.tsx`,
 * per spec Never: keep that file but do not import it here).
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<TimelineSearchParams>;
}

export default async function PublicHomePage({ searchParams }: PageProps) {
  // Resolve + parse the URL filter state. parseTimelineFilters whitelists the
  // values (invalid ?session=foo / ?category=bar → undefined → no filter), so
  // bad input never 500s the public route (I/O matrix). `await searchParams`
  // mirrors the daily/page.tsx async-searchParams pattern (Next.js 16).
  const params = await searchParams;
  const filters = parseTimelineFilters(params);

  // Map the session URL value to the core TimelineSessionTagType. "all" and
  // undefined both mean "no sessionTag passed" (listPublishedTimeline returns
  // every entry including non_trading). parseSessionFilter's whitelist only
  // accepts the three real-session literals or "all", so when value !== "all"
  // it is exactly one of pre_open / intraday / post_close — a subset of
  // TimelineSessionTagType (which also includes non_trading, but non_trading
  // has no independent pill per spec Never). The cast is therefore total.
  const sessionTag: TimelineSessionTagType | undefined =
    filters.session !== undefined && filters.session.value !== "all"
      ? (filters.session.value as TimelineSessionLiteral)
      : undefined;

  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing —
  // that is intentional (DB is core infra, not graceful-degradation territory).
  const prisma = getPrisma();
  const traceId = newTraceId();

  // Parallel published-read-model reads. Both are read-only (AD-3/AD-3b);
  // neither triggers a synchronous refresh or external call (AD-4). The page
  // issues them concurrently so the request latency is the max, not the sum.
  // `listPublishedTimeline({ sessionTag })` narrows server-side via the
  // composite index when a session filter is active (spec Design Notes: session
  // is the server-filtered dimension — it hits the (trade_date, session_tag,
  // occurred_at) index directly).
  const [hotEvents, timelineEntries] = await Promise.all([
    listPublishedHotEvents({ prisma, traceId }),
    listPublishedTimeline({ prisma, traceId, sessionTag }),
  ]);

  // Distinguish read-model-empty from session-filter-empty (spec Design Notes:
  // two distinct empty states). When the session-filtered query returns [], the
  // read model might still have rows for that trade_date under a DIFFERENT
  // session — that is filter-empty (distinct copy + clear link, NO 最近更新),
  // NOT read-model-empty (4.2 copy + 最近更新). The fallback read only fires
  // when a session filter is active AND the filtered query returned nothing;
  // the common case (filter returns results) never triggers it.
  let isReadModelEmpty = timelineEntries.length === 0;
  if (isReadModelEmpty && sessionTag !== undefined) {
    const unfiltered = await listPublishedTimeline({ prisma, traceId });
    isReadModelEmpty = unfiltered.length === 0;
  }

  // Category dimension: in-memory JS-join (spec Never: do NOT add a `category`
  // param to listPublishedTimeline). Only read associations + filter when a
  // category filter is active — avoids the read entirely on the default view
  // (no category filter), which is the common case.
  let filteredEntries = timelineEntries;
  if (filters.category !== undefined && !isReadModelEmpty) {
    const kind = filters.category.value;
    const associations = await listPublishedAssociations({ prisma, traceId });
    // Build hotEventId → Set<AssociationItem.kind> so one lookup per timeline
    // entry decides membership. listPublishedAssociations is filter-free (2.2
    // design); the web layer applies the dimension filter here.
    const kindsByHotEvent = new Map<string, Set<AssociationItem["kind"]>>();
    for (const row of associations) {
      let set = kindsByHotEvent.get(row.hotEventId);
      if (set === undefined) {
        set = new Set();
        kindsByHotEvent.set(row.hotEventId, set);
      }
      for (const item of row.items) {
        set.add(item.kind);
      }
    }
    filteredEntries = timelineEntries.filter((entry) => {
      const set = kindsByHotEvent.get(entry.hotEventId);
      return set !== undefined && set.has(kind);
    });
  }

  // Two empty-state branches (spec Design Notes):
  //   - read-model empty (NO rows at all, regardless of filters) → 4.2 copy +
  //     最近更新. Filters render but cannot match anything.
  //   - filter empty (rows exist but the current filter excludes them all) →
  //     distinct copy + clear-filter link, NO 最近更新.
  const isFilterEmpty =
    !isReadModelEmpty &&
    filteredEntries.length === 0 &&
    (filters.session !== undefined || filters.category !== undefined);

  const now = new Date();

  // Group the (session/category-filtered) timeline entries by tradeDate for
  // the editorial date-section layout (UX-DR4b / UX-DR16, Story 6.3).
  // filteredEntries is already ordered latest-tradeDate-first + occurredAt DESC
  // within a date (listPublishedTimeline contract), so a Map preserves the
  // correct group order on insertion. Each group renders a DateSectionDivider
  // + a <ul> of TimelineCard entries. Single-date (the common case —
  // listPublishedTimeline defaults to the latest trade_date) renders one
  // divider; multi-date (future filter span) renders one per date.
  const timelineGroups = new Map<string, PublishedTimelineEntry[]>();
  for (const entry of filteredEntries) {
    let arr = timelineGroups.get(entry.tradeDate);
    if (arr === undefined) {
      arr = [];
      timelineGroups.set(entry.tradeDate, arr);
    }
    arr.push(entry);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/*
        Masthead — preserved byte-for-byte from 1.1 so home.spec.ts stays green
        (it asserts H1「AGUHOT」+「可信热点发布闭环」subtitle). The (public)/layout.tsx
        public shell is unchanged.
      */}
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">AGUHOT</h1>
        <p className="text-lg text-ink-secondary">可信热点发布闭环</p>
      </header>

      {/*
        Main-line band — "今日重点 / 市场主线". Rendered ONLY when the hot-events
        read model has data; the band component itself also guards against an
        empty list (defensive — NFR-2: no fabricated copy). Sits above the
        timeline + filters so the home proactively answers "what is the market
        trading" before the minute-level scan. The band is NEVER filtered by
        the session/category dimensions (spec Never: band is saliency
        projection, independent of timeline filters, always full top-N).
      */}
      {/*
        Numbered「当前热点」ranking — Story 6.2 (replaces the 4.2 MainLineBand
        card-band). Renders its own <section class="mt-8"> + returns null when
        hot-events is empty (NFR-2: no fabricated copy). Reuses the existing
        listPublishedHotEvents saliency read — no new read model/field.
      */}
      <NumberedHotList events={hotEvents} now={now} />

      {/*
        Filter nav — Story 4.3. Renders on EVERY render (empty or populated read
        model) so the filter affordance is always visible (spec: even on an
        empty read model the nav renders, just with no matches to filter).
        `aria-label="时间流筛选"` (NOT 「筛选」) keeps the 4.2 e2e assertion
        `nav[aria-label='筛选']` count = 0 green (the V1 FeedFilters was removed
        in 4.2; this new nav has a distinguishing semantic for screen readers).
      */}
      <section className="mt-8">
        <TimelineFilters
          session={filters.session}
          category={filters.category}
          searchParams={params}
        />
      </section>

      {/*
        Timeline feed — the minute-level chronological list. Each entry renders
        as a TimelineCard (fixed reading order, fold disclosure, AI 解读 slot
        only when non-null). Two empty-state branches below handle the no-data
        cases; the populated list renders only when filteredEntries is non-empty.

        Empty-state split (spec Design Notes):
          - read-model empty (no rows at all, regardless of filters) → the 4.2
            copy "暂无公开展示的时间流。" + 最近更新. Filters render above but
            cannot match anything.
          - filter empty (rows exist but the current filter excludes them all)
            → distinct copy "当前筛选条件下暂无时间流条目。" + a clear-filter
            link, NO 最近更新 (data exists, just narrowed too far; citing a
            render time would imply staleness rather than narrowness).
      */}
      <section className="mt-6" aria-label="时间流">
        {filteredEntries.length > 0 ? (
          <div>
            {Array.from(timelineGroups.entries()).map(([tradeDate, entries]) => (
              <section key={tradeDate} aria-label={tradeDate}>
                <DateSectionDivider tradeDate={tradeDate} />
                <ul role="list">
                  {entries.map((entry: PublishedTimelineEntry) => (
                    <TimelineCard key={entry.id} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : isFilterEmpty ? (
          <div className="space-y-3">
            <p className="text-ink-secondary">当前筛选条件下暂无时间流条目。</p>
            <a
              href={mergeTimelineSearchParams(params, {}, ["session", "category"])}
              className="inline-flex items-center min-h-11 text-sm text-brand hover:underline"
            >
              清除筛选
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-ink-secondary">暂无公开展示的时间流。</p>
            {/*
              Last-updated time — NFR-2: the empty state shows an explicit "最近
              更新" time so the reader knows the page is live, not broken. Uses
              the page's render time (now) since an empty read model has no row-
              level timestamp to cite; this is the honest "this page was last
              rendered at" anchor, not a fabricated content timestamp.
            */}
            <p className="font-mono text-xs text-ink-tertiary">最近更新：{formatDateTime(now)}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Locale-stable UTC format (mirrors event-card.tsx / timeline-card.tsx). Avoids
 * locale-dependent toLocaleString so the timestamp stays consistent across
 * build-time TZ and runtime TZ. YYYY-MM-DD HH:mm UTC is enough for the empty-
 * state "最近更新" line.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
