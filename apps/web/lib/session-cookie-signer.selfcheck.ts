/**
 * Self-check for the session-cookie signer + verify round-trip (no infra, no
 * DB, no Next runtime).
 *
 * Run with: pnpm --filter web verify:session-cookie
 *           (tsx lib/session-cookie-signer.selfcheck.ts)
 *
 * Story 3.3 review (verification-gap + adversarial): the cookie value format
 * has TWO consumers that must agree byte-for-byte — `signSessionCookie` (mint,
 * used by createSession + the e2e seed) and `readSession` (verify, via the
 * shared `sign`). The default `pnpm --filter web e2e` excludes `@watchlist`
 * (grep-invert), so a drift between mint and verify would break EVERY
 * authenticated session and only the manually-run `e2e:watchlist` would catch
 * it. This selfcheck pins the round-trip with no DB and no `next/headers`, so
 * it runs fast and anywhere.
 *
 * Drives:
 *   - signSessionCookie output format = `${accountId}.${sig}` (one dot, sig
 *     non-empty, accountId prefix preserved)
 *   - round-trip: verifySessionCookie(signSessionCookie(id, secret)) → id
 *   - tampered signature → rejected (null)
 *   - wrong secret → rejected (null)
 *   - malformed value (no dot / empty segments) → rejected (null)
 *   - different accountIds under same secret produce distinct signatures
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * web selfcheck convention (no test framework, plain assertions + process.exit).
 */

import {
  safeEqual,
  sign,
  signSessionCookie,
  verifySessionCookie,
} from "./session-cookie-signer.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const SECRET = "test-session-secret-32chars-min";
const ACCOUNT_A = "019f4dcf-5029-7717-bc1b-15860e71ed7d";
const ACCOUNT_B = "019f4dcf-4fe0-7c97-8f36-16070bb67858";

function main(): void {
  const assertions: Assertion[] = [];

  // --- Format: value = `${accountId}.${sig}` -----------------------------
  assertions.push(
    accept("signSessionCookie format = accountId.sig (one dot, non-empty sig)", () => {
      const value = signSessionCookie(ACCOUNT_A, SECRET);
      const dot = value.lastIndexOf(".");
      if (dot !== value.indexOf(".")) {
        throw new Error("expected exactly one '.' (accountId has no dots; base64url sig has none)");
      }
      if (dot <= 0 || dot === value.length - 1) throw new Error("dot out of range");
      if (value.slice(0, dot) !== ACCOUNT_A) throw new Error("accountId prefix not preserved");
      if (value.slice(dot + 1) === "") throw new Error("empty signature");
    }),
  );

  // --- Round-trip: mint → verify accepts ----------------------------------
  assertions.push(
    accept("round-trip: verify(signSessionCookie(id)) → id", () => {
      const value = signSessionCookie(ACCOUNT_A, SECRET);
      const out = verifySessionCookie(value, SECRET);
      if (out === null) throw new Error("verify returned null for a valid cookie");
      if (out.accountId !== ACCOUNT_A) throw new Error(`expected ${ACCOUNT_A}, got ${out.accountId}`);
    }),
  );

  // --- Tampered signature → rejected --------------------------------------
  assertions.push(
    accept("tampered signature → rejected", () => {
      const value = signSessionCookie(ACCOUNT_A, SECRET);
      const dot = value.lastIndexOf(".");
      const tampered = `${value.slice(0, dot)}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      if (verifySessionCookie(tampered, SECRET) !== null) {
        throw new Error("tampered signature was accepted");
      }
    }),
  );

  // --- Wrong secret → rejected --------------------------------------------
  assertions.push(
    accept("wrong secret → rejected", () => {
      const value = signSessionCookie(ACCOUNT_A, SECRET);
      if (verifySessionCookie(value, "completely-different-secret-32chars") !== null) {
        throw new Error("cookie minted under one secret was accepted under another");
      }
    }),
  );

  // --- Malformed value (no dot) → rejected --------------------------------
  assertions.push(
    accept("malformed value (no dot) → rejected", () => {
      if (verifySessionCookie("no-dot-here", SECRET) !== null) {
        throw new Error("malformed cookie without a dot was accepted");
      }
    }),
  );

  // --- Malformed value (empty sig) → rejected -----------------------------
  assertions.push(
    accept("malformed value (empty sig) → rejected", () => {
      if (verifySessionCookie(`${ACCOUNT_A}.`, SECRET) !== null) {
        throw new Error("cookie with empty signature was accepted");
      }
    }),
  );

  // --- Distinct accountIds → distinct signatures --------------------------
  assertions.push(
    accept("distinct accountIds → distinct signatures", () => {
      const sigA = sign(ACCOUNT_A, SECRET);
      const sigB = sign(ACCOUNT_B, SECRET);
      if (sigA === sigB) throw new Error("two different accountIds produced the same signature");
    }),
  );

  // --- safeEqual is constant-time-shaped + correct ------------------------
  assertions.push(
    accept("safeEqual: equal strings → true; different → false", () => {
      if (!safeEqual("abc", "abc")) throw new Error("equal strings should be equal");
      if (safeEqual("abc", "abd")) throw new Error("different strings should not be equal");
      if (safeEqual("abc", "ab")) throw new Error("different-length strings should not be equal");
    }),
  );

  report(assertions);
}

/** Run a case whose body MUST return normally. */
function accept(name: string, body: () => void): Assertion {
  try {
    body();
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message };
  }
}

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== web session-cookie signer round-trip self-check ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

main();
