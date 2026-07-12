import Link from "next/link";

import type { PublishedHotEventSummary } from "@aguhot/core";

/**
 * Numbered「当前热点」ranking — Story 6.2 (Epic 6 视觉对齐参考站).
 *
 * Replaces the V1 `MainLineBand` "今日重点 / 市场主线" card-band (Story 4.2)
 * with a compact numbered ranking (1. 2. 3 …) matching the reference site
 * (aihot.virxact.com) top-of-feed「当前热点」list (UX-DR16, 2026-07-12). The
 * band was a `rounded-lg border bg-surface-muted` card; this is a borderless
 * ordered list with hairline row separators — the editorial-column form.
 *
 * Data source (unchanged from 4.2): reuses `listPublishedHotEvents` saliency
 * read (ordered `evidenceCount DESC + latestEvidenceAt DESC`). NO new read
 * model / field (sprint-change-proposal 提案 14 — architecture untouched).
 * `published_timeline` has no saliency/pin field; the hot-events read is the
 * honest, zero-new-read-path saliency source.
 *
 * Each item: index number (1-based, font-mono ink-tertiary) → title (Link to
 * detail, ink-primary semibold) → 来源数 (ink-tertiary) → relative time
 * (「N 分钟前」/「N 小时前」/「N 天前」, ink-tertiary right-aligned). The number
 * conveys rank; no per-item ranking-reason chip (the 4.2 band carried
 * 「近期升温」/「多源覆盖」tags; the reference-site numbered list doesn't, and the
 * spec 6.2 AC drops them — FR-3's "同事件精选" half still lives on the timeline
 * card's fold tag).
 *
 * Honest state (NFR-2): empty hot-events → the list does NOT render (no
 * fabricated「当前热点」copy, no fabricated「精选分」score — the reference site's
 * 「精选 82」editorial score is NOT replicated; aguhot doesn't compute one, so
 * 来源数 is the honest signal).
 *
 * Server component: no client JS, no useState. Public path read-only
 * (AD-3/AD-3b/AD-6). Tokens: reuses only real @theme tokens
 * (border-border-hairline / ink-* / font-mono / font-display / brand). No
 * shadcn/ui. No token VALUE changes.
 *
 * Index rendering: explicit `{i + 1}` (NOT CSS counter). Tailwind's Preflight
 * resets `<ol>` list-style to none, so `::marker` is hidden — an explicit
 * number span is the reliable cross-browser choice (simpler than counter-reset/
 * increment + ::before, same visual). Ponytail: simplest that works.
 */

/**
 * V1 top-N: 5. The list surfaces the five most salient published events so the
 * reader gets a fast "what is the market trading" answer. Tuning is a future
 * iteration. (4.2's band used 3; the reference-site list shows ~5 and the
 * numbered form reads well at 5.)
 */
const NUMBERED_HOT_LIST_TOP_N = 5;

/**
 * Locale-stable relative-time formatter. Pure number math (no toLocaleString)
 * so the label is identical across build-time TZ and runtime TZ — same
 * rationale as timeline-card formatHHmm / event-card formatDateTime.
 *
 *   < 60s   → 「刚刚」
 *   < 60min → 「N 分钟前」
 *   < 24h   → 「N 小时前」
 *   else    → 「N 天前」
 *
 * Negative diff (future latestEvidenceAt, shouldn't happen) collapses to
 * 「刚刚」via the < 60s branch.
 */
function formatRelative(d: Date, now: Date): string {
  const diffMs = now.getTime() - d.getTime();
  // Future timestamp (diffMs < 0): a data anomaly — ingestion does not reject
  // future publishedAt, so clock skew / malformed feeds can land a
  // latestEvidenceAt ahead of the server clock. Display falls back to「刚刚」
  // (least-bad for slight skew) rather than a negative/wrong unit; the real
  // fix is at ingestion (reject future timestamps), out of scope for 6.2.
  // Explicit branch so the anomaly is visible in code, not silently caught by
  // the < 60s path. (Codex review P2.)
  if (diffMs < 0) return "刚刚";
  if (diffMs < 60_000) return "刚刚";
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} 天前`;
}

export interface NumberedHotListProps {
  /**
   * The published hot-events saliency list (already ordered by
   * `evidenceCount DESC + latestEvidenceAt DESC` — the contract of
   * listPublishedHotEvents). The list slices the top-N itself so the page can
   * pass the full list. Empty array → the list does not render (NFR-2).
   */
  events: PublishedHotEventSummary[];
  /**
   * Injected clock so relative-time logic shares one clock with the page + the
   * timeline feed (mirrors MainLineBand / event-card `now` pattern).
   */
  now: Date;
}

export function NumberedHotList({ events, now }: NumberedHotListProps) {
  // NFR-2 honest state: empty hot-events → do NOT render (no fabricated copy).
  if (events.length === 0) {
    return null;
  }

  const top = events.slice(0, NUMBERED_HOT_LIST_TOP_N);

  return (
    <section aria-labelledby="numbered-hot-list-heading" className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2
          id="numbered-hot-list-heading"
          className="font-display text-2xl font-semibold text-ink-primary"
        >
          当前热点
        </h2>
        <span className="font-mono text-xs text-ink-tertiary">多信源热度排序</span>
      </div>
      {/*
        `role="list"` restores list semantics after Tailwind Preflight's
        `ol { list-style: none }` reset — Safari/VoiceOver stops exposing a
        marker-less <ol> as a list without it. The explicit {i+1} numbers carry
        the rank visually; role="list" carries it to assistive tech. (Codex P2.)
      */}
      <ol role="list" className="mt-3">
        {top.map((e, i) => (
          <li
            key={e.hotEventId}
            className="flex items-baseline gap-3 border-b border-border-hairline py-2.5 last:border-b-0"
          >
            <span className="min-w-[18px] shrink-0 font-mono text-xs text-ink-tertiary">
              {i + 1}
            </span>
            <Link
              href={`/events/${e.hotEventId}`}
              className="min-w-0 flex-1 text-base font-semibold text-ink-primary hover:text-brand"
            >
              {e.title}
            </Link>
            <span className="shrink-0 text-xs text-ink-tertiary">{e.evidenceCount} 信源</span>
            <span className="min-w-[64px] shrink-0 text-right text-xs text-ink-tertiary">
              {formatRelative(e.latestEvidenceAt, now)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
