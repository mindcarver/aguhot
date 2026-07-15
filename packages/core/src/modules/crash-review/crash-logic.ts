/**
 * crash-logic — pure crash-day detection + forward-return computation (Story 8.2).
 *
 * No DB, no network, no clocks inside the values: same input → identical output. This
 * is the "leave one runnable check behind" surface — `crash-logic.selfcheck.ts` asserts
 * the Epic 8.2 I/O & edge-case matrix against canned series. The service layer
 * (`crash-review-service.ts`) reads index_daily_bars, hands the series here, and upserts.
 *
 *   - computeForwardReturns: given an index's bars (ascending by trade_date) and the
 *     crash day's position, return T+1/T+5/T+20 historic actual `(close[t+N]/close[t]-1)*100`
 *     over the index's OWN trading-day series. null when fewer than N future bars exist
 *     (NFR-5 — no fabrication, no extrapolation). close values are converted to JS number
 *     for the ratio; the underlying 8.1 columns stay Decimal(12,4), so the double-precision
 *     ratio is far below display rounding error (ponytail: correct on edge cases, no need
 *     to pull Prisma.Decimal into a pure function).
 *   - detectCrashDays: union all trade days, and for each day gather each index's bar
 *     present that day (missing index ⇒ omitted, never faked). A day is a crash day iff
 *     at least one index's pct_change ≤ threshold (default -2.0%). crashCount counts
 *     triggering indices (1..3).
 *
 * NFR: the forward-return numbers describe observed historic facts only. No
 * buy/sell/target/predictive wording lives here — advisory wording is an 8.3 display
 * concern.
 */

import {
  CRASH_THRESHOLD,
  FORWARD_RETURN_HORIZONS,
} from "./types.js";
import type {
  DetectedCrashDay,
  ForwardReturnHorizon,
  ForwardReturns,
  IndexBar,
  IndexCrashDetail,
} from "./types.js";

/**
 * Format a UTC-midnight trade Date as the `YYYY-MM-DD` trading-day key used for series
 * ordering and the crash_days.trade_date upsert. index_daily_bars.trade_date is stored
 * @db.Date (UTC midnight), so toISOString().slice(0,10) is the stable day key.
 */
export function tradeDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Compare two trade-day keys (`YYYY-MM-DD`) — lexicographic order == chronological order
 * for zero-padded ISO dates, so a plain `<` sort is correct.
 */
export function compareTradeDayKey(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compute T+1/T+5/T+20 forward returns for the bar at `crashIdx` in `bars` (which must be
 * ascending by trade date). For each horizon N, if `crashIdx + N` is within the series,
 * the return is `(close[t+N] / close[t] - 1) * 100`; otherwise `null`. Guarded against a
 * zero close (defensive — 8.1 close is NOT NULL and never 0 for a real index, but a divide
 * would otherwise yield Infinity, not a usable statistic).
 */
export function computeForwardReturns(
  bars: readonly IndexBar[],
  crashIdx: number,
): ForwardReturns {
  const out: Record<`t${ForwardReturnHorizon}`, number | null> = {
    t1: null,
    t5: null,
    t20: null,
  };

  if (crashIdx < 0 || crashIdx >= bars.length) return out;

  const baseClose = bars[crashIdx]!.close.toNumber();
  if (baseClose === 0) return out;

  for (const horizon of FORWARD_RETURN_HORIZONS) {
    const futureIdx = crashIdx + horizon;
    if (futureIdx >= bars.length) continue; // too few future bars → stays null (NFR-5)
    const futureClose = bars[futureIdx]!.close.toNumber();
    out[`t${horizon}` as `t${ForwardReturnHorizon}`] =
      (futureClose / baseClose - 1) * 100;
  }

  return out;
}

/**
 * Detect crash days across one or more index series. Returns one DetectedCrashDay per
 * trading day (ascending) on which at least one index closed at or below `threshold`.
 * Indices with no bar on a given day are omitted from that day's `indices` detail
 * (never faked to 0 — NFR-5).
 *
 * Each series is defensively re-sorted ascending by trade date so callers cannot corrupt
 * the forward-return offsets by passing unsorted input. The same bar list is reused for
 * both the per-day lookup and the forward-return window, so T+N always walks the index's
 * own trading calendar.
 */
export function detectCrashDays(
  seriesByIndex: ReadonlyMap<string, readonly IndexBar[]>,
  threshold: number = CRASH_THRESHOLD,
): DetectedCrashDay[] {
  // Sort each index's bars ascending by trade date and index them by day key.
  const sortedByIndex = new Map<string, { bars: IndexBar[]; idxByDay: Map<string, number> }>();
  for (const [indexCode, rawBars] of seriesByIndex) {
    const bars = [...rawBars].sort((a, b) => compareTradeDayKey(tradeDayKey(a.tradeDate), tradeDayKey(b.tradeDate)));
    const idxByDay = new Map<string, number>();
    for (let i = 0; i < bars.length; i++) idxByDay.set(tradeDayKey(bars[i]!.tradeDate), i);
    sortedByIndex.set(indexCode, { bars, idxByDay });
  }

  // Union of all trade days, ascending.
  const allDays = new Set<string>();
  for (const { idxByDay } of sortedByIndex.values()) for (const day of idxByDay.keys()) allDays.add(day);
  const orderedDays = [...allDays].sort(compareTradeDayKey);

  const crashDays: DetectedCrashDay[] = [];
  for (const day of orderedDays) {
    const indices: IndexCrashDetail[] = [];

    for (const [indexCode, { bars, idxByDay }] of sortedByIndex) {
      const idx = idxByDay.get(day);
      if (idx === undefined) continue; // this index has no bar on `day` → omit (NFR-5)
      const bar = bars[idx]!;
      const pctChange = bar.pctChange.toNumber();
      indices.push({
        indexCode,
        pctChange,
        close: bar.close.toNumber(),
        crashed: pctChange <= threshold,
        forwardReturns: computeForwardReturns(bars, idx),
      });
    }

    const crashCount = indices.filter((i) => i.crashed).length;
    if (crashCount >= 1) {
      crashDays.push({ tradeDay: day, threshold, crashCount, indices });
    }
  }

  return crashDays;
}
