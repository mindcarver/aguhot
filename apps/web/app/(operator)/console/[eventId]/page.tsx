import Link from "next/link";
import { notFound } from "next/navigation";

import { getCandidateDetail, getPrisma, CandidateNotFoundError, newTraceId } from "@aguhot/core";

import { submitReview } from "./actions";

/**
 * Candidate detail / review page — Story 1.6.
 *
 * Server component reading one candidate with its evidence records + decision
 * audit chain via getCandidateDetail. Renders:
 *   - the candidate title + current status,
 *   - the evidence list (source name, time, summary, original link) via the
 *     hot_event_evidence → evidence_records → evidence_sources join,
 *   - the decision audit chain (review + publication decisions, ascending),
 *   - the decision form (approve/reject/takedown + note) as a server action.
 *
 * `force-dynamic` for the same reason as the console list (DB read at request
 * time). If the candidate is not found, render 404 via notFound().
 */
export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const prisma = getPrisma();

  let detail;
  try {
    detail = await getCandidateDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: eventId,
    });
  } catch (error) {
    if (error instanceof CandidateNotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <nav className="mb-6">
          <Link href="/console" className="text-sm text-ink-secondary hover:text-ink-primary">
            ← 返回复核队列
          </Link>
        </nav>

        <header className="space-y-2">
          <h1 className="text-2xl font-bold">{detail.title}</h1>
          <p className="font-mono text-sm text-ink-secondary">
            状态 · {detail.publicationStatus}
          </p>
        </header>

        {/* Evidence list */}
        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold">证据来源（{detail.evidence.length}）</h2>
          {detail.evidence.length === 0 ? (
            <p className="text-ink-secondary">无证据记录。</p>
          ) : (
            <ul className="space-y-3" role="list">
              {detail.evidence.map((e) => (
                <li key={e.evidenceRecordId} className="rounded-lg border-l-2 border-brand px-4 py-3 bg-surface">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-semibold">{e.sourceName}</span>
                    <span className="font-mono text-xs text-ink-tertiary">
                      {e.publishedAt ? formatDate(e.publishedAt) : "时间未知"}
                    </span>
                  </div>
                  {e.title ? <p className="mt-1 font-medium">{e.title}</p> : null}
                  {e.summary ? <p className="mt-1 text-sm text-ink-secondary">{e.summary}</p> : null}
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-sm text-brand hover:underline"
                    >
                      原文链接 ↗
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Decision audit chain */}
        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold">决策审计链（{detail.decisions.length}）</h2>
          {detail.decisions.length === 0 ? (
            <p className="text-ink-secondary">暂无决策记录。</p>
          ) : (
            <ol className="space-y-2" role="list">
              {detail.decisions.map((d) => (
                <li key={`${d.type}-${d.id}`} className="font-mono text-sm text-ink-secondary">
                  <span className="text-ink-tertiary">{formatDate(d.createdAt)}</span>
                  {" · "}
                  {d.type === "review" ? (
                    <span>
                      复核决策 · {d.outcome}
                      {d.reviewer ? ` · ${d.reviewer}` : null}
                      {d.note ? ` · ${d.note}` : null}
                    </span>
                  ) : (
                    <span>
                      发布决策 · {d.fromStatus} → {d.toStatus}
                      {d.reason ? ` · ${d.reason}` : null}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Decision form */}
        <ReviewForm eventId={eventId} currentStatus={detail.publicationStatus} />
      </div>
    </main>
  );
}

/**
 * The decision form. The available outcomes depend on the current status:
 *   candidate  → approve / reject
 *   published  → takedown
 *   rejected / taken_down → none (terminal in V1; re-publish is 1.9/1.10)
 *
 * The form posts to the submitReview server action. The server action validates
 * the transition legality via decideReview → resolveTransition, so even if the
 * status changed between render and submit, an illegal transition is rejected
 * server-side (no silent state drift).
 */
function ReviewForm({
  eventId,
  currentStatus,
}: {
  eventId: string;
  currentStatus: string;
}) {
  const canApprove = currentStatus === "candidate";
  const canReject = currentStatus === "candidate";
  const canTakedown = currentStatus === "published";

  if (!canApprove && !canReject && !canTakedown) {
    return (
      <section className="mt-10">
        <p className="text-ink-secondary">
          该事件状态为 {currentStatus}，无可执行的复核操作（再发布属后续迭代）。
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 space-y-4">
      <h2 className="text-xl font-semibold">执行复核决策</h2>
      <form action={submitReview} className="space-y-4">
        <input type="hidden" name="eventId" value={eventId} />
        <div>
          <label htmlFor="note" className="block text-sm font-medium text-ink-secondary">
            备注（可选）
          </label>
          <textarea
            id="note"
            name="note"
            rows={2}
            className="mt-1 block w-full rounded-md border border-line-subtle bg-surface px-3 py-2 text-sm"
            placeholder="补充说明…"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          {canApprove ? (
            <button
              type="submit"
              name="outcome"
              value="approve"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong"
            >
              通过并发布
            </button>
          ) : null}
          {canReject ? (
            <button
              type="submit"
              name="outcome"
              value="reject"
              className="rounded-md border border-line-subtle bg-surface px-4 py-2 text-sm font-medium hover:border-ink-secondary"
            >
              驳回
            </button>
          ) : null}
          {canTakedown ? (
            <button
              type="submit"
              name="outcome"
              value="takedown"
              className="rounded-md border border-market-down bg-surface px-4 py-2 text-sm font-medium text-market-down hover:bg-market-down-soft"
            >
              下线
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function formatDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
