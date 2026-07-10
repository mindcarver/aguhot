/**
 * PURE session-cookie value signer — the single source of truth for the
 * `aguhot:session` cookie value format (`${accountId}.${base64url hmac}`).
 *
 * Story 3.3: extracted into its own module (NO `next/headers` import) so the
 * e2e seed/spec can import it under playwright's ESM loader WITHOUT pulling in
 * `next/headers` (which playwright's loader cannot resolve the way Next's dev
 * server does). `session.ts` re-exports this fn so the server-action path and
 * the e2e path produce byte-identical cookie values — avoiding HMAC-formula
 * drift.
 *
 * Pure: only Node `crypto` (no `next/headers`, no env read, no I/O). The secret
 * is an explicit arg; the caller resolves it (createSession via requireEnv at
 * request time; e2e from process.env at seed time).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compute the base64url HMAC-SHA256 signature of `accountId` under `secret`.
 *
 * Exported (not just used internally) so `session.ts`'s `readSession` imports
 * THIS function for its recompute-and-compare path — eliminating the twin-`sign`
 * drift risk (a single source of truth for both mint and verify). Story 3.3
 * review: a private twin in readSession could silently diverge from
 * signSessionCookie, breaking all authenticated sessions with no default-e2e
 * coverage (the @watchlist suite is grep-inverted out of `pnpm e2e`).
 */
export function sign(accountId: string, secret: string): string {
  return createHmac("sha256", secret).update(accountId).digest("base64url");
}

/**
 * Constant-time signature verification (mirrors `session.ts`'s `safeEqual`).
 * Exported so the selfcheck can exercise the verify path without `next/headers`.
 */
export function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a cookie value produced by `signSessionCookie`. Returns the accountId
 * on a valid signature, or `null` on any failure (malformed / tampered / wrong
 * secret). Pure mirror of `readSession`'s verify logic — kept here as the
 * canonical statement of the format so the selfcheck can pin mint↔verify without
 * importing `next/headers`. `readSession` itself stays the runtime entry point
 * (it owns cookie I/O + the SESSION_SECRET requireEnv); this fn owns only the
 * value-level check.
 */
export function verifySessionCookie(value: string, secret: string): { accountId: string } | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const accountId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (accountId === "" || sig === "") return null;
  if (!safeEqual(sign(accountId, secret), sig)) return null;
  return { accountId };
}

/**
 * Produce the `aguhot:session` cookie value for `accountId` signed with
 * `secret`. The value is `${accountId}.${base64url hmac}` — `verifySessionCookie`
 * (and `readSession`, via the same shared `sign`) splits on the last `.` and
 * recomputes the signature for constant-time comparison.
 */
export function signSessionCookie(accountId: string, secret: string): string {
  const sig = sign(accountId, secret);
  return `${accountId}.${sig}`;
}
