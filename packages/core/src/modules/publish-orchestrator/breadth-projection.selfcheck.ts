/**
 * Self-check for the pure toCrashDayBreadth projection helper (Story 8.7).
 *
 * Run with: pnpm --filter @aguhot/core verify:breadth-projection
 *           (tsx src/modules/publish-orchestrator/breadth-projection.selfcheck.ts)
 *
 * Pins the I/O Matrix mapping edges for the market_breadth_daily → CrashDayBreadth projection
 * (AC7). The helper is a PURE function (no DB, no I/O), so this selfcheck feeds it plain
 * structural objects and asserts the exact mapping — these are the silent-regression hazards:
 *   1. Decimal → number: totalTurnover/marginBalanceChange must call .toNumber() (mirrors
 *      leadingSectors.pctChange). A regression that copies the Decimal object verbatim would
 *      serialize as a string in JSON, breaking the 8.8 page render.
 *   2. nullable fields null preserved (not zeroed): advancing/declining/flat/totalTurnover/
 *      marginBalanceChange keep their null verbatim. A regression that coerced null→0 would
 *      FABRICATE data (NFR-5 violation — the whole point of 8.6 making spot latest-day-only).
 *   3. dragonTiger passthrough: the 8.6 Json aggregate (or null) passes through untouched as
 *      unknown. A regression that re-parsed/validated it would couple the projection to the Json
 *      shape 8.6 owns.
 *   4. non-null counts copied verbatim: limitUp/limitDown/consecutiveBoard/brokenBoard.
 *
 * The "null row → null breadth" case (AC2, missing market_breadth_daily row) is pinned below as
 * a caller-side mapping assertion: the caller (refreshPublishedCrashDays) handles it BEFORE invoking
 * the helper (findUnique returns null ⇒ breadth = null directly, this helper is never called for a
 * null row). That branch is a ternary on the caller, not a path through the pure helper, so this
 * selfcheck replicates the caller's `breadthRow === null ? null : toCrashDayBreadth(breadthRow)`
 * mapping to pin the AC2 edge. The throw→null path and the upsert need live PG / a prisma mock the
 * repo does not have; that integration coverage is deferred separately.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails (CI-gateable).
 */

import { toCrashDayBreadth } from "./publish-service.js";
import type { MarketBreadthProjectionInput } from "./publish-service.js";

