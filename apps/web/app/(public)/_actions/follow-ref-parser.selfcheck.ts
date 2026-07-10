/**
 * Self-check for the action-layer trust-boundary parser (no infra, no DB, no
 * Next runtime).
 *
 * Run with: pnpm --filter web verify:follow-ref
 *           (tsx app/(public)/_actions/follow-ref-parser.selfcheck.ts)
 *
 * Pins parseFollowRef's rejection matrix at the ACTION layer (the trust
 * boundary that receives raw formData strings). parseFollowRef delegates to
 * core's assertValidFollowRef so both layers enforce identically; this selfcheck
 * proves the delegation actually fires (a 50-char non-UUID hot_event id must be
 * rejected HERE, not only inside core). The core selfcheck
 * (verify:follow-logic) already pins assertValidFollowRef itself.
 *
 * Drives:
 *   - forged targetKind ("evil") → rejected
 *   - missing targetKind / targetId → rejected
 *   - empty + whitespace-only targetId → rejected
 *   - targetId > 128 chars → rejected
 *   - hot_event id not UUIDv7-shaped (50-char non-UUID) → rejected (the case
 *     that used to diverge: passed the action's 128 cap, failed only in core)
 *   - valid hot_event (UUIDv7) + valid theme (slug ≤128) → accepted
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * core selfcheck convention (no test framework, plain assertions +
 * process.exit).
 */

import { FollowTargetKind } from "@aguhot/core";

import { parseFollowRef } from "./follow-ref-parser.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

/** A real-shape UUIDv7 (version nibble 7, variant 0b10) — the happy-path id. */
const VALID_UUIDV7 = "01923f8e-6a1c-7b2d-a3e4-5f6a7b8c9d0e";
/**
 * A 50-char non-UUID string: passes the action layer's generic 128-char cap but
 * MUST be rejected by the delegated assertValidFollowRef (UUIDv7 shape check).
 * This is the divergent case the parser now closes.
 */
const FIFTY_CHAR_NON_UUID = `${"a".repeat(50)}`;

/** Build a FormData with the two follow form fields. */
function formData(kind: string, id: string): FormData {
  const fd = new FormData();
  fd.set("targetKind", kind);
  fd.set("targetId", id);
  return fd;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- Acceptance: valid hot_event ref (UUIDv7 id) → parsed ---------------
  assertions.push(
    runAccept("valid hot_event ref (UUIDv7 id) accepted", () => {
      const ref = parseFollowRef(formData(FollowTargetKind.HotEvent, VALID_UUIDV7));
      if (ref.kind !== FollowTargetKind.HotEvent) {
        throw new Error(`expected kind hot_event, got ${ref.kind}`);
      }
      if (ref.hotEventId !== VALID_UUIDV7) {
        throw new Error(`expected hotEventId ${VALID_UUIDV7}, got ${ref.hotEventId}`);
      }
    }),
  );

  // --- Acceptance: valid theme ref (slug ≤128) → parsed ------------------
  assertions.push(
    runAccept("valid theme ref (slug ≤128) accepted", () => {
      const ref = parseFollowRef(formData(FollowTargetKind.Theme, "gusu-fintech"));
      if (ref.kind !== FollowTargetKind.Theme) {
        throw new Error(`expected kind theme, got ${ref.kind}`);
      }
      if (ref.themeSlug !== "gusu-fintech") {
        throw new Error(`expected themeSlug gusu-fintech, got ${ref.themeSlug}`);
      }
    }),
  );

  // --- Rejection: forged targetKind outside whitelist --------------------
  assertions.push(
    runReject("forged targetKind=\"evil\" rejected", () => {
      parseFollowRef(formData("evil", VALID_UUIDV7));
    }),
  );

  // --- Rejection: missing targetKind (not a string) ----------------------
  assertions.push(
    runReject("missing targetKind rejected", () => {
      const fd = new FormData();
      fd.set("targetId", VALID_UUIDV7);
      parseFollowRef(fd);
    }),
  );

  // --- Rejection: missing targetId (not a string) ------------------------
  assertions.push(
    runReject("missing targetId rejected", () => {
      const fd = new FormData();
      fd.set("targetKind", FollowTargetKind.HotEvent);
      parseFollowRef(fd);
    }),
  );

  // --- Rejection: empty + whitespace-only targetId -----------------------
  assertions.push(
    runReject("empty targetId rejected", () => {
      parseFollowRef(formData(FollowTargetKind.HotEvent, ""));
    }),
  );
  assertions.push(
    runReject("whitespace-only targetId rejected", () => {
      parseFollowRef(formData(FollowTargetKind.HotEvent, "   "));
    }),
  );

  // --- Rejection: targetId > 128 chars (theme slug) ----------------------
  assertions.push(
    runReject("theme slug > 128 chars rejected", () => {
      parseFollowRef(formData(FollowTargetKind.Theme, "a".repeat(129)));
    }),
  );

  // --- Rejection: hot_event id not UUIDv7-shaped (the divergent case) ----
  // A 50-char non-UUID passes the local 128 cap; the delegated
  // assertValidFollowRef must reject it at the action layer (previously it was
  // rejected only inside core).
  assertions.push(
    runReject("hot_event id 50-char non-UUID rejected (divergence closed at action layer)", () => {
      parseFollowRef(formData(FollowTargetKind.HotEvent, FIFTY_CHAR_NON_UUID));
    }),
  );

  // --- Boundary sanity: exactly 128-char theme slug → accepted ------------
  assertions.push(
    runAccept("boundary: 128-char theme slug accepted (== cap)", () => {
      parseFollowRef(formData(FollowTargetKind.Theme, "a".repeat(128)));
    }),
  );

  report(assertions);
}

/**
 * Run a case whose body MUST return normally (acceptance path). Returns an
 * Assertion: ok=true iff the body completed without throwing.
 */
function runAccept(name: string, body: () => void): Assertion {
  try {
    body();
    return { name, ok: true };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: `expected no throw, but got: ${(err as Error).message}`,
    };
  }
}

/**
 * Run a case whose body MUST throw (rejection path). Returns an Assertion:
 * ok=true iff the body threw.
 */
function runReject(name: string, body: () => void): Assertion {
  try {
    body();
  } catch (err) {
    // Expected for rejection cases.
    void err;
    return { name, ok: true };
  }
  return {
    name,
    ok: false,
    detail: "expected parseFollowRef to throw, but it returned normally",
  };
}

// --- reporting (mirrors core selfcheck convention) ---------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== web action-layer follow-ref trust-boundary self-check ===");
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
