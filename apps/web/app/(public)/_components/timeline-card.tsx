import Link from "next/link";

import {
  TIMELINE_FOLD_THRESHOLD,
  type PublishedTimelineEntry,
  type TimelineSessionTagType,
} from "@aguhot/core";

import { cn } from "@/lib/utils";

import { EditorialReasonBlock } from "./editorial-reason-block";
import { SourceChipList } from "./source-chip-list";

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
 *     summary (body-sm ink-secondary, `line-clamp-3` preview — the card
 *     `summary` is the explain projection's `deriveSummary` (title ＋ latest
 *     EvidenceRecord.summary), and EvidenceRecord.summary is the RSS
 *     `<description>`, which for 财经/RSSHub feeds is often the full article
 *     body; the card shows a 3-line excerpt, full text on the detail page,
 *     matching the reference site's "excerpt, not full paste" form) →
 *     evidence count →
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

  // AI 解读 slot (Story 6.4): EditorialReasonBlock renders a solid-hairline
  // signature block and self-guards null/empty (pre-5.1 default null → no
  // block, no AiLabel, no empty marketing placeholder, NFR-2).
  const recommendationReason = entry.recommendationReason;

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
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-ink-secondary">
              {summary}
            </p>
          ) : null}

          {/*
            Source chips (Story 6.4, factual). `关联讨论 {count} 条` +
            representative `{sourceName}` chip. Replaces the 4.2/6.3 evidence
            <dl>. Rendered BEFORE EditorialReasonBlock so the hairline divider
            separates ALL factual content (source/title/summary/chips) ABOVE
            from the AI commentary BELOW (demo reading order, Codex P2).
          */}
          <SourceChipList count={entry.evidenceCount} sourceName={sourceName} />

          {/*
            AI 解读 signature block (Story 6.4, PRD §10 / NFR-3). Solid-hairline
            separator + slot-specific「AI 解读」label + reason. Self-guards
            null/empty (pre-5.1 → no block). Visual weight ≤ factual title
            (body-sm ink-secondary; the hairline separates without raising
            weight — UX-DR8). Rendered AFTER the factual chips so the divider
            sits between factual and editorial.
          */}
          <EditorialReasonBlock reason={recommendationReason} />
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
          {/*
            Expanded disclosure: honest text — count of evidence RECORDS + the
            one representative source + a guide to the detail page. No `+N`
            chip: `evidenceCount` counts records (`projectTimelineFields` uses
            `input.evidence.length`), NOT distinct publishers, so `+{count-1}`
            would falsely imply more sources (Codex P2 — the seed has 2
            semiconductor records under 1 EvidenceSource). 「条证据」honestly
            labels them as evidence records. No fabricated per-source name/time
            list — `published_timeline` carries only count + representative
            sourceName; the full per-source timeline is the detail page's
            `证据时间线` job (1.8).
          */}
          <p className="mt-2 text-xs text-ink-tertiary">
            精选自 {entry.evidenceCount} 条证据（代表来源：{sourceName}）· 完整证据时间线请见详情页
          </p>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Asia/Shanghai (Beijing) HH:mm, so the displayed time matches the paired
 * session tag (盘前 / 盘中 / 盘后) — which is itself derived from the Shanghai
 * framing of the same instant. Showing UTC HH:mm made a post-close (盘后)
 * entry read as e.g. "07:35" (UTC) instead of "15:35" (Beijing). Intl
 * DateTimeFormat is TZ-aware and DST-free for Asia/Shanghai, so this is
 * correct regardless of the host process timezone. Mirrors the
 * toShanghaiParts pattern in packages/core/.../session-tag.ts. Date context
 * lives in the DateSectionDivider; per-entry time is HH:mm (UX-DR4b).
 */
function formatHHmm(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map = new Map<string, string>();
  for (const part of fmt.formatToParts(d)) map.set(part.type, part.value);
  // hour12:false still emits "24" for midnight in some ICU builds; normalize.
  const hourRaw = Number.parseInt(map.get("hour") ?? "0", 10);
  const hour = (hourRaw === 24 ? 0 : hourRaw).toString().padStart(2, "0");
  const minute = (map.get("minute") ?? "0").padStart(2, "0");
  return `${hour}:${minute}`;
}
