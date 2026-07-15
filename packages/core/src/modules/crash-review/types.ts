/**
 * crash-review types + module config — Story 8.2.
 *
 * This module owns the `crash_days` table (AD-2 single-writer). It READS
 * `index_daily_bars` (8.1) and writes one CrashDay row per A-share crash trading day.
 * It never reads sector_daily_bars (leading-down sector display is 8.3's concern),
 * never calls AkShare (8.1's write path), and never writes published_crash_days
 * (8.3 / publish-orchestrator).
 */

import type { PrismaClient } from "../../../generated/client.js";

// --- module config (NOT global env — mirrors TIMELINE_FOLD_THRESHOLD) --------

/**
 * The crash threshold (signed percent). A trading day is a crash day when ANY of the
 * three broad indices has `pct_change <= CRASH_THRESHOLD`. Default -2.0% per the
 * 2026-07-15b sprint-change-proposal locked decisions ("跌幅 ≤ -2%").
 *
 * This is a crash-review module config constant, deliberately NOT in global env —
 * same convention as event-assembly's TIMELINE_FOLD_THRESHOLD (architect review:
 * operator-tunable tuning belongs to the owning module, not the global env surface).
 * Callers may override it per-invocation; the value used is persisted per-row in
 * `crash_days.threshold` so a re-tuned recompute stays auditable.
 */
export const CRASH_THRESHOLD = -2.0;

/**
 * Forward-return horizons, measured in TRADING DAYS (the index's own series ordered by
 * trade_date), not calendar days. T+1 / T+5 (~1 week) / T+20 (~1 month) per the
 * 2026-07-15b proposal. Listed ascending so compute/output order is stable.
 */
export const FORWARD_RETURN_HORIZONS = [1, 5, 20] as const;
export type ForwardReturnHorizon = (typeof FORWARD_RETURN_HORIZONS)[number];

/**
 * The three broad indices a crash day watches (AkShare-prefixed codes, aligned with
 * 8.1's index_daily_bars.index_code values). A day is a crash day when ANY one closes
 * at or below CRASH_THRESHOLD.
 */
export const CRASH_INDEX_CODES = ["sh000001", "sz399001", "sz399006"] as const;
export type CrashIndexCode = (typeof CRASH_INDEX_CODES)[number];

/** Market-data lineage carried into crash_days.source (matches 8.1's `source`). */
export const CRASH_SOURCE = "akshare" as const;

// --- read-side types (index_daily_bars rows) ---------------------------------

/**
 * A single index_daily_bars row as crash-review reads it. Decimal values are carried
 * as Prisma.Decimal (the 8.1 schema stores them @db.Decimal). trade_date comes back as
 * a UTC Date from Prisma; we normalize to a `YYYY-MM-DD` trade-day key for series
 * ordering and upsert keys.
 */
export interface IndexBar {
  indexCode: string;
  /** UTC midnight Date for the trading day. */
  tradeDate: Date;
  pctChange: DecimalLike;
  close: DecimalLike;
}

/**
 * Minimal decimal interface — Prisma.Decimal satisfies this, and the pure logic
 * functions use only the arithmetic they need, so selfchecks can pass a lightweight
 * stand-in (e.g. a plain object or a real Prisma.Decimal) without the DB.
 */
export interface DecimalLike {
  toNumber(): number;
}

// --- derived projection types (the crash_days.indices Json shape) ------------

/** Forward returns over the horizons; null when the series has too few future bars. */
export interface ForwardReturns {
  t1: number | null;
  t5: number | null;
  t20: number | null;
}

/** One entry per index present on the crash day (a missing index is omitted, not faked). */
export interface IndexCrashDetail {
  indexCode: string;
  /** Crash-day pct_change % (signed). */
  pctChange: number;
  /** Crash-day close. */
  close: number;
  /** Whether this index triggered the crash (pctChange <= threshold). */
  crashed: boolean;
  forwardReturns: ForwardReturns;
}

/**
 * A crash day detected by the pure logic. The service upserts one crash_days row per
 * `tradeDay` whose crashCount >= 1.
 */
export interface DetectedCrashDay {
  /** `YYYY-MM-DD` trading-day key. */
  tradeDay: string;
  threshold: number;
  crashCount: number;
  indices: IndexCrashDetail[];
}

/** A crash_days row, as the service reads it back / hands to 8.3's projection. */
export interface CrashDayRecord {
  id: string;
  tradeDate: Date;
  threshold: number;
  crashCount: number;
  indices: IndexCrashDetail[];
  source: string;
  computedAt: Date;
  traceId: string | null;
}

// --- service options ---------------------------------------------------------

export interface UpsertCrashDaysOptions {
  prisma: PrismaClient;
  traceId: string;
  /** Optional inclusive range bound (`YYYY-MM-DD`); default = scan all index_daily_bars. */
  fromDay?: string;
  /** Optional inclusive range bound (`YYYY-MM-DD`). */
  toDay?: string;
  /** Override the module default (AC6); defaults to CRASH_THRESHOLD. */
  threshold?: number;
}

export interface UpsertCrashDaysResult {
  /** Number of crash_days rows upserted (one per detected crash day). */
  upserted: number;
  /** Detected crash days in ascending trade-day order. */
  crashDays: DetectedCrashDay[];
  threshold: number;
  /** indexCode → count of bars scanned. */
  barsByIndex: Record<string, number>;
  traceId: string;
}
