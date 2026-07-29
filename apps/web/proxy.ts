import { NextResponse, type NextRequest } from "next/server";

import { isRequestAuthenticated } from "@/lib/operator-auth";

/**
 * Request-time auth gate for `/console/*` — the primary trust boundary.
 *
 * Replaces the old env-flag gate (`isOperatorEnabled`) with REAL auth: a
 * signed operator cookie (`aguhot:operator`) issued by the login server
 * action after a timing-safe token comparison. The verify path is shared with
 * the RSC/action gates via `isRequestAuthenticated` in `lib/operator-auth.ts`,
 * so proxy, layout, and the 4 server actions all agree on "is this an
 * authenticated operator request?".
 *
 *   - `/console/login` is ALWAYS allowed through (an unauthenticated operator
 *     must be able to reach the login form + the login action).
 *   - Every other `/console/*` path requires `isRequestAuthenticated(request)`
 *     to pass; on failure it redirects to `/console/login`.
 *   - NON-production bypass (inside `isRequestAuthenticated`): dev/test always
 *     returns true so `pnpm e2e:console` seed/spec paths stay reachable
 *     without a token.
 *
 * Runtime: Proxy defaults to the Node.js runtime (Next 16+), which is what we
 * need — the nodejs runtime reads the live runtime `process.env.SESSION_SECRET`
 * / `process.env.NODE_ENV` directly; the old edge middleware would only see
 * build-time-inlined env and the verify would silently fail closed (or the
 * NODE_ENV bypass would freeze at build). Note: the `runtime` config option is
 * NOT available in proxy files (setting it throws) — nodejs is the default, so
 * nothing to declare.
 *
 * Matcher: matches `/console` and any sub-path (`/console/:path*`), and
 * NOTHING else — `(public)` routes and API routes are untouched. The matcher
 * is a path matcher (not method-based), so POST server-action requests to
 * `/console` are intercepted too (Next.js proxy runs for all methods the
 * matcher covers) — this is what closes the write-path hole (server actions
 * POST straight to the action handler without re-rendering the layout).
 *
 * On a closed gate, redirect to `/console/login` (NOT a 403) — mirrors the
 * login flow so an operator with an expired cookie re-authenticates smoothly.
 */
export function proxy(request: NextRequest): NextResponse {
  const pathname = new URL(request.url).pathname;
  // The login route + login action must be reachable by an unauthenticated
  // operator. Without this carve-out the proxy would redirect /console/login
  // → /console/login → ... infinitely.
  if (pathname === "/console/login") {
    return NextResponse.next();
  }
  if (!isRequestAuthenticated(request)) {
    return NextResponse.redirect(new URL("/console/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // `/console/:path*` covers `/console/anything/...`; the bare `/console` entry
  // is matched by the literal. Together they cover the whole console surface
  // without touching `(public)` or API routes.
  matcher: ["/console", "/console/:path*"],
  // No `runtime` key: Proxy defaults to the nodejs runtime in Next 16+, which
  // is required here so `process.env.SESSION_SECRET` / `process.env.NODE_ENV`
  // read the RUNTIME value (edge would only see build-time inlined env → gate
  // stuck). The `runtime` option is no longer permitted in proxy files.
};
