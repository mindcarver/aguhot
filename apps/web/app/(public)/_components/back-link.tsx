"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  isValidListReturn,
  readReturnContext,
  writeRestoreMarker,
} from "./list-context-memory";

/**
 * Detail-page "return to originating list" link — Story 2.5 (UX-DR12).
 *
 * Replaces the bare `<Link href="/">` return link on the detail page. This is
 * the single UX-DR12 landing point: when a reader enters a detail page from a
 * list (homepage feed `/?window=…` / theme `/topics/{slug}` / daily
 * `/daily?date=…`), the BackLink restores the originating list URL (with its
 * filter query intact) instead of always falling back to the homepage top.
 *
 * Pair with `<ListContextMemory/>` (mounted once in the public layout), which
 * captures the originating list URL + scroll position at click time and
 * restores the scroll one-shot on return.
 *
 * Flow:
 *   1. `<ListContextMemory/>` capture listener writes `RETURN_CONTEXT_KEY` +
 *      scroll slot when the reader clicks an `/events/{id}` link.
 *   2. This BackLink reads `RETURN_CONTEXT_KEY` and validates it via
 *      `isValidListReturn` (same-origin + list-route allowlist — blocks
 *      `https://evil.com`, `//evil.com`, `/console/…`). Valid → render that
 *      href; invalid/absent → render `fallback`.
 *   3. On click, write `RESTORE_MARKER_KEY` (value = originating href) so the
 *      return load restores the scroll position exactly once (a refresh /
 *      direct load has no marker → lands at the top, never wrongly jumped).
 *
 * SSR safety + existing-spec preservation: `fromHref` is read via
 * `useSyncExternalStore`, whose `getServerSnapshot` returns `null`. SSR + the
 * first hydration render therefore use `href={fallback}` — byte-identical to
 * the previous bare `<Link href="/">` — so any existing href assertion on the
 * detail page stays green, and there is no hydration mismatch. After hydration,
 * `getSnapshot` reads sessionStorage and may update the href to the originating
 * list URL. `useSyncExternalStore` is the React-blessed primitive for reading
 * from an external store (sessionStorage) without a setState-in-effect cascading
 * render.
 *
 * a11y (UX-DR13): rendered as a real `<a href>` (not a JS button), so it is
 * keyboard-reachable, focusable, and middle-click-openable. Scroll restore uses
 * `behavior: "instant"` (no animation — UX-DR15 reduced-motion consistent).
 *
 * Depth cap (UX-DR12, one level): BackLink is used ONLY on the detail page.
 * The daily-page and theme-page "return" links stay as bare `<Link>` (they are
 * list→list / list→directory secondary navigation, not a detail return). This
 * component is the single reading-context-return surface.
 */

export interface BackLinkProps {
  /**
   * Fallback href when there is no captured originating context, or the
   * captured value fails the open-redirect guard. For the detail page this is
   * `/` (byte-identical to the previous bare link, so direct-load / external
   * referrer / private-mode all honestly return to the homepage top).
   */
  fallback: string;
  /** Link label/children (e.g. `<span aria-hidden>←</span> 返回首页`). */
  children: ReactNode;
  /**
   * Optional className applied to the `<a>`. Reuse the existing return-link
   * styling so there is no visual change (token-safe).
   */
  className?: string;
}

// --- useSyncExternalStore adapters -------------------------------------------

// We do NOT need cross-component reactivity (BackLink is the sole reader and it
// reads once on mount). `subscribe` is a no-op so no re-renders are scheduled
// after the initial read. `getServerSnapshot` returns null for SSR safety.
const subscribe = (): (() => void) => () => {
  // No-op: BackLink reads sessionStorage once on mount; the capture listener
  // (in <ListContextMemory/>) writes BEFORE navigation to the detail page, so
  // the value is already present when this component mounts. There is no
  // late-arriving update to re-render for.
};

/**
 * Client snapshot: read + validate the originating list href. Returns null when
 * absent / invalid / storage disabled (BackLink renders fallback).
 */
function getClientSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  const ctx = readReturnContext();
  if (ctx !== null && isValidListReturn(ctx)) return ctx;
  return null;
}

/** Server snapshot: always null (SSR renders fallback, no hydration mismatch). */
function getServerSnapshot(): null {
  return null;
}

export function BackLink({ fallback, children, className }: BackLinkProps) {
  // useSyncExternalStore: SSR returns null (→ href=fallback on first render);
  // client reads sessionStorage and may return the originating list URL. This
  // avoids the setState-in-effect cascading-render pattern.
  const fromHref = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const href = fromHref ?? fallback;

  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        // Only arm scroll restore when we are actually returning to a captured
        // list URL. A fallback click (no context / invalid context) does not
        // write a marker — the homepage top load must not try to restore a
        // stale scroll position.
        if (fromHref !== null) {
          writeRestoreMarker(fromHref);
        }
      }}
    >
      {children}
    </Link>
  );
}

