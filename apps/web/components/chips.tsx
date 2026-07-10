import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Token-driven display primitives — Story 1.3.
 *
 * Three small chip primitives that consume the `@theme` tokens in
 * globals.css. They are display-only (no client behavior) so they stay server
 * components. They exist to:
 *   - prove the tokens are consumable as Tailwind utilities, and
 *   - anchor AC1/AC2 on the `/design` preview surface.
 *
 * Market semantics follow DESIGN's a11y floor: a reaction chip carries BOTH a
 * Chinese text label (涨/跌/平) AND color — color is never the sole signal.
 *
 * Story 1.7: FilterPill gains an optional `href`. When provided it renders as a
 * `<Link>` (URL-driven filter — server-rendered, shareable, zero client JS). This
 * is the first real consumer of FilterPill (1.3 deferred "wire up when a real
 * filter lands"). Without `href` it keeps the `<span>` display form.
 */

/**
 * AI-content label.
 *
 * Uses `accent-warm` (DESIGN: reserved for the AI label / light
 * explanation-layer emphasis). "AI" is the text. `rounded-full` per DESIGN
 * `ai-label` radius.
 */
export function AiLabel({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-accent-warm px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent-warm-foreground",
        className,
      )}
    >
      AI
    </span>
  );
}

/**
 * Free-text operator tag chip — Story 1.9.
 *
 * Renders one operator-authored tag (from the published read model' projected
 * `tags` array, sourced from the effective HotEventRevision.tags). Used on the
 * public detail page under the title (display-only attribute; NOT a feed filter
 * — filtering by tag belongs to Epic 2.2 taxonomy). V1 tags have NO taxonomy
 * and NO tag-level metadata; this chip is the minimal display primitive.
 *
 * Token: `bg-surface-muted` (a real, resolving token — DO NOT copy the 1-6
 * console's drifted `bg-surface`/`border-line-subtle` which do not resolve
 * under Tailwind v4). `rounded-full` matches the chip family.
 */
export function TagChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Filter pill — default vs active, optionally a link.
 *
 * DESIGN `filter-pill`: default is a light surface with secondary ink; active
 * flips to the brand background with brand-foreground ink. `rounded-full`.
 * `active` is a controlled prop so callers (and tests) can pin either state.
 *
 * Story 1.7: an optional `href` turns the pill into a `<Link>` for URL-driven
 * filtering (server-rendered, shareable URL, no client JS / useState). When
 * omitted the pill renders as a display-only `<span>` (keeps 1.3 / /design use).
 * The active/default class styles are identical in both forms.
 *
 * Story 3.6 — `min-h-11` (44px) touch target, UX-DR13「密集小标签」baseline. One
 * pillClass change covers home 筛选 / topics 目录 / search 主题命中 / detail 关联
 * / `/design` five surfaces (FilterPill renders as both `<Link>` and `<span>`,
 * same pillClass). `min-h-11` is the existing 44px token (nav/SearchBox/
 * FollowButton share it). Visual style (color/radius/font-size) is byte-unchanged.
 */
export function FilterPill({
  active = false,
  href,
  children,
  className,
}: {
  active?: boolean;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pillClass = cn(
    "inline-flex items-center min-h-11 rounded-full px-3 py-1 text-sm",
    active
      ? "bg-brand text-brand-foreground"
      : "bg-surface-base text-ink-secondary",
    className,
  );

  if (href !== undefined) {
    return (
      <Link href={href} className={pillClass}>
        {children}
      </Link>
    );
  }

  return <span className={pillClass}>{children}</span>;
}

/**
 * Market-reaction chip tone.
 *
 * `up`/`down`/`flat` map to DESIGN market-up/down/flat. The chip's background
 * uses the corresponding `-soft` token and its text/value uses the solid
 * market token, so red/green enter the UI only as chips — never as full-bleed
 * card coloring (DESIGN: don't let it look like a trading terminal).
 */
export type ReactionTone = "up" | "down" | "flat";

const REACTION_LABEL: Record<ReactionTone, string> = {
  up: "涨",
  down: "跌",
  flat: "平",
};

const REACTION_TONE_CLASS: Record<ReactionTone, string> = {
  up: "bg-market-up-soft text-market-up",
  down: "bg-market-down-soft text-market-down",
  flat: "bg-market-flat-soft text-market-flat",
};

/**
 * Market-reaction chip.
 *
 * Renders the Chinese text label (涨/跌/平) next to the numeric `value`. The
 * value uses `font-mono` (IBM Plex Mono numeric layer) so digits stay stable;
 * the label stays in the sans body face. Both the text label and color carry
 * the semantics (a11y floor: color is not the only signal).
 */
export function ReactionChip({
  tone,
  value,
  className,
}: {
  tone: ReactionTone;
  value: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm",
        REACTION_TONE_CLASS[tone],
        className,
      )}
    >
      <span>{REACTION_LABEL[tone]}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}
