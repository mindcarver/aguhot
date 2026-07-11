/**
 * Operator auth helper for e2e — mints a signed `aguhot:operator` cookie.
 *
 * Production mode (`next start`, NODE_ENV=production) closes the non-production
 * bypass in `lib/operator-auth.ts`, so `/console/*` 307-redirects to
 * `/console/login` without a valid operator cookie. This helper simulates an
 * already-logged-in operator by minting the SAME signed cookie the login server
 * action would set — WITHOUT driving the login UI — so the console/revision/
 * merge-split e2e suites can exercise the operator pages under production mode.
 *
 * Mirrors `e2e/watchlist.spec.ts`'s `loginAsAccountA` pattern:
 *   - signSessionCookie is the SINGLE source of truth for the cookie value
 *     (imported from `lib/session-cookie-signer.js`, the pure signer with NO
 *     `next/headers` import so playwright's ESM loader can resolve it).
 *   - SESSION_SECRET is resolved lazily at call time via requireEnv, so
 *     `playwright test --list` and module import do not throw when the env is
 *     unset. The e2e:* scripts inject SESSION_SECRET into the process env before
 *     running playwright; by the time any test body calls this, the env is
 *     populated. The secret MUST match the server-side SESSION_SECRET for
 *     verifySessionCookie to pass — the e2e:* scripts inline the same value the
 *     server boots with.
 *
 * Differences from the viewer (watchlist) cookie:
 *   - accountId is the fixed literal `"operator"` (operator-auth.ts gates on
 *     this literal — a viewer session cookie cannot be replayed as operator).
 *   - cookie name is `aguhot:operator` (NOT `aguhot:session`).
 */

import type { BrowserContext } from "@playwright/test";

import { requireEnv } from "@aguhot/config";

import { signSessionCookie } from "../lib/session-cookie-signer.js";

/** The cookie name carrying the operator signature (mirrors operator-auth.ts). */
const OPERATOR_COOKIE = "aguhot:operator";

/** The accountId literal encoded in the signed cookie value. */
const OPERATOR_ACCOUNT_ID = "operator";

/**
 * Resolve SESSION_SECRET lazily (at test-run time, not module-import time) so
 * `playwright test --list` and module import do not throw when the env is
 * unset. The e2e:* scripts inject SESSION_SECRET into the process env before
 * running playwright; by the time any test body calls this, the env is
 * populated.
 */
function sessionSecret(): string {
  return requireEnv("SESSION_SECRET");
}

/**
 * Mint a signed operator cookie value and add it to the browser context.
 *
 * Equivalent to the state the loginOperator server action leaves the viewer in:
 * a valid signed `aguhot:operator` cookie that readOperatorSession /
 * isRequestAuthenticated accept. Call this BEFORE the first `page.goto("/console...")`
 * in each test that touches `/console/*`.
 */
export async function authenticateOperator(context: BrowserContext): Promise<void> {
  const value = signSessionCookie(OPERATOR_ACCOUNT_ID, sessionSecret());
  await context.addCookies([
    {
      name: OPERATOR_COOKIE,
      value,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}
