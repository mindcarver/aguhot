import Link from "next/link";

import {
  listPendingCandidates,
  listPublishedHotEvents,
  getSm9GateDistribution,
  getPrisma,
  newTraceId,
} from "@aguhot/core";
import type { AutoPublishOutcome } from "@aguhot/core";

/**
 * Operator review console — candidate queue + published events. Story 1.6 +
 * Story 1.9 (published-events entry).
 *
 * Server component reading pending candidates + published events via
 * @aguhot/core. force-dynamic so the route is request-time evaluated (getPrisma
 * reads DATABASE_URL at runtime), keeping the public web build DATABASE_URL-free.
 *
 *   - Candidate queue (AC1, Story 1.6): pending candidates with a link into the
 *     review page.
 *   - Published events (Story 1.9): a section listing currently-published events
 *     so the operator can enter the revision branch of /console/[eventId]
 *     (revise title/tags/explanation + republish). Reuses the public read query
 *     (listPublishedHotEvents) — operator-side read of the published read model
 *     is legitimate (same data the public feed sees).
 *
 * NFR: empty states render a clear message, no fake data. V1 has no auth
 * (deferred to user-profile); the layout is the drop-in point.
 */
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const prisma = getPrisma();
  const [candidates, published, sm9] = await Promise.all([
    listPendingCandidates({ prisma, traceId: newTraceId() }),
    listPublishedHotEvents({ prisma, traceId: newTraceId() }),
    getSm9GateDistribution({ prisma, traceId: newTraceId() }),
  ]);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">运营复核台</h1>
          <p className="text-ink-secondary">
            待复核候选热点 · {candidates.length} 条
          </p>
        </header>

        {/* Story 7.6 — SM-9 gate-distribution readout. Shows what the Epic 7
            auto-publish gate recommends (approve/hold/reject) over all hot_events,
            the relevance split, and the current thresholds. The gap between
            gate.approve and status.published = manual overrides. */}
        <section
          aria-label="打分闸门分布"
          className="mt-6 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4"
        >
          <h2 className="text-sm font-semibold text-ink-secondary">打分闸门分布 (SM-9)</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-xs sm:grid-cols-4">
            <div>
              <dt className="inline text-ink-tertiary">自动发 </dt>
              <dd className="inline text-ink-primary">{sm9.gate.approve}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">留复核 </dt>
              <dd className="inline text-ink-primary">{sm9.gate.hold}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">拦截 </dt>
              <dd className="inline text-ink-primary">{sm9.gate.reject}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">总数 </dt>
              <dd className="inline text-ink-primary">{sm9.total}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">pass </dt>
              <dd className="inline">{sm9.relevance.pass}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">suspicious </dt>
              <dd className="inline">{sm9.relevance.suspicious}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">fail </dt>
              <dd className="inline">{sm9.relevance.fail}</dd>
            </div>
            <div>
              <dt className="inline text-ink-tertiary">未打分 </dt>
              <dd className="inline">{sm9.relevance.unscored}</dd>
            </div>
          </dl>
          <p className="mt-3 font-mono text-xs text-ink-tertiary">
            实际: published {sm9.status.published} · candidate {sm9.status.candidate} · rejected{" "}
            {sm9.status.rejected} · 阈值 LOW={sm9.thresholds.low} HIGH={sm9.thresholds.high}
          </p>
        </section>

        {/* Story 5.4: AI content sampling console entry. Cross-event list of AI
            解读 + AI 深读 with a type filter, an SM-6 misleading-rate readout,
            and a per-row suppress form. Research briefings are browse-only (not
            listed / not suppressible in V1). */}
        <section className="mt-8">
          <Link
            href="/console/ai-content"
            className="block rounded-lg border border-border-hairline bg-surface-raised px-5 py-4 transition hover:border-ink-secondary"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-base font-semibold">AI 内容抽检（reason / 深读）</h2>
              <span className="shrink-0 text-sm text-ink-secondary">进入 →</span>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">
              抽检 AI 解读与 AI 深读 · 标记误导并下线 · 误导率读数
            </p>
          </Link>
        </section>

        {candidates.length === 0 ? (
          <p className="mt-12 text-ink-secondary">暂无待复核候选。</p>
        ) : (
          <ul className="mt-8 space-y-3" role="list">
            {candidates.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/console/${c.id}`}
                  className="block rounded-lg border border-border-hairline bg-surface-raised px-5 py-4 transition hover:border-ink-secondary"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="text-lg font-semibold">{c.title}</h2>
                    <span className="shrink-0 font-mono text-sm text-ink-secondary">
                      {c.evidenceCount} 来源
                    </span>
                  </div>
                  <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-ink-tertiary">
                    <div>
                      <dt className="inline">最近证据 </dt>
                      <dd className="inline">{formatDate(c.latestEvidenceAt)}</dd>
                    </div>
                    <div>
                      <dt className="inline">状态 </dt>
                      <dd className="inline">candidate</dd>
                    </div>
                    {/* Story 7.6 — Epic 7 score + gate outcome so the operator sees
                        why this was held. */}
                    <div>
                      <dt className="inline">打分 </dt>
                      <dd className="inline text-ink-secondary">
                        {c.saliency === null ? "—" : `${c.saliency} 分`}
                        {c.relevanceLabel !== null ? ` · ${c.relevanceLabel}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">闸门 </dt>
                      <dd className={`inline ${gateOutcomeClass(c.gateOutcome)}`}>
                        {gateOutcomeLabel(c.gateOutcome)}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Published events — Story 1.9. Entry into the revision UI. Each links
            to /console/{id} where the published branch renders the revision
            form + republish + pending diff. */}
        <section className="mt-16 space-y-2">
          <h2 className="text-xl font-bold">已发布热点</h2>
          <p className="text-ink-secondary">
            已发布热点 · {published.length} 条 · 可修正标题/标签/解释后重新发布
          </p>
          {published.length === 0 ? (
            <p className="mt-6 text-ink-secondary">暂无已发布热点。</p>
          ) : (
            <ul className="mt-6 space-y-3" role="list">
              {published.map((e) => (
                <li key={e.hotEventId}>
                  <Link
                    href={`/console/${e.hotEventId}`}
                    className="block rounded-lg border border-border-hairline bg-surface-raised px-5 py-4 transition hover:border-ink-secondary"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-base font-semibold">{e.title}</h3>
                      <span className="shrink-0 font-mono text-sm text-ink-secondary">
                        {e.evidenceCount} 来源
                      </span>
                    </div>
                    <dl className="mt-2 flex gap-6 font-mono text-xs text-ink-tertiary">
                      <div>
                        <dt className="inline">最近证据 </dt>
                        <dd className="inline">{formatDate(e.latestEvidenceAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline">状态 </dt>
                        <dd className="inline">published</dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function formatDate(d: Date): string {
  // Locale-stable ISO-ish format (avoid locale-dependent toLocaleString which
  // varies by build-time TZ). YYYY-MM-DD HH:mm UTC is enough for a queue list.
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// Story 7.6 — gate-outcome badge label + tone. Kept in ink tones (no market
// red/green) so it reads as a queue-triage signal, not investment advice.
function gateOutcomeLabel(outcome: AutoPublishOutcome | null): string {
  switch (outcome) {
    case "approve":
      return "自动发布";
    case "reject":
      return "拦截";
    case "hold":
      return "留复核";
    default:
      return "未打分";
  }
}

function gateOutcomeClass(outcome: AutoPublishOutcome | null): string {
  switch (outcome) {
    case "approve":
      return "text-ink-primary font-semibold";
    case "reject":
      return "text-ink-secondary";
    default:
      return "text-ink-tertiary";
  }
}
