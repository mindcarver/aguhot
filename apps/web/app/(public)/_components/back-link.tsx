"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import {
  isSearchReturn,
  isValidListReturn,
  readReturnContext,
  writeRestoreMarker,
} from "./list-context-memory";

/**
 * Detail-page "return to originating list" link — Story 2.5 (UX-DR12) +
 * Story 3.4 (source-aware label, AC2).
 *
 * Replaces the bare `<Link href="/">` return link on the detail page. This is
 * the single UX-DR12 landing point: when a reader enters a detail page from a
 * list (homepage feed `/?window=…` / theme `/topics/{slug}` / daily
 * `/daily?date=…` / search `/search?q=…`), the BackLink restores the
 * originating list URL (with its filter query intact) instead of always
 * falling back to the homepage top.
 *
 * Story 3.4 — source-aware LABEL (AC2 explicit entry). The href behavior is
 * byte-unchanged (still `fromHref ?? fallback`, 2.5 scroll-restore infra
 * untouched). What changes is the LABEL: when the originating context is a
 * valid search URL (`isSearchReturn(fromHref)` true), BackLink renders the
 * optional `searchLabel` (e.g. 「← 返回搜索结果」) — a page-level, history-
 * independent `<a href="/search?q=…">` that carries the original query and
 * does not depend on bfcache / browser-back. Otherwise it renders `children`
 * (the default label, e.g. 「← 返回首页」). This single return surface covers
 * both AC1 (point of return restores query + scroll, via the unchanged href)
 * and AC2 (the reader can SEE they came from search and that the entry carries
 * the query, via the source-aware label).
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
 * first hydration render therefore use `href={fallback}` AND `children` (label
 * defaults to the non-search label since `isSearchReturn(null)` is false) —
 * byte-identical to the previous bare `<Link href="/">` with static children,
 * so existing label + href assertions stay green and there is no hydration
 * mismatch. After hydration, `getSnapshot` reads sessionStorage and may update
 * BOTH the href (to the originating list URL) and the label (to `searchLabel`
 * when the origin is `/search?…`) — the two derive from the same `fromHref`
 * at the same render, so they always switch in lockstep. `useSyncExternalStore`
 * is the React-blessed primitive for reading from an external store
 * (sessionStorage) without a setState-in-effect cascading render.
 *
 * a11y (UX-DR13): rendered as a real `<a href>` (not a JS button), so it is
 * keyboard-reachable, focusable, and middle-click-openable. The search-return
 * label 「← 返回搜索结果」 is SR-readable and focusable (same `<a>` token, no
 * new visual). Scroll restore uses `behavior: "instant"` (no animation —
 * UX-DR15 reduced-motion consistent).
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
  /**
   * Story 3.4 — label rendered when the originating context is a SEARCH URL
   * (`fromHref` is a valid `/search?…` per `isSearchReturn`). When provided
   * and the reader came from search, this becomes the explicit AC2
   * 「返回搜索结果」 entry (a page-level `<a href="/search?q=…">` carrying the
   * original query). When omitted, or when the origin is NOT search, the
   * `children` label is rendered (backward-compatible — other callers that do
   * not pass `searchLabel` see no behavior change).
   *
   * Note: only the LABEL is selected by this prop; the HREF is still
   * `fromHref ?? fallback` (byte-identical to 2.5). So a search-origin reader
   * sees 「返回搜索结果」 AND is taken to `/search?q=…` (never search-label +
   * `/` mismatch). SSR / first render reads `fromHref=null` → `isSearchReturn`
   * is false → `children` renders (byte-identical to today, no hydration
   * mismatch).
   */
  searchLabel?: ReactNode;
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

export function BackLink({ fallback, children, className, searchLabel }: BackLinkProps) {
  // useSyncExternalStore: SSR returns null (→ href=fallback on first render);
  // client reads sessionStorage and may return the originating list URL. This
  // avoids the setState-in-effect cascading-render pattern.
  const fromHref = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const href = fromHref ?? fallback;
  // Story 3.4 — source-aware LABEL. When the reader came from search (and a
  // searchLabel was provided), render that explicit 「返回搜索结果」 entry.
  // Otherwise render the default `children` label. The href logic above is
  // byte-identical to 2.5; only the label selection is new. SSR / first render
  // (fromHref=null) → isSearchReturn false → children (byte-identical to today,
  // no hydration mismatch). `searchLabel ?? children` guards an absent
  // searchLabel: a caller that does not pass searchLabel always sees children.
  const label =
    fromHref !== null && isSearchReturn(fromHref)
      ? (searchLabel ?? children)
      : children;

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
      {label}
    </Link>
  );
}

