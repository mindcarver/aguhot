import Link from "next/link";

import { FilterPill, AiLabel } from "@/components/chips";

import {
  getPrisma,
  getSm6MisleadingRate,
  listAiContentForSampling,
  newTraceId,
} from "@aguhot/core";

import { submitSuppressAiContent } from "./actions";

/**
 * Operator AI-content sampling console — Story 5.4.
 *
 * Cross-event list of AI 解读 (recommendation_reasons) + AI 深读 (deep_reads),
 * with a type FilterPill, an SM-6 misleading-rate readout, and a per-row
 * "标记为误导并下线" suppress form. TrendBriefing is EXCLUDED (epic Gap 2: V1
 * does not allow marking / taking down trend briefings; the sampling console is
 * browse-only for them, and they never appear in this list).
 *
 * Server component reading via @aguhot/core. force-dynamic so the route is
 * request-time evaluated (getPrisma reads DATABASE_URL at runtime), keeping the
 * public web build DATABASE_URL-free (same pattern as /console and the other
 * core-reading operator pages).
 *
 * AC (epic): "进入复核台 → 按类型筛选 reason/deepread → 标记 → 误导率读数".
 *
 * URL-driven filter (zero client JS — the FilterPill renders as a <Link>):
 *   - ?type=reason   → only AI 解读 rows.
 *   - ?type=deepread → only AI 深读 rows.
 *   - (no param)     → both.
 *
 * NFR: empty states render a clear message, no fake data. Already-suppressed
 * rows render with a "已下线" marker (UX-DR14) and NO suppress button (idempotent —
 * the server-side suppressAiContent also guards, but hiding the button is the
 * honest UI).
 */
export const dynamic = "force-dynamic";

// The supported URL filter values. `undefined` = both (no ?type= param). The
// FilterPill hrefs below drive this; a garbage ?type= value falls through to
// "both" (listAiContentForSampling ignores unknown type values).
type TypeFilter = "reason" | "deepread" | undefined;

export default async function AiContentConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const sp = await searchParams;
  const typeFilter: TypeFilter =
    sp.type === "reason" || sp.type === "deepread" ? sp.type : undefined;

  const prisma = getPrisma();
  const [items, sm6] = await Promise.all([
    listAiContentForSampling({ prisma, traceId: newTraceId(), type: typeFilter }),
    getSm6MisleadingRate({ prisma, traceId: newTraceId() }),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">AI 内容抽检</h1>
          <p className="text-ink-secondary">
            AI 解读 · AI 深读 · {items.length} 条 · 研判不在抽检范围
          </p>
        </header>

        {/* SM-6 misleading-rate readout (7-day rolling window). Inline text mirroring
            the existing /console "· N 条" pattern. denominator === 0 → "暂无数据"
            (the readout is meaningless until there is generated content to judge). */}
        <section className="mt-6 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
          <h2 className="text-base font-semibold">AI 内容误导率（近 {sm6.windowDays} 日）</h2>
          {sm6.denominator === 0 ? (
            <p className="mt-1 text-sm text-ink-secondary">暂无数据</p>
          ) : (
            <p className="mt-1 text-sm text-ink-secondary">
              <span className="font-mono">{(sm6.rate * 100).toFixed(1)}%</span>
              {" · "}
              <span className="font-mono">
                {sm6.numerator}/{sm6.denominator}
              </span>
              {sm6.rate < 0.1 ? " · 达标（< 10%）" : " · 超标（≥ 10%）"}
            </p>
          )}
        </section>

        {/* FilterPill row: URL-driven (zero client JS). Active = current ?type=.
            Three states: 全部 (no param) / reason / deepread. TrendBriefing is
            intentionally absent from the filter set (epic Gap 2). */}
        <nav className="mt-8 flex flex-wrap gap-2" aria-label="AI 内容类型筛选">
          <FilterPill active={typeFilter === undefined} href="/console/ai-content">
            全部
          </FilterPill>
          <FilterPill active={typeFilter === "reason"} href="/console/ai-content?type=reason">
            AI 解读
          </FilterPill>
          <FilterPill active={typeFilter === "deepread"} href="/console/ai-content?type=deepread">
            AI 深读
          </FilterPill>
        </nav>

        {items.length === 0 ? (
          <p className="mt-12 text-ink-secondary">暂无 AI 内容。</p>
        ) : (
          <ul className="mt-8 space-y-4" role="list">
            {items.map((item) => (
              <li
                key={`${item.type}-${item.id}`}
                className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <AiLabel />
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-secondary">
                    {item.type === "reason" ? "AI 解读" : "AI 深读"}
                  </span>
                  <Link
                    href={`/console/${item.hotEventId}`}
                    className="text-base font-semibold transition hover:underline"
                  >
                    {item.eventTitle}
                  </Link>
                  {item.suppressedAt !== null && (
                    <span className="text-xs font-medium text-ink-tertiary">已下线</span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-xs text-ink-tertiary">
                    {formatDate(item.createdAt)}
                  </span>
                </div>

                <p className="mt-2 text-sm text-ink-secondary line-clamp-3">
                  {item.content}
                </p>

                {/* Suppress form: only rendered for live (unsuppressed) rows. The
                    server action whitelists targetType ∈ {reason,deepread}; the
                    hidden hotEventId scopes the audit row. JS-free form submit
                    (mirrors the [eventId]/ReviewForm pattern). The note is
                    operator free-text (why the content is misleading). */}
                {item.suppressedAt === null && (
                  <form action={submitSuppressAiContent} className="mt-3 flex flex-wrap items-start gap-2">
                    <input type="hidden" name="targetType" value={item.type} />
                    <input type="hidden" name="targetId" value={item.id} />
                    <input type="hidden" name="hotEventId" value={item.hotEventId} />
                    <input
                      type="text"
                      name="note"
                      placeholder="误导理由（可选）"
                      className="min-w-0 flex-1 rounded-md border border-border-hairline bg-surface-base px-3 py-1.5 text-sm"
                    />
                    <button
                      type="submit"
                      className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-foreground transition hover:opacity-90"
                    >
                      标记为误导并下线
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function formatDate(d: Date): string {
  // Locale-stable ISO-ish format (avoid locale-dependent toLocaleString which
  // varies by build-time TZ). YYYY-MM-DD HH:mm UTC is enough for a sampling list.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
