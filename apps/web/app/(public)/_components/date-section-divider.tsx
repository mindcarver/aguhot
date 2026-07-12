/**
 * Trade-day section divider — Story 6.3 (Epic 6 视觉对齐参考站).
 *
 * Renders the editorial date-section header that groups timeline entries by
 * `tradeDate` (UX-DR4b / UX-DR16). The reference site divides its feed by
 * 「7月11日」「7月10日」date headers; aguhot's `published_timeline` carries a
 * `tradeDate` (YYYY-MM-DD, Asia/Shanghai local calendar date — see
 * session-tag.ts deriveTradeDate), so the divider formats that string into a
 * readable CJK date + weekday.
 *
 * `tradeDate` is a LOCAL calendar date string, NOT an instant — parsing it as
 * `Date.UTC(y, m-1, d)` is safe for day-granularity display (the weekday of a
 * calendar date is timezone-independent at day granularity; only the
 * midnight instant is TZ-sensitive, which we never display). Avoids
 * `toLocaleString` so the label stays locale-stable across build/runtime TZ
 * (same rationale as timeline-card / event-card formatDateTime).
 *
 * Non-trading annotation: Sat/Sun → 「（非交易日）」. Holidays are not covered
 * (V1 display heuristic; the per-entry sessionTag carries the authoritative
 * non_trading signal, this is just a section-label affordance).
 */

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function formatTradeDateHeader(tradeDate: string): {
  dateLabel: string;
  weekday: string;
  nonTrading: boolean;
} {
  const parts = tradeDate.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) {
    return { dateLabel: tradeDate, weekday: "", nonTrading: false };
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayIdx = dt.getUTCDay();
  const weekday = WEEKDAY_LABELS[dayIdx] ?? "";
  const nonTrading = dayIdx === 0 || dayIdx === 6; // Sat/Sun
  return { dateLabel: `${m} 月 ${d} 日`, weekday, nonTrading };
}

export interface DateSectionDividerProps {
  tradeDate: string;
}

export function DateSectionDivider({ tradeDate }: DateSectionDividerProps) {
  const { dateLabel, weekday, nonTrading } = formatTradeDateHeader(tradeDate);
  return (
    <h2 className="mb-3 mt-7 font-display text-sm font-semibold tracking-wide text-ink-secondary first:mt-0">
      {dateLabel}
      {weekday !== "" ? ` · ${weekday}` : ""}
      {nonTrading ? "（非交易日）" : ""}
    </h2>
  );
}
