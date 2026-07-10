"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Reading-context capture + one-shot scroll restore — Story 2.5 (UX-DR12).
 *
 * This is the layout-level infrastructure that preserves the reader's
 * "originating consumption context" (filter query + scroll position) across the
 * list → detail → list return path. It is the missing half of the closed loop:
 * the four forward surfaces (1.7 feed / 2.2 association / 2.3 theme / 2.4 daily)
 * already cross-link, but until 2.5 the detail "返回" link always fell back to
 * the homepage top — dropping `?window=` / `?date=` / `?concept=` filter state
 * and the scroll position. UX-DR12 requires the return path to restore both.
 *
 * Mechanism (ponytail: one layout-level client component + sessionStorage, no
 * per-link wrapping, no URL `?from=` pollution, no Provider/Redux/Zustand):
 *
 *   1. CAPTURE — a single capture-phase click listener on `document` watches
 *      every click. When the clicked `<a>` resolves to `/events/{id}` (a detail
 *      navigation), it writes the CURRENT list URL (pathname + search) +
 *      `window.scrollY` into sessionStorage. Capture phase guarantees the
 *      handler runs BEFORE Next's `<Link>` client routing, so the context is
 *      captured before the navigation leaves the list page. Forward hrefs stay
 *      byte-identical (event-card / theme member / daily entry links are
 *      untouched) — the listener covers every detail entry point automatically,
 *      with zero per-link wrapping.
 *
 *   2. RESTORE — when the reader clicks the detail-page `<BackLink>` (the only
 *      "from detail back to list" return path), BackLink's onClick writes a
 *      one-shot `RESTORE_MARKER` (value = the originating list href). On the
 *      return load, a `useEffect` keyed on `usePathname()` checks: if the
 *      current list route matches the marker, it reads the stored scrollY and
 *      `window.scrollTo({top, behavior: "instant"})` (instant, no animation —
 *      reduced-motion-safe), then CLEARS the marker + scroll entry. One-shot:
 *      a page refresh / direct load / first entry has NO marker → no-op, so the
 *      reader lands at the top (never wrongly jumped to a stale scroll).
 *
 * Trust boundary + open-redirect guard: the return href comes from
 * sessionStorage (same-origin JS-written, but treated as untrusted on read).
 * `isValidListReturn` parses it with `new URL(raw, "http://localhost")` and
 * requires `origin === "http://localhost"` (blocks `https://evil.com`,
 * `//evil.com` protocol-relative, full external URLs) + pathname in an
 * allowlist (`/`, `/daily`, `/search` exact; `/topics/` prefix). Anything else
 * (`/console/…`, `/events/…`, `/favorites`) is rejected → BackLink falls back
 * to `/`. Tampered return-context never produces an off-site jump.
 *
 * Depth cap (UX-DR12 "navigation depth is capped at one level"): only the
 * list → detail jump is captured. Detail → detail (none today), list → list
 * (main-nav switches) are not captured/restored — main nav is global
 * navigation, not reading-context return. The listener only writes when the
 * target is `/events/`, so every other click is a no-op.
 *
 * Graceful degradation / private mode: every sessionStorage access is wrapped
 * in try/catch. When storage is disabled (private mode / cookies blocked) or
 * `window`/`document` is missing, all reads/writes silently no-op; BackLink
 * falls back to `/`; the reader can still browse, just without context restore.
 *
 * SSR safety: this is a `"use client"` component that renders `null` (zero UI,
 * zero layout impact). All `window` / `sessionStorage` / `document` access is
 * inside `useEffect`, which is client-only. The public shell stays
 * DATABASE_URL-free — this component does NOT import `@aguhot/core`
 * (only `next/navigation` + `react`).
 *
 * Constants are defined here (single source of truth) and imported by
 * `back-link.tsx` so the two files never mirror key strings.
 */

// --- sessionStorage keys + allowlists (single source of truth) ---------------

/**
 * Key under which the originating list URL (pathname + search) is stored when
 * the reader clicks into a detail page.
 */
export const RETURN_CONTEXT_KEY = "aguhot:returnContext" as const;

/**
 * One-shot marker written by BackLink onClick (value = the originating list
 * href). Its presence + match against the current pathname+search is what
 * gates scroll restore — without it, refresh / direct load never jumps.
 */
export const RESTORE_MARKER_KEY = "aguhot:restoreMarker" as const;

/**
 * Prefix for scroll-position entries. Keyed by the full originating list href
 * (pathname + search) so the scroll entry is unique per filter combination
 * (e.g. `/?window=7d` vs `/?window=today` each get their own scroll slot).
 */
export const SCROLL_KEY_PREFIX = "aguhot:scroll:" as const;

/**
 * Pathname prefixes that count as "list routes" for capture + restore. A
 * detail navigation originating from any of these is a reading-context return
 * candidate. `/topics/` is a prefix (theme pages are `/topics/{slug}`).
 */
