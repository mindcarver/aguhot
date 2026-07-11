import type { Metadata } from "next";

import {
  getPrisma,
  listPublishedHotEvents,
  listPublishedTimeline,
  newTraceId,
  type PublishedTimelineEntry,
} from "@aguhot/core";

import { MainLineBand } from "./_components/main-line-band";
import { TimelineCard } from "./_components/timeline-card";

export const metadata: Metadata = {
  title: "首页",
};

/**
 * Public timeline feed homepage — Story 4.2 (Epic 4 时间流首页).
 *
 * This is the Epic 4 pivot: the home body changed from the V1 priority-sorted
 * `listPublishedHotEvents` feed (Story 1.7) to a minute-level chronological
 * `时间流` reading the new `published_timeline` read model (Story 4.1, AD-3b).
 * The page now reads TWO published read models:
 *   - `listPublishedTimeline` (default = latest trade_date, ordered
 *     `occurredAt DESC`) → the timeline cards (minute-level dynamics).
 *   - `listPublishedHotEvents` (ordered `evidenceCount DESC + latestEvidenceAt
 *     DESC`) → the top-N `main-line-band` ("今日重点 / 市场主线"). The band
 *     reuses the existing saliency read because `published_timeline` has no
 *     saliency/pin field (it is a pure time-order projection). Two read models
 *     coexist: the band answers "what is the market trading", the timeline
 *     answers "minute-level dynamics" (spec Design Notes).
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
 *   - `published_timeline` empty (no rows at all) → "暂无公开展示的时间流" empty
 *     state + the page's render time as "最近更新". No skeleton, no cards, no
 *     fabricated content. masthead still visible, no /login redirect (AD-8).
 *   - `listPublishedTimeline` returns `[]` (not an error) → same empty state.
 *   - `listPublishedHotEvents` empty → the band does NOT render (no fabricated
 *     "今日重点" copy). The timeline empty state is independent: either read
 *     model can be empty without affecting the other.
 *   - getPrisma throws when DATABASE_URL is missing at runtime → loud failure
 *     (the error propagates to a route error), NOT a silent empty state. DB is
 *     core infra; its absence is an incident, not graceful degradation.
 *
 * Removed (4.2): the V1 priority-feed filter UI (`FeedFilters`, the `?window=`
 * /`?concept=`/`?industry=`/`?stock=` searchParams, the association-dimension
 * in-memory join, the FollowButton-on-card follow-state read). Per spec Code
 * Map: the home no longer imports `FeedFilters` (4.3 will own the new session/
 * category filter UI; the file is kept for 4.3 to possibly reuse, per spec
 * Never: do not delete feed-filters.tsx). The timeline card has no follow-on-
 * card in 4.2 scope; follow remains on the detail page.
 */
export const dynamic = "force-dynamic";

export default async function PublicHomePage() {
  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing —
  // that is intentional (DB is core infra, not graceful-degradation territory).
  const prisma = getPrisma();
  const traceId = newTraceId();

  // Two parallel published-read-model reads. Both are read-only (AD-3/AD-3b);
  // neither triggers a synchronous refresh or external call (AD-4). The page
  // issues them concurrently so the request latency is the max, not the sum.
  const [hotEvents, timelineEntries] = await Promise.all([
    listPublishedHotEvents({ prisma, traceId }),
    listPublishedTimeline({ prisma, traceId }),
  ]);

  const now = new Date();

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
        timeline so the home proactively answers "what is the market trading"
        before the minute-level scan.
      */}
      {hotEvents.length > 0 ? (
        <section className="mt-8">
          <MainLineBand events={hotEvents} now={now} />
        </section>
      ) : null}

      {/*
        Timeline feed — the minute-level chronological list. Each entry renders
        as a TimelineCard (fixed reading order, fold disclosure, AI 解读 slot
        only when non-null). The list is rendered ONLY when the timeline read
        model has entries; the empty state below handles the no-data case.
      */}
      <section className="mt-8" aria-label="时间流">
        {timelineEntries.length > 0 ? (
          <ul role="list" className="space-y-3">
            {timelineEntries.map((entry: PublishedTimelineEntry) => (
              <TimelineCard key={entry.id} entry={entry} />
            ))}
          </ul>
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
            <p className="font-mono text-xs text-ink-tertiary">
              最近更新：{formatDateTime(now)}
            </p>
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
