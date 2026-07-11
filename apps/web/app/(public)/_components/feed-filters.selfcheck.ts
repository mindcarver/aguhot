/**
 * Self-check for the pure web-layer feed searchParams helpers (no infra, no DB,
 * no Next runtime).
 *
 * Run with: pnpm --filter web exec tsx "app/(public)/_components/feed-filters.selfcheck.ts"
 *           (tsx app/(public)/_components/feed-filters.selfcheck.ts)
 *
 * Pins two things that had ZERO unit coverage before:
 *
 *  1. mergeSearchParams sibling-preservation (review finding C2's core). The
 *     fix stopped filter pills from clobbering sibling keys — a window change
 *     must keep ?concept=…, and an association clear must keep ?window=…. This
 *     selfcheck locks that behavior down so a future "simplification" can't
 *     silently reintroduce the regression. Cases:
 *       - {window:"today"} + {concept:"X"}    → ?window=today&concept=X
 *       - {window:"today",concept:"X"} del [concept] → ?window=today
 *       - {concept:"X"} + {window:"7d"}       → ?window=7d&concept=X (FEED_QUERY_KEYS order)
 *       - {} + {}                              → "/"  (empty collapses to root)
 *
 *  2. P3 regression: Next.js searchParams deliver `string[]` for a repeated key
 *     (`?concept=a&concept=b`). Before the fix, raw.trim() threw TypeError and
 *     500'd the public feed nav. After the fix, firstString() collapses the
 *     array to its first element and the feed renders normally.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, mirroring the
 * core/web selfcheck convention (no test framework, plain assertions +
 * process.exit).
 */

import {
  firstString,
  mergeSearchParams,
  parseAssociationFilter,
} from "./feed-filters.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- C2 case 1: window + concept update preserves window -----------------
  assertions.push(
    runAccept("C2 keep-sibling: {window} + {concept} keeps window", () => {
      const href = mergeSearchParams({ window: "today" }, { concept: "X" });
      if (href !== "?window=today&concept=X") {
        throw new Error(`expected ?window=today&concept=X, got ${href}`);
      }
    }),
  );

  // --- C2 case 2: delete association keeps window --------------------------
  assertions.push(
    runAccept(
      "C2 keep-sibling: delete [concept] keeps window when both present",
      () => {
        const href = mergeSearchParams(
          { window: "today", concept: "X" },
          {},
          ["concept"],
        );
        if (href !== "?window=today") {
          throw new Error(`expected ?window=today, got ${href}`);
        }
      },
    ),
  );

  // --- C2 case 3: FEED_QUERY_KEYS stable ordering --------------------------
  assertions.push(
    runAccept(
      "C2 ordering: {concept} + {window} emits window-first (FEED_QUERY_KEYS)",
      () => {
        // Pass current with only concept; add window via updates. Output must
        // be window-first regardless of insertion order, proving the map is
        // re-emitted in FEED_QUERY_KEYS order (stable URLs across renders).
        const href = mergeSearchParams({ concept: "X" }, { window: "7d" });
        if (href !== "?window=7d&concept=X") {
          throw new Error(`expected ?window=7d&concept=X, got ${href}`);
        }
      },
    ),
  );

  // --- C2 case 4: empty input collapses to root ----------------------------
  assertions.push(
    runAccept('C2 empty: {} + {} → "/" (root, no dangling ?)', () => {
      const href = mergeSearchParams({}, {});
      if (href !== "/") {
        throw new Error(`expected "/", got ${href}`);
      }
    }),
  );

  // --- P3 regression: string[] in current does not throw ------------------
  assertions.push(
    runAccept(
      "P3 regression: {concept:string[]} in current → no throw, takes first",
      () => {
        // Before the fix, current[key] for a repeated key (?concept=a&concept=b)
        // arrived as string[] and raw.trim() threw TypeError. firstString()
        // must collapse it to the first element so mergeSearchParams renders
        // the feed nav instead of 500ing.
        const href = mergeSearchParams(
          { concept: ["a", "b"] } as {
            concept: string[];
            window?: string;
            industry?: string;
            stock?: string;
          },
          { window: "today" },
        );
        if (href !== "?window=today&concept=a") {
          throw new Error(`expected ?window=today&concept=a, got ${href}`);
        }
      },
    ),
  );

  // --- P3 regression: string[] in parseAssociationFilter -----------------
  assertions.push(
    runAccept(
      "P3 regression: parseAssociationFilter with string[] takes first element",
      () => {
        // Same shape risk on the parser side. ?concept=a&concept=b must
        // resolve to {concept, "a"} not throw.
        const af = parseAssociationFilter({
          concept: ["a", "b"],
          industry: undefined,
          stock: undefined,
        });
        if (af === null) {
          throw new Error("expected non-null association filter, got null");
        }
        if (af.kind !== "concept" || af.label !== "a") {
          throw new Error(
            `expected {kind:"concept", label:"a"}, got ${JSON.stringify(af)}`,
          );
        }
      },
    ),
  );

  // --- P3 regression: firstString unit contract ---------------------------
  assertions.push(
    runAccept("firstString: string passes through", () => {
      if (firstString("x") !== "x") {
        throw new Error(`expected "x", got ${firstString("x")}`);
      }
    }),
  );
  assertions.push(
    runAccept("firstString: string[] collapses to first element", () => {
      if (firstString(["a", "b"]) !== "a") {
        throw new Error(`expected "a", got ${firstString(["a", "b"])}`);
      }
    }),
  );
  assertions.push(
    runAccept("firstString: undefined passes through", () => {
      if (firstString(undefined) !== undefined) {
        throw new Error(
          `expected undefined, got ${String(firstString(undefined))}`,
        );
      }
    }),
  );
  assertions.push(
    runAccept("firstString: empty array → undefined (no element to take)", () => {
      if (firstString([]) !== undefined) {
        throw new Error(
          `expected undefined for [], got ${String(firstString([]))}`,
        );
      }
    }),
  );

  // --- C2: empty-string values are dropped (existing behavior preserved) ---
  assertions.push(
    runAccept("C2 edge: empty-string current value dropped (no ?key=)", () => {
      const href = mergeSearchParams({ window: "" }, { concept: "X" });
      if (href !== "?concept=X") {
        throw new Error(`expected ?concept=X, got ${href}`);
      }
    }),
  );

  // --- C2: delete a key not present is a no-op ----------------------------
  assertions.push(
    runAccept("C2 edge: deleting an absent key is a no-op", () => {
      const href = mergeSearchParams({ window: "today" }, {}, ["concept"]);
      if (href !== "?window=today") {
        throw new Error(`expected ?window=today, got ${href}`);
      }
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
      detail: (err as Error).message,
    };
  }
}

// --- reporting (mirrors core/web selfcheck convention) -----------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== web feed-filters mergeSearchParams/firstString self-check ===");
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