const LIST_PATH_PREFIXES = ["/topics/"] as const;

/**
 * Exact list pathnames. `/` (homepage feed), `/daily` (daily digest), and
 * `/search` (search results, Story 3.1) are exact matches (they have no
 * dynamic segment). `/search` was added in 3.1 to honor the 2.5 defer:
 * navigating search → detail → BackLink must restore the originating search
 * URL (query intact) rather than falling back to `/`.
 */
const LIST_PATH_EXACT = ["/", "/daily", "/search"] as const;

// --- pure helpers (sessionStorage wrapped in try/catch) ----------------------

/**
 * Build the sessionStorage key for a given list href's scroll position.
 * Public so tests + BackLink can share the scheme.
 */
export function scrollKey(href: string): string {
  return `${SCROLL_KEY_PREFIX}${href}`;
}

/**
 * Open-redirect guard for a return-context candidate. Parses `raw` with
 * `new URL(raw, "http://localhost")` so that protocol-relative
 * (`//evil.com`), absolute (`https://evil.com`), and backslash-trick
 * (`/\\evil.com`) URLs all resolve to a non-localhost origin and are rejected.
 * Then requires the pathname to be an allowlisted list route.
 *
 * Returns true ONLY when:
 *   - `raw` is a non-empty string,
 *   - it parses to `origin === "http://localhost"` (same-origin under our
 *     base),
 *   - pathname is exactly `/`, `/daily`, or `/search`, OR starts with `/topics/`.
 *
 * Any parse failure / disallowed pathname / cross-origin → false (BackLink
 * falls back to `/`). This is the trust boundary; it cannot be simplified to
 * `startsWith("/")` (which would let `//evil.com` through).
 */
