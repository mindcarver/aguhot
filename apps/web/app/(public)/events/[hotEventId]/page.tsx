import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AiLabel } from "@/components/chips";
import { getPrisma, getPublishedHotEventDetail, newTraceId } from "@aguhot/core";

export const metadata: Metadata = {
  title: "热点事件详情",
};

/**
 * Public hot-event detail page — Story 1.8.
 *
 * This is the first public DETAIL route to READ the published read models
 * (published_hot_events + published_hot_event_explanations +
 * published_hot_event_evidence), via getPublishedHotEventDetail. It completes
 * the "read the summary and evidence timeline" half of the epic's detail AC.
 *
 * Why force-dynamic + @aguhot/core import is safe for the build:
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at REQUEST time, not BUILD time. getPrisma() reads
 *     DATABASE_URL at runtime; that call is never reached during `next build`,
 *     so the public web build stays DATABASE_URL-free (same mechanism as the
 *     1.7 homepage and the (operator)/console route). (public)/layout.tsx and
 *     the static public routes (/daily, /topics, /favorites, /design) never
 *     import core, so only `/` and `/events/[hotEventId]` are dynamic.
 *
 * Three first-screen partitions (AC1):
 *   - 发生了什么 (what happened): title + source count + time FACTS. Always
 *     rendered from the read model — facts never depend on the explanation.
 *   - 为什么重要 (why it matters): system-derived explanation, or an honest
 *     "系统解释生成中" degraded line when no explanation was projected yet.
 *   - 当前仍不确定什么 (what remains uncertain): same degraded-line rule.
 *   The system-derived explanation partitions carry the uniform <AiLabel/> (AC3,
 *   same component as the operator console — public/operator identical).
 *
 * Evidence timeline (AC2): one row per source, chronological (publishedAt ASC,
 * nulls last — the projection already assigned `position` in that order). Each
 * row shows source name, time (font-mono), summary, and either "原文链接 ↗"
 * (url present → available) or an "无原始链接" badge (url missing → unavailable).
 * A row is NEVER silently dropped for a missing link (AC2: dead links keep the
 * record with a clearly marked status).
 *
 * AD-8: no auth, no /login redirect. Unpublished id (no published_hot_events
 * row) → getPublishedHotEventDetail returns null → notFound() (404). Candidate /
 * rejected / taken-down titles never leak.
 *
 * NFR: no investment-advice wording. The deterministic explanation text stays
 * descriptive (it is generated from real evidence, never fabricates). The page
 * renders only what the read model carries.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ hotEventId: string }>;
}

export default async function PublicEventDetailPage({ params }: PageProps) {
  const { hotEventId } = await params;

  // Request-time DB read. getPrisma() throws loudly if DATABASE_URL is missing
  // (DB is core infra; its absence is an incident, not graceful degradation).
  const prisma = getPrisma();
  const detail = await getPublishedHotEventDetail({
    prisma,
    traceId: newTraceId(),
    hotEventId,
  });

  // Unpublished id (candidate / rejected / taken_down / unknown): no summary
  // row in the read model → 404. The title/content of non-published events
  // never leaks (AD-8). notFound() throws Next's 404 — handled by the framework.
  if (detail === null) {
    notFound();
  }

  const hasExplanation = detail.explanation !== null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      {/* Return link to the feed (stable back path; originating-context retention is 2.5). */}
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"
      >
        <span aria-hidden>←</span> 返回首页
      </Link>

      {/* Title — a fact, not system-derived, so no AiLabel here. */}
      <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-ink-primary">
        {detail.title}
      </h1>

      {/* 发生了什么 — facts partition. Source count + times, always rendered. */}
      <section className="mt-8 space-y-3 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          发生了什么
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-sm text-ink-tertiary">
          <div>
            <dt className="inline">来源数 </dt>
            <dd className="inline text-ink-primary">{detail.evidenceCount}</dd>
          </div>
          <div>
            <dt className="inline">最近更新 </dt>
            <dd className="inline">{formatDateTime(detail.latestEvidenceAt)}</dd>
          </div>
          <div>
            <dt className="inline">发布于 </dt>
            <dd className="inline">{formatDateTime(detail.publishedAt)}</dd>
          </div>
        </dl>
      </section>

      {/* 为什么重要 — system-derived explanation, or honest degraded state. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            为什么重要
          </h2>
          {hasExplanation ? <AiLabel /> : null}
        </div>
        {hasExplanation ? (
          <p className="text-base leading-relaxed text-ink-primary">
            {detail.explanation!.whyItMatters}
          </p>
        ) : (
          <p className="text-base text-ink-tertiary">系统解释生成中。</p>
        )}
      </section>

      {/* 当前仍不确定什么 — system-derived, or honest degraded state. */}
      <section className="mt-6 space-y-3 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
            当前仍不确定什么
          </h2>
          {hasExplanation ? <AiLabel /> : null}
        </div>
        {hasExplanation ? (
          <p className="text-base leading-relaxed text-ink-primary">
            {detail.explanation!.uncertainties}
          </p>
        ) : (
          <p className="text-base text-ink-tertiary">系统解释生成中。</p>
        )}
      </section>

      {/* Evidence timeline (AC2). One row per source, chronological. */}
      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          证据时间线
        </h2>
        {detail.evidence.length > 0 ? (
          <ol role="list" className="space-y-4">
            {detail.evidence.map((row) => (
              <li
                key={row.id}
                className="border-l-2 border-brand bg-surface-raised px-5 py-4"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-semibold text-ink-primary">
                    {row.sourceName}
                  </span>
                  <time className="font-mono text-xs text-ink-tertiary">
                    {row.publishedAt === null ? "时间未知" : formatDateTime(row.publishedAt)}
                  </time>
                </div>
                {row.summary !== null && row.summary.trim() !== "" ? (
                  <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                    {row.summary}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-ink-tertiary">（无摘要）</p>
                )}
                <div className="mt-3">
                  {row.linkStatus === "available" && row.url !== null ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-brand"
                    >
                      原文链接 <span aria-hidden>↗</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-tertiary">
                      无原始链接
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-tertiary">暂无证据行。</p>
        )}
      </section>
    </div>
  );
}

/**
 * Locale-stable UTC format (avoid locale-dependent toLocaleString). YYYY-MM-DD
 * HH:mm UTC is consistent across build-time TZ and runtime TZ. Shared shape with
 * the feed card formatter.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
