/**
 * Self-check for the pure clustering logic (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:cluster-logic
 *           (tsx src/modules/event-assembly/clustering.selfcheck.ts)
 *
 * Synthesizes records covering the spec I/O & Edge-Case Matrix and asserts
 * clusterRecords groups them correctly:
 *   1. Subset long/short titles merge into one group (overlap-coefficient,
 *      not Jaccard).
 *   2. Different-event titles do not merge.
 *   3. Cross-time-window (>72h) same-title records do not merge.
 *   4. Empty-title records form their own singletons.
 *   5. tokenize/signatureOf/overlapCoefficient invariants.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, so it is
 * CI-gateable. This is the "leave one runnable check behind for non-trivial
 * logic" pattern (ponytail) — the clusterRecords union-find + overlap-
 * coefficient is exactly the kind of logic that silently regresses without a
 * check, and this self-check needs no PG/Redis so it can run in any gate.
 */

import {
  clusterRecords,
  overlapCoefficient,
  signatureOf,
  tokenize,
  SIGNATURE_DELIMITER,
} from "./clustering.js";
import type { ClusterInput } from "./types.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- tokenize invariants ----------------------------------------------------
  const t1 = tokenize("央行宣布降准0.5个百分点");
  assertions.push({
    name: "tokenize splits CJK into single chars + Latin decimal token",
    ok: t1.has("央") && t1.has("行") && t1.has("0.5") && !t1.has("的"),
    detail: `[${[...t1].join(", ")}]`,
  });

  const t2 = tokenize("Fed cuts rates by 50bps");
  assertions.push({
    name: "tokenize lowercases and splits Latin on whitespace/punct",
    ok: t2.has("fed") && t2.has("cuts") && t2.has("rates") && t2.has("50bps"),
    detail: `[${[...t2].join(", ")}]`,
  });

  assertions.push({
    name: "tokenize null title -> empty set",
    ok: tokenize(null).size === 0,
  });

  // --- overlapCoefficient: subset pair scores 1.0 -----------------------------
  const short = tokenize("央行降准");
  const long = tokenize("央行宣布降准0.5个百分点");
  const oc = overlapCoefficient(short, long);
  assertions.push({
    name: "overlap-coefficient(subset) = 1.0 (short ⊂ long)",
    ok: oc === 1,
    detail: `oc=${oc}`,
  });

  assertions.push({
    name: "overlap-coefficient(empty, any) = 0",
    ok: overlapCoefficient(new Set(), short) === 0,
  });

  // --- signatureOf: order-independent ----------------------------------------
  const a: ClusterInput = mk("a1", "央行降准", 0);
  const b: ClusterInput = mk("a2", "央行宣布降准0.5个百分点", 1);
  const sigAB = signatureOf([a, b]);
  const sigBA = signatureOf([b, a]);
  assertions.push({
    name: "signatureOf is order-independent",
    ok: sigAB === sigBA && sigAB.length > 0,
    detail: sigAB.split(SIGNATURE_DELIMITER).join(","),
  });

  // The signature delimiter (`|`) is load-bearing: incremental merge splits the
  // stored signature back into a token set, so a token containing the delimiter
  // would silently corrupt matching. Pin that tokenize never emits the
  // delimiter and that signatureOf round-trips through signatureToTokenSet.
  assertions.push({
    name: "no token contains the signature delimiter (round-trip safe)",
    ok: [...t1, ...t2, ...tokenize("a|b|c")].every((tok) => !tok.includes(SIGNATURE_DELIMITER)),
    detail: `delimiter="${SIGNATURE_DELIMITER}"`,
  });
  const roundTrip = new Set(signatureOf([a, b]).split(SIGNATURE_DELIMITER));
  const expectedTokens = new Set([...tokenize(a.title!), ...tokenize(b.title!)]);
  assertions.push({
    name: "signatureOf round-trips through split to the same token set",
    ok: roundTrip.size === expectedTokens.size &&
        [...roundTrip].every((t) => expectedTokens.has(t)),
  });

  // --- clusterRecords: the core matrix ---------------------------------------

  // 1. Subset long/short titles same event -> one group (overlap, not Jaccard).
  const sameEvent = [
    mk("short", "央行降准", 0),
    mk("long", "央行宣布降准0.5个百分点", 1),
  ];
  const g1 = clusterRecords(sameEvent);
  assertions.push({
    name: "subset long/short titles merge into one group",
    ok: g1.length === 1 && g1[0]!.ids.length === 2,
    detail: `${g1.length} groups`,
  });

  // 2. Different-event titles -> separate groups.
  const diffEvents = [
    mk("ev1", "央行降准", 0),
    mk("ev2", "美股大跌", 1),
  ];
  const g2 = clusterRecords(diffEvents);
  assertions.push({
    name: "different-event titles do not merge",
    ok: g2.length === 2 && g2[0]!.ids.length === 1 && g2[1]!.ids.length === 1,
    detail: `${g2.length} groups`,
  });

  // 3. Cross-time-window (>72h) same-title -> separate groups.
  const within72h = 72 * 60 * 60 * 1000;
  const farApart = [
    mk("day1", "央行降准", 0),
    mk("day10", "央行降准", 10 * 24 * 60 * 60 * 1000), // 10 days > 72h
  ];
  const g3 = clusterRecords(farApart);
  assertions.push({
    name: "cross-time-window same-title records do not merge (>72h)",
    ok: g3.length === 2,
    detail: `${g3.length} groups`,
  });

  // 3b. Within-window same-title -> merge (boundary sanity).
  const closeApart = [
    mk("h1", "央行降准", 0),
    mk("h2", "央行降准", within72h - 60_000), // 1 min under 72h
  ];
  const g3b = clusterRecords(closeApart);
  assertions.push({
    name: "within-time-window same-title records merge (<72h)",
    ok: g3b.length === 1 && g3b[0]!.ids.length === 2,
    detail: `${g3b.length} groups`,
  });

  // 4. Empty-title records form their own singletons.
  const emptyTitles = [
    mk("e1", null, 0),
    mk("e2", null, 1),
    mk("e3", "央行降准", 2),
  ];
  const g4 = clusterRecords(emptyTitles);
  assertions.push({
    name: "empty-title records form own singletons (3 inputs -> 3 groups)",
    ok: g4.length === 3 && g4.every((g) => g.ids.length === 1),
    detail: `${g4.length} groups`,
  });

  // 4b. Empty inputs -> empty result (no-op).
  assertions.push({
    name: "empty inputs -> empty result",
    ok: clusterRecords([]).length === 0,
  });

  // 5. Mixed realistic batch: 2 same-event subset + 1 different + 1 null.
  const mixed = [
    mk("m1", "央行降准", 0),
    mk("m2", "央行宣布降准0.5个百分点", 30 * 60 * 1000), // 30min later
    mk("m3", "美联储维持利率不变", 60 * 60 * 1000), // 1h later, diff event
    mk("m4", null, 90 * 60 * 1000), // null title
  ];
  const g5 = clusterRecords(mixed);
  assertions.push({
    name: "mixed batch: 2 same-event merge, 1 diff, 1 null -> 3 groups",
    ok: g5.length === 3 &&
      g5.some((g) => g.ids.length === 2 && g.ids.includes("m1") && g.ids.includes("m2")) &&
      g5.some((g) => g.ids.length === 1 && g.ids[0] === "m3") &&
      g5.some((g) => g.ids.length === 1 && g.ids[0] === "m4"),
    detail: g5.map((g) => `[${g.ids.join(",")}]`).join(" "),
  });

  report(assertions);
}

/**
 * Build a ClusterInput with sensible defaults. `publishedAtOffsetMs` is
 * relative to a fixed base time so tests are deterministic (not wall-clock).
 */
function mk(id: string, title: string | null, publishedAtOffsetMs: number): ClusterInput {
  const base = 1_700_000_000_000; // fixed epoch ms, deterministic
  return {
    id,
    title,
    publishedAt: title === null && publishedAtOffsetMs < 0 ? null : new Date(base + publishedAtOffsetMs),
    ingestedAt: new Date(base + publishedAtOffsetMs),
  };
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== event-assembly clustering self-check ===");
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