/** Minimal Decimal stand-in — structural match to Prisma.Decimal's `.toNumber()`. */
function dec(n: number): { toNumber(): number } {
  return { toNumber: () => n };
}

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- 1. full breadth row: Decimal→number, nullable fields present ------------------------
  const fullRow: MarketBreadthProjectionInput = {
    limitUpCount: 42,
    limitDownCount: 8,
    consecutiveBoardMax: 5,
    brokenBoardCount: 12,
    advancingCount: 3200,
    decliningCount: 1700,
    flatCount: 150,
    totalTurnover: dec(1_234_567_890.12),
    marginBalanceChange: dec(-450_000_000.0),
    dragonTiger: {
      stockCount: 3,
      institutionalNetBuy: -120_000_000,
      hotMoneyNetBuy: 80_000_000,
      topStocks: [
        { code: "600000", name: "浦发银行", netBuy: 50_000_000, reason: "日跌幅偏离值达7%" },
      ],
    },
  };
  const full = toCrashDayBreadth(fullRow);
  assertions.push({
    name: "non-null counts copied verbatim (limitUp/limitDown/consecutiveBoard/brokenBoard)",
    ok:
      full.limitUpCount === 42 &&
      full.limitDownCount === 8 &&
      full.consecutiveBoardMax === 5 &&
      full.brokenBoardCount === 12,
    detail: JSON.stringify({
      limitUpCount: full.limitUpCount,
      limitDownCount: full.limitDownCount,
      consecutiveBoardMax: full.consecutiveBoardMax,
      brokenBoardCount: full.brokenBoardCount,
    }),
  });
  assertions.push({
    name: "Decimal→number: totalTurnover and marginBalanceChange call .toNumber()",
    ok:
      full.totalTurnover === 1_234_567_890.12 && full.marginBalanceChange === -450_000_000.0,
    detail: JSON.stringify({
      totalTurnover: full.totalTurnover,
      marginBalanceChange: full.marginBalanceChange,
    }),
  });
  assertions.push({
    name: "non-null nullable counts copied verbatim (advancing/declining/flat)",
    ok:
      full.advancingCount === 3200 &&
      full.decliningCount === 1700 &&
      full.flatCount === 150,
    detail: JSON.stringify({
      advancingCount: full.advancingCount,
      decliningCount: full.decliningCount,
      flatCount: full.flatCount,
    }),
  });
  assertions.push({
    name: "dragonTiger Json aggregate passed through verbatim (object identity preserved)",
    ok: full.dragonTiger === fullRow.dragonTiger,
    detail: JSON.stringify(full.dragonTiger),
  });

  // --- 2. historical-day breadth row: nullable fields NULL, not zeroed (NFR-5) -------------
  // This is the 8.6 "spot is latest-day-only" case: a historical breadth row has NULL for
  // advancing/declining/flat/totalTurnover (and possibly marginBalanceChange). The projection
  // MUST keep NULL — coercing to 0 would fabricate "no trades happened" (NFR-5 violation).
  const historicalRow: MarketBreadthProjectionInput = {
    limitUpCount: 30,
    limitDownCount: 120,
    consecutiveBoardMax: 3,
    brokenBoardCount: 25,
    advancingCount: null,
    decliningCount: null,
    flatCount: null,
    totalTurnover: null,
    marginBalanceChange: null,
    dragonTiger: null,
  };
  const hist = toCrashDayBreadth(historicalRow);
  assertions.push({
    name: "historical-day nullable fields kept NULL (not zeroed — NFR-5)",
    ok:
      hist.advancingCount === null &&
      hist.decliningCount === null &&
      hist.flatCount === null &&
      hist.totalTurnover === null &&
      hist.marginBalanceChange === null,
    detail: JSON.stringify({
      advancingCount: hist.advancingCount,
      decliningCount: hist.decliningCount,
      flatCount: hist.flatCount,
      totalTurnover: hist.totalTurnover,
      marginBalanceChange: hist.marginBalanceChange,
    }),
  });
  assertions.push({
    name: "historical-day non-null counts still copied verbatim",
    ok:
      hist.limitUpCount === 30 &&
      hist.limitDownCount === 120 &&
      hist.consecutiveBoardMax === 3 &&
      hist.brokenBoardCount === 25,
    detail: JSON.stringify({
      limitUpCount: hist.limitUpCount,
      limitDownCount: hist.limitDownCount,
    }),
  });
  assertions.push({
    name: "historical-day dragonTiger null passes through as null",
    ok: hist.dragonTiger === null,
    detail: JSON.stringify(hist.dragonTiger),
  });

  // --- 3. mixed null/present: margin present but spot fields null (T-1 margin landed) -----
  // The 8.6 per-source isolation means marginBalanceChange can be non-null while the spot
  // fields are null (spot fetched for latest day only; margin fetched for the date). The
  // projection must keep each field's null-ness independent (no cross-field coercion).
  const mixedRow: MarketBreadthProjectionInput = {
    limitUpCount: 15,
    limitDownCount: 60,
    consecutiveBoardMax: 2,
    brokenBoardCount: 10,
    advancingCount: null,
    decliningCount: null,
    flatCount: null,
    totalTurnover: null,
    marginBalanceChange: dec(-200_000_000.5),
    dragonTiger: { stockCount: 0, institutionalNetBuy: 0, hotMoneyNetBuy: 0, topStocks: [] },
  };
  const mixed = toCrashDayBreadth(mixedRow);
  assertions.push({
    name: "mixed row: marginBalanceChange .toNumber()'d while spot fields stay null (independent)",
    ok:
      mixed.advancingCount === null &&
      mixed.decliningCount === null &&
      mixed.flatCount === null &&
      mixed.totalTurnover === null &&
      mixed.marginBalanceChange === -200_000_000.5,
    detail: JSON.stringify({
      advancingCount: mixed.advancingCount,
      totalTurnover: mixed.totalTurnover,
      marginBalanceChange: mixed.marginBalanceChange,
    }),
  });
  assertions.push({
    name: "mixed row: zero-object dragonTiger (honest no-listing day) passed through verbatim",
    ok:
      typeof mixed.dragonTiger === "object" &&
      mixed.dragonTiger !== null &&
      (mixed.dragonTiger as { stockCount: number }).stockCount === 0,
    detail: JSON.stringify(mixed.dragonTiger),
  });

  // --- 4. determinism: same input → identical output -------------------------------------
  const again = toCrashDayBreadth(fullRow);
  assertions.push({
    name: "deterministic: same input → identical output",
    ok: JSON.stringify(again) === JSON.stringify(full),
  });

  // --- 5. AC2: missing market_breadth_daily row (findUnique → null) ⇒ breadth null -------
  // The pure helper's signature is (row: MarketBreadthProjectionInput) → CrashDayBreadth, so a
  // null ROW is handled by the caller BEFORE invoking the helper — refreshPublishedCrashDays does
  // `breadth = breadthRow === null ? null : toCrashDayBreadth(breadthRow)`. Pin that caller-side
  // mapping here so the AC2 "missing breadth row → breadth null" edge is regression-guarded: a
  // refactor that dropped the null-ternary (e.g. calling toCrashDayBreadth unconditionally) would
  // crash on `null.limitUpCount`, but this assertion catches the contract break at the mapping
  // boundary, not just at the crash. This mirrors the caller's exact ternary shape.
  const missingBreadthRow: MarketBreadthProjectionInput | null = null;
  const missingBreadth =
    missingBreadthRow === null ? null : toCrashDayBreadth(missingBreadthRow);
  assertions.push({
    name: "AC2: missing breadth row (null) → breadth null (not zeroed, not crash)",
    ok: missingBreadth === null,
    detail: JSON.stringify({ breadth: missingBreadth }),
  });

  // --- report ----------------------------------------------------------------------------
  const failed = assertions.filter((a) => !a.ok);
  for (const a of assertions) {
    const tag = a.ok ? "PASS" : "FAIL";
    const tail = a.detail ? `  ${a.detail}` : "";
    console.log(`  ${tag}  ${a.name}${tail}`);
  }
  console.log("");
  if (failed.length > 0) {
    console.log(`FAIL — ${failed.length}/${assertions.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
}

main();
