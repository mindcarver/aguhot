import type { ReactNode } from "react";
import { ListContextMemory } from "./_components/list-context-memory";
import { PublicNav } from "./_components/public-nav";

/**
 * Responsive public shell — Story 1.2.
 *
 * Group-level layout for the `(public)` route group. The root `layout.tsx`
 * owns `<html>/<body>`; this layout wraps every `(public)` route in the
 * responsive shell (desktop left-rail nav + main area; mobile top bar +
 * drawer). It deliberately does NOT wrap `(operator)/console`, which stays a
 * bare placeholder until Story 1.6.
 *
 * Desktop (>=768px, `md:`): flex row — `<PublicNav>` renders the sticky
 * left-rail `<aside>`, and `<main>` takes the remaining width with
 * `min-w-0` so long content cannot push the rail off-screen.
 *
 * Mobile (<768px): block flow — `<PublicNav>` renders the sticky top
 * `<header>` (and the conditionally-rendered drawer); `<main>` stacks below.
 *
 * Story 2.5: `<ListContextMemory/>` is mounted once inside `<main>`. It renders
 * `null` (zero UI/layout impact) and provides the UX-DR12 reading-context
 * capture (document-level capture-phase click listener → writes the
 * originating list URL + scroll into sessionStorage when the reader clicks an
 * `/events/{id}` link) + one-shot scroll restore (gated by a marker BackLink
 * writes on click). It is a client component but does NOT import `@aguhot/core`
 * — the public shell stays DATABASE_URL-free at build time.
 *
 * Story 3.5 — skip-to-content entry + `<main id>` keyboard a11y baseline
 * primitives. The skip-link is the first focusable element in the `(public)`
 * route tree: it is visually hidden (`sr-only`) until `:focus`, when it
 * becomes visible (branded, absolutely-positioned). `tabIndex={-1}` on
 * `<main>` makes the skip target programmatically focusable, so activating
 * the skip-link moves focus INTO `<main>` instead of the browser jumping to
 * the first link inside it — keyboard readers can bypass the entire nav.
 * `<ListContextMemory/>` / children are unchanged: `id` / `tabIndex` are
 * static attributes that do not affect subtree behavior or the 2.5 scroll
 * restore. This layout is still a server component — the skip-link is a plain
 * `<a>` and `id`/`tabIndex` are static props, so there is no `"use client"`
 * and no hydration change.
 */
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen md:flex">
      {/*
        Story 3.5 — skip-to-content link. First focusable element in the
        (public) tree so a single Tab reaches it; `sr-only` until `:focus`,
        then revealed as a branded, absolutely-positioned chip. `href="#main"`
        + `<main id="main" tabIndex={-1}>` move focus INTO main on activation
        (WCAG 2.4.1 Bypass Blocks). The global `:focus-visible` rule in
        globals.css also applies to this link when keyboard-focused.
      */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink-primary focus:ring-2 focus:ring-focus-ring"
      >
        跳至主要内容
      </a>
      <PublicNav />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1">
        <ListContextMemory />
        {children}
      </main>
    </div>
  );
}
