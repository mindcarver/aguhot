import Link from "next/link";

import {
  TIMELINE_FOLD_THRESHOLD,
  type PublishedTimelineEntry,
  type TimelineSessionTagType,
} from "@aguhot/core";

import { AiLabel } from "@/components/chips";
import { cn } from "@/lib/utils";

/**
 * Timeline feed card — Story 4.2 (Epic 4 时间流首页).
 *
 * Renders one `PublishedTimelineEntry` (the per-HotEvent folded projection from
 * the 4.1 `published_timeline` read model) as a minute-level timeline card on
 * the public home feed. This card is DISTINCT from `event-card` (the V1
 * priority-feed card): the timeline answers "分钟级动态", event-card answered
 * "priority-sorted saliency" (the latter now lives only in `main-line-band`).
 *
 * Fixed reading order (DESIGN `timeline-card`, UX-DR4b):
 *   timestamp + session tag → source → title → one-line summary →
 *   `AI 解读` slot (only when non-null) → evidence count.
 * Timestamp is visually de-emphasized via `ink-tertiary` + `font-mono` (DESIGN:
 * the numeric/meta layer). The whole card is a `<Link>` to the detail page
 * (`/events/{hotEventId}`) — the 1.8-deferred whole-card-click pattern, applied
 * to the timeline card.
 *
 * `AI 解读` slot (DESIGN `ai-label` + the entry's `recommendationReason`):
 *   - Per spec Never: 4.2 does NOT generate `AI 解读`. The
 *     `published_timeline.recommendation_reason` field is a NULL slot reserved
 *     for Story 5.1. When it is null (the 4.2 default), the slot AND the
 *     AiLabel are NOT rendered — never an empty marketing placeholder.
 *   - When non-null (5.1+), the AiLabel renders adjacent to the reason copy,
 *     visually separated from the factual summary (DESIGN: AI label expresses
 *     "information source nature", not "superior").
 *   - Visual weight ≤ factual title/summary (PRD §10): the reason renders in
 *     `body-sm` ink-secondary, never bolder than the title/summary above it.
 *
 * Folding (FR-3 revised, "同事件精选"):
 *   - When `foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD` (default
 *     2, owned by event-assembly per AD-2), the card shows the「同事件精选」tag
 *     and a native `<details>` that discloses "精选自 N 条证据源（代表来源：
 *     {sourceName}）· 完整证据时间线请见详情页". Per spec Never: the card does NOT
 *     fabricate a per-source name/time list — `published_timeline` carries only
 *     `evidenceCount` + `foldedEvidenceRecordIds` (ids only) + a representative
 *     `sourceName`; the full per-source timeline is the detail page's
 *     `证据时间线` job (1.8). The `<details>` is a static disclosure with zero
 *     client JS (UX-DR4b "展开列出每条证据源的时间" is partially met — count +
 *     representative source here, full list on the detail page).
 *   - Single-source entries (length < 2) render independently with NO fold tag
 *     and NO reason tag (FR-3 revised: reason labels only appear when an entry
 *     deviates from pure time order).
 *
 * Whole-card link + fold coexistence (Design Notes):
 *   The whole card body is wrapped in a `<Link>`. The `<details>`/`<summary>`
 *   (the「同事件精选」tag) is a SIBLING of the Link (a card footer), NOT inside
 *   it. A `<summary>` nested in an `<a>` toggles disclosure AND navigates on
 *   the same click — the card click wins, so the disclosure body was
 *   unreachable by mouse. Keeping the disclosure outside the anchor hit area
 *   means the summary toggles cleanly while the rest of the card navigates
 *   (the same sibling-not-descendant pattern event-card uses for FollowButton;
 *   here the reason is interaction correctness, not HTML validity).
 *
 * Honest states (NFR-2):
 *   - Empty summary (`""`) → the summary slot renders nothing (the
 *     `published_timeline` projection stores `""` when no ExplanationVersion
 *     exists; honest degraded state, not a fabricated summary).
 *   - The card is only rendered when the read model has a row; the empty-read-
 *     model empty state is the page's responsibility (not the card's).
 *
 * Tokens: reuses only real @theme tokens (bg-surface-raised /
 * border-border-hairline / rounded-lg / ink-* / bg-surface-muted / font-mono /
 * bg-accent-warm via AiLabel). No shadcn/ui (project doesn't install it). No
 * undefined tokens.
 */

