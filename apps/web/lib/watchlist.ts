/**
 * resolveWatchlistView — pure web-layer helper that classifies a user's follows
 * into live vs offline groups by diffing against the published read models.
 *
 * Story 3.3 (watchlist + revisit management).
 *
 * Why this lives in the WEB layer (not as a new core function): the offline
 * classification is a cross-module JOIN of "follow state" (owned by
 * `user-profile`) × "published availability" (owned by `publish-orchestrator`).
 * Core must NOT let `user-profile` reverse-depend on `publish-orchestrator`'s
 * read models (Epic 3 "single ownership boundary" — `user-profile` only stores/
 * retrieves follows by id, never reads published_*). There is a direct
 * precedent: `/topics/[slug]` already does the same JS-join at the web layer
 * (listPublishedThemeMemberships + listPublishedHotEvents) to decide whether a
 * theme has live members. This helper mirrors that pattern for the watchlist.
 *
 * AD-3 (public site reads only published_*): offline = the follow's hotEventId
 * / slug is NOT present in the published read model (published has NO
 * `publication_status` column — row existence = live; takedown = row deletion;
 * theme liveness is derived from `published_hot_event_themes.items` slugs).
 *
 * AC3 (honest status annotation, NFR2 never fake): live items render normally
 * (events as EventCard, themes as a link row); offline items render with visual
 * downgrade (muted + "已下线" badge + NO detail link — detail would 404) and are
 * NEVER mixed into the live group. Offline events have no displayable title
 * (the published row is deleted; `follow_targets` does not redundantly store
 * titles) → annotated "该热点已下线", NEVER fabricating a title/summary/
 * evidenceCount. Offline themes are annotated "该主题已下线" (the human-readable
 * label derived from a published membership is no longer obtainable) — the bare
 * slug is never exposed to the reader.
 *
 * Zero runtime dependencies, zero I/O: this is a pure data transformation that
 * can be imported by a tsx selfcheck directly (mirrors
 * follow-ref-parser.selfcheck.ts). The page does the three reads
 * (listFollows + listPublishedHotEvents + listPublishedThemeMemberships), this
 * fn does the diff.
 */

import type {
  FollowTarget,
  PublishedHotEventSummary,
  PublishedThemeMembershipRow,
  ThemeRef,
} from "@aguhot/core";

import { FollowTargetKind } from "@aguhot/core";

/**
 * The resolved watchlist view: four buckets, each ordered by the follow's
 * `createdAt DESC` (most-recently-followed first — the sort runs across ALL
 * follows before classification, so each bucket preserves that order).
 *
 *   - liveEvents: published event summaries the user follows (rendered as
 *     EventCard with live title + detail link).
 *   - liveThemes: { slug, label } pairs the user follows and that have >=1
 *     published membership (rendered as a link row to /topics/{slug}). The
 *     label is the first-seen label from the published membership items
 *     (mirrors /topics/[slug]'s first-seen label derivation).
 *   - offlineEvents: { hotEventId } for follows whose hotEventId is NOT in the
 *     published set (the event was taken down / merged / never existed).
 *   - offlineThemes: { slug } for follows whose slug is NOT in any published
 *     membership (the theme's membership was cleared / never existed).
 *
 * The `hotEventId` / `slug` on offline items is kept so the FollowButton ref
 * stays valid (unfollow needs the id) — it is NEVER rendered to the reader.
 */
export interface WatchlistView {
  liveEvents: PublishedHotEventSummary[];
  liveThemes: { slug: string; label: string }[];
  offlineEvents: { hotEventId: string }[];
  offlineThemes: { slug: string }[];
}

