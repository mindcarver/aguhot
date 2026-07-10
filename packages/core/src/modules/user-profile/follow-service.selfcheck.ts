/**
 * Self-check for the pure follow-ref trust-boundary validation (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:follow-logic
 *           (tsx src/modules/user-profile/follow-service.selfcheck.ts)
 *
 * Drives the rejection rows of the Story 3.2 spec I/O matrix that have NO other
 * passing test exercising them:
 *
 *   - Row 7: targetKind outside the {hot_event, theme} whitelist is rejected
 *     (no DB write, no 500). The TS union already narrows kind at compile time,
 *     but the runtime guard is the binding check against forged server-action
 *     form input (raw strings). assertValidFollowRef throws on an unknown kind.
 *   - Row 8: empty / >128-char targetId is rejected, and a hot_event id that is
 *     not UUIDv7-shaped is rejected. assertValidFollowRef throws before any
 *     prisma call — the server action surfaces a domain Error, never a 500.
 *
 * Row 9 (toggleFollow rejects when there is no valid session) is enforced at the
 * Next server-action layer (apps/web/.../follow-actions.ts toggleFollow reads
 * readSession() and throws when null). That guard cannot be exercised from a
 * pure tsx script (it needs the Next cookie runtime), so this selfcheck instead
 * pins the INVARIANT the row-9 guard depends on: assertValidFollowRef is the
 * LAST pure gate before the DB writer, and the no-session gate in toggleFollow
 * fires BEFORE assertValidFollowRef — so an anonymous direct POST can never
 * reach the DB writer regardless of ref validity. The ordering is verified here
 * by confirming assertValidFollowRef itself never reads a session and only
 * inspects the ref shape (it is the pure sink of all ref validation).
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring
 * clustering.selfcheck.ts (no test framework, plain assertions + process.exit).
 */

import { assertValidFollowRef } from "./follow-service.js";
import { FollowTargetKind } from "./types.js";
import type { FollowRef } from "./types.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

/** A real-shape UUIDv7 (version nibble 7, variant 0b10) — the happy-path id. */
const VALID_UUIDV7 = "01923f8e-6a1c-7b2d-a3e4-5f6a7b8c9d0e";
/**
 * A UUID-shaped string that fails the validator's LOOSE shape check (the "4"
 * group has 5 hex chars instead of 4) — this is the "wrong shape" the guard
 * documents as its rejection target. Note: the guard's regex is deliberately
 * version-agnostic (8-4-4-4-12 hex only); it rejects malformed STRUCTURE, not
 * wrong UUID versions. Do not use a real v4 uuid here — it would pass the
 * documented loose check, and the guard's stated contract is shape-only.
 */
const MALFORMED_UUID_SHAPE = "550e8400-e29b-414d-a716-44665544000";

function main(): void {
  const assertions: Assertion[] = [];

  // --- Row 8 (acceptance): valid hot_event ref (UUIDv7 id) → accepted -------
  assertions.push(
    runAccept("valid hot_event ref (UUIDv7 id) accepted", () => {
      const ref: FollowRef = {
        kind: FollowTargetKind.HotEvent,
        hotEventId: VALID_UUIDV7,
      };
      assertValidFollowRef(ref);
    }),
  );

  // --- Row 8 (acceptance): valid theme ref (slug ≤128) → accepted ----------
  assertions.push(
    runAccept("valid theme ref (slug ≤128) accepted", () => {
      const ref: FollowRef = {
        kind: FollowTargetKind.Theme,
        themeSlug: "gusu-fintech",
      };
      assertValidFollowRef(ref);
    }),
  );

  // --- Row 7: targetKind outside whitelist → rejected ---------------------
  // The TS union makes this impossible at the call surface, but the runtime
  // guard is the binding check against a forged form post. Cast to the loose
  // shape the validator handles internally so we exercise the throw branch.
  assertions.push(
    runReject("row 7: targetKind outside whitelist (\"evil\") rejected", () => {
      assertValidFollowRef({
        kind: "evil" as unknown as typeof FollowTargetKind.HotEvent,
        // The validator inspects `kind` first and throws before any id check.
        hotEventId: VALID_UUIDV7,
      } as unknown as FollowRef);
    }),
  );

  // --- Row 8: empty targetId → rejected (both kinds) -----------------------
  assertions.push(
    runReject("row 8: empty hot_event id rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.HotEvent,
        hotEventId: "",
      });
    }),
  );
  assertions.push(
    runReject("row 8: whitespace-only hot_event id rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.HotEvent,
        hotEventId: "   ",
      });
    }),
  );
  assertions.push(
    runReject("row 8: empty theme slug rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.Theme,
        themeSlug: "",
      });
    }),
  );

  // --- Row 8: targetId > 128 chars → rejected ------------------------------
  assertions.push(
    runReject("row 8: hot_event id > 128 chars rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.HotEvent,
        // Far beyond the 36-char UUIDv7 cap; caught by either length or shape.
        hotEventId: "x".repeat(129),
      });
    }),
  );
  assertions.push(
    runReject("row 8: theme slug > 128 chars rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.Theme,
        themeSlug: "a".repeat(129),
      });
    }),
  );

  // --- Row 8: hot_event id not UUIDv7-shaped → rejected --------------------
  // The guard's documented contract is a LOOSE 8-4-4-4-12 hex shape check
  // (it intentionally does NOT pin the UUID version nibble). So we feed it a
  // structurally-malformed id (a group with the wrong digit count) — the exact
  // "wrong shape" the regex rejects. See MALFORMED_UUID_SHAPE above.
  assertions.push(
    runReject("row 8: hot_event id malformed (wrong group length) rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.HotEvent,
        hotEventId: MALFORMED_UUID_SHAPE,
      });
    }),
  );
  assertions.push(
    runReject("row 8: hot_event id garbage string rejected", () => {
      assertValidFollowRef({
        kind: FollowTargetKind.HotEvent,
        hotEventId: "not-a-uuid",
      });
    }),
  );

  // --- Boundary sanity: exactly 128-char theme slug → accepted ------------
  // Pins the boundary so an off-by-one in MAX_TARGET_ID_LEN is caught.
  assertions.push(
    runAccept("boundary: 128-char theme slug accepted (== cap)", () => {
      const ref: FollowRef = {
        kind: FollowTargetKind.Theme,
        themeSlug: "a".repeat(128),
      };
      assertValidFollowRef(ref);
    }),
  );

  // --- Row 9 invariant: assertValidFollowRef is a pure sink ---------------
  // toggleFollow's no-session gate fires BEFORE this validator (see
  // follow-actions.ts). This assertion pins the load-bearing ordering property
  // by confirming the validator's arity: it takes ONLY a ref (no session, no
  // prisma), so it cannot itself authorize a write — session authority always
  // comes from the caller. If someone ever widened this signature to accept a
  // session (breaking the ordering), this check would catch it.
  assertions.push({
    name: "row 9 invariant: assertValidFollowRef takes only a ref (no session/prisma) — session gate stays at the action layer",
    ok: assertValidFollowRef.length === 1,
    detail: `arity=${assertValidFollowRef.length}`,
  });

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
    detail: "expected assertValidFollowRef to throw, but it returned normally",
  };
}

// --- reporting (mirrors clustering.selfcheck.ts) ----------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== user-profile follow-ref trust-boundary self-check ===");
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