/**
 * The Chinese label for each A-share session tag, folded into the timestamp
 * meta line (e.g.「盘前 · 09:25 UTC」). Per spec Design Notes: `sessionTag` is
 * NOT a filter UI (4.3 owns filters) — it is a low-cost visual meta folded into
 * the timestamp row, `font-mono` + `ink-tertiary`. Defined here (not in core)
 * because this is a pure display concern of the timeline card; core's
 * TimelineSessionTag is the value authority, this map is the label authority.
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
  // The read model stores the full folded id set; the THRESHOLD only controls
  // the「同事件精选」TAG display here (publish-orchestrator does not read it).
  const isFolded = entry.foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD;

  // AI 解读 slot: render ONLY when recommendationReason is non-null (5.1+).
  // Pre-5.1 default is null → no slot, no AiLabel, no empty marketing placeholder.
  const recommendationReason = entry.recommendationReason;
  const hasRecommendation = recommendationReason !== null && recommendationReason !== "";

  return (
    // hover lives on the <li> (not the Link) so the whole card — including the
    // fold disclosure footer below — shares one hover affordance.
    <li className="rounded-lg border border-border-hairline bg-surface-raised transition-colors hover:bg-surface-muted">
      {/*
        Whole-card link (1.8 pattern applied to the timeline card). The card
        body — meta → source → title → summary → (AI slot) → evidence count —
        is wrapped in a Link so that block is one click target to the detail
        page. The fold `<details>` is a SIBLING of the Link (below), NOT inside
        it: a `<summary>` inside an `<a>` toggles disclosure AND navigates on
        the same click (the card click wins, so the disclosure body was
        unreachable by mouse). Keeping the disclosure outside the anchor hit
        area means the summary toggles cleanly while the rest of the card still
        navigates — the same sibling-not-descendant pattern event-card uses for
        its FollowButton.
      */}
      <Link
        href={`/events/${hotEventId}`}
        className="block rounded-lg px-5 py-4"
      >
        {/*
          Meta line: session tag + timestamp, visually de-emphasized
          (ink-tertiary + font-mono). Session tag folds in as a prefix
          (「盘前 · 09:25 UTC」). Reading order puts this FIRST per DESIGN
          `timeline-card` (timestamp → source → title → summary → AI → count).
        */}
        <div className="font-mono text-xs text-ink-tertiary">
          {SESSION_TAG_LABEL[sessionTag]} · {formatDateTime(occurredAt)}
        </div>

        {/*
          Source line: representative source name. ink-secondary so it sits
          below the timestamp meta but above the title. Kept on its own line so
          the scan order (time → source → title) is unambiguous.
        */}
        <div className="mt-1 text-sm text-ink-secondary">{sourceName}</div>

        {/*
          Title: the factual anchor (effective HotEvent title). ink-primary +
          semibold so it carries the most visual weight on the card (DESIGN:
          factual title dominates; AI/explanation must not outweigh it).
        */}
        <h2 className="mt-1 text-lg font-semibold text-ink-primary">{title}</h2>

        {/*
          Summary: one-line explanation (latest ExplanationVersion.summary ?? "").
          Only rendered when non-empty — the read model stores "" when no
          ExplanationVersion exists (honest degraded state, not fabricated).
          ink-secondary body-sm so it stays subordinate to the title.
        */}
        {summary !== "" ? (
          <p className="mt-1 text-sm text-ink-secondary">{summary}</p>
        ) : null}

        {/*
          AI 解读 slot (PRD §10 / NFR-3). Rendered ONLY when
          recommendationReason is non-null AND non-empty. Pre-5.1 default is
          null → no slot, no AiLabel, no empty marketing placeholder (spec
          Never). Visual weight ≤ factual title/summary: body-sm +
          ink-secondary, never bolder than the title above. The AiLabel is
          adjacent (DESIGN: visually separated from the factual summary,
          expresses "information source nature", not "superior").
        */}
        {hasRecommendation ? (
          <div className="mt-2 flex items-start gap-2">
            <AiLabel className="mt-0.5 shrink-0" />
            <p className="text-sm text-ink-secondary">{recommendationReason}</p>
          </div>
        ) : null}

        {/*
          Evidence count: the last item in the reading order inside the
          clickable body. font-mono + ink-tertiary matches the timestamp meta
          layer (DESIGN: numeric layer). Kept visually quiet so it reads as
          supporting meta, not a headline.
        */}
        <dl className="mt-2 font-mono text-xs text-ink-tertiary">
          <div>
            <dt className="inline">证据源 </dt>
            <dd className="inline">{entry.evidenceCount}</dd>
          </div>
        </dl>
      </Link>

      {/*
        Fold disclosure (FR-3 revised,「同事件精选」) — a SIBLING of the Link,
        rendered as a card footer. Only rendered when the entry folds >=
        TIMELINE_FOLD_THRESHOLD sources. Native `<details>`: zero client JS
        (public pages are server components + force-dynamic, no useState /
        loading skeleton per spec Never). Because it is OUTSIDE the anchor,
        clicking the summary toggles disclosure without navigating (review fix:
        previously the summary lived inside the `<a>` and the card click won on
        every toggle, making the disclosure body unreachable by mouse).

        Per spec Never: the disclosure does NOT fabricate a per-source name/time
        list — `published_timeline` carries only evidenceCount +
        foldedEvidenceRecordIds (ids) + a representative sourceName; the full
        per-source timeline is the detail page's `证据时间线` job (1.8). The
        expanded body states the count + representative source + a guide to the
        detail page.
      */}
      {isFolded ? (
        <details className="px-5 pb-4">
          <summary
            className={cn(
              "inline-flex cursor-pointer items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-secondary",
              "list-none [&::-webkit-details-marker]:hidden",
            )}
          >
            同事件精选
          </summary>
          {/*
            Expanded disclosure: count + representative source + a guide to the
            detail page for the full per-source timeline. No fabricated
            per-source name/time list (spec Never).
          */}
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
 * Locale-stable UTC format (mirrors event-card.tsx's formatDateTime). Avoids
 * locale-dependent toLocaleString so the timestamp stays consistent across
 * build-time TZ and runtime TZ. YYYY-MM-DD HH:mm UTC is enough for the timeline
 * card meta line. Per spec Design Notes: each card can自带 formatDateTime
 * (consistent with event-card); kept as a local helper rather than a shared
 * util to avoid coupling the two card components' formatting independently.
 */
function formatDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
