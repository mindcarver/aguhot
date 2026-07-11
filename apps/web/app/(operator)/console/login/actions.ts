"use server";

import { redirect } from "next/navigation";

import { requireEnv } from "@aguhot/config";

import {
  clearOperatorSession,
  createOperatorSession,
} from "@/lib/operator-auth";
import { safeEqual } from "@/lib/session-cookie-signer";

/**
 * Operator login + logout server actions. Story: real operator auth (replaces
 * the env-flag gate).
 *
 *   - loginOperator(formData): timing-safe compare the submitted token against
 *     AGUHOT_OPERATOR_TOKEN. On match, mint the signed operator cookie via
 *     createOperatorSession() and redirect to /console. On ANY mismatch
 *     (missing / wrong value / wrong length) return a GENERIC error — never
 *     reveal which sub-case failed, to avoid token enumeration.
 *   - logoutOperator(): clear the operator cookie, redirect to /console/login.
 *
 * Security:
 *   - Token comparison uses `safeEqual` (timingSafeEqual with an equal-length
 *     guard) so a wrong token does not leak length/byte information via timing.
 *   - The error response is a single generic message for all failure modes
 *     (missing env, wrong value, malformed input) — no enumeration oracle.
 *   - The token is NEVER logged, NEVER echoed in a response. requireEnv throws
 *     on a missing token; we catch and convert to the same generic error.
 *
 * NOTE: loginOperator is deliberately NOT gated by isOperatorAuthenticated —
 * the login action MUST be reachable by an unauthenticated operator (otherwise
 * no one can ever log in). The /console/login ROUTE is also exempted from the
 * middleware gate (see middleware.ts).
 */

/** Generic error returned for every login failure (no enumeration oracle). */
const LOGIN_ERROR = "凭证无效" as const;

export interface LoginResult {
  error?: string;
}

/**
 * Verify the submitted operator token and mint the signed session cookie.
 *
 * The token field name is "token" (the login form's password input `name`).
 * On success this function redirects (which throws in Next's server-action
 * machinery — that is expected); on failure it returns `{ error }`.
 *
 * Signature is `(prevState, formData)` so the action composes with
 * `useActionState` (which passes the previous result as the first arg and the
 * form data as the second). `prevState` is intentionally ignored — every
 * attempt is evaluated independently (no rate-limiting state lives here).
 */
export async function loginOperator(
  _prevState: LoginResult | undefined,
  formData: FormData,
): Promise<LoginResult> {
  const submitted = formData.get("token");

  // A missing/non-string field is a tampered form, not an expected path —
  // return the generic error (do NOT distinguish from a wrong-value case).
  if (typeof submitted !== "string" || submitted === "") {
    return { error: LOGIN_ERROR };
  }

  let expected: string;
  try {
    expected = requireEnv("AGUHOT_OPERATOR_TOKEN");
  } catch {
    // Token not configured at runtime → closed. Return the generic error so an
    // attacker cannot distinguish "no token configured" from "wrong token".
    return { error: LOGIN_ERROR };
  }

  // Timing-safe comparison. safeEqual returns false immediately on a length
  // mismatch (timingSafeEqual requires equal-length buffers, so we guard
  // first) — the length leak is acceptable: the configured token length is not
  // secret, and a wrong-length guess is always a malformed attempt. On equal
  // lengths the comparison is constant-time.
  if (!safeEqual(expected, submitted)) {
    return { error: LOGIN_ERROR };
  }

  // Token matches: mint the signed operator cookie and enter the console.
  await createOperatorSession();
  redirect("/console");
}

/**
 * Clear the operator cookie and return to the login page. Reachable by an
 * already-authenticated operator (the logout button posts to this action).
 * Gated by isOperatorAuthenticated at the action first-line would be fine too,
 * but clearing a cookie is idempotent so it is left ungated.
 */
export async function logoutOperator(): Promise<void> {
  await clearOperatorSession();
  redirect("/console/login");
}
