/**
 * Pure A-share trading-session derivation for the timeline read model (Story
 * 4.1, AC5). Two pure functions over a UTC instant:
 *   - deriveSessionTag(occurredAtUtc): PreOpen / Intraday / PostClose / NonTrading
 *   - deriveTradeDate(occurredAtUtc): the Asia/Shanghai trading day (YYYY-MM-DD),
 *     with natural-day fallback on non-trading days.
 *
 * No DB, no side-effects — independently unit-testable at the session boundary
 * instants. The codebase had no A-share session definition before this file.
 *
 * A-SHARE SESSION DEFINITION (Asia/Shanghai, UTC+8, no DST):
 *
 *   Trading days are Monday–Friday excluding public holidays. V1 does NOT ship a
 *   PRC holiday calendar (procurement + maintenance is a separate concern); a
 *   holiday is indistinguishable from a non-trading weekday here, which means a
 *   holiday-session publish is tagged NonTrading and grouped by natural day —
 *   the honest V1 fallback (PRD §12 Q5: non-trading days fall back to natural-
 *   day grouping). When a holiday calendar is procured, swap isTradingDay's
 *   predicate; the public API and downstream code are unchanged.
 *
 *   Local-time session windows (Asia/Shanghai):
 *     09:00–09:30  集合竞价 (pre-open auction)            → PreOpen
 *     09:30–11:30  上午连续竞价 (morning continuous)      → Intraday
 *     11:30–13:00  午间休市 (lunch break)                 → PostClose (neither continuous auction)
 *     13:00–15:00  下午连续竞价 (afternoon continuous)    → Intraday
 *     15:00–23:59  收盘后 (post-close)                    → PostClose
 *     00:00–09:00  盘前夜间 / 非交易时段                   → NonTrading
 *
 *   BOUNDARY INSTANTS (half-open intervals — [lower, upper)):
 *     PreOpen:   local >= 09:00 AND local < 09:30
 *     Intraday:  (local >= 09:30 AND local < 11:30) OR (local >= 13:00 AND local < 15:00)
 *     PostClose: (local >= 11:30 AND local < 13:00) OR (local >= 15:00 AND local < 23:59:59.999)
 *     NonTrading: everything else (before 09:00, OR on a non-trading weekday)
 *
 *   The PostClose bucket deliberately absorbs the 11:30–13:00 lunch break and
 *   the 15:00+ after-hours window — they are neither intraday continuous
 *   auction sessions, and tagging them NonTrading would mislead users (the
 *   event DID happen on a trading day, just outside continuous trading). The
 *   home feed still groups them under the same trade_date.
 *
 * TRADE_DATE DERIVATION:
 *   - On a trading day, trade_date = the Asia/Shanghai calendar date of
 *     occurredAtUtc (e.g. an event at 2024-01-02T01:00:00Z = 09:00 Shanghai on
 *     2024-01-02 → trade_date "2024-01-02"). An event at 2024-01-02T16:30:00Z
 *     = 00:30 Shanghai on 2024-01-03 → trade_date "2024-01-03" (rolled to the
 *     next local day). This is intentional: trade_date is the local calendar
 *     day, NOT the UTC day.
 *   - On a non-trading day (weekend/holiday), trade_date = the Asia/Shanghai
 *     natural calendar date (PRD §12 Q5 fallback). The home feed groups by
 *     trade_date regardless of session, so weekend items cluster on their
 *     natural day.
 */

import { TimelineSessionTag } from "./types.js";
import type { TimelineSessionTagType } from "./types.js";

/** Asia/Shanghai timezone offset in minutes (UTC+8, no DST). */
const SHANGHAI_OFFSET_MINUTES = 8 * 60;

/**
 * Convert a UTC instant to the Asia/Shanghai local-time components. Uses
 * Intl.DateTimeFormat (TZ-aware, no DST for Asia/Shanghai) so the math is
 * correct regardless of the host process timezone. Returns the parts needed
 * for session classification + trade_date.
 */
