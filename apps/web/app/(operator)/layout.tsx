import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isOperatorEnabled } from "@/lib/operator-gate";

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
 * Deployment gate lives in `lib/operator-gate.ts` so the SAME gate covers:
 *   - this layout (RSC render / GET gate), and
 *   - `middleware.ts` (GET + POST request gate — server actions POST straight
 *     to the action handler without re-rendering the layout, so the layout gate
 *     alone does not cover the write path), and
 *   - each server action's first-line defense-in-depth gate.
 *
 * See `lib/operator-gate.ts` for the env contract.
 */

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
