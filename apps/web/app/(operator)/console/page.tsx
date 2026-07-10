import Link from "next/link";

import { listPendingCandidates, getPrisma, newTraceId } from "@aguhot/core";

/**
 * Operator review console — candidate queue. Story 1.6.
 *
 * Server component reading pending candidates via @aguhot/core's
 * listPendingCandidates. This is the first web route to consume @aguhot/core:
 *
 *   - `export const dynamic = "force-dynamic"` marks the route dynamic so Next
 *     evaluates it at request time (getPrisma reads DATABASE_URL at runtime),
 *     not at build time. This keeps the public web build DATABASE_URL-free:
 *     public routes are static and never import core; operator routes are
 *     dynamic and do.
 *   - The route is under `(operator)` whose layout sets `robots noindex`
 *     (operator pages are never indexed).
 *
 * Renders the candidate queue (AC1): title, evidence count, latest evidence
 * time, status (always "candidate" for this query), with a link into each
 * candidate's detail/review page. Empty state renders a clear message, no fake
 * data (NFR: empty states never render placeholder data).
 *
 * V1 has no auth (deferred to user-profile module); the layout is the drop-in
 * point for future auth.
 */
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const prisma = getPrisma();
  const candidates = await listPendingCandidates({
    prisma,
    traceId: newTraceId(),
  });

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
                  className="block rounded-lg border border-line-subtle bg-surface px-5 py-4 transition hover:border-ink-secondary"
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
