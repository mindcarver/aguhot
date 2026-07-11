/**
 * Self-check for the operator signed-cookie auth — sign/verify round-trip +
 * safeEqual behavior (no infra, no DB, no Next runtime, no test framework).
 *
 * Run with: pnpm --filter web verify:operator-auth
 *           (tsx lib/operator-auth.selfcheck.ts)
 *
 * This replaces the old `operator-gate.selfcheck.ts` (deleted along with
 * `operator-gate.ts`). The old selfcheck pinned an env-flag on/off gate; the
 * new gate is REAL auth (shared operator key + signed cookie), so the selfcheck
 * pins the HMAC round-trip that the gate's security rests on.
 *
 * operator-auth.ts reuses `signSessionCookie` / `verifySessionCookie` / `safeEqual`
 * from `./session-cookie-signer` (the single HMAC truth source — NO second HMAC
 * implementation here). This selfcheck exercises those fns with the operator
 * accountId literal ("operator") to pin:
 *   - signSessionCookie("operator", secret) ↔ verifySessionCookie round-trip
 *     (valid → { accountId: "operator" }; tampered → null; wrong secret → null;
 *     malformed → null)
 *   - the encoded accountId is exactly "operator" (a replayed viewer cookie
 *     carrying a different accountId would be rejected by readOperatorSession's
 *     accountId === "operator" guard — not pinned here because that guard lives
 *     in operator-auth.ts which imports next/headers; this selfcheck stays pure)
 *   - safeEqual: equal-length equal → true; equal-length different → false;
 *     different-length → false (the login action's timing-safe token compare)
 *
 * The env-bypass logic (`isOperatorAuthenticated` returns true when
 * NODE_ENV !== "production") is NOT pinned here because it lives in the
 * next/headers-bearing operator-auth.ts module (importing it would pull
 * next/headers into a tsx script). The bypass is a one-line `process.env` read
 * exercised by the e2e:console suite (seed reaches /console in test without a
 * token). Documenting here so a future reader knows the gap is intentional.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * web selfcheck convention (no test framework, plain assertions + process.exit).
 */

import {
  safeEqual,
  signSessionCookie,
  verifySessionCookie,
} from "./session-cookie-signer.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const SECRET = "test-operator-secret-32chars-min";
const OPERATOR_ID = "operator";

function main(): void {
  const assertions: Assertion[] = [];

  // --- Format: value = "operator.${sig}" --------------------------------
  assertions.push(
    accept('signSessionCookie("operator", secret) format = "operator.sig"', () => {
      const value = signSessionCookie(OPERATOR_ID, SECRET);
      const dot = value.lastIndexOf(".");
      if (dot !== value.indexOf(".")) {
        throw new Error("expected exactly one '.' (operator id has no dots; base64url sig has none)");
      }
      if (dot <= 0 || dot === value.length - 1) throw new Error("dot out of range");
      if (value.slice(0, dot) !== OPERATOR_ID) {
        throw new Error(`accountId prefix not preserved: expected "${OPERATOR_ID}"`);
      }
      if (value.slice(dot + 1) === "") throw new Error("empty signature");
    }),
  );

  // --- Round-trip: mint → verify accepts with accountId "operator" -------
  assertions.push(
    accept('round-trip: verify(signSessionCookie("operator")) → { accountId: "operator" }', () => {
      const value = signSessionCookie(OPERATOR_ID, SECRET);
      const out = verifySessionCookie(value, SECRET);
      if (out === null) throw new Error("verify returned null for a valid cookie");
      if (out.accountId !== OPERATOR_ID) {
        throw new Error(`expected accountId "${OPERATOR_ID}", got "${out.accountId}"`);
      }
    }),
  );

  // --- Tampered signature → rejected ------------------------------------
  assertions.push(
    accept("tampered signature → rejected (null)", () => {
      const value = signSessionCookie(OPERATOR_ID, SECRET);
      const dot = value.lastIndexOf(".");
      const tampered = `${value.slice(0, dot)}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
      if (verifySessionCookie(tampered, SECRET) !== null) {
        throw new Error("tampered signature was accepted");
      }
    }),
  );

  // --- Wrong secret → rejected ------------------------------------------
  assertions.push(
    accept("wrong secret → rejected (null)", () => {
      const value = signSessionCookie(OPERATOR_ID, SECRET);
      if (verifySessionCookie(value, "completely-different-secret-32chars") !== null) {
        throw new Error("cookie minted under one secret was accepted under another");
      }
    }),
  );

  // --- Malformed value (no dot) → rejected ------------------------------
  assertions.push(
    accept("malformed value (no dot) → rejected (null)", () => {
      if (verifySessionCookie("no-dot-here", SECRET) !== null) {
        throw new Error("malformed cookie without a dot was accepted");
      }
    }),
  );

  // --- Malformed value (empty sig) → rejected ---------------------------
  assertions.push(
    accept('malformed value ("operator.") → rejected (null)', () => {
      if (verifySessionCookie(`${OPERATOR_ID}.`, SECRET) !== null) {
        throw new Error("cookie with empty signature was accepted");
      }
    }),
  );

  // --- A non-"operator" accountId also verifies (accountId is not a magic
  //     string for the signer) — readOperatorSession's account guard is what
  //     rejects a replayed viewer cookie. Pin that the signer itself does NOT
  //     special-case "operator" (the guard is operator-auth.ts's job). -------
  assertions.push(
    accept("signer does NOT special-case operator: a viewer id also verifies", () => {
      const viewerId = "019f4dcf-5029-7717-bc1b-15860e71ed7d";
      const value = signSessionCookie(viewerId, SECRET);
      const out = verifySessionCookie(value, SECRET);
      if (out === null) throw new Error("viewer-id cookie should verify (signer is generic)");
      if (out.accountId !== viewerId) throw new Error("viewer accountId not round-tripped");
      // The operator guard (readOperatorSession) would reject this because
      // out.accountId !== "operator" — that guard is NOT exercised here (it
      // lives in the next/headers-bearing module). Pinned for documentation.
    }),
  );

  // --- safeEqual: login action's timing-safe token compare --------------
  // The login action calls safeEqual(expectedToken, submittedToken). Pin the
  // three meaningful cases so a regression (e.g. swapping to ===) is caught.
  assertions.push(
    accept("safeEqual: equal → true; different same-length → false; different-length → false", () => {
      if (!safeEqual("abc", "abc")) throw new Error("equal strings should be equal");
      if (safeEqual("abc", "abd")) throw new Error("different same-length strings should not be equal");
      if (safeEqual("abc", "ab")) throw new Error("different-length strings should not be equal");
      if (safeEqual("secret-token-32chars-min", "secret-token-32chars-mim")) {
        throw new Error("one-char diff in equal-length strings should not be equal");
      }
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
  console.log("=== web operator-auth sign/verify + safeEqual self-check ===");
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
