/**
 * crash-review-service — orchestrate crash-day detection + forward-return computation
 * and upsert `crash_days` (Story 8.2).
 *
 * This module is the SOLE writer of crash_days (AD-2). It READS index_daily_bars (8.1
 * owns those rows) and upserts one crash_days row per detected crash trading day. It
 * never reads sector_daily_bars (leading-down sector display is 8.3), never calls
 * AkShare (8.1's write path), and never writes published_crash_days (8.3 /
 * publish-orchestrator).
 *
 * The heavy lifting (detection + forward returns) is pure logic in crash-logic.ts; this
 * service is the DB-bound shell around it — same separation as generateMarketReaction
 * around deriveSignals, and saliency around scoreSaliency. The pure core is what the
 * selfcheck exercises; this service is exercised via the dev runner run-crash-review.ts.
 *
 * Upsert semantics (AC5): keyed by trade_date, so re-running a range refreshes existing
 * rows (forward returns fill in as new bars arrive, computedAt bumps) without producing
 * duplicates. This is a materialized-projection upsert — NOT append-only (unlike
 * market_reaction_snapshots' AD-5): there is exactly one source-of-truth row per crash
 * day, and recomputing it is the intended way to close out T+20.
 *
 * Per-item isolation (AC4): each crash day is upserted in its own try/catch so a single
 * write failure skips that day, not the batch. A trading day where all three indices are
 * missing never reaches upsert (detection omits it; never faked, NFR-5).
 */

import { newTraceId } from "../../shared/ids.js";
import type { Prisma, PrismaClient } from "../../../generated/client.js";
import { detectCrashDays, tradeDayKey } from "./crash-logic.js";
import {
  CRASH_INDEX_CODES,
  CRASH_SOURCE,
} from "./types.js";
import type {
  DetectedCrashDay,
  IndexBar,
  UpsertCrashDaysOptions,
  UpsertCrashDaysResult,
} from "./types.js";

/**
 * Scan index_daily_bars (all three broad indices, optionally date-bounded), detect crash
 * days at `threshold` (default CRASH_THRESHOLD = -2.0%), and upsert one crash_days row
 * per detected day. Returns the detected days + per-index bar counts for observability.
 *
 * `threshold` is overridable per call (AC6); the value used is persisted per-row in
 * crash_days.threshold so a re-tuned recompute is auditable.
 */
export async function upsertCrashDays(
  options: UpsertCrashDaysOptions,
): Promise<UpsertCrashDaysResult> {
  const { prisma, traceId, threshold: overrideThreshold } = options;
  const threshold = overrideThreshold ?? -2.0;

  // Read the three broad indices' bars (optionally date-bounded). trade_date is @db.Date,
  // returned as a UTC-midnight Date; pct_change/close come back as Prisma.Decimal, which
  // satisfies DecimalLike (toNumber). CRASH_INDEX_CODES is a readonly tuple, so spread
  // into a mutable array for Prisma's `in` filter.
  const where: { indexCode: { in: string[] }; tradeDate?: { gte?: Date; lte?: Date } } = {
    indexCode: { in: [...CRASH_INDEX_CODES] },
  };
  if (options.fromDay !== undefined || options.toDay !== undefined) {
    where.tradeDate = {};
    if (options.fromDay !== undefined) where.tradeDate.gte = dayToDate(options.fromDay);
    if (options.toDay !== undefined) where.tradeDate.lte = dayToDate(options.toDay);
  }

  const rows = await prisma.indexDailyBar.findMany({
    where,
    select: { indexCode: true, tradeDate: true, pctChange: true, close: true },
    orderBy: [{ indexCode: "asc" }, { tradeDate: "asc" }],
  });

  // Group into per-index series. barsByIndex counts feed the result's observability.
  const seriesByIndex = new Map<string, IndexBar[]>();
  const barsByIndex: Record<string, number> = {};
  for (const code of CRASH_INDEX_CODES) {
    seriesByIndex.set(code, []);
    barsByIndex[code] = 0;
  }
  for (const r of rows) {
    let series = seriesByIndex.get(r.indexCode);
    if (series === undefined) {
      // Unknown index code — ignore (CRASH_INDEX_CODES is the closed set, but be safe).
      series = [];
      seriesByIndex.set(r.indexCode, series);
      barsByIndex[r.indexCode] = 0;
    }
    series.push({
      indexCode: r.indexCode,
      tradeDate: r.tradeDate,
      pctChange: r.pctChange,
      close: r.close,
    });
    barsByIndex[r.indexCode] = (barsByIndex[r.indexCode] ?? 0) + 1;
  }

  const crashDays = detectCrashDays(seriesByIndex, threshold);

  // Upsert one row per crash day, isolated per-item (AC4). Keyed by trade_date unique.
  let upserted = 0;
  for (const day of crashDays) {
    const tradeDate = dayToDate(day.tradeDay);
    // indices is a typed IndexCrashDetail[]; cast to Prisma.InputJsonValue (Prisma's
    // Json envelope does not carry the element type — same convention as digest-service's
    // items / cluster-events's saliencyBreakdown).
    const indicesJson = day.indices as unknown as Prisma.InputJsonValue;
    try {
      await prisma.crashDay.upsert({
        where: { tradeDate },
        create: {
          id: newTraceId(),
          tradeDate,
          threshold,
          crashCount: day.crashCount,
          indices: indicesJson,
          source: CRASH_SOURCE,
          traceId,
          computedAt: new Date(),
        },
        update: {
          threshold,
          crashCount: day.crashCount,
          indices: indicesJson,
          source: CRASH_SOURCE,
          traceId,
          computedAt: new Date(),
        },
      });
      upserted++;
    } catch (err) {
      // Per-item isolation: a single write failure skips this day, not the batch.
      console.warn(
        `[crash-review] skip crash day ${day.tradeDay} (upsert failed): ${(err as Error).message}`,
      );
    }
  }

  return { upserted, crashDays, threshold, barsByIndex, traceId };
}

/** Parse a `YYYY-MM-DD` trade-day key into a UTC-midnight Date (matches 8.1's @db.Date). */
function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Read a single crash_days row by trade-day key (UTC-midnight Date), or null. */
export async function getCrashDay(
  prisma: PrismaClient,
  tradeDay: string,
): Promise<DetectedCrashDay | null> {
  const row = await prisma.crashDay.findUnique({
    where: { tradeDate: dayToDate(tradeDay) },
  });
  if (row === null) return null;
  return {
    tradeDay: tradeDayKey(row.tradeDate),
    threshold: Number(row.threshold),
    crashCount: row.crashCount,
    indices: row.indices as unknown as DetectedCrashDay["indices"],
  };
}