/**
 * Resolve a user's follows into the live/offline watchlist view.
 *
 * Steps:
 *   1. Sort ALL follows by createdAt DESC (deterministic tiebreaker by id) so
 *      every bucket preserves "most-recently-followed first".
 *   2. Build the published-liveness indexes:
 *      - eventsById: Map<hotEventId, PublishedHotEventSummary> for O(1) lookup.
 *      - themeLabelBySlug: Map<slug, label> built by scanning all membership
 *        rows' items (first-seen label wins, mirroring /topics/[slug]).
 *   3. For each follow (in sorted order), classify into the right bucket:
 *      - hot_event: hotEventId in eventsById → liveEvents (push the summary);
 *        else → offlineEvents (push { hotEventId }).
 *      - theme: slug in themeLabelBySlug → liveThemes (push { slug, label });
 *        else → offlineThemes (push { slug }).
 *
 * Pure + total: empty inputs yield all-empty buckets (AC2 empty state). Unknown
 * targetKind (defensive — the app-layer whitelist guarantees only the two union
 * values are ever written) is skipped, never throws.
 */
export function resolveWatchlistView(input: {
  follows: FollowTarget[];
  publishedEvents: PublishedHotEventSummary[];
  themeMemberships: PublishedThemeMembershipRow[];
}): WatchlistView {
  // 1. Sort follows by createdAt DESC (id DESC deterministic tiebreaker) so
  // each bucket preserves the same most-recently-followed-first order.
  const sortedFollows = [...input.follows].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id.localeCompare(a.id),
  );

  // 2. Build published-liveness indexes.
  const eventsById = new Map<string, PublishedHotEventSummary>();
  for (const e of input.publishedEvents) {
    eventsById.set(e.hotEventId, e);
  }
  // Theme liveness: a slug is live iff it appears in >=1 published membership's
  // items. The label is the first-seen label across all membership rows
  // (mirrors /topics/[slug]'s first-seen label derivation).
  const themeLabelBySlug = new Map<string, string>();
  for (const m of input.themeMemberships) {
    // `items` is a Prisma Json column — defend against null / non-array / shape
    // corruption at the trust boundary rather than trusting the `as ThemeRef[]`
    // cast (a malformed row would otherwise crash the page with a 500).
    const items = Array.isArray(m.items) ? (m.items as unknown[]) : [];
    for (const raw of items) {
      const item = raw as Partial<ThemeRef>;
      if (
        typeof item.slug === "string" &&
        item.slug.trim() !== "" &&
        typeof item.label === "string" &&
        item.label.trim() !== "" &&
        !themeLabelBySlug.has(item.slug)
      ) {
        themeLabelBySlug.set(item.slug, item.label);
      }
    }
  }

  // 3. Classify each follow into its bucket.
  const liveEvents: PublishedHotEventSummary[] = [];
  const liveThemes: { slug: string; label: string }[] = [];
  const offlineEvents: { hotEventId: string }[] = [];
  const offlineThemes: { slug: string }[] = [];

  for (const follow of sortedFollows) {
    if (follow.targetKind === FollowTargetKind.HotEvent) {
      const hotEventId = follow.targetHotEventId;
      if (hotEventId !== null) {
        const summary = eventsById.get(hotEventId);
        if (summary !== undefined) {
          liveEvents.push(summary);
        } else {
          // The published row was deleted (takedown / merge) or the id was
          // never a published event. Offline: no title to show (AC3).
          offlineEvents.push({ hotEventId });
        }
      }
      // targetHotEventId null on a hot_event row is a data invariant violation
      // (app-layer writer always sets it). Skip defensively rather than throw.
    } else if (follow.targetKind === FollowTargetKind.Theme) {
      const slug = follow.targetThemeSlug;
      if (slug !== null) {
        const label = themeLabelBySlug.get(slug);
        if (label !== undefined) {
          liveThemes.push({ slug, label });
        } else {
          // No published membership carries this slug → the theme page would
          // 404. Offline: do not expose the bare slug to the reader (AC3).
          offlineThemes.push({ slug });
        }
      }
      // targetThemeSlug null on a theme row is a data invariant violation. Skip.
    }
    // Unknown targetKind (defensive): skip, never throw. The app-layer
    // whitelist guarantees only hot_event / theme are ever written.
  }

  return { liveEvents, liveThemes, offlineEvents, offlineThemes };
}
