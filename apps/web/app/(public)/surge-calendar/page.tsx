import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { getPrisma, listPublishedSurgeDays, newTraceId } from "@aguhot/core";
import type { PublishedSurgeDay } from "@aguhot/core";

import { formatDay } from "./_components";

export const metadata: Metadata = {
  title: "大涨日历",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const MONTH_GRID_CAP = 12;

interface MonthGroup {
  key: string;
  label: string;
  year: number;
  month0: number;
  days: PublishedSurgeDay[];
}

export default async function SurgeCalendarPage() {
  const surgeDays = await listPublishedSurgeDays({ prisma: getPrisma(), traceId: newTraceId() });
  const months: MonthGroup[] = [];
  const seen = new Set<string>();
  for (const surgeDay of surgeDays) {
    const key = `${surgeDay.tradeDate.getUTCFullYear()}-${String(surgeDay.tradeDate.getUTCMonth() + 1).padStart(2, "0")}`;
    let month = months.find((item) => item.key === key);
    if (month === undefined) {
      if (seen.has(key) || months.length >= MONTH_GRID_CAP) continue;
      seen.add(key);
      month = {
        key,
        label: `${surgeDay.tradeDate.getUTCFullYear()}年${surgeDay.tradeDate.getUTCMonth() + 1}月`,
        year: surgeDay.tradeDate.getUTCFullYear(),
        month0: surgeDay.tradeDate.getUTCMonth(),
        days: [],
      };
      months.push(month);
    }
    month.days.push(surgeDay);
  }
  const allMonthCount = new Set(surgeDays.map((day) => `${day.tradeDate.getUTCFullYear()}-${day.tradeDate.getUTCMonth()}`)).size;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">大涨日历</h1>
        <p className="text-lg text-ink-secondary">AGUHOT · A 股历史大涨日与回顾</p>
        <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-3">
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">说明</span>
          <p className="text-sm leading-relaxed text-ink-secondary">
            历史统计回顾，非预测、非投资建议。大涨日 = 三大宽基任一当日涨幅 ≥ 2%；点选日期查看领涨板块、历史实际收益与市场广度。数据来源：AkShare 公开行情。
          </p>
        </div>
      </header>
      {surgeDays.length === 0 ? (
        <section className="mt-12 space-y-2">
          <p className="text-base text-ink-tertiary">暂无已记录的大涨日。</p>
          <p className="font-mono text-xs text-ink-tertiary">行情历史回顾上线后将在此展示。</p>
        </section>
      ) : (
        <section className="mt-12 space-y-8">
          <h2 className="text-xl font-semibold text-ink-primary">日历</h2>
          <div className="space-y-8">{months.map((month) => <SurgeMonthGrid key={month.key} month={month} />)}</div>
          {allMonthCount > months.length ? <p className="font-mono text-xs text-ink-tertiary">仅展示最近 {MONTH_GRID_CAP} 个月。</p> : null}
          <p className="font-mono text-xs text-ink-tertiary">点选大涨日查看详情。</p>
        </section>
      )}
    </div>
  );
}

function SurgeMonthGrid({ month }: { month: MonthGroup }) {
  const firstDay = (new Date(Date.UTC(month.year, month.month0, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(month.year, month.month0 + 1, 0)).getUTCDate();
  const byDay = new Map(month.days.map((day) => [day.tradeDate.getUTCDate(), day]));
  const cells: ReactNode[] = [];
  for (let blank = 0; blank < firstDay; blank++) cells.push(<div key={`blank-${blank}`} aria-hidden />);
  for (let day = 1; day <= daysInMonth; day++) {
    const surgeDay = byDay.get(day);
    cells.push(surgeDay === undefined ? (
      <div key={day} className="flex h-11 items-center justify-center text-xs text-ink-tertiary">{day}</div>
    ) : (
      <Link key={day} href={`/surge-calendar/${formatDay(surgeDay.tradeDate)}`} aria-label={`${formatDay(surgeDay.tradeDate)} 大涨日，查看详情`} className="flex h-11 items-center justify-center rounded bg-market-up-soft font-mono text-xs text-market-up hover:bg-market-up hover:text-white">
        {day}
      </Link>
    ));
  }
  return <div><h3 className="mb-2 font-mono text-sm text-ink-secondary">{month.label}</h3><div className="grid grid-cols-7 gap-1 text-center">{WEEKDAYS.map((weekday) => <div key={weekday} className="text-xs text-ink-tertiary">{weekday}</div>)}{cells}</div></div>;
}
