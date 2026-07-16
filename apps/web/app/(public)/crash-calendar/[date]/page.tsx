import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReactionChip } from "@/components/chips";
import {
  getPrisma,
  listPublishedCrashDays,
  listPublishedHotEvents,
  newTraceId,
} from "@aguhot/core";

import {
  BreadthSections,
  ForwardReturnsTable,
  INDEX_LABEL,
  LeadingSectors,
  LinkedHotEvents,
  WEEKDAY_CN,
  absPct,
  formatDay,
  signTone,
} from "../_components/crash-day-shared";

/**
 * `/crash-calendar/[date]` — crash-day deep detail page (Story 8.8, Epic 8).
 *
 * Reads ONLY published_* read models (AD-3 — never market_breadth_daily /
 * crash_days / index_daily_bars / sector_daily_bars): listPublishedCrashDays
 * (8.3) + listPublishedHotEvents (8.5 same-day linkage). The date segment is
 * resolved in JS: `crashDays.find(c => formatDay(c.tradeDate) === date)`. V1
 * scale is tiny, mirroring the index page's list+filter paradigm (Design Notes).
 *
 * Routing semantics (mirrors /events/[hotEventId]): `notFound()` (404) on an
 * invalid `YYYY-MM-DD` OR a valid-format date with no published crash-day row.
 * This is INTENTIONALLY different from the index page's `?d=` honest-fallback
 * (which silently falls back to the latest crash day) — the [date] segment IS
 * "this specific day's detail", so a missing day is a 404, not a silent redirect
 * to a different day's URL (Design Notes: avoids URL↔content mismatch).
 *
 * Renders: 说明块 → 当日宽基/触发 → 领跌板块 → 前瞻收益 → 市场广度(5段) → 当日热点.
 *   - 市场广度 consumes 8.7's `published_crash_days.breadth`. breadth===null →
 *     the whole breadth group renders "该日广度数据暂不可用" but the INHERITED four
 *     segments still render (AC2 — breadth absence never blocks the page).
 *
 * Compliance (§10 / §12 Q9/Q10 / SM-C4):
 *   - `generateMetadata` returns `robots:{index:false,follow:false}` for EVERY
 *     [date] request (AC5 — financial-info gate until external legal sign-off).
 *   - Explicit「历史统计回顾，非预测、非投资建议」说明块 (mirrors index page).
 *   - NOT sorted by rebound magnitude (inherits listPublishedCrashDays tradeDate DESC).
 *
 * Why force-dynamic + @aguhot/core import is safe for the build: same mechanism
 * as /events/[hotEventId], /daily, /topics — `force-dynamic` evaluates the route
 * at REQUEST time, so getPrisma()'s DATABASE_URL read is never reached during
 * `next build` (AD-3/AD-6, public web build stays DB-free).
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ date: string }>;
}

/** AC5: every [date] request is noindex/nofollow (financial-info compliance gate). */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  // Malformed segment (e.g. /crash-calendar/foo-bar) → neutral title; the page
  // body will notFound() → 404. Never interpolate raw garbage into a per-date title.
  const title = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date} 大跌日回顾` : "大跌日回顾";
  return {
    title,
    robots: { index: false, follow: false },
  };
}

export default async function CrashDayDetailPage({ params }: PageProps) {
  const { date } = await params;

  // AC3: invalid format → 404 (no fallback, no 500). Mirrors /events/[hotEventId].
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    notFound();
  }

  const prisma = getPrisma();
  const traceId = newTraceId();
  // Two independent published_* reads (AD-3, public page reads published_* only) —
  // concurrent, sharing one traceId.
  const [crashDays, hotEvents] = await Promise.all([
    listPublishedCrashDays({ prisma, traceId }),
    listPublishedHotEvents({ prisma, traceId }),
  ]);

  // Resolve the day in JS (V1 tiny scale, mirrors index list+filter paradigm).
  // AC3: valid format but no published row → notFound() (no fallback to nearest).
  const day = crashDays.find((c) => formatDay(c.tradeDate) === date);
  if (day === undefined) {
    notFound();
  }

  // Story 8.5 — same-day published HotEvents: filter preserves listPublishedHotEvents'
  // saliency DESC return order; publishedAt = first-published day (Interpretation A).
  // Cap for display (defensive; V1 published volume is tiny).
  const linked = hotEvents.filter((e) => formatDay(e.publishedAt) === date);

  const weekday = `周${WEEKDAY_CN[day.tradeDate.getUTCDay()]}`;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">
          {formatDay(day.tradeDate)} 大跌日回顾
        </h1>
        <p className="text-lg text-ink-secondary">
          {weekday} · 触发宽基 {day.crashCount} / 3（阈值 {day.threshold.toFixed(1)}%）
        </p>
        {/* 合规说明块:镜像 EditorialReasonBlock 视觉契约(hairline 分隔 + 标签 + body-sm),
            静态文案非 AI 解读 → 中性 bg-surface-muted。镜像 index 页既有说明块。 */}
        <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-3">
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">
            说明
          </span>
          <p className="text-sm leading-relaxed text-ink-secondary">
            历史统计回顾，非预测、非投资建议。大跌日 = 三大宽基任一当日跌幅 ≤ 阈值；T+1 / T+5 /
            T+20 为大跌后该指数历史实际收益，缺失记为「—」。市场广度（涨跌停 / 龙虎榜 / 融资融券等）
            数据来源：AkShare 公开行情。
          </p>
        </div>
      </header>

      {/* Segment 1 — 当日宽基(三大宽基涨跌;crashed 即触发) */}
      <section className="mt-10 space-y-2">
        <h2 className="text-xl font-semibold text-ink-primary">当日宽基</h2>
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
      </section>

      {/* Segment 2 — 领跌板块榜 */}
      <section className="mt-10">
        <LeadingSectors sectors={day.leadingSectors} />
      </section>

      {/* Segment 3 — 前瞻收益表 */}
      <section className="mt-10">
        <ForwardReturnsTable indices={day.indices} />
      </section>

      {/* Segment 4 — 市场广度(Story 8.8:消费 8.7 breadth 的 5 段) */}
      <section className="mt-12 border-t border-border-hairline pt-8">
        <BreadthSections breadth={day.breadth} />
      </section>

      {/* Segment 5 — 当日热点事件(Story 8.5:关联当日已发布 HotEvent) */}
      <section className="mt-10 border-t border-border-hairline pt-8">
        <LinkedHotEvents events={linked.slice(0, 8)} total={linked.length} />
      </section>
    </div>
  );
}
