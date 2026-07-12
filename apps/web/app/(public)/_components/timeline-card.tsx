import Link from "next/link";

import {
  TIMELINE_FOLD_THRESHOLD,
  type PublishedTimelineEntry,
  type TimelineSessionTagType,
} from "@aguhot/core";

import { AiLabel } from "@/components/chips";
import { cn } from "@/lib/utils";

/**
 * Timeline feed entry — Story 6.3 (Epic 6 视觉对齐参考站).
 *
 * Reworked from the 4.2 bordered card (`rounded-lg border bg-surface-raised`)
 * to a borderless editorial-column entry (UX-DR4b / UX-DR16, 2026-07-12). The
 * reference site (aihot.virxact.com) renders its feed as a borderless vertical
 * column with a per-entry time rail + vertical rule + body; this card matches
 * that form using aguhot's existing tokens (no token change — ui-ux-pro-max
 * 2026-07-12 reconciliation confirmed the palette is correct).
 *
 * Three-column structure:
 *   ┌──────────────────────────────────────────────┐
 *   │ HH:mm   │ <navy 1px vertical rule> │ body    │
 *   │ 时段     │                          │ 来源    │
 *   │         │                          │ 标题    │
 *   │         │                          │ 摘要    │
 *   │         │                          │ 证据源  │
 *   │         │                          │ (AI槽)  │
 *   └──────────────────────────────────────────────┘
 *
 *   - Left rail: `HH:mm` (font-mono, ink-primary, semibold — LEADS the entry,
 *     no longer de-emphasized) + session tag (盘前/盘中/盘后/非交易, ink-tertiary).
 *   - Navy 1px vertical rule: `border-l border-brand` on the body. Echoes the
 *     DESIGN `evidence-row` `borderLeft: 3px solid brand-primary` "traceable
 *     evidence" semantic — every timeline entry is sourced, the rule signals
 *     that. 1px (not 3px) so a column of entries stays light.
 *   - Body: source name (ink-secondary, promoted to a first-class scan
 *     element) → title (ink-primary semibold, factual anchor) → multi-line
 *     summary (body-sm ink-secondary, density allowed) → evidence count →
 *     AI 解读 slot (4.2 inline form; Story 6.4 upgrades to a solid-hairline
 *     signature `EditorialReasonBlock`).
 *
 * Whole-entry link (1.8 pattern): the rail + body is one `<Link>` to the
 * detail page. The `<details>` fold disclosure is a SIBLING of the Link (NOT
 * inside it) — a `<summary>` inside an `<a>` toggles disclosure AND navigates
 * (card click wins, disclosure unreachable by mouse). Kept outside the anchor
 * hit area so the summary toggles cleanly (4.2 review fix, preserved).
 *
 * Hover: `hover:bg-surface-base` on the `<li>`, 150ms `transition-colors`. The
 * global `@media (prefers-reduced-motion: reduce)` rule in globals.css
 * collapses the transition to ~0ms (no per-component handling needed).
 *
 * Honest states (NFR-2, preserved from 4.2):
 *   - Empty summary (`""`) → the summary slot renders nothing (the
 *     `published_timeline` projection stores `""` when no ExplanationVersion
 *     exists; honest degraded state, not fabricated).
 *   - `recommendationReason` null/empty (5.1 pre-default) → AI slot + AiLabel
 *     NOT rendered (no empty marketing placeholder).
 *   - The card renders only when the read model has a row; page-level empty
 *     state is the page's responsibility (not the card's).
 *
 * Tokens: reuses only real @theme tokens (border-border-hairline / border-brand
 * / surface-base / ink-* / font-mono / bg-accent-warm via AiLabel). No shadcn/ui
 * (project doesn't install it). No undefined tokens. No token VALUE changes.
 */

const SESSION_TAG_LABEL: Record<TimelineSessionTagType, string> = {
  pre_open: "盘前",
  intraday: "盘中",
  post_close: "盘后",
  non_trading: "非交易",
};

export interface TimelineCardProps {
  entry: PublishedTimelineEntry;
}

