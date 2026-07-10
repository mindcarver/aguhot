/**
 * Lightweight signed-cookie session helpers — Story 3.2 (deferred-login follow).
 *
 * This is the V1 "lightweight account" session: a single signed cookie
 * `aguhot:session=<accountId>.<hmac>`. There are NO credentials (no password /
 * OAuth / magic-link) — the login action itself (startSessionAndFollow) creates
 * a UserAccount row + sets this cookie. Real credential auth is deferred to a
 * later epic (registered in deferred-work.md).
 *
 *   - createSession(accountId): set the signed cookie. httpOnly + SameSite=Lax
 *     + Secure(production) + 90-day maxAge.
 *   - readSession(): read + HMAC-verify the cookie. Returns { accountId } on a
 *     valid signature, or null on any failure (missing / tampered / truncated).
 *     NEVER throws — a bad cookie degrades silently to anonymous (AD-8: no
 *     login wall, ever).
 *   - clearSession(): delete the cookie. Reserved (no logout flow in 3.2).
 *
 * HMAC = base64url(SHA256(accountId, SESSION_SECRET)). Verification uses
 * `timingSafeEqual` to avoid signature-oracle timing side channels. SESSION_SECRET
 * is resolved at REQUEST time via `requireEnv("SESSION_SECRET")` (the env schema
 * marks it optional so `next build` stays SESSION_SECRET-free; only force-
 * dynamic routes / server actions that touch the session resolve it — same
 * pattern as DATABASE_URL).
 *
 * This module is a Next.js runtime concept (cookies via `next/headers`) and
 * therefore lives in apps/web, NOT in core (core must be runtime-agnostic).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { requireEnv } from "@aguhot/config";

/** The cookie name carrying `accountId.hmac`. */
export const SESSION_COOKIE = "aguhot:session" as const;

/** Session lifetime in seconds (90 days — supports SM-4 7-day retention measurement). */
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/**
 * Compute the base64url HMAC-SHA256 signature of `accountId` under
 * `SESSION_SECRET`. Resolves SESSION_SECRET at request time via requireEnv.
 */
function sign(accountId: string, secret: string): string {
  return createHmac("sha256", secret).update(accountId).digest("base64url");
}

/**
 * Constant-time signature verification. Returns true iff `expected` and
 * `actual` are the same length and byte-equal. Never throws on a length
 * mismatch (timingSafeEqual requires equal-length buffers, so we guard first —
 * the length leak is acceptable: the signature length is deterministic for a
 * given secret + algorithm, so a wrong-length `actual` is always a malformed
 * cookie, not a valid guess).
 */
function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Set the signed session cookie carrying `accountId`. Called by the
 * startSessionAndFollow server action after createAccount.
 *
 * `await cookies()` is the Next 16 async cookies() API. The cookie is httpOnly
 * (no JS access), SameSite=Lax (default; allows top-level navigation carries),
 * Secure in production, path=/, 90-day maxAge.
 */
export async function createSession(accountId: string): Promise<void> {
  const secret = requireEnv("SESSION_SECRET");
  const sig = sign(accountId, secret);
  const value = `${accountId}.${sig}`;
  const store = await cookies();
  store.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Read + verify the session cookie. Returns `{ accountId }` on a valid
 * signature, or `null` on any failure (missing / tampered / wrong shape). NEVER
 * throws — a bad cookie degrades silently to anonymous (AD-8).
 *
 * The accountId is extracted from the cookie value (before the last `.`) and
 * its signature recomputed + compared in constant time. A cookie whose
 * signature does not match → null (anonymous).
 */
export async function readSession(): Promise<{ accountId: string } | null> {
  let secret: string;
  try {
    secret = requireEnv("SESSION_SECRET");
  } catch {
    // SESSION_SECRET unset (e.g. a misconfigured runtime) → treat as anonymous
    // rather than crashing the request. The session simply cannot be trusted.
    return null;
  }
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw === undefined || raw === "") return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null; // malformed (no sig / empty sig)
  const accountId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (accountId === "" || sig === "") return null;
  const expected = sign(accountId, secret);
  if (!safeEqual(expected, sig)) return null;
  return { accountId };
}

/**
 * Delete the session cookie. Reserved (no logout flow in 3.2); exists so a
 * future logout / account-merge action can call it without re-plumbing the
 * cookie options.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
