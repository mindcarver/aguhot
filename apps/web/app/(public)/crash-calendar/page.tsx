import type { Metadata } from "next";
import Link from "next/link";

import { ReactionChip } from "@/components/chips";
import type { ReactionTone } from "@/components/chips";
import {
  getPrisma,
  listPublishedCrashDays,
  newTraceId,
} from "@aguhot/core";
import type {
  IndexCrashDetail,
  LeadingSector,
  PublishedCrashDay,
} from "@aguhot/core";

export const metadata: Metadata = {
  title: "大跌日历",
  // §12 Q10: 行情历史回顾属金融信息服务范畴,合规复核未清前不被搜索引擎索引。
  // 不对外公开 = 既不索引,也不在 prod 投影 published_crash_days(行不存 → 空状态)。
  robots: { index: false, follow: false },
};

/**
 * Crash-calendar public page — Story 8.3 (Epic 8 大跌日历与历史回顾).
 *
 * Reads ONLY the published_crash_days read model (listPublishedCrashDays, AD-3 — never
 * crash_days / index_daily_bars / sector_daily_bars / hot_events). Renders three segments:
 *   1. 月度日历网格 — 大跌日高亮(`bg-market-down-soft`),可点选 `?d=` 切换详情;
 *   2. 领跌板块榜   — 当日 Top-N 申万一级跌幅板块,复用 `ReactionChip tone="down"`;
 *   3. 前瞻收益表   — 三大宽基 × T+1/T+5/T+20 历史实际收益(`font-mono`,缺数据「—」NFR-5)。
 *
 * 默认详情 = 最近一个大跌日(tradeDate desc 首行);`?d=YYYY-MM-DD` 命中则切到该日,非法/不
 * 命中回落最近(不报错,同 /daily 的 ?date= 范式)。空状态诚实降级(AC4),从不渲染假数据。
 *
 * 合规护栏(§10 措辞黑名单 / SM-C4 对冲):显式「历史统计回顾,非预测、非投资建议」;不按反弹
 * 幅度排序(按 tradeDate 倒序);red-up/green-down 复用既有 token,不新增 token。
 *
 * Why force-dynamic + @aguhot/core import is safe for the build: same mechanism as /daily +
 * /topics — `force-dynamic` evaluates the route at request time, so getPrisma()'s DATABASE_URL
 * read is never reached during `next build` (AD-3/AD-6, public web build stays DB-free).
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ d?: string }>;
}

const WEEKDAY_HEADER = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];
const INDEX_LABEL: Record<string, string> = {
  sh000001: "上证综指",
  sz399001: "深证成指",
  sz399006: "创业板指",
};
const MONTH_GRID_CAP = 12;

/** UTC-midnight Date (@db.Date) → `YYYY-MM-DD`, using UTC getters to avoid TZ drift. */
function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function signTone(n: number): ReactionTone {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/** `1.23` / `-0.85` → `"+1.23%"` / `"-0.85%"` (returns-table cell, no label ⇒ sign needed). */
function signedPct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** `1.23` / `-0.85` → `"1.23%"` (chip magnitude — the 涨/跌 label + tone carry direction). */
function absPct(n: number): string {
  return `${Math.abs(n).toFixed(2)}%`;
}

interface MonthGroup {
  key: string; // YYYY-MM
  label: string; // 2026年7月
  year: number;
  month0: number;
  days: PublishedCrashDay[]; // crash days that month (already tradeDate desc)
}

export default async function CrashCalendarPage({ searchParams }: PageProps) {
  const prisma = getPrisma();
  const params = await searchParams;
  const crashDays = await listPublishedCrashDays({ prisma, traceId: newTraceId() });

  // Resolve the focus day: a valid & extant ?d= → that day; otherwise the latest crash day.
  // Invalid/malformed ?d= is ignored (falls back to latest) — same honest-fallback as /daily.
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? "")
    ? (params.d as string)
    : undefined;
  const focus =
    (requested !== undefined
      ? crashDays.find((c) => formatDay(c.tradeDate) === requested)
      : undefined) ?? crashDays[0];
  const focusKey = focus !== undefined ? formatDay(focus.tradeDate) : undefined;

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
            历史统计回顾，非预测、非投资建议。大跌日 = 三大宽基任一当日跌幅 ≤ 阈值；T+1 / T+5 /
            T+20 为大跌后该指数历史实际收益，缺失记为「—」。数据来源：AkShare 公开行情。
          </p>
        </div>
      </header>

      {crashDays.length === 0 ? (
        // AC4 honest empty state — never fabricated, never blank.
        <section className="mt-12 space-y-2">
          <p className="text-base text-ink-tertiary">暂无已记录的大跌日。</p>
          <p className="font-mono text-xs text-ink-tertiary">
            行情历史回顾上线后将在此展示。
          </p>
        </section>
      ) : (
        <>
          {/* Segment 1 — 月度日历网格(大跌日高亮 + 可点选) */}
          <section className="mt-12 space-y-8">
            <h2 className="text-xl font-semibold text-ink-primary">日历</h2>
            <div className="space-y-8">
              {months.map((m) => (
                <CrashMonthGrid key={m.key} month={m} focusKey={focusKey} />
              ))}
            </div>
            {monthsTruncated ? (
              <p className="font-mono text-xs text-ink-tertiary">
                仅展示最近 {MONTH_GRID_CAP} 个月；共 {distinctMonthCount} 个月、
                {crashDays.length} 个大跌日。
              </p>
            ) : null}
          </section>

          {/* Segments 2 + 3 — 所选大跌日详情(领跌板块 + 前瞻收益) */}
          {focus !== undefined ? (
            <CrashDayDetail day={focus} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** One month grid: weekday header (Mon-start) + aligned day cells; crash days highlighted. */
function CrashMonthGrid({
  month,
  focusKey,
}: {
  month: MonthGroup;
  focusKey: string | undefined;
}) {
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
      const isFocus = dayKey === focusKey;
      cells.push(
        <Link
          key={day}
          href={`?d=${dayKey}`}
          scroll={false}
          aria-label={`${dayKey} 大跌日，查看详情`}
          className={[
            "flex h-11 items-center justify-center rounded font-mono text-xs",
            "bg-market-down-soft text-market-down",
            // Hover flips to solid market-down bg ⇒ text must flip to white to stay
            // readable (green-on-green would vanish). Focus keeps the soft bg + a ring.
            isFocus
              ? "ring-2 ring-market-down"
              : "hover:bg-market-down hover:text-white",
          ].join(" ")}
        >
          {day}
        </Link>,
      );
    } else {
      cells.push(
        <div
          key={day}
          className="flex h-11 items-center justify-center text-xs text-ink-tertiary"
        >
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

/** Detail for one crash day: trigger indices + leading-down sectors + forward-return table. */
function CrashDayDetail({ day }: { day: PublishedCrashDay }) {
  const date = day.tradeDate;
  const weekday = `周${WEEKDAY_CN[date.getUTCDay()]}`;
  return (
    <section className="mt-12 space-y-8 border-t border-border-hairline pt-8">
      <div className="space-y-1">
        <h2 className="font-mono text-xl font-semibold text-ink-primary">
          {formatDay(date)}
        </h2>
        <p className="text-sm text-ink-secondary">
          {weekday} · 触发宽基 {day.crashCount} / 3（阈值 {day.threshold.toFixed(1)}%）
        </p>
      </div>

      {/* 当日三大宽基涨跌(crashed 即触发) */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-secondary">当日宽基</h3>
        <div className="flex flex-wrap gap-2">
          {day.indices.map((idx) => (
            <span key={idx.indexCode} className="inline-flex items-center gap-1.5">
              <span className="text-sm text-ink-secondary">
                {INDEX_LABEL[idx.indexCode] ?? idx.indexCode}
              </span>
              <ReactionChip tone={signTone(idx.pctChange)} value={absPct(idx.pctChange)} />
            </span>
          ))}
        </div>
      </div>

      {/* Segment 2 — 领跌板块榜 */}
      <LeadingSectors sectors={day.leadingSectors} />

      {/* Segment 3 — 前瞻收益表 */}
      <ForwardReturnsTable indices={day.indices} />
    </section>
  );
}

function LeadingSectors({ sectors }: { sectors: LeadingSector[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">领跌板块（申万一级）</h3>
      {sectors.length === 0 ? (
        // NFR-5: no sector bars for the day ⇒ honest line, never faked.
        <p className="text-sm text-ink-tertiary">该日领跌板块数据暂不可用。</p>
      ) : (
        <ul className="space-y-1.5">
          {sectors.map((s) => (
            <li key={s.sectorCode} className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-secondary">{s.sectorName}</span>
              <ReactionChip tone="down" value={absPct(s.pctChange)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ForwardReturnsTable({ indices }: { indices: IndexCrashDetail[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-secondary">
        前瞻收益（大跌后历史实际）
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-tertiary">
              <th className="py-1.5 pr-4 font-medium">指数</th>
              <th className="py-1.5 pr-4 font-medium">T+1</th>
              <th className="py-1.5 pr-4 font-medium">T+5</th>
              <th className="py-1.5 font-medium">T+20</th>
            </tr>
          </thead>
          <tbody>
            {indices.map((idx) => (
              <tr key={idx.indexCode} className="border-t border-border-hairline">
                <td className="py-1.5 pr-4 text-ink-secondary">
                  {INDEX_LABEL[idx.indexCode] ?? idx.indexCode}
                </td>
                <ReturnCell v={idx.forwardReturns.t1} />
                <ReturnCell v={idx.forwardReturns.t5} />
                <ReturnCell v={idx.forwardReturns.t20} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-tertiary">
        T+N = 大跌日后第 N 个交易日该指数实际收益；「—」为数据不足，不编造。
      </p>
    </div>
  );
}

function ReturnCell({ v }: { v: number | null }) {
  if (v === null) {
    return (
      <td className="py-1.5 pr-4 font-mono text-ink-tertiary">—</td>
    );
  }
  const tone =
    v > 0 ? "text-market-up" : v < 0 ? "text-market-down" : "text-ink-secondary";
  return <td className={`py-1.5 pr-4 font-mono ${tone}`}>{signedPct(v)}</td>;
}
