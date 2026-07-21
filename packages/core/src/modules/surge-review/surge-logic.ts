import {
  compareTradeDayKey,
  computeForwardReturns,
  tradeDayKey,
} from "../crash-review/crash-logic.js";
import { SURGE_INDEX_CODES, SURGE_THRESHOLD } from "./types.js";
import type { DetectedSurgeDay, IndexBar, IndexSurgeDetail } from "./types.js";

/** Pure detection for GitHub #30. Missing index bars are omitted, never fabricated. */
export function detectSurgeDays(
  seriesByIndex: ReadonlyMap<string, readonly IndexBar[]>,
  threshold: number = SURGE_THRESHOLD,
): DetectedSurgeDay[] {
  const sorted = new Map<string, { bars: IndexBar[]; indexByDay: Map<string, number> }>();
  for (const [indexCode, rawBars] of seriesByIndex) {
    const bars = [...rawBars].sort((a, b) => compareTradeDayKey(tradeDayKey(a.tradeDate), tradeDayKey(b.tradeDate)));
    const indexByDay = new Map<string, number>();
    bars.forEach((bar, index) => indexByDay.set(tradeDayKey(bar.tradeDate), index));
    sorted.set(indexCode, { bars, indexByDay });
  }

  const allDays = new Set<string>();
  for (const { indexByDay } of sorted.values()) for (const day of indexByDay.keys()) allDays.add(day);

  const surgeDays: DetectedSurgeDay[] = [];
  for (const day of [...allDays].sort(compareTradeDayKey)) {
    const indices: IndexSurgeDetail[] = [];
    for (const indexCode of SURGE_INDEX_CODES) {
      const indexSeries = sorted.get(indexCode);
      if (indexSeries === undefined) {
        indices.push({
          indexCode,
          pctChange: null,
          close: null,
          surged: false,
          forwardReturns: null,
        });
        continue;
      }
      const { bars, indexByDay } = indexSeries;
      const index = indexByDay.get(day);
      if (index === undefined) {
        indices.push({
          indexCode,
          pctChange: null,
          close: null,
          surged: false,
          forwardReturns: null,
        });
        continue;
      }
      const bar = bars[index]!;
      const pctChange = bar.pctChange.toNumber();
      indices.push({
        indexCode,
        pctChange,
        close: bar.close.toNumber(),
        surged: pctChange >= threshold,
        forwardReturns: computeForwardReturns(bars, index),
      });
    }
    const surgeCount = indices.filter((index) => index.surged).length;
    if (surgeCount > 0) surgeDays.push({ tradeDay: day, threshold, surgeCount, indices });
  }
  return surgeDays;
}