export function TimelineCard({ entry }: TimelineCardProps) {
  const { hotEventId, occurredAt, sessionTag, sourceName, title, summary } = entry;

  // Fold decision: pure >= check against the event-assembly-owned threshold.
  const isFolded = entry.foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD;

  // AI 解读 slot: render ONLY when recommendationReason is non-null (5.1+).
  // Pre-5.1 default is null → no slot, no AiLabel, no empty marketing placeholder.
  const recommendationReason = entry.recommendationReason;
  const hasRecommendation = recommendationReason !== null && recommendationReason !== "";

  return (
    // hover on the <li> so the whole entry — including the fold disclosure
    // footer below — shares one hover affordance. border-t (not border around)
    // gives the borderless column its only separator.
    <li className="border-t border-border-hairline transition-colors first:border-t-0 hover:bg-surface-base">
      {/*
        Whole-entry link (1.8 pattern): rail + body is one click target to the
        detail page. The fold `<details>` is a SIBLING below (outside the
        anchor) so its summary toggles without navigating.
      */}
      <Link href={`/events/${hotEventId}`} className="flex items-stretch">
        {/*
          Left rail: HH:mm (LEADS, ink-primary semibold — no longer
          de-emphasized) + session tag (ink-tertiary, below). Fixed width so
          the vertical rule aligns across all entries in the column.
        */}
        <div className="flex w-[68px] shrink-0 flex-col items-start gap-1 pt-3 pr-4">
          <span className="font-mono text-[15px] font-semibold leading-none text-ink-primary">
            {formatHHmm(occurredAt)}
          </span>
          <span className="font-mono text-[10px] text-ink-tertiary">
            {SESSION_TAG_LABEL[sessionTag]}
          </span>
        </div>

        {/*
          Body: navy 1px vertical rule (border-l border-brand — "traceable
          evidence" semantic, echoes evidence-row) + content. Reading order:
          source → title → summary → evidence count → (AI slot).
        */}
        <div className="flex-1 border-l border-brand py-3 pl-[18px]">
          <div className="text-[13px] text-ink-secondary">{sourceName}</div>
          <h3 className="mt-1 text-[17px] font-semibold leading-snug text-ink-primary">{title}</h3>
          {summary !== "" ? (
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{summary}</p>
          ) : null}

          {/*
            AI 解读 slot (PRD §10 / NFR-3). 4.2 inline form retained here;
            Story 6.4 upgrades this to a solid-hairline signature
            `EditorialReasonBlock` (visual weight ≤ factual title preserved).
            Rendered ONLY when recommendationReason is non-null AND non-empty
            (spec Never: no empty marketing placeholder).
          */}
          {hasRecommendation ? (
            <div className="mt-2 flex items-start gap-2">
              <AiLabel className="mt-0.5 shrink-0" />
              <p className="text-sm text-ink-secondary">{recommendationReason}</p>
            </div>
          ) : null}

          {/*
            Evidence count: the last item in the reading order inside the
            clickable body. font-mono + ink-tertiary matches the numeric meta
            layer. Story 6.4 replaces this dl with a `SourceChipList`
            (来源数 chip + 关联讨论来源 chips).
          */}
          <dl className="mt-2 font-mono text-xs text-ink-tertiary">
            <div>
              <dt className="inline">证据源 </dt>
              <dd className="inline">{entry.evidenceCount}</dd>
            </div>
          </dl>
        </div>
      </Link>

      {/*
        Fold disclosure (FR-3 revised,「同事件精选」) — a SIBLING of the Link,
        rendered as an entry footer. Only rendered when the entry folds >=
        TIMELINE_FOLD_THRESHOLD sources. Native `<details>`: zero client JS
        (public pages are server components + force-dynamic). Because it is
        OUTSIDE the anchor, clicking the summary toggles disclosure without
        navigating (4.2 review fix — preserved).

        Left padding (w-[68px] rail + pl-[18px] body = 86px) aligns the
        disclosure under the body content, not under the rail.

        Per spec Never: the disclosure does NOT fabricate a per-source name/time
        list — `published_timeline` carries only evidenceCount +
        foldedEvidenceRecordIds (ids) + a representative sourceName; the full
        per-source timeline is the detail page's `证据时间线` job (1.8).
      */}
      {isFolded ? (
        <details className="pb-3 pl-[86px]">
          <summary
            className={cn(
              "inline-flex cursor-pointer items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-secondary",
              "list-none [&::-webkit-details-marker]:hidden",
            )}
          >
            同事件精选
          </summary>
          <p className="mt-2 text-xs text-ink-tertiary">
            精选自 {entry.evidenceCount} 条证据源（代表来源：{sourceName}）·
            完整证据时间线请见详情页
          </p>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Locale-stable HH:mm format. Avoids locale-dependent toLocaleString so the
 * timestamp stays consistent across build-time TZ and runtime TZ. The
 * `published_timeline.occurredAt` is a UTC instant; `toISOString().slice(11,16)`
 * yields the UTC HH:mm. V1 displays UTC time (the 4.2 formatDateTime showed
 * full `YYYY-MM-DD HH:mm UTC`; 6.3 drops to HH:mm per UX-DR4b — the date
 * context now lives in the DateSectionDivider, the per-entry time is HH:mm).
 */
function formatHHmm(d: Date): string {
  return d.toISOString().slice(11, 16);
}
