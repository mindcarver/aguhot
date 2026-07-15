/**
 * crash-review module barrel — Story 8.2.
 *
 * Owns the crash_days table (AD-2 single-writer). Reads index_daily_bars (8.1) and
 * writes one CrashDay per crash trading day. Exposes:
 *   - the pure detection/forward-return core (crash-logic) — what the selfcheck covers;
 *   - the DB-bound upsert service (crash-review-service) — what the dev runner drives;
 *   - the module config (CRASH_THRESHOLD / horizons / index codes) — operator-tunable,
 *     NOT global env, mirroring TIMELINE_FOLD_THRESHOLD.
 *
 * This module never writes published_crash_days (8.3 / publish-orchestrator owns the
 * public projection) and never reads sector_daily_bars (leading-down sector display is
 * 8.3's concern). It only reads index_daily_bars and writes crash_days.
 */

export { detectCrashDays, computeForwardReturns, tradeDayKey, compareTradeDayKey } from "./crash-logic.js";
export { upsertCrashDays, getCrashDay } from "./crash-review-service.js";
export {
  CRASH_THRESHOLD,
  FORWARD_RETURN_HORIZONS,
  CRASH_INDEX_CODES,
  CRASH_SOURCE,
} from "./types.js";
export type {
  ForwardReturnHorizon,
  CrashIndexCode,
  IndexBar,
  DecimalLike,
  ForwardReturns,
  IndexCrashDetail,
  DetectedCrashDay,
  CrashDayRecord,
  UpsertCrashDaysOptions,
  UpsertCrashDaysResult,
} from "./types.js";
