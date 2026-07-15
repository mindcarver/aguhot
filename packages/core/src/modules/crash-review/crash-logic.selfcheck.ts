/**
 * Self-check for the pure crash-detection / forward-return logic (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:crash-logic
 *           (tsx src/modules/crash-review/crash-logic.selfcheck.ts)
 *
 * Covers the Story 8.2 I/O & edge-case matrix:
 *   1. no index ≤ threshold → no crash day.
 *   2. one index ≤ -2.0% → crash day, crashCount=1.
 *   3. two indices crash same day → crashCount=2, both flagged crashed.
 *   4. computeForwardReturns full: T+1/T+5/T+20 present and correct.
 *   5. computeForwardReturns insufficient: T+20 null when <20 future bars.
 *   6. computeForwardReturns at last bar → all null.
 *   7. missing index on a day → omitted from indices (not faked, NFR-5).
 *   8. threshold override (AC6): -3.0 demotes a -2.5% day; crashCount drops.
 *   9. ascending trade-day output + determinism (same input → same output).
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails (CI-gateable — the
 * forward-return offsets and the crashCount/omission rules silently regress without it).
 */

import {
  computeForwardReturns,
  detectCrashDays,
  tradeDayKey,
} from "./crash-logic.js";
import { CRASH_THRESHOLD } from "./types.js";
import type { IndexBar } from "./types.js";

type Dec = { toNumber: () => number };
function dec(n: number): Dec {
  return { toNumber: () => n };
}

