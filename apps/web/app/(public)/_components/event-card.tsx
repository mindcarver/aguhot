import Link from "next/link";

import type { FollowRef } from "@aguhot/core";

import { cn } from "@/lib/utils";

import { FollowButton } from "./follow-button";

/**
 * Published hot-event feed card — Story 1.7 (whole-card link added in 1.8;
 * FollowButton sibling added in 3.2).
 *
 * Renders one published_hot_events row as an information card on the public feed.
 * The card shows exactly the fields the read model has (Story 1.6 minimal
 * projection): title, source count (evidenceCount), latest update time
 * (latestEvidenceAt). A ranking-reason chip is rendered ONLY when there is a
 * real signal — evidenceCount >= 3 (multi-source coverage) or latestEvidenceAt
 * within the last 72 hours (recent heating). When neither signal is present, no
 * chip is rendered (NFR: never fabricate a reason). The ordering itself
 * (evidenceCount DESC, latestEvidenceAt DESC) always applies at the query layer.
 *
 * Story 1.8: the whole card is now a `<Link>` to the detail page
 * (`/events/{hotEventId}`), landing the 1.7-deferred "whole-card click to detail"
 * (epic: event card is whole-card clickable to detail). The card's token/style
 * surface is unchanged — only the outer element flipped from `<li>` to a `<li>`
 * wrapping a `<Link>` so the entire card is clickable.
 *
 * Story 3.2: a FollowButton is mounted as a DOM SIBLING of the whole-card Link
 * (inside the `<li class="relative">`), absolutely positioned in the top-right
 * corner. This is REQUIRED for HTML validity: a `<button>` / `<form>` CANNOT be
 * a descendant of an `<a>` (invalid HTML — browsers force a DOM split that
 * breaks both the card click and the button). The Link keeps its full-card hit
 * area but gains `pr-16` right padding so its content never underlaps the
 * FollowButton. The ranking-reason chip, meta line, and tokens are byte-for-byte
 * unchanged. Follow state is SSR-driven: the page passes `isFollowing` +
 * `isLoggedIn` after reading the session + follow state; absent props → the
 * FollowButton is not rendered (e.g. search results, where follow-on-card is
 * out of scope for 3.2).
 *
 * Tokens: uses only real @theme tokens that resolve in Tailwind v4
 * (bg-surface-raised / border-border-hairline / rounded-lg / ink-* / bg-brand).
 * Does NOT copy the operator console's broken undefined tokens (bg-surface /
 * border-line-subtle / bg-brand-strong) — those do not resolve.
 */

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const MULTI_SOURCE_THRESHOLD = 3;

export interface EventCardProps {
  hotEventId: string;
  title: string;
  evidenceCount: number;
  latestEvidenceAt: Date;
  publishedAt: Date;
  now?: Date;
  /**
   * SSR follow state for this event + the current viewer (Story 3.2). Omitted
   * on surfaces that do not render a follow button on the card (e.g. /search
   * results). When omitted, no FollowButton is rendered.
   */
  isFollowing?: boolean;
  /**
   * SSR logged-in state (session present). When `isFollowing` is provided this
   * must be too. Omitted alongside `isFollowing` → no FollowButton.
   */
  isLoggedIn?: boolean;
}

/**
 * Decide whether a ranking-reason chip should render, and which reason.
 * Returns null when no honest signal exists (never fabricates a reason).
 *
 * - "近期升温" (recent heating): latestEvidenceAt within 72h.
 * - "多源覆盖" (multi-source coverage): evidenceCount >= 3.
 * If both apply, recency wins (more time-sensitive, surfaces first).
 */
function rankingReason(
  evidenceCount: number,
  latestEvidenceAt: Date,
  now: Date,
): { label: string; tone: "recent" | "multi-source" } | null {
  const isRecent = now.getTime() - latestEvidenceAt.getTime() <= SEVENTY_TWO_HOURS_MS;
  if (isRecent) {
    return { label: "近期升温", tone: "recent" };
  }
  if (evidenceCount >= MULTI_SOURCE_THRESHOLD) {
    return { label: "多源覆盖", tone: "multi-source" };
  }
  return null;
}

export function EventCard({
  hotEventId,
  title,
  evidenceCount,
  latestEvidenceAt,
  publishedAt,
  now = new Date(),
  isFollowing,
  isLoggedIn,
}: EventCardProps) {
  const reason = rankingReason(evidenceCount, latestEvidenceAt, now);

  // Story 3.2: render the FollowButton only when the page passed follow state.
  // Search results omit these props → no follow-on-card (3.2 scope).
  const showFollow = isFollowing !== undefined && isLoggedIn !== undefined;
  const followRef: FollowRef = { kind: "hot_event", hotEventId };

  return (
    // relative + pr-16 on the Link so the FollowButton (absolute top-right) has
    // a positioning context and never underlaps the card content.
    <li className="relative rounded-lg border border-border-hairline bg-surface-raised">
      {/*
        Whole-card link (Story 1.8): the entire card body is wrapped in a Link so
        the card is one click target to the detail page. block + padding on the
        Link keeps the hit area the full card; the existing chip/meta layout is
        unchanged. hover:bg-surface-muted gives a subtle hover affordance that
        works with the bg-surface-raised base. Story 3.2 adds pr-16 (only when
        the FollowButton is rendered) so the top-right button never overlaps.
      */}
      <Link
        href={`/events/${hotEventId}`}
        className={cn(
          "block rounded-lg px-5 py-4 hover:bg-surface-muted",
          // Reserve top-right space only when the FollowButton is actually
          // rendered; /search reuses this card without follow props and would
          // otherwise show an empty ~64px gap.
          showFollow && "pr-16",
        )}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
          {reason !== null ? (
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs",
                reason.tone === "recent"
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface-muted text-ink-secondary",
              )}
            >
              {reason.label}
            </span>
          ) : null}
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-ink-tertiary">
          <div>
            <dt className="inline">来源数 </dt>
            <dd className="inline">{evidenceCount}</dd>
          </div>
          <div>
            <dt className="inline">更新 </dt>
            <dd className="inline">{formatDateTime(latestEvidenceAt)}</dd>
          </div>
          <div>
            <dt className="inline">发布 </dt>
            <dd className="inline">{formatDateTime(publishedAt)}</dd>
          </div>
        </dl>
      </Link>
      {/*
        Story 3.2: FollowButton is a DOM SIBLING of the whole-card Link (NOT a
        descendant). Nesting a <button>/<form> inside an <a> is invalid HTML and
        breaks both interactions; absolute-positioning the button as a sibling
        keeps the whole-card click AND a separate top-right follow hit area.
      */}
      {showFollow ? (
        <div className="absolute right-3 top-3">
          <FollowButton
            followRef={followRef}
            initialIsFollowing={isFollowing ?? false}
            isLoggedIn={isLoggedIn ?? false}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is enough for the feed card meta line and stays consistent across
 * build-time TZ and runtime TZ.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
