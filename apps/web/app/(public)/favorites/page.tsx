import type { Metadata } from "next";
import Link from "next/link";

import {
  FollowTargetKind,
  getPrisma,
  listFollows,
  listPublishedHotEvents,
  listPublishedThemeMemberships,
  newTraceId,
} from "@aguhot/core";

import { readSession } from "@/lib/session";
import { resolveWatchlistView } from "@/lib/watchlist";

import { EventCard } from "../_components/event-card";
import { FollowButton } from "../_components/follow-button";

// H1 「收藏」 stays the same as the 1.2 placeholder so PRIMARY_NAV_ITEMS /
// navigation.spec stay byte-identical (Story 3.3 Never: do not touch
// PRIMARY_NAV_ITEMS / NavList).
export const metadata: Metadata = {
  title: "收藏",
};

/**
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() / readSession()
 *     read DATABASE_URL / SESSION_SECRET at runtime; those calls are never
 *     reached during `next build` (same mechanism as the 1.7 homepage, the 1.8
 *     detail route, and the 2.3 theme route — all of which already force
 *     dynamic without breaking the DATABASE_URL-free build). The static public
 *     routes (/design, the layout) never import core, so they stay static.
 */
export const dynamic = "force-dynamic";

/**
 * Watchlist page (was 1.2 placeholder; replaced with the real list in 3.3).
 *
 * Story 3.3 (关注列表与回访管理) replaces the structural placeholder with the
 * real watchlist: the page a reader lands on to view + manage everything they
 * followed (FR13 "view the follow list on an independent page"; epic-3
 * "watchlist is a first-class top-level surface").
 *
 * AD-8 (anonymous-first, AC2): `readSession()` returns null for anonymous /
 * bad-signature cookies → the page renders an EMPTY STATE (HTTP 200, NO login
 * wall, NO redirect). The anonymous reader sees a clear "你还没有收藏内容"
 * message + entries back to home / topics. NEVER gate this page on a session.
 *
 * AD-3 (public reads only published_*): the three reads are all filter-free
 * published_* list fns (listFollows is a user-profile read by id; the other two
 * are the same publish-orchestrator reads /topics/[slug] already JS-joins). The
 * live/offline diff is a pure web-layer fn (resolveWatchlistView) — it does NOT
 * touch hot_events / themes / explanation_* / evidence_* / review_* (the
 * follow row carries only id strings; offline = the id is absent from the
 * published set). This mirrors the /topics/[slug] JS-join precedent and keeps
 * the user-profile module from reverse-depending on publish-orchestrator's read
 * models (single ownership boundary).
 *
 * AC3 (honest status annotation, NFR2 never fake):
 *   - live events render as EventCard (whole-card clickable to detail).
 *   - live themes render as a link row to /topics/{slug}.
 *   - offline events/themes render as a MUTED row with a 「已下线」badge and NO
 *     detail link (detail would 404 — a clickable offline item is misleading,
 *     the inverse of AC3). Offline events have no displayable title (the
 *     published row is deleted; follow_targets stores no title) → annotated
 *     「该热点已下线」, NEVER fabricating a title/summary/evidenceCount. Offline
 *     themes are annotated 「该主题已下线」 (the human-readable label is no longer
 *     obtainable) — the bare slug is never shown to the reader.
 *
 * Management: every watchlist item (live AND offline) carries the 3.2
 * FollowButton (already-followed → click = unfollowTarget + revalidatePath →
 * the item disappears from the list). Zero new interaction. Offline items MUST
 * be unfollowable — otherwise taken-down content lingers forever, violating
 * AC3's recoverability.
 *
 * Zero follows (logged-in, AC2) → same empty state (copy nudged to reflect
 * "登录后收藏的内容会出现在这里").
 */
