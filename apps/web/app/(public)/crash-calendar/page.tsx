import type { Metadata } from "next";
import Link from "next/link";

import { getPrisma, listPublishedCrashDays, newTraceId } from "@aguhot/core";
import type { PublishedCrashDay } from "@aguhot/core";

import { formatDay } from "./_components/crash-day-shared";

export const metadata: Metadata = {
  title: "大跌日历",
  // §12 Q10: 行情历史回顾属金融信息服务范畴,合规复核未清前不被搜索引擎索引。
  // 不对外公开 = 既不索引,也不在 prod 投影 published_crash_days(行不存 → 空状态)。
  robots: { index: false, follow: false },
};

/**
 * Crash-calendar INDEX page — Story 8.3 + 8.5 (Epic 8), slimmed in 8.8.
 *
 * Pure calendar entry: renders a month grid of published crash days. Clicking a
 * grid cell navigates to the deep detail page `/crash-calendar/[date]` (8.8),
 * which renders the breadth 5 段 + inherited 4 段. This page NO LONGER renders an
 * inline `CrashDayDetail` segment, NO LONGER reads `?d=`, and NO LONGER reads
 * `listPublishedHotEvents` (those moved to `[date]`).
 *
 * Reads ONLY published_* read models (AD-3 — never crash_days / index_daily_bars
 * / sector_daily_bars): listPublishedCrashDays (8.3). Renders the month grid with
 * crash days highlighted (`bg-market-down-soft`); each cell links to
 * `/crash-calendar/{dayKey}`.
 *
 * 合规护栏(§10 措辞黑名单 / SM-C4 对冲):显式「历史统计回顾,非预测、非投资建议」;不按反弹
 * 幅度排序(按 tradeDate 倒序);red-up/green-down 复用既有 token,不新增 token。
 *
 * Why force-dynamic + @aguhot/core import is safe for the build: same mechanism as /daily +
 * /topics — `force-dynamic` evaluates the route at request time, so getPrisma()'s DATABASE_URL
 * read is never reached during `next build` (AD-3/AD-6, public web build stays DB-free).
 */
export const dynamic = "force-dynamic";

const WEEKDAY_HEADER = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_GRID_CAP = 12;

interface MonthGroup {
  key: string; // YYYY-MM
  label: string; // 2026年7月
  year: number;
  month0: number;
  days: PublishedCrashDay[]; // crash days that month (already tradeDate desc)
}

export default async function CrashCalendarPage() {
  const prisma = getPrisma();
  const traceId = newTraceId();
  // AD-3 — public page reads published_* only.
  const crashDays = await listPublishedCrashDays({ prisma, traceId });

  // Group crash days by month (preserve first-seen = latest month order; cap for sanity).
  const months: MonthGroup[] = [];
  const seenMonth = new Set<string>();
  for (const c of crashDays) {
    const key = `${c.tradeDate.getUTCFullYear()}-${String(c.tradeDate.getUTCMonth() + 1).padStart(2, "0")}`;
    let group = months.find((m) => m.key === key);
    if (group === undefined) {
      if (seenMonth.has(key) || months.length >= MONTH_GRID_CAP) continue;
      seenMonth.add(key);
      group = {
        key,
        label: `${c.tradeDate.getUTCFullYear()}年${c.tradeDate.getUTCMonth() + 1}月`,
        year: c.tradeDate.getUTCFullYear(),
        month0: c.tradeDate.getUTCMonth(),
        days: [],
      };
      months.push(group);
    }
    group.days.push(c);
  }

  // Distinct-month count across ALL published crash days (the calendar renders only the
  // most recent MONTH_GRID_CAP months). When older months are truncated, surface it honestly
  // (NFR-2: never silently hide data) rather than letting the page look complete.
  const distinctMonthCount = new Set(
    crashDays.map(
      (c) =>
        `${c.tradeDate.getUTCFullYear()}-${String(c.tradeDate.getUTCMonth() + 1).padStart(2, "0")}`,
    ),
  ).size;
  const monthsTruncated = distinctMonthCount > months.length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">
          大跌日历
        </h1>
        <p className="text-lg text-ink-secondary">AGUHOT · A 股历史大跌日与回顾</p>
        {/* 合规说明块:镜像 EditorialReasonBlock 视觉契约(hairline 分隔 + 标签 + body-sm),
            但静态文案非 AI 解读 → 用中性 bg-surface-muted 而非 accent-warm「AI 解读」标签。 */}
        <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-3">
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">
            说明
          </span>
          <p className="text-sm leading-relaxed text-ink-secondary">
            历史统计回顾，非预测、非投资建议。大跌日 = 三大宽基任一当日跌幅 ≤ 阈值；点选日历中的大跌日，
            可查看领跌板块、前瞻收益与当日市场广度。数据来源：AkShare 公开行情。
          </p>
        </div>
      </header>

      {crashDays.length === 0 ? (
        // AC4 honest empty state — never fabricated, never blank.
        <section className="mt-12 space-y-2">
          <p className="text-base text-ink-tertiary">暂无已记录的大跌日。</p>
          <p className="font-mono text-xs text-ink-tertiary">行情历史回顾上线后将在此展示。</p>
        </section>
      ) : (
        <section className="mt-12 space-y-8">
          <h2 className="text-xl font-semibold text-ink-primary">日历</h2>
          <div className="space-y-8">
            {months.map((m) => (
              <CrashMonthGrid key={m.key} month={m} />
            ))}
          </div>
          {monthsTruncated ? (
            <p className="font-mono text-xs text-ink-tertiary">
              仅展示最近 {MONTH_GRID_CAP} 个月；共 {distinctMonthCount} 个月、
              {crashDays.length} 个大跌日。
            </p>
          ) : null}
          {/* 8.8: 提示用户日历格子可点选进入深度详情页(详情已迁至 [date] 路由)。 */}
          <p className="font-mono text-xs text-ink-tertiary">点选大跌日查看详情。</p>
        </section>
      )}
    </div>
  );
}

/** One month grid: weekday header (Mon-start) + aligned day cells; crash days
 *  highlighted and linked to `/crash-calendar/{dayKey}` (the 8.8 deep-detail route). */
function CrashMonthGrid({ month }: { month: MonthGroup }) {
  const firstDow = (new Date(Date.UTC(month.year, month.month0, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(month.year, month.month0 + 1, 0)).getUTCDate();
  const crashByDay = new Map<number, PublishedCrashDay>();
  for (const c of month.days) {
    crashByDay.set(c.tradeDate.getUTCDate(), c);
  }

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push(<div key={`b${i}`} aria-hidden />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const crash = crashByDay.get(day);
    if (crash !== undefined) {
      const dayKey = formatDay(crash.tradeDate);
      cells.push(
        <Link
          key={day}
          href={`/crash-calendar/${dayKey}`}
          aria-label={`${dayKey} 大跌日，查看详情`}
          className="flex h-11 items-center justify-center rounded font-mono text-xs bg-market-down-soft text-market-down hover:bg-market-down hover:text-white"
        >
          {day}
        </Link>,
      );
    } else {
      cells.push(
        <div key={day} className="flex h-11 items-center justify-center text-xs text-ink-tertiary">
          {day}
        </div>,
      );
    }
  }

  return (
    <div>
      <h3 className="mb-2 font-mono text-sm text-ink-secondary">{month.label}</h3>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADER.map((w) => (
          <div key={w} className="text-xs text-ink-tertiary">
            {w}
          </div>
        ))}
        {cells}
      </div>
    </div>
  );
}
