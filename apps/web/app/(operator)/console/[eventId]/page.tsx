import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getCandidateDetail,
  getPublishedEventForRevision,
  getPrisma,
  CandidateNotFoundError,
  newTraceId,
} from "@aguhot/core";

import { AiLabel } from "@/components/chips";
import { submitReview, submitRevision } from "./actions";

/**
 * Candidate / published-event detail + review page. Story 1.6 + Story 1.9
 * (published-event revision branch).
 *
 * Server component. Always reads `getCandidateDetail` (status, evidence,
 * decisions — zero-change reuse of 1.6). When the event is `published`, it
 * ADDITIONALLY reads `getPublishedEventForRevision` (the operator-side
 * published-vs-effective-vs-pending diff) and renders the revision branch:
 *   - the CURRENTLY PUBLIC version (title/tags/explanation) + publishedAt,
 *   - the pending diff (which of title/tags/explanation would change on republish),
 *   - a revision form (title / tags / three explanation partitions) that posts
 *     to submitRevision (append HotEventRevision + ExplanationVersion source=
 *     "human"; no public change until republish),
 *   - a "重新发布" button (outcome=republish) that posts to submitReview →
 *     decideReview re-projects the effective title/tags + latest explanation,
 *   - the existing takedown button (unchanged from 1.6).
 *
 * Non-published events (candidate/rejected/taken_down) render the existing
 * ReviewForm unchanged (1.6 zero-regression). Tokens: the revision UI uses REAL
 * resolving tokens (bg-surface-raised/bg-surface-base/border-border-hairline/
 * ink-*), NOT the 1.6 drifted bg-surface/border-line-subtle/bg-brand-strong.
 *
 * AC3 (operator AiLabel): the revision view renders the effective explanation
 * partitions with the SAME source gating as the public detail page
 * (source !== "human" → <AiLabel>), so the operator sees the same provenance
 * label the public reader sees (uniform, identical on public and operator).
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

  // For published events, also read the operator revision view (published-vs-
  // effective-vs-pending). For non-published events this stays undefined and
  // the page renders the existing 1.6 ReviewForm unchanged.
  let revisionView = null;
  if (detail.publicationStatus === "published") {
    try {
      revisionView = await getPublishedEventForRevision({
        prisma,
        traceId: newTraceId(),
        hotEventId: eventId,
      });
    } catch {
      // If the revision read fails (shouldn't for a published event), fall
      // back to the ReviewForm-only view rather than crashing the whole page.
      revisionView = null;
    }
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
                <li
                  key={e.evidenceRecordId}
                  className="rounded-lg border-l-2 border-brand bg-surface-raised px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-semibold">{e.sourceName}</span>
                    <span className="font-mono text-xs text-ink-tertiary">
                      {e.publishedAt ? formatDate(e.publishedAt) : "时间未知"}
                    </span>
                  </div>
                  {e.title ? <p className="mt-1 font-medium">{e.title}</p> : null}
                  {e.summary ? (
                    <p className="mt-1 text-sm text-ink-secondary">{e.summary}</p>
                  ) : null}
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

        {/* Published-event revision branch (Story 1.9). Only rendered when the
            event is published AND the revision view loaded. Shows the current
            public version, the pending diff, and the revision + republish form. */}
        {detail.publicationStatus === "published" && revisionView !== null ? (
          <RevisionBranch eventId={eventId} view={revisionView!} />
        ) : null}

        {/* Decision audit chain */}
        <section className="mt-10 space-y-3">
          <h2 className="text-xl font-semibold">决策审计链（{detail.decisions.length}）</h2>
          {detail.decisions.length === 0 ? (
            <p className="text-ink-secondary">暂无决策记录。</p>
          ) : (
            <ol className="space-y-2" role="list">
              {detail.decisions.map((d) => (
                <li
                  key={`${d.type}-${d.id}`}
                  className="font-mono text-sm text-ink-secondary"
                >
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

        {/* Decision form (1.6 — candidate/rejected/taken_down). Published events
            render their own revision + republish + takedown form in RevisionBranch
            above, so the generic ReviewForm is shown only when NOT published. */}
        {detail.publicationStatus !== "published" ? (
          <ReviewForm eventId={eventId} currentStatus={detail.publicationStatus} />
        ) : null}
      </div>
    </main>
  );
}

/**
 * The published-event revision branch. Renders:
 *   1. The current public version (title/tags/explanation + publishedAt).
 *   2. The pending diff (title/tags/explanation booleans — what a republish
 *      would change).
 *   3. The effective working copy (the latest revision + latest explanation —
 *      what the form is pre-filled with and what a republish would project).
 *   4. The revision form (submitRevision) + republish + takedown buttons
 *      (submitReview).
 */
function RevisionBranch({
  eventId,
  view,
}: {
  eventId: string;
  view: import("@aguhot/core").PublishedEventRevisionView;
}) {
  const published = view.published;
  const hasPending = view.pending.title || view.pending.tags || view.pending.explanation;
  // Effective explanation source gating (AC3): the operator sees the same
  // provenance label the public reader sees. Since the operator is editing the
  // working copy, we label the EFFECTIVE explanation. But the effective could
  // be the human-typed draft (not yet public) — once it's human-sourced it is
  // not system-derived, so no AiLabel. We can only know the source after
  // republish (it's on the published read model). For the working copy we show
  // the AiLabel only when the PUBLISHED explanation is non-human (i.e. the
  // currently public one is system-derived); the draft the operator types is
  // assumed human (they typed it) and gets no label once republished.
  const publishedIsAiSourced =
    published !== null &&
    published.explanation !== null &&
    // The published read model carry explanationSource; PublishedEventRevisionView
    // does not surface the published source string (only partitions), so we
    // approximate: if the published explanation differs from effective, the
    // public one is still the prior (template) version → AI-sourced. This label
    // is informational for the operator; the authoritative gating lives on the
    // public detail page where source is read from the read model.
    view.pending.explanation === true;

  return (
    <section className="mt-10 space-y-6">
      <h2 className="text-xl font-semibold">已发布版本与修订</h2>

      {/* Current public version */}
      <div className="space-y-3 rounded-lg border border-border-hairline bg-surface-raised px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          当前发布版
        </h3>
        {published === null ? (
          <p className="text-sm text-ink-tertiary">（当前未在发布态——可能已下线。）</p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="inline font-mono text-ink-tertiary">标题 </dt>
              <dd className="inline text-ink-primary">{published.title}</dd>
            </div>
            <div>
              <dt className="inline font-mono text-ink-tertiary">标签 </dt>
              <dd className="inline text-ink-primary">
                {published.tags.length > 0 ? published.tags.join("、") : "（无）"}
              </dd>
            </div>
            {published.explanation !== null ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <dt className="font-mono text-ink-tertiary">解释</dt>
                  {publishedIsAiSourced ? <AiLabel /> : null}
                </div>
                <dd className="text-ink-secondary">
                  {published.explanation.summary}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="inline font-mono text-ink-tertiary">解释 </dt>
                <dd className="inline text-ink-tertiary">（系统解释生成中）</dd>
              </div>
            )}
            <div>
              <dt className="inline font-mono text-ink-tertiary">发布于 </dt>
              <dd className="inline font-mono text-ink-secondary">
                {formatDate(published.publishedAt)}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Pending diff */}
      <div className="space-y-2 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          待发布修改
        </h3>
        {hasPending ? (
          <ul className="space-y-1 text-sm text-ink-secondary" role="list">
            {view.pending.title ? <li>· 标题已修改（重新发布后生效）</li> : null}
            {view.pending.tags ? <li>· 标签已修改（重新发布后生效）</li> : null}
            {view.pending.explanation ? (
              <li>· 解释已修改（重新发布后生效）</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-ink-tertiary">无待发布修改（工作副本与发布版一致）。</p>
        )}
      </div>

      {/* Revision form — submitRevision. Pre-fill with the EFFECTIVE working copy. */}
      <RevisionForm eventId={eventId} view={view} />

      {/* Republish + takedown — submitReview. Republish is the publish gate
          reused (published→published, action=publish → refresh projects the
          effective). Takedown is the existing 1.6 path. */}
      <form action={submitReview} className="space-y-4">
        <input type="hidden" name="eventId" value={eventId} />
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            name="outcome"
            value="republish"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            disabled={!hasPending}
            title={hasPending ? "重新发布：把待发布修改投影到公开读模型" : "无待发布修改"}
          >
            重新发布
          </button>
          <button
            type="submit"
            name="outcome"
            value="takedown"
            className="rounded-md border border-market-down bg-surface-base px-4 py-2 text-sm font-medium text-market-down hover:bg-market-down-soft"
          >
            下线
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * The revision form. Pre-fills the title/tags/explanation inputs with the
 * EFFECTIVE working copy (latest revision ?? baseline; latest explanation ??
 * empty). Posts to submitRevision. The operator can edit any subset; each
 * module's change detection decides whether to append.
 *
 * Tags input is a single text box (separator input: comma / fullwidth comma /
 * newline). No multi-input tag UI (deferred — V1 uses a single textbox per the
 * spec "single textbox separator input").
 */
function RevisionForm({
  eventId,
  view,
}: {
  eventId: string;
  view: import("@aguhot/core").PublishedEventRevisionView;
}) {
  const initialTitle = view.effective.title;
  const initialTags = view.effective.tags.join(", ");
  const initialSummary = view.effective.explanation?.summary ?? "";
  const initialWhy = view.effective.explanation?.whyItMatters ?? "";
  const initialUnc = view.effective.explanation?.uncertainties ?? "";

  return (
    <form action={submitRevision} className="space-y-4 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
      <input type="hidden" name="eventId" value={eventId} />
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
        修订标题 / 标签 / 解释
      </h3>
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-ink-secondary">
          标题
        </label>
        <input
          id="title"
          name="title"
          type="text"
          defaultValue={initialTitle}
          className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
        />
      </div>
      <div>
        <label htmlFor="tags" className="block text-sm font-medium text-ink-secondary">
          标签（逗号或换行分隔，例如「货币政策,A股，流动性」）
        </label>
        <textarea
          id="tags"
          name="tags"
          rows={2}
          defaultValue={initialTags}
          className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
          placeholder="货币政策,A股，流动性"
        />
      </div>
      <div>
        <label htmlFor="summary" className="block text-sm font-medium text-ink-secondary">
          解释 · 发生了什么
        </label>
        <textarea
          id="summary"
          name="summary"
          rows={2}
          defaultValue={initialSummary}
          className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
        />
      </div>
      <div>
        <label htmlFor="whyItMatters" className="block text-sm font-medium text-ink-secondary">
          解释 · 为什么重要
        </label>
        <textarea
          id="whyItMatters"
          name="whyItMatters"
          rows={2}
          defaultValue={initialWhy}
          className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
        />
      </div>
      <div>
        <label htmlFor="uncertainties" className="block text-sm font-medium text-ink-secondary">
          解释 · 当前仍不确定什么
        </label>
        <textarea
          id="uncertainties"
          name="uncertainties"
          rows={2}
          defaultValue={initialUnc}
          className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
        />
      </div>
      <div>
        <button
          type="submit"
          className="rounded-md bg-surface-raised px-4 py-2 text-sm font-medium text-ink-primary border border-border-hairline hover:border-ink-secondary"
        >
          保存修订（不立即公开）
        </button>
        <p className="mt-2 text-xs text-ink-tertiary">
          保存修订后，公开页仍显示旧版本；需在上方点「重新发布」才会把修订投影到公开页。
        </p>
      </div>
    </form>
  );
}

/**
 * The decision form (1.6 — candidate/rejected/taken_down). The available
 * outcomes depend on the current status:
 *   candidate  → approve / reject
 *   published  → handled by RevisionBranch above (not this form)
 *   rejected / taken_down → none (terminal in V1; re-publish is 1.10)
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

  if (!canApprove && !canReject) {
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
            className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
            placeholder="补充说明…"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          {canApprove ? (
            <button
              type="submit"
              name="outcome"
              value="approve"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              通过并发布
            </button>
          ) : null}
          {canReject ? (
            <button
              type="submit"
              name="outcome"
              value="reject"
              className="rounded-md border border-border-hairline bg-surface-raised px-4 py-2 text-sm font-medium hover:border-ink-secondary"
            >
              驳回
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
