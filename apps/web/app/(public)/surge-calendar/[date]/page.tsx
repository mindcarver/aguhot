import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReactionChip } from "@/components/chips";
import { getPrisma, listPublishedHotEvents, listPublishedSurgeDays, newTraceId } from "@aguhot/core";

import {
  BreadthSections,
  INDEX_LABEL,
  LeadingSurgeSectors,
  LinkedHotEvents,
  SurgeForwardReturns,
  WEEKDAY_CN,
  absPct,
  formatDay,
  signTone,
} from "../_components";

export const dynamic = "force-dynamic";
interface PageProps { params: Promise<{ date: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  return { title: /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date} 大涨日回顾` : "大涨日回顾", robots: { index: false, follow: false } };
}

export default async function SurgeDayPage({ params }: PageProps) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const prisma = getPrisma();
  const traceId = newTraceId();
  const [surgeDays, hotEvents] = await Promise.all([
    listPublishedSurgeDays({ prisma, traceId }),
    listPublishedHotEvents({ prisma, traceId }),
  ]);
  const day = surgeDays.find((item) => formatDay(item.tradeDate) === date);
  if (day === undefined) notFound();
  const linked = hotEvents.filter((event) => formatDay(event.publishedAt) === date);
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">{date} 大涨日回顾</h1>
        <p className="text-lg text-ink-secondary">周{WEEKDAY_CN[day.tradeDate.getUTCDay()]} · 触发宽基 {day.surgeCount} / 3（阈值 {day.threshold.toFixed(1)}%）</p>
        <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-3"><span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">说明</span><p className="text-sm leading-relaxed text-ink-secondary">历史统计回顾，非预测、非投资建议。T+1 / T+5 / T+20 为大涨日后该指数历史实际收益，缺失记为「—」。</p></div>
      </header>
      <section className="mt-10 space-y-2"><h2 className="text-xl font-semibold text-ink-primary">当日宽基</h2><div className="flex flex-wrap gap-2">{day.indices.map((index) => <span key={index.indexCode} className="inline-flex items-center gap-1.5"><span className="text-sm text-ink-secondary">{INDEX_LABEL[index.indexCode] ?? index.indexCode}</span>{index.pctChange === null ? <span className="text-xs text-ink-tertiary">数据暂不可用</span> : <ReactionChip tone={signTone(index.pctChange)} value={absPct(index.pctChange)} />}</span>)}</div></section>
      <section className="mt-10"><LeadingSurgeSectors sectors={day.leadingSectors} /></section>
      <section className="mt-10"><SurgeForwardReturns indices={day.indices} /></section>
      <section className="mt-12 border-t border-border-hairline pt-8"><BreadthSections breadth={day.breadth} /></section>
      <section className="mt-10 border-t border-border-hairline pt-8"><LinkedHotEvents events={linked.slice(0, 8)} total={linked.length} /></section>
    </div>
  );
}