export function isValidListReturn(raw: string | null | undefined): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  let url: URL;
  try {
    url = new URL(raw, "http://localhost");
  } catch {
    return false;
  }
  // Cross-origin / protocol-relative / absolute-external → reject.
  if (url.origin !== "http://localhost") return false;
  const { pathname } = url;
  // Exact-match list routes.
  if ((LIST_PATH_EXACT as readonly string[]).includes(pathname)) return true;
  // Prefix-match list routes (theme pages: /topics/{slug}).
  for (const prefix of LIST_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Read the stored originating-list href, or null when absent / storage
 * disabled. Never throws.
 */
export function readReturnContext(): string | null {
  try {
    return window.sessionStorage.getItem(RETURN_CONTEXT_KEY);
  } catch {
    return null;
  }
}

/**
 * Write the originating-list href (pathname + search) when the reader clicks
 * into a detail page. Never throws (private-mode no-op).
 */
export function writeReturnContext(href: string): void {
  try {
    window.sessionStorage.setItem(RETURN_CONTEXT_KEY, href);
  } catch {
    // Storage disabled (private mode / cookies blocked) → silent no-op. The
    // reader can still browse; BackLink just falls back to `/`.
  }
}

/**
 * Write the one-shot restore marker (value = originating list href). Called by
 * BackLink onClick so the subsequent list load knows to restore scroll.
 */
export function writeRestoreMarker(href: string): void {
  try {
    window.sessionStorage.setItem(RESTORE_MARKER_KEY, href);
  } catch {
    // Private-mode no-op → scroll restore will not fire (acceptable degrade).
  }
}

/**
 * Read the one-shot restore marker, or null.
 */
function readRestoreMarker(): string | null {
  try {
    return window.sessionStorage.getItem(RESTORE_MARKER_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear the one-shot restore marker. Called after scroll restore completes so a
 * subsequent refresh of the same list page does not re-jump.
 */
export function clearRestore(): void {
  try {
    window.sessionStorage.removeItem(RESTORE_MARKER_KEY);
  } catch {
    // Private-mode no-op.
  }
}

/**
 * Write the scroll position for a given list href. Called at capture time
 * alongside writeReturnContext.
 */
export function writeScroll(href: string, y: number): void {
  try {
    window.sessionStorage.setItem(scrollKey(href), String(y));
  } catch {
    // Private-mode no-op.
  }
}

/**
 * Read the stored scroll position for a given list href, or null.
 */
function readScroll(href: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(scrollKey(href));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Clear the scroll slot for a given list href. Called after restore so the
 * scroll entry does not outlive its marker (one-shot semantics).
 */
export function clearScroll(href: string): void {
  try {
    window.sessionStorage.removeItem(scrollKey(href));
  } catch {
    // Private-mode no-op.
  }
}

/**
 * Does this pathname count as a list route (the kind of page that captures
 * reading context and that BackLink can return to)? Mirrors the allowlist in
 * `isValidListReturn` but operates on a bare pathname (no origin parsing).
 * Used by the restore effect to decide whether scroll restore could apply.
 */
function isListPath(pathname: string): boolean {
  if ((LIST_PATH_EXACT as readonly string[]).includes(pathname)) return true;
  for (const prefix of LIST_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

// --- the component (renders null, zero UI) -----------------------------------

export function ListContextMemory(): null {
  const pathname = usePathname();

  // CAPTURE: one document-level capture-phase click listener. Fires before
  // Next's <Link> client routing, so the context is written before navigation
  // away from the list page. A single listener covers every detail entry point
  // (feed card, theme member, daily entry) — forward hrefs stay byte-identical,
  // no per-link wrapping. Capture listener registered once on mount; App Router
  // preserves the layout component across client-side navigations within the
  // (public) route group, so a single [] effect covers every list → detail jump.
  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      // Only capture "real" primary clicks without modifiers — a modified
      // click (cmd/ctrl for new tab, shift for new window) or non-left button
      // should not be treated as a reading-context navigation (the original
      // list page stays open, so there is no return to restore).
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Find the nearest anchor from the click target (covers clicks on child
      // elements inside an <a>).
      const anchor = target.closest("a");
      if (anchor === null) return;
      // Resolve the anchor's href against the current origin so pathname is
      // absolute. href="" / "#" / non-http anchors are skipped.
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Skip links that open in a new tab or download: these are not "leave the
      // current list" navigations (the original list page stays open), so there
      // is no return to restore. Same reasoning as the modifier-key skip above.
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      // Only capture detail navigations. List → list, nav, external → no-op.
      if (!url.pathname.startsWith("/events/")) return;
      // Capture the CURRENT list URL (pathname + search) + scroll. This is the
      // originating consumption context UX-DR12 wants preserved.
      const href = window.location.pathname + window.location.search;
      writeReturnContext(href);
      writeScroll(href, window.scrollY);
    };
    // Capture phase: runs before Next's <Link> routing (which is also on
    // document but registered later / can be prevented). True = capture.
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  // RESTORE: one-shot scroll restore gated by RESTORE_MARKER. useEffect (chosen
  // over useLayoutEffect) because during client-side navigation the new route's
  // content is fetched asynchronously by Next — the DOM is not tall enough at
  // layout time. We defer the actual scroll to the next animation frame and
  // retry briefly (a few frames) until the page is tall enough to reach the
  // target scroll position. Keyed on [pathname] so the one-shot restore fires
  // once per return navigation (not per in-list filter change, which does not
  // remount the layout). The marker is written ONLY by BackLink onClick — so
  // refresh / direct load / first entry (no marker) is a no-op, and the reader
  // lands at the top (never wrongly jumped to a stale scroll).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isListPath(pathname)) return;
    // The marker value is the originating list href (pathname + search). It
    // must match the CURRENT pathname + search exactly — so returning to list
    // A does not trigger list B's restore.
    const currentHref = window.location.pathname + window.location.search;
    const marker = readRestoreMarker();
    if (marker === null || marker !== currentHref) return;
    const y = readScroll(currentHref);
    // Clear the RESTORE_MARKER IMMEDIATELY (before the rAF retry loop) so the
    // restore is one-shot: a subsequent refresh of this list page does not
    // re-jump, even if the retry loop is still running (P10: preserves the AC5
    // refresh-no-re-jump guarantee). But DEFER clearing the scroll slot until
    // AFTER window.scrollTo has actually been applied (or the retry loop gives
    // up): if the reader navigates away mid-retry, the marker is already gone
    // (no stale re-jump) but the scroll slot survives so a later return to the
    // same list can still restore. The scroll slot is cleared on successful
    // restore or on retry exhaustion to avoid unbounded growth.
    clearRestore();
    // No scroll target → nothing to restore (the reader landed at the top,
    // which is correct for a missing slot).
    if (y === null || y <= 0) {
      clearScroll(currentHref);
      return;
    }

    // Defer the scroll to the next animation frame + retry briefly until the
    // page is tall enough. During client-side navigation, the new route's
    // content arrives async; scrollTo on a short page clamps to max-scroll
    // (often 0). We retry for up to ~500ms (30 frames @ 60fps) to let the
    // content paint, then give up (worst case: reader is at the top — the
    // query was still restored, which is the more important half of UX-DR12).
    let cancelled = false;
    let framesLeft = 30;
    const tryScroll = (): void => {
      if (cancelled) return;
      // If the page can now accommodate the target scroll, restore it and clear
      // the scroll slot (P10: scroll slot is cleared only after a successful
      // scrollTo, so a mid-retry navigation away keeps the slot for a later
      // return).
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll >= y) {
        window.scrollTo({ top: y, behavior: "instant" });
        clearScroll(currentHref);
        return;
      }
      framesLeft -= 1;
      if (framesLeft > 0) {
        requestAnimationFrame(tryScroll);
        return;
      }
      // Retry exhaustion: clear the scroll slot so it does not leak forever
      // (P10: bounded growth — the slot is cleared on give-up too).
      clearScroll(currentHref);
    };
    requestAnimationFrame(tryScroll);

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Renders nothing — this component is infrastructure only.
  return null;
}
