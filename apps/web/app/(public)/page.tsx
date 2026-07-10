import type { Metadata } from "next";
import Link from "next/link";

import { getPrisma, listPublishedHotEvents, newTraceId } from "@aguhot/core";

import { EventCard } from "./_components/event-card";
import { FeedFilters, parseFeedWindow, type FeedWindow } from "./_components/feed-filters";

export const metadata: Metadata = {
  title: "首页",
};

/**
 * Public hot-event feed homepage — Story 1.7.
 *
 * This is the first public route to READ the published_hot_events read model
 * (AD-3: public reads only published_* read models). It is the public
 * consumption half of the "viewable + trustworthy" loop that 1.6's publish gate
 * made possible.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`.
 *     This keeps the public web build DATABASE_URL-free — the same mechanism the
 *     (operator)/console route uses. The (public)/layout.tsx and /daily /topics
 *     /favorites /design routes stay static (they never import core), so only
 *     this one route is dynamic.
 *
 * Why URL-driven filtering:
 *   - The date window (?window=today|7d|30d|all, default all) is read from
 *     searchParams (a Promise in Next 16) and rendered via `<Link>` pills in
 *     FeedFilters. The filter state lives in the URL: server-rendered, shareable,
 *     back/forward works, refresh keeps the filter, zero client JS / useState.
 *     "全部" is the always-visible clear control.
 *
 * Honest states (NFR: never fake data):
 *   - No published rows at all → "暂无公开展示的热点事件" empty state (no skeleton cards).
 *   - Rows exist but the window filters to zero → "当前筛选条件下无热点事件" + clear link.
 *   - getPrisma throws when DATABASE_URL is missing at runtime → loud failure (the
 *     error propagates to a route error), NOT a silent empty state. DB is core
 *     infra; its absence is an incident, not graceful degradation.
 *
 * Masthead (H1 「AGUHOT」 + subtitle 「可信热点发布闭环」) is preserved from 1.1 so
 * home.spec.ts stays green.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ window?: string }>;
}

export default async function PublicHomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const window = parseFeedWindow(params.window);

  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing —
  // that is intentional (DB is core infra, not graceful-degradation territory).
  const prisma = getPrisma();
  const all = await listPublishedHotEvents({ prisma, traceId: newTraceId() });

  const totalExists = all.length > 0;
  const now = new Date();
  const visible = totalExists ? filterByWindow(all, window, now) : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">AGUHOT</h1>
        <p className="text-lg text-ink-secondary">可信热点发布闭环</p>
      </header>

      {totalExists ? (
        <>
          <section className="mt-8">
            <FeedFilters window={window} />
          </section>

          {visible.length > 0 ? (
            <ul role="list" className="mt-8 space-y-3">
              {visible.map((e) => (
                <EventCard
                  key={e.hotEventId}
                  hotEventId={e.hotEventId}
                  title={e.title}
                  evidenceCount={e.evidenceCount}
                  latestEvidenceAt={e.latestEvidenceAt}
                  publishedAt={e.publishedAt}
                  now={now}
                />
              ))}
            </ul>
          ) : (
            <div className="mt-12 space-y-3">
              <p className="text-ink-secondary">当前筛选条件下无热点事件。</p>
              {window !== "all" ? (
                <Link
                  href="?window=all"
                  className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"
                >
                  查看全部
                </Link>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <p className="mt-12 text-ink-secondary">暂无公开展示的热点事件。</p>
      )}
    </div>
  );
}

/**
 * Apply the date window to the published list (JS filter). The query already
 * returns rows ordered by evidenceCount DESC + latestEvidenceAt DESC; windowing
 * preserves that order. `now` is injected so card reason logic and window logic
 * share one clock.
 */
function filterByWindow<T extends { latestEvidenceAt: Date }>(
  rows: T[],
  window: FeedWindow,
  now: Date,
): T[] {
  if (window === "all") return rows;
  const cutoffMs = windowCutoffMs(window, now);
  return rows.filter((r) => r.latestEvidenceAt.getTime() >= cutoffMs);
}

function windowCutoffMs(window: Exclude<FeedWindow, "all">, now: Date): number {
  const DAY = 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();
  if (window === "today") {
    // "今日" = since the start of the current UTC day (midnight UTC).
    const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return startOfDay;
  }
  if (window === "7d") return nowMs - 7 * DAY;
  return nowMs - 30 * DAY; // "30d"
}
