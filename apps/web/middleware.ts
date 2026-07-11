import { NextResponse, type NextRequest } from "next/server";

import { isOperatorEnabled } from "@/lib/operator-gate";

/**
 * Request-time gate for `/console/*` — the defense-in-depth layer that closes
 * the hole left by the `(operator)/layout.tsx` RSC gate.
 *
 * Why this exists (Story fix B follow-up):
 *   The layout's `redirect()` only runs during RSC render (GET). A server
 *   action POST goes straight to the action handler and does NOT re-render the
 *   layout, so without this middleware the `/console/*` write actions
 *   (submitReview / submitMerge / submitSplit / submitRevision) were reachable
 *   in production regardless of `AGUHOT_OPERATOR_ENABLED`. This middleware runs
 *   on BOTH GET and POST (and every other method) for `/console`, so a closed
 *   gate blocks the write path at the network edge before the action executes.
 *
 * Runtime: `nodejs` (NOT edge). Edge middleware only sees build-time-inlined
 * `process.env`, so a runtime-injected `AGUHOT_OPERATOR_ENABLED` would read as
 * `undefined` and the gate would silently fail. The Node.js runtime reads the
 * live runtime env. `isOperatorEnabled()` is the SAME function the layout +
 * server actions use, so all three gates are consistent by construction.
 *
 * Matcher: matches `/console` and any sub-path (`/console/:path*`), and NOTHING
 * else — `(public)` routes and API routes are untouched. The matcher is a path
 * matcher (not method-based), so POST server-action requests to `/console` are
 * intercepted too (Next.js middleware runs for all methods the matcher covers).
 *
 * When closed, redirect to `/` (mirrors the layout's closed-branch behavior —
 * a bare redirect avoids leaking the console's existence via a 403).
 */
export function middleware(request: NextRequest): NextResponse {
  if (!isOperatorEnabled()) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // `/console/:path*` covers `/console/anything/...`; the bare `/console` entry
  // is matched by the literal. Together they cover the whole console surface
  // without touching `(public)` or API routes.
  matcher: ["/console", "/console/:path*"],
  // Node.js runtime so `process.env.AGUHOT_OPERATOR_ENABLED` reads the
  // RUNTIME value (edge would only see build-time inlined env → gate stuck).
  // NOTE: value must be a bare string literal — Turbopack's static config
  // parser rejects `as const` (Next 16 build error: "runtime needs to be a
  // static string"). Also: the `middleware` file convention is deprecated in
  // Next 16 in favor of `proxy.ts`; rename is a follow-up, not blocking.
  runtime: "nodejs",
};
