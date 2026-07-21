import { newTraceId } from "../../shared/ids.js";
import type { Prisma, PrismaClient } from "../../../generated/client.js";
import { tradeDayKey } from "../crash-review/crash-logic.js";
import { detectSurgeDays } from "./surge-logic.js";
import { SURGE_INDEX_CODES, SURGE_SOURCE, SURGE_THRESHOLD } from "./types.js";
import type { IndexBar, UpsertSurgeDaysOptions, UpsertSurgeDaysResult } from "./types.js";

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function inScope(day: string, fromDay: string | undefined, toDay: string | undefined): boolean {
  return (fromDay === undefined || day >= fromDay) && (toDay === undefined || day <= toDay);
}

/**
 * Detect and reconcile surge_days from the full index series. Full history is read even for a
 * bounded write so T+N values use real future trading bars; the requested range limits writes.
 */
export async function upsertSurgeDays(
  options: UpsertSurgeDaysOptions,
): Promise<UpsertSurgeDaysResult> {
  const threshold = options.threshold ?? SURGE_THRESHOLD;
  const rows = await options.prisma.indexDailyBar.findMany({
    where: { indexCode: { in: [...SURGE_INDEX_CODES] } },
    select: { indexCode: true, tradeDate: true, pctChange: true, close: true },
    orderBy: [{ indexCode: "asc" }, { tradeDate: "asc" }],
  });
  const seriesByIndex = new Map<string, IndexBar[]>();
  const barsByIndex: Record<string, number> = {};
  for (const code of SURGE_INDEX_CODES) {
    seriesByIndex.set(code, []);
    barsByIndex[code] = 0;
  }
  for (const row of rows) {
    const series = seriesByIndex.get(row.indexCode);
    if (series === undefined) continue;
    series.push(row);
    barsByIndex[row.indexCode] = (barsByIndex[row.indexCode] ?? 0) + 1;
  }

  const surgeDays = detectSurgeDays(seriesByIndex, threshold).filter((day) =>
    inScope(day.tradeDay, options.fromDay, options.toDay),
  );
  const sourceKeys = new Set(surgeDays.map((day) => day.tradeDay));
  let upserted = 0;
  for (const day of surgeDays) {
    try {
      await options.prisma.surgeDay.upsert({
        where: { tradeDate: toDate(day.tradeDay) },
        create: {
          id: newTraceId(),
          tradeDate: toDate(day.tradeDay),
          threshold,
          surgeCount: day.surgeCount,
          indices: day.indices as unknown as Prisma.InputJsonValue,
          source: SURGE_SOURCE,
          traceId: options.traceId,
          computedAt: new Date(),
        },
        update: {
          threshold,
          surgeCount: day.surgeCount,
          indices: day.indices as unknown as Prisma.InputJsonValue,
          source: SURGE_SOURCE,
          traceId: options.traceId,
          computedAt: new Date(),
        },
      });
      upserted++;
    } catch (error) {
      console.warn(`[surge-review] skip ${day.tradeDay}: ${(error as Error).message}`);
    }
  }

  const existing = await options.prisma.surgeDay.findMany({
    where: {
      tradeDate: {
        ...(options.fromDay === undefined ? {} : { gte: toDate(options.fromDay) }),
        ...(options.toDay === undefined ? {} : { lte: toDate(options.toDay) }),
      },
    },
    select: { tradeDate: true },
  });
  let pruned = 0;
  for (const row of existing) {
    if (sourceKeys.has(tradeDayKey(row.tradeDate))) continue;
    try {
      await options.prisma.surgeDay.delete({ where: { tradeDate: row.tradeDate } });
      pruned++;
    } catch (error) {
      console.warn(`[surge-review] skip prune ${row.tradeDate.toISOString()}: ${(error as Error).message}`);
    }
  }

  return { upserted, pruned, surgeDays, threshold, barsByIndex, traceId: options.traceId };
}

export async function getSurgeDay(prisma: PrismaClient, tradeDay: string) {
  return prisma.surgeDay.findUnique({ where: { tradeDate: toDate(tradeDay) } });
}
