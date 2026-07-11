import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Operator route group layout — Story 1.6 + Story (real operator auth).
 *
 * Groups every `(operator)` route under a shared layout that:
 *   1. Sets `robots: { index: false, follow: false }` so /console and any future
 *      operator route is never indexed by search engines.
 *   2. (Auth gate REMOVED here) — the real auth gate lives in `middleware.ts`
 *      (the primary edge gate, covering BOTH GET and POST) and in each server
 *      action's first-line `isOperatorAuthenticated()` check (defense-in-depth
 *      against a misconfigured matcher). The layout previously hosted the gate,
 *      but a layout `redirect()` would now send `/console/login` into a redirect
 *      loop (login lives under this layout), so the layout no longer gates — it
 *      only sets noindex + renders children.
 *
 * This layout deliberately does NOT wrap `(public)` routes — it only applies to
 * the `(operator)` route group, so the public shell (left-rail nav, no noindex)
 * is untouched.
 *
 * `force-dynamic` is required so routes under this layout evaluate at REQUEST
 * time (not build time) — the auth cookie + env resolution must not be frozen
 * at build.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function OperatorLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