function toShanghaiParts(occurredAtUtc: Date): {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  weekday: number; // 0 = Sunday ... 6 = Saturday (JS getDay convention)
} {
  // Format in Asia/Shanghai with the parts we need. Using individual
  // formatToParts avoids any string-parsing fragility.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const map = new Map<string, string>();
  for (const part of fmt.formatToParts(occurredAtUtc)) {
    map.set(part.type, part.value);
  }
  const year = Number.parseInt(map.get("year") ?? "1970", 10);
  const month = Number.parseInt(map.get("month") ?? "1", 10);
  const day = Number.parseInt(map.get("day") ?? "1", 10);
  // hour12: false still emits "24" for midnight in some ICU builds; normalize to 0.
  const hourRaw = Number.parseInt(map.get("hour") ?? "0", 10);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const minute = Number.parseInt(map.get("minute") ?? "0", 10);
  const weekdayStr = map.get("weekday") ?? "Sun";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[weekdayStr] ?? 0;
  return { year, month, day, hour, minute, weekday };
}

/** Pad a number to 2 digits for YYYY-MM-DD formatting. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Is the given Asia/Shanghai local day a trading day? V1: Mon–Fri (weekday).
 * PRC public holidays are NOT excluded (holiday calendar procurement is
 * deferred — see module doc). This is the single swap point when a calendar
 * lands.
 */
function isTradingDay(weekday: number): boolean {
  // weekday: 0 = Sunday ... 6 = Saturday (JS getDay convention, preserved above).
  return weekday >= 1 && weekday <= 5; // Mon–Fri
}

/**
 * Classify a UTC instant into one of four A-share trading sessions. The session
 * is derived from the Asia/Shanghai local time of `occurredAtUtc`; a non-trading
 * weekday (or any time before 09:00) collapses to NonTrading. Pure and
 * deterministic — see the module doc for the exact boundary instants.
 */
export function deriveSessionTag(occurredAtUtc: Date): TimelineSessionTagType {
  const { hour, minute, weekday } = toShanghaiParts(occurredAtUtc);

  // Non-trading weekday → NonTrading regardless of time.
  if (!isTradingDay(weekday)) {
    return TimelineSessionTag.NonTrading;
  }

  const minutesOfDay = hour * 60 + minute; // 0..1439

  // Pre-open auction: 09:00 <= local < 09:30
  if (minutesOfDay >= 9 * 60 && minutesOfDay < 9 * 60 + 30) {
    return TimelineSessionTag.PreOpen;
  }
  // Morning continuous: 09:30 <= local < 11:30
  if (minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 11 * 60 + 30) {
    return TimelineSessionTag.Intraday;
  }
  // Lunch break + afternoon continuous + post-close handled below.
  // Afternoon continuous: 13:00 <= local < 15:00
  if (minutesOfDay >= 13 * 60 && minutesOfDay < 15 * 60) {
    return TimelineSessionTag.Intraday;
  }
  // PostClose: 11:30 <= local < 13:00 (lunch) OR 15:00 <= local < 23:59:59.999.
  // 23:59:59.999 is the last representable instant of the day; we treat any
  // time >= 15:00 on a trading weekday as PostClose.
  if (
    (minutesOfDay >= 11 * 60 + 30 && minutesOfDay < 13 * 60) ||
    minutesOfDay >= 15 * 60
  ) {
    return TimelineSessionTag.PostClose;
  }

  // Everything else on a trading weekday (00:00 <= local < 09:00) → NonTrading.
  return TimelineSessionTag.NonTrading;
}

/**
 * Derive the trade_date (YYYY-MM-DD) for a UTC instant. On a trading day this
 * is the Asia/Shanghai calendar date of the instant; on a non-trading day it is
 * the natural-day calendar date (PRD §12 Q5 fallback). The result is always the
 * Asia/Shanghai local date — never the UTC date — so events that occur late UTC
 * (e.g. 16:30 UTC = 00:30 next-day Shanghai) roll to the next local day.
 */
export function deriveTradeDate(occurredAtUtc: Date): string {
  const { year, month, day } = toShanghaiParts(occurredAtUtc);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Re-export the offset constant for callers that need to reason about the
 * UTC+8 boundary without hardcoding it (e.g. tests, future calendar adapter).
 */
export const SHANGHAI_OFFSET_MIN = SHANGHAI_OFFSET_MINUTES;
