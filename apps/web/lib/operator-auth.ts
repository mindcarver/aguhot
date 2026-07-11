/**
 * Operator authentication — shared operator key + signed cookie.
 *
 * This replaces the old env-flag gate (`lib/operator-gate.ts`, deleted) with
 * REAL authentication for `/console/*`. The design mirrors `lib/session.ts`
 * (the viewer session) byte-for-byte in cookie attributes, secret resolution,
 * and HMAC verify path — but the account id is the fixed literal `"operator"`
 * (a shared operator key, NOT per-operator identity yet).
 *
 *   - createOperatorSession(): mint the signed cookie `aguhot:operator`. Cookie
 *     attributes mirror createSession EXACTLY (httpOnly + SameSite=Lax +
 *     Secure(production) + 90-day maxAge + path="/"). Called by the login
 *     server action AFTER the submitted token passes a timing-safe comparison
 *     against `AGUHOT_OPERATOR_TOKEN`.
 *   - readOperatorSession(): read + HMAC-verify the cookie. Returns
 *     `{ accountId: "operator" }` on a valid signature whose accountId is
 *     `"operator"`, or null on any failure (missing / tampered / wrong account).
 *     NEVER throws — a bad cookie degrades silently to unauthenticated.
 *   - isOperatorAuthenticated(): the high-level gate. NON-production always
 *     returns true (dev/test + e2e seed reach `/console/*` without a token —
 *     the same bypass the old flag had, preserving seed reachability). In
 *     production it requires a valid signed cookie.
 *   - isRequestAuthenticated(request): edge/middleware entry point. Middleware
 *     runs on the Node.js runtime and reads the cookie off the incoming
 *     NextRequest directly (it CANNOT call `cookies()` from `next/headers` —
 *     that API is for RSC / server actions only). Centralized here so
 *     middleware.ts and the RSC/action gates share one verify path.
 *
 * HMAC = base64url(SHA256("operator", SESSION_SECRET)). The signer is the
 * SINGLE source of truth from `./session-cookie-signer` — this module does NOT
 * reimplement HMAC. SESSION_SECRET is resolved at REQUEST time via
 * `requireEnv("SESSION_SECRET")` (the env schema marks it optional so
 * `next build` stays SESSION_SECRET-free — same pattern as DATABASE_URL and
 * AGUHOT_OPERATOR_TOKEN).
 *
 * AGUHOT_OPERATOR_TOKEN is resolved at REQUEST time in the LOGIN action only
 * (not here) — this module is the cookie verify path, not the login path. The
 * token is NEVER logged, NEVER echoed in a response, and compared with
 * `safeEqual` (timing-safe, equal-length guarded) to avoid a token-oracle
 * timing side channel.
 */

import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { requireEnv } from "@aguhot/config";

import { signSessionCookie, verifySessionCookie } from "./session-cookie-signer";

/** The cookie name carrying the operator signature. */
export const OPERATOR_COOKIE = "aguhot:operator" as const;

/**
 * The accountId literal encoded in the signed cookie value. The cookie value
 * is `operator.${base64url hmac}` — verify passes iff the signature is valid
 * AND the accountId is exactly this literal (so a viewer session cookie
 * `aguhot:session=<viewer>.<sig>` cannot be replayed as an operator cookie:
 * different cookie name AND the accountId check would reject it even if the
 * names collided).
 */
const OPERATOR_ACCOUNT_ID = "operator";

/** Operator session lifetime — mirrors the viewer session (90 days). */
const OPERATOR_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/**
 * Set the signed operator cookie. Called by the login server action after the
 * submitted token passes the timing-safe comparison against
 * `AGUHOT_OPERATOR_TOKEN`.
 *
 * `await cookies()` is the Next 16 async cookies() API. Cookie attributes
 * mirror `createSession` in `lib/session.ts` EXACTLY (httpOnly + SameSite=Lax
 * + Secure(production) + path="/" + same maxAge) so the two session cookies
 * have identical security posture.
 */
export async function createOperatorSession(): Promise<void> {
  const secret = requireEnv("SESSION_SECRET");
  // Delegate to the pure signer so the operator cookie and the viewer cookie
  // share a SINGLE HMAC implementation (no twin-sign drift risk).
  const value = signSessionCookie(OPERATOR_ACCOUNT_ID, secret);
  const store = await cookies();
  store.set(OPERATOR_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OPERATOR_MAX_AGE_SECONDS,
  });
}

/**
 * Read + verify the operator cookie from `next/headers` cookies() (the RSC /
 * server-action entry point). Returns `{ accountId: "operator" }` on a valid
 * signature whose accountId is `"operator"`, or null on any failure (missing /
 * tampered / wrong account / secret unset). NEVER throws — a bad cookie
 * degrades silently to unauthenticated.
 */
export async function readOperatorSession(): Promise<{ accountId: string } | null> {
  let secret: string;
  try {
    secret = requireEnv("SESSION_SECRET");
  } catch {
    // SESSION_SECRET unset (e.g. a misconfigured runtime) → treat as
    // unauthenticated rather than crashing the request.
    return null;
  }
  const store = await cookies();
  const raw = store.get(OPERATOR_COOKIE)?.value;
  if (raw === undefined || raw === "") return null;
  const verified = verifySessionCookie(raw, secret);
  if (verified === null) return null;
  // Defense-in-depth: the cookie name is dedicated, but enforce that the
  // signed accountId is the operator literal (a replayed viewer cookie — were
  // the names ever to collide — would carry a different accountId and is
  // rejected here).
  if (verified.accountId !== OPERATOR_ACCOUNT_ID) return null;
  return verified;
}

/**
 * The high-level operator gate. Used by RSC layouts / pages and the
 * first-line of each server action.
 *
 * NON-production always returns true — dev/test + e2e seed reach `/console/*`
 * without a token (the same bypass the old `isOperatorEnabled` flag had, so
 * `pnpm e2e:console` seed/spec paths stay reachable). In production a valid
 * signed operator cookie is required.
 */
export async function isOperatorAuthenticated(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  return (await readOperatorSession()) !== null;
}

/**
 * Middleware entry point. Middleware runs on the Node.js runtime and reads
 * the cookie off the incoming `NextRequest` directly — it CANNOT call
 * `cookies()` from `next/headers` (that API is for RSC / server actions).
 *
 * Mirrors `isOperatorAuthenticated`'s env-bypass + verify logic, but against
 * `request.cookies` and `process.env.SESSION_SECRET` (middleware on the
 * nodejs runtime reads the live runtime env directly; no requireEnv so a
 * missing secret degrades silently to unauthenticated rather than throwing
 * inside the middleware response cycle).
 *
 * Centralized here so middleware.ts and the RSC/action gates share ONE verify
 * path — avoiding drift between the edge gate and the request-time gate.
 */
export function isRequestAuthenticated(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const raw = request.cookies.get(OPERATOR_COOKIE)?.value;
  if (raw === undefined || raw === "") return false;
  const verified = verifySessionCookie(raw, secret);
  if (verified === null) return false;
  return verified.accountId === OPERATOR_ACCOUNT_ID;
}

/**
 * Delete the operator cookie. Called by the logout server action.
 */
export async function clearOperatorSession(): Promise<void> {
  const store = await cookies();
  store.delete(OPERATOR_COOKIE);
}
