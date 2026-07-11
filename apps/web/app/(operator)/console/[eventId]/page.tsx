import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getCandidateDetail,
  getPublishedEventForRevision,
  getPrisma,
  listPublishedHotEvents,
  CandidateNotFoundError,
  newTraceId,
} from "@aguhot/core";

import { AiLabel } from "@/components/chips";
import { submitReview, submitRevision, submitMerge, submitSplit } from "./actions";

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
  // effective-vs-pending) AND the list of other published events (for the merge
  // source dropdown). For non-published events these stay undefined/null and the
  // page renders the existing 1.6 ReviewForm unchanged.
  let revisionView = null;
  let otherPublished: { hotEventId: string; title: string }[] = [];
  // Story 1-9 fix: the published explanation's provenance (source). Read from
  // the published_hot_event_explanations read model so the operator <AiLabel>
  // gating matches the public detail page EXACTLY (source !== "human"), instead
  // of the fragile `pending.explanation === true` heuristic that mislabeled an
  // already-published human explanation as AI right after a republish.
  let publishedExplanationSource: string | null = null;
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
    // Fetch the authoritative published explanation source (same column the
    // public detail page reads via getPublishedHotEventDetail). Absent when the
    // explain worker has not projected yet → treat as not-AI (no label), same
    // honest degraded state as the public page.
    const publishedExplanation = await prisma.publishedHotEventExplanation.findUnique({
      where: { hotEventId: eventId },
      select: { explanationSource: true },
    });
    publishedExplanationSource = publishedExplanation?.explanationSource ?? null;
    // Load the other published events for the merge-source <select>. Exclude the
    // current event (merging an event into itself is rejected by submitMerge +
    // mergeHotEvents, so it is not offered). Reuses the public read query —
    // operator-side read of the published read model is legitimate (same data
    // the public feed sees, same as the /console published-events section).
    const allPublished = await listPublishedHotEvents({ prisma, traceId: newTraceId() });
    otherPublished = allPublished
      .filter((e) => e.hotEventId !== eventId)
      .map((e) => ({ hotEventId: e.hotEventId, title: e.title }));
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
          <RevisionBranch
            eventId={eventId}
            view={revisionView!}
            publishedExplanationSource={publishedExplanationSource}
          />
        ) : null}

        {/* Merge / split branch (Story 1.10). Rendered alongside the revision
            branch for published events. Merge absorbs another published event's
            evidence into this one (then retires the source via takedown); split
            carves a checked evidence subset into a new candidate (lands in the
            review queue, not auto-published). Both reuse the publish gate
            (decideReview) for the read-model refresh; mergeHotEvents/splitHotEvent
            only move evidence links + recompute signatures. */}
        {detail.publicationStatus === "published" ? (
          <MergeSplitBranch eventId={eventId} evidence={detail.evidence} otherPublished={otherPublished} />
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
 *
 * `publishedExplanationSource` is the authoritative provenance string read
 * from published_hot_event_explanations.explanation_source (same column the
 * public detail page reads). AC3 source gating (source !== "human") is applied
 * IDENTICALLY on public and operator — the operator sees exactly the provenance
 * label the public reader sees, with no heuristic.
 */
function RevisionBranch({
  eventId,
  view,
  publishedExplanationSource,
}: {
  eventId: string;
  view: import("@aguhot/core").PublishedEventRevisionView;
  /**
   * The provenance of the CURRENTLY PUBLISHED explanation, read from the public
   * read model. null when the published explanation projection has not run yet
   * (absent row) or the event is not currently published. "human" → operator-
   * authored → no AiLabel; "template"/"ai" → system-derived → AiLabel, exactly
   * like the public detail page.
   */
  publishedExplanationSource: string | null;
}) {
  const published = view.published;
  const hasPending = view.pending.title || view.pending.tags || view.pending.explanation;
  // AC3 source gating: identical to the public detail page
  // (detail.explanation !== null && detail.explanation.source !== "human").
  // We gate on the PUBLISHED explanation's source (the currently public one),
  // read straight from the published read model — NOT on the fragile
  // `pending.explanation === true` heuristic that mislabeled a human-sourced
  // explanation as AI right after a republish.
  const publishedIsAiSourced =
    published !== null &&
    published.explanation !== null &&
    publishedExplanationSource !== "human";

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
 * The decision form (1.6 — candidate/rejected/taken_down; 1.10 — republish for
 * taken_down/rejected). The available outcomes depend on the current status:
 *   candidate   → approve / reject
 *   published   → handled by RevisionBranch above (not this form)
 *   taken_down  → republish (1.10: re-publish after takedown)
 *   rejected    → republish (1.10: correct an erroneous reject)
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
  // Story 1.10: taken_down + rejected both get a republish button (re-publish
  // after takedown / correct an erroneous reject). candidate republish is illegal
  // (nothing has been published to refresh) and stays absent here.
  const canRepublish = currentStatus === "taken_down" || currentStatus === "rejected";

  if (!canApprove && !canReject && !canRepublish) {
    return (
      <section className="mt-10">
        <p className="text-ink-secondary">
          该事件状态为 {currentStatus}，无可执行的复核操作。
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
          {canRepublish ? (
            <button
              type="submit"
              name="outcome"
              value="republish"
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90"
            >
              重新发布
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/**
 * The merge / split branch for published events (Story 1.10). Two operator
 * actions, both reusing the publish gate for the read-model refresh:
 *
 *   - Merge: select another published event as the source; submitMerge moves
 *     its evidence into the current event (shared deduped), refreshes the
 *     current event's read model (republish), and retires the source (takedown).
 *   - Split: check a non-empty, non-full subset of evidence + provide a title;
 *     submitSplit creates a new candidate from the subset, moves the links, and
 *     refreshes the current event's read model (republish). The new candidate
 *     lands in the /console review queue (not auto-published).
 *
 * Tokens: REAL resolving tokens (bg-surface-raised/bg-surface-base/border-
 * border-hairline/ink-*), NOT the 1.6 drifted bg-surface/border-line-subtle/
 * bg-brand-strong.
 */
function MergeSplitBranch({
  eventId,
  evidence,
  otherPublished,
}: {
  eventId: string;
  evidence: { evidenceRecordId: string; sourceName: string; title: string | null; publishedAt: Date | null }[];
  otherPublished: { hotEventId: string; title: string }[];
}) {
  return (
    <section className="mt-10 space-y-6">
      <h2 className="text-xl font-semibold">合并 / 拆分</h2>

      {/* Merge form. Lists other published events as the source to absorb. The
          source's evidence moves into this event; the source is retired. */}
      <form action={submitMerge} className="space-y-4 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <input type="hidden" name="targetId" value={eventId} />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          合并（吸收另一已发布热点）
        </h3>
        <p className="text-xs text-ink-tertiary">
          选择一个已发布热点作为来源，其证据将合并到当前事件（共享证据自动去重），来源事件将被下线。
        </p>
        {otherPublished.length === 0 ? (
          <p className="text-sm text-ink-tertiary">（暂无其它已发布热点可合并。）</p>
        ) : (
          <div>
            <label htmlFor="sourceId" className="block text-sm font-medium text-ink-secondary">
              来源事件
            </label>
            <select
              id="sourceId"
              name="sourceId"
              defaultValue=""
              className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
            >
              <option value="" disabled>
                选择要合并的已发布热点…
              </option>
              {otherPublished.map((e) => (
                <option key={e.hotEventId} value={e.hotEventId}>
                  {e.title}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <button
            type="submit"
            disabled={otherPublished.length === 0}
            className="rounded-md border border-border-hairline bg-surface-raised px-4 py-2 text-sm font-medium text-ink-primary hover:border-ink-secondary disabled:opacity-50"
          >
            执行合并
          </button>
        </div>
      </form>

      {/* Split form. Check a subset of the current event's evidence + provide a
          title for the new candidate. The subset must be non-empty and not the
          full set (mergeHotEvents/splitHotEvent guards; submitSplit redirects
          back on rejection). The new candidate lands in the review queue. */}
      <form action={submitSplit} className="space-y-4 rounded-lg border border-border-hairline bg-surface-base px-5 py-4">
        <input type="hidden" name="sourceId" value={eventId} />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
          拆分（把勾选证据子集拆为新候选）
        </h3>
        <p className="text-xs text-ink-tertiary">
          勾选要拆出的证据子集（至少留 1 条给当前事件）并填写新标题。新事件以 candidate 进入复核队列，经复核后才公开。
        </p>
        {evidence.length <= 1 ? (
          <p className="text-sm text-ink-tertiary">（当前证据不足 2 条，无法拆分。）</p>
        ) : (
          <>
            <div>
              <label htmlFor="splitTitle" className="block text-sm font-medium text-ink-secondary">
                新候选标题
              </label>
              <input
                id="splitTitle"
                name="title"
                type="text"
                className="mt-1 block w-full rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm text-ink-primary"
                placeholder="拆分出的新候选标题"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="block text-sm font-medium text-ink-secondary">勾选要拆出的证据</legend>
              {evidence.map((e) => (
                <label
                  key={e.evidenceRecordId}
                  className="flex items-start gap-3 rounded-md border border-border-hairline bg-surface-raised px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="evidenceRecordId"
                    value={e.evidenceRecordId}
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="font-semibold">{e.sourceName}</span>
                    {e.title ? <span className="ml-2 text-ink-secondary">{e.title}</span> : null}
                    <span className="ml-2 font-mono text-xs text-ink-tertiary">
                      {e.publishedAt ? formatDate(e.publishedAt) : "时间未知"}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div>
              <button
                type="submit"
                className="rounded-md border border-border-hairline bg-surface-raised px-4 py-2 text-sm font-medium text-ink-primary hover:border-ink-secondary"
              >
                执行拆分
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}

function formatDate(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
