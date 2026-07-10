import Link from "next/link";

import { listPendingCandidates, listPublishedHotEvents, getPrisma, newTraceId } from "@aguhot/core";

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
  const [candidates, published] = await Promise.all([
    listPendingCandidates({ prisma, traceId: newTraceId() }),
    listPublishedHotEvents({ prisma, traceId: newTraceId() }),
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
                  <dl className="mt-2 flex gap-6 font-mono text-xs text-ink-tertiary">
                    <div>
                      <dt className="inline">最近证据 </dt>
                      <dd className="inline">{formatDate(c.latestEvidenceAt)}</dd>
                    </div>
                    <div>
                      <dt className="inline">状态 </dt>
                      <dd className="inline">candidate</dd>
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
