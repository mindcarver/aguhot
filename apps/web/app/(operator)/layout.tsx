import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Operator route group layout — Story 1.6.
 *
 * Groups every `(operator)` route under a shared layout that:
 *   1. Sets `robots: { index: false, follow: false }` so /console and any future
 *      operator route is never indexed by search engines (resolves the 1-1
 *      deferred item: the /console placeholder was publicly reachable and
 *      indexable with no noindex).
 *   2. Serves as the drop-in structure point for real operator auth when the
 *      user-profile module lands (a future epic). V1 has NO auth — the console
 *      is dev-time reachable — which is honestly recorded in deferred-work.md
 *      (not a security gap being silently shipped; a system-without-auth is
 *      connectable, and a one-off throwaway auth would be over-engineering).
 *
 * This layout deliberately does NOT wrap `(public)` routes — it only applies to
 * the `(operator)` route group, so the public shell (left-rail nav, no noindex)
 * is untouched.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function OperatorLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