export default async function FavoritesPage() {
  const prisma = getPrisma();
  const traceId = newTraceId();
  const session = await readSession();

  // Anonymous (AD-8) OR logged-in-with-zero-follows (AC2) → empty state. The
  // empty state is shared; only the copy differs to reflect whether the viewer
  // is anonymous or logged in.
  if (session === null) {
    return <EmptyState isLoggedIn={false} />;
  }

  // Three reads (AD-3: only published_* + the user's own follow rows). These
  // are the same filter-free list fns the feed / topics pages already use.
  const [follows, publishedEvents, themeMemberships] = await Promise.all([
    listFollows({ prisma, traceId, userAccountId: session.accountId }),
    listPublishedHotEvents({ prisma, traceId }),
    listPublishedThemeMemberships({ prisma, traceId }),
  ]);

  // Zero follows → same empty state (AC2 logged-in). Nudge the copy to reflect
  // "you are logged in; anything you collect will show up here".
  if (follows.length === 0) {
    return <EmptyState isLoggedIn={true} />;
  }

  // Pure web-layer diff: classify each follow into live/offline by kind.
  const view = resolveWatchlistView({ follows, publishedEvents, themeMemberships });
  const hasLive = view.liveEvents.length > 0 || view.liveThemes.length > 0;
  const hasOffline = view.offlineEvents.length > 0 || view.offlineThemes.length > 0;
  const now = new Date();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-ink-primary">收藏</h1>
        <p className="text-lg text-ink-secondary">你关注的热点事件与主题。</p>
      </header>

      {!hasLive && !hasOffline ? (
        // All follows resolved to neither live nor offline (defensive — would
        // require every follow row to violate the target-column invariant).
        // Show the empty state rather than a blank page.
        <EmptyState isLoggedIn={true} />
      ) : (
        <>
          {hasLive ? (
            <section className="mt-10 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
                关注中
              </h2>
              {view.liveEvents.length > 0 ? (
                // Live events reuse EventCard (3.2 already carries the
                // FollowButton as a DOM sibling of the whole-card Link, so the
                // card is both the detail entry point AND the unfollow affordance).
                <ul role="list" className="space-y-3">
                  {view.liveEvents.map((e) => (
                    <EventCard
                      key={e.hotEventId}
                      hotEventId={e.hotEventId}
                      title={e.title}
                      evidenceCount={e.evidenceCount}
                      latestEvidenceAt={e.latestEvidenceAt}
                      publishedAt={e.publishedAt}
                      now={now}
                      isFollowing={true}
                      isLoggedIn={true}
                    />
                  ))}
                </ul>
              ) : null}
              {view.liveThemes.length > 0 ? (
                // Live themes render as link rows to /topics/{slug} (FR13 — the
                // theme page is the revisit target). Each row also carries a
                // FollowButton so the reader can unfollow from the list.
                <ul role="list" className="space-y-3">
                  {view.liveThemes.map((t) => (
                    <li
                      key={t.slug}
                      className="relative flex items-center justify-between gap-4 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4"
                    >
                      <Link
                        href={`/topics/${encodeURIComponent(t.slug)}`}
                        className="group min-w-0 flex-1 space-y-1"
                      >
                        <p className="truncate font-semibold text-ink-primary group-hover:text-brand">
                          {t.label}
                        </p>
                        <p className="font-mono text-xs text-ink-tertiary">主题</p>
                      </Link>
                      <FollowButton
                        followRef={{ kind: FollowTargetKind.Theme, themeSlug: t.slug }}
                        initialIsFollowing={true}
                        isLoggedIn={true}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {hasOffline ? (
            // Offline group (AC3). Visually downgraded (muted + 「已下线」badge,
            // NO detail link — detail would 404). Each item carries a
            // FollowButton so the reader can clean up taken-down content
            // (AC3 recoverability). NEVER mixed into the live group.
            <section className="mt-10 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-tertiary">
                已下线
              </h2>
              <ul role="list" className="space-y-3">
                {view.offlineEvents.map((e) => (
                  <li
                    key={`offline-evt-${e.hotEventId}`}
                    className="relative flex items-center justify-between gap-4 rounded-lg border border-border-hairline bg-surface-muted px-5 py-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-tertiary">
                          该热点已下线
                        </span>
                        <span className="rounded-full bg-surface-base px-2 py-0.5 text-xs text-ink-tertiary">
                          已下线
                        </span>
                      </div>
                      {/* The bare hotEventId is never shown to the reader (no
                          title exists; the id is an internal handle only).
                          AC3: never fabricate a title/summary/evidenceCount. */}
                    </div>
                    <FollowButton
                      followRef={{ kind: FollowTargetKind.HotEvent, hotEventId: e.hotEventId }}
                      initialIsFollowing={true}
                      isLoggedIn={true}
                    />
                  </li>
                ))}
                {view.offlineThemes.map((t) => (
                  <li
                    key={`offline-theme-${t.slug}`}
                    className="relative flex items-center justify-between gap-4 rounded-lg border border-border-hairline bg-surface-muted px-5 py-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink-tertiary">
                          该主题已下线
                        </span>
                        <span className="rounded-full bg-surface-base px-2 py-0.5 text-xs text-ink-tertiary">
                          已下线
                        </span>
                      </div>
                      {/* The bare slug is never shown to the reader (no
                          human-readable label is obtainable; AC3). */}
                    </div>
                    <FollowButton
                      followRef={{ kind: FollowTargetKind.Theme, themeSlug: t.slug }}
                      initialIsFollowing={true}
                      isLoggedIn={true}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Empty state for both anonymous (AD-8 / AC2 anon) and logged-in-with-zero-
 * follows (AC2 logged-in) viewers. HTTP 200, NO login wall, NO redirect.
 * Provides entries back to home (feed) and the /topics directory so the reader
 * can discover content to follow. Mirrors the search empty-state CTA tokens
 * (text-ink-secondary + bg-brand rounded-full).
 */
function EmptyState({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight text-ink-primary">收藏</h1>
      </header>
      <div className="mt-12 space-y-4">
        <p className="text-ink-secondary">
          {isLoggedIn
            ? "你还没有收藏内容。登录后收藏的热点事件与主题会出现在这里。"
            : "你还没有收藏内容。在热点详情页或主题页点击「收藏」即可保存感兴趣的内容。"}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center min-h-11 rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"
          >
            返回首页
          </Link>
          <Link
            href="/topics"
            className="inline-flex items-center min-h-11 rounded-full border border-border-hairline bg-surface-raised px-3 py-1 text-sm text-ink-secondary hover:bg-surface-muted"
          >
            探索主题
          </Link>
        </div>
      </div>
    </div>
  );
}
