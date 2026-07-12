import { cn } from "@/lib/utils";

/**
 * Global search entry — Story 3.1 (FR12).
 *
 * A native HTML `<form method="get" action="/search">` with an
 * `<input type="search" name="q">`. No client JS, no "use client" — this is a
 * server component rendered as a static JSX subtree inside public-nav.tsx (which
 * is itself "use client" but treats SearchBox as a static child). Keyboard Enter
 * triggers the browser's native form submission → `GET /search?q=…` → the
 * server-rendered search results page. The query lives entirely in the URL
 * (`?q=`): shareable, back/forward works, refresh keeps the query, zero
 * useState/useReducer (consistent with the feed's `?window=` URL-driven filter).
 *
 * Rendered at the TOP of NavList (both the desktop left-rail aside AND the
 * mobile drawer — they share NavList), so the search entry is globally reachable
 * from either surface (AC3 keyboard + touch). It is NOT a PRIMARY_NAV_ITEMS
 * entry: the navigation.spec asserts "四个一级入口" (four primary entries) and
 * adding a fifth would break that. A `<form>` inside `<nav>` is not a primary
 * link, so the existing navigation e2e assertions stay green.
 *
 * Accessible name: the input carries `aria-label="搜索热点事件与主题"` directly
 * (id-free). `htmlFor`/`id` pairing + a wrapping `<label>` are both avoided
 * because SearchBox renders in TWO places simultaneously (desktop aside + mobile
 * drawer) — duplicate ids would be invalid HTML, and wrapping the input in an
 * sr-only `<label>` would hide the input itself. `aria-label` needs no id, is
 * safe across duplicate instances, and does not hide the input. `useId()` is
 * unavailable here (server component, no hooks). The form itself already carries
 * `role="search"` + its own `aria-label` for the landmark.
 *
 * Input constraints: `required` (native HTML5 validation blocks empty submission
 * so clicking 搜索 with no keyword stays on the current page instead of
 * navigating to `/search?q=`) and `maxLength={128}` (matches the page-layer
 * MAX_QUERY_LEN trust-boundary truncation, preventing a huge paste from
 * building a GET URL servers reject as 414 before parseSearchQuery runs).
 *
 * Touch target (UX-DR13 / FR12 AC3): both the input and the submit button have
 * `min-h-11` (44px) so the tap target meets the minimum on mobile. Tokens use
 * the existing resolved surface/ink/border tokens (bg-surface-raised /
 * border-border-hairline / ink-*).
 */

export interface SearchBoxProps {
  /**
   * Prefilled query (uncontrolled). Used on the /search page so the reader can
   * change the word in place. `defaultValue` (NOT `value`) keeps this an
   * uncontrolled input — SSR-safe (no hydration mismatch) and no client state.
   * Omitted on the nav instances (no prefill).
   */
  defaultValue?: string;
  /**
   * Optional extra classes appended to the `<form>` (merged via `cn` after the
   * base layout). Used by callers that need form-level layout tweaks without
   * forking the component. Omit for the default spacing.
   */
  className?: string;
  /**
   * Layout variant (Story 6.1 review-followup):
   *   - "stacked" (default): input over button, each `block w-full`. Used in the
   *     mobile drawer + /search page where vertical space is ample.
   *   - "compact": input + button on ONE row (`flex items-center`), input
   *     `w-40`, button `shrink-0`. Used in the desktop top bar (`h-14` = 56px),
   *     where the stacked form's two `min-h-11` (88px) rows would overflow the
   *     56px bar (Codex P1). Both controls keep `min-h-11` (44px ≤ 56px) so the
   *     touch-target + a11y INPUT-reachability invariants hold.
   */
  variant?: "stacked" | "compact";
}

export function SearchBox({ defaultValue, className, variant = "stacked" }: SearchBoxProps) {
  const compact = variant === "compact";
  return (
    <form
      role="search"
      method="get"
      action="/search"
      aria-label="搜索热点与主题"
      className={cn(compact ? "flex items-center gap-2" : "space-y-1", className)}
    >
      {/*
        Accessible name via aria-label on the input (id-free). No <label>:
        pairing a <label> with htmlFor/id would require an id (duplicate-id
        invalid HTML across the desktop + mobile instances), and wrapping the
        input in an sr-only <label> would HIDE the input. aria-label needs no
        id, works for both instances, and keeps the input visible. `required`
        blocks empty submission client-side (no /search?q= navigation);
        `maxLength={128}` mirrors the page-layer MAX_QUERY_LEN trust-boundary
        truncation so an oversized paste cannot build a GET URL servers reject.
      */}
      <input
        name="q"
        type="search"
        defaultValue={defaultValue ?? ""}
        placeholder="搜索热点 / 主题"
        autoComplete="off"
        aria-label="搜索热点事件与主题"
        required
        maxLength={128}
        className={cn(
          "min-h-11 rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-base text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          compact ? "w-40" : "block w-full",
        )}
      />
      <button
        type="submit"
        className={cn(
          "min-h-11 rounded-md bg-brand px-3 py-2 text-base font-semibold text-brand-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          compact ? "shrink-0" : "block w-full",
        )}
      >
        搜索
      </button>
    </form>
  );
}