const base = new Date("2024-01-02T00:00:00.000Z");
function dayStr(offset: number): string {
  return tradeDayKey(new Date(base.getTime() + offset * 86_400_000));
}
function bar(code: string, offset: number, pct: number, close: number): IndexBar {
  return {
    indexCode: code,
    tradeDate: new Date(base.getTime() + offset * 86_400_000),
    pctChange: dec(pct),
    close: dec(close),
  };
}

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- fixture: sh000001 full 23-bar series, crash at offset 2 (close=100) -----
  // closes chosen so T+1=+1%, T+5=+3%, T+20=+5% from the crash close of 100.
  const shCloses = Array.from({ length: 23 }, (_, i) => (i === 3 ? 101 : i === 7 ? 103 : i === 22 ? 105 : 100));
  const sh: IndexBar[] = shCloses.map((c, i) => bar("sh000001", i, i === 2 ? -2.5 : 0.5, c));

  // sz399001: present on offsets 0,1,3 — deliberately ABSENT on the crash day (offset 2)
  // to exercise the "missing index ⇒ omitted, not faked" rule (NFR-5).
  const sz: IndexBar[] = [0, 1, 3].map((i) => bar("sz399001", i, -1.0, 100));

  // sz399006: sparse — offsets 0 and 2 only. Crashes on offset 2 (-3.0%). Its series has
  // no future bars after offset 2, so all forward returns are null (insufficiency).
  const cy: IndexBar[] = [bar("sz399006", 0, 0.4, 100), bar("sz399006", 2, -3.0, 100)];

  // --- 1. no crash when nothing ≤ threshold ---------------------------------
  const calm = detectCrashDays(
    new Map([["sh000001", [bar("sh000001", 0, 0.5, 100), bar("sh000001", 1, 0.5, 100)]]]),
  );
  assertions.push({
    name: "no index ≤ threshold → no crash day",
    ok: calm.length === 0,
    detail: JSON.stringify(calm),
  });

  // --- 2 & 3 & 7. mixed crash day (offset 2): sh + sz399006 crash, sz399001 omitted -
  const series = new Map<string, IndexBar[]>([
    ["sh000001", sh],
    ["sz399001", sz],
    ["sz399006", cy],
  ]);
  const days = detectCrashDays(series);
  const crash2 = days.find((d) => d.tradeDay === dayStr(2));
  assertions.push({
    name: "offset 2 detected as crash day",
    ok: crash2 !== undefined,
    detail: JSON.stringify(days.map((d) => d.tradeDay)),
  });
  assertions.push({
    name: "crashCount=2 (sh + sz399006); sz399001 omitted (present ≠ crashed), indices length=2",
    ok:
      crash2 !== undefined &&
      crash2.crashCount === 2 &&
      crash2.indices.length === 2 &&
      !crash2.indices.some((i) => i.indexCode === "sz399001"),
    detail: JSON.stringify(crash2?.indices.map((i) => i.indexCode)),
  });
  assertions.push({
    name: "sh + sz399006 flagged crashed; crash pct recorded",
    ok:
      crash2 !== undefined &&
      crash2.indices.find((i) => i.indexCode === "sh000001")?.crashed === true &&
      crash2.indices.find((i) => i.indexCode === "sz399006")?.crashed === true &&
      crash2.indices.find((i) => i.indexCode === "sh000001")?.pctChange === -2.5,
  });

  // --- 4. sh forward returns full: T+1=+1, T+5=+3, T+20=+5 -------------------
  // Compare at 2dp (display precision) — the raw ratio carries harmless float noise
  // (e.g. 1.0000000000000009) from the close-ratio division; the underlying 8.1 closes
  // stay Decimal(12,4) so the noise is far below display rounding.
  const shFr = crash2?.indices.find((i) => i.indexCode === "sh000001")?.forwardReturns;
  const near = (a: number | null, b: number): boolean => a !== null && Math.abs(a - b) < 1e-6;
  assertions.push({
    name: "sh forward returns: t1=+1%, t5=+3%, t20=+5%",
    ok:
      shFr !== undefined &&
      near(shFr.t1, 1) &&
      near(shFr.t5, 3) &&
      near(shFr.t20, 5),
    detail: JSON.stringify(shFr),
  });

  // --- 5 & 6. sz399006 (sparse) forward returns all null; last-bar all null ----
  const cyFr = crash2?.indices.find((i) => i.indexCode === "sz399006")?.forwardReturns;
  assertions.push({
    name: "sz399006 forward returns all null (no future bars, NFR-5)",
    ok: cyFr !== undefined && cyFr.t1 === null && cyFr.t5 === null && cyFr.t20 === null,
    detail: JSON.stringify(cyFr),
  });
  const lastBarFr = computeForwardReturns([bar("x", 0, -3, 100), bar("x", 1, -3, 100)], 1);
  assertions.push({
    name: "computeForwardReturns at last bar → all null",
    ok: lastBarFr.t1 === null && lastBarFr.t5 === null && lastBarFr.t20 === null,
    detail: JSON.stringify(lastBarFr),
  });

  // --- 8. threshold override (AC6): -3.0 demotes sh (-2.5%); only sz399006 fires ---
  const deep = detectCrashDays(series, -3.0);
  const deepCrash2 = deep.find((d) => d.tradeDay === dayStr(2));
  assertions.push({
    name: "threshold -3.0: sh (-2.5%) no longer crashed; crashCount=1 (sz399006 only)",
    ok:
      deepCrash2 !== undefined &&
      deepCrash2.crashCount === 1 &&
      deepCrash2.indices.find((i) => i.indexCode === "sh000001")?.crashed === false &&
      deepCrash2.indices.find((i) => i.indexCode === "sz399006")?.crashed === true &&
      deepCrash2.threshold === -3.0,
    detail: JSON.stringify(deepCrash2?.crashCount),
  });

  // --- 9. ascending output + determinism ------------------------------------
  const asc = days.every((d, i) => i === 0 || d.tradeDay >= days[i - 1]!.tradeDay);
  assertions.push({ name: "crash days returned ascending by trade day", ok: asc });
  assertions.push({
    name: "deterministic: same input → identical output",
    ok: JSON.stringify(detectCrashDays(series)) === JSON.stringify(days),
  });

  // --- report ----------------------------------------------------------------
  const failed = assertions.filter((a) => !a.ok);
  for (const a of assertions) {
    const tag = a.ok ? "PASS" : "FAIL";
    const tail = a.detail ? `  ${a.detail}` : "";
    console.log(`  ${tag}  ${a.name}${tail}`);
  }
  console.log("");
  console.log(`(CRASH_THRESHOLD default = ${CRASH_THRESHOLD})`);
  if (failed.length > 0) {
    console.log(`FAIL — ${failed.length}/${assertions.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
}

main();
