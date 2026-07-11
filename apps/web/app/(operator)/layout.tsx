import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Operator route group layout — Story 1.6.
 *
 * Groups every `(operator)` route under a shared layout that:
 *   1. Sets `robots: { index: false, follow: false }` so /console and any future
 *      operator route is never indexed by search engines (resolves the 1-1
 *      deferred item: the /console placeholder was publicly reachable and
 *      indexable with no noindex).
 *   2. Gates every `/console/*` route (and its server actions) behind a
 *      deployment gate so unauthenticated requests cannot reach the operator
 *      write path. V1 has NO real auth (deferred to user-profile per
 *      deferred-work.md) — but the write actions (submitReview / submitMerge /
 *      submitSplit) hit the DB, and `robots:noindex` does not mitigate WRITE
 *      permission. To ship V1 without an open write surface, the console is
 *      closed by default in production and must be explicitly opened via
 *      `AGUHOT_OPERATOR_ENABLED=true`. dev/test stay open (local dev + e2e
 *      seed reach `/console/*` without a flag). When real operator auth lands,
 *      this gate is replaced by a session/role check — the layout remains the
 *      single trust-boundary seam.
 *   3. Serves as the drop-in structure point for real operator auth when the
 *      user-profile module lands (a future epic).
 *
 * This layout deliberately does NOT wrap `(public)` routes — it only applies to
 * the `(operator)` route group, so the public shell (left-rail nav, no noindex)
 * is untouched.
 *
 * `force-dynamic` is required so the gate evaluates at REQUEST time (not build
 * time) — otherwise a production build would freeze NODE_ENV/AGUHOT_OPERATOR_ENABLED
 * at build and the gate would not reflect per-request env.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Deployment gate for the operator console. In production the console is
 * closed unless `AGUHOT_OPERATOR_ENABLED=true` is set in the runtime env.
 * dev/test are always open (local development + e2e seed need `/console/*`).
 *
 * Read directly from `process.env` — same pattern as `lib/session.ts` reading
 * `process.env.NODE_ENV`. Not added to `packages/config/env.ts`'s schema: this
 * is a Next.js runtime guard, not an infra contract that a workspace asserts;
 * adding a schema field for a one-off boolean gate would be over-engineering.
 */
function isOperatorEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AGUHOT_OPERATOR_ENABLED === "true";
}

export default async function OperatorLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  if (!isOperatorEnabled()) {
    // Closed by default in production. Redirect to the public home rather than
    // rendering a 403 page: the console is an internal surface, and a bare
    // redirect avoids leaking its existence.
    redirect("/");
  }
  return <>{children}</>;
}
