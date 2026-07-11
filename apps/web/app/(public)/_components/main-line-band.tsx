import Link from "next/link";

import type { PublishedHotEventSummary } from "@aguhot/core";

import { cn } from "@/lib/utils";

/**
 * Stable id so the section's accessible name comes from its visible heading
 * (aria-labelledby) instead of a redundant aria-label that would duplicate the
 * heading text and cause screen readers to announce it twice.
 */
const MAIN_LINE_BAND_HEADING_ID = "main-line-band-heading";

/**
 * Main-line top band — Story 4.2 (Epic 4 时间流首页).
 *
 * Persistent, lightweight "今日重点 / 市场主线" band that sits above the
 * timeline feed. It proactively answers "what is the market trading" so the
 * home does not degenerate into a pure scan surface (PRD §1 Vision; DESIGN
 * `main-line-band`). Reuses the existing `listPublishedHotEvents` saliency
 * ordering (`evidenceCount DESC + latestEvidenceAt DESC`) and takes the top-N
 * (V1 = 3) — the band's data source decision per spec Design Notes:
 * `published_timeline` has no saliency/pin field (it is a pure time-order
 * projection), so the band reads `listPublishedHotEvents` instead. This is the
 * honest, zero-new-read-path choice: two read models coexist — the band answers
 * "市场在交易什么", the timeline answers "分钟级动态".
 *
 * Honest ranking reason (FR-3 revised): each band item carries the same
 * ranking-reason logic as `event-card` ("近期升温" / "多源覆盖"). Reason labels
 * only appear when a real signal exists (recency / multi-source); when neither
 * signal is present, NO tag is rendered (NFR: never fabricate a reason). The
 * pure-timeline entries (single-source, not pinned) carry NO reason tag — only
 * band items do, because band items are the ones deviating from pure time order
 * (FR-3 revised: reason labels only appear when an entry deviates from pure
 * time order).
 *
 * Each band item is a `<Link>` to the detail page (1.8 whole-card-click
 * pattern). When hot-events is empty, the band does NOT render at all (no
 * fabricated copy — NFR-2 honest state). The band is independent from the
 * timeline empty state: either can be empty without affecting the other.
 *
 * Server component: no client JS, no useState. Public path stays read-only
 * (AD-3/AD-3b/AD-6). Tokens: reuses only real @theme tokens
 * (bg-surface-muted / border-border-hairline / rounded-lg / ink-* / bg-brand /
 * font-mono). No shadcn/ui.
 */

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const MULTI_SOURCE_THRESHOLD = 3;

/**
 * V1 top-N: 3. The band surfaces the three most salient published events so the
 * reader gets a fast "what is the market trading" answer without scanning the
 * full timeline. Tuning this number is a future-iteration concern.
 */
const MAIN_LINE_BAND_TOP_N = 3;

/**
 * Decide whether a ranking-reason tag should render on a band item, and which
 * reason. Returns null when no honest signal exists (never fabricates a reason).
 *
 * Mirrors event-card.tsx's `rankingReason` exactly so the band and the (now
 * band-only) saliency reasoning stay consistent. Kept as a local helper rather
 * than a shared util — the two components are deliberately independent (the
 * event-card is no longer on the home feed after 4.2; the band is its sole
 * saliency surface now) and duplicating three lines is cheaper than coupling
 * them.
 *
 *   - "近期升温" (recent heating): latestEvidenceAt within 72h.
 *   - "多源覆盖" (multi-source coverage): evidenceCount >= 3.
 *   If both apply, recency wins (more time-sensitive, surfaces first).
 */
function rankingReason(
  evidenceCount: number,
  latestEvidenceAt: Date,
  now: Date,
): { label: string; tone: "recent" | "multi-source" } | null {
  const isRecent = now.getTime() - latestEvidenceAt.getTime() <= SEVENTY_TWO_HOURS_MS;
  if (isRecent) {
    return { label: "近期升温", tone: "recent" };
  }
  if (evidenceCount >= MULTI_SOURCE_THRESHOLD) {
    return { label: "多源覆盖", tone: "multi-source" };
  }
  return null;
}

export interface MainLineBandProps {
  /**
   * The published hot-events saliency list (already ordered by
   * `evidenceCount DESC + latestEvidenceAt DESC` — the contract of
   * listPublishedHotEvents). The band slices the top-N itself so the page can
   * pass the full list without a second slice call. Empty array → the band
   * does not render (NFR-2 honest empty state, no fabricated copy).
   */
  events: PublishedHotEventSummary[];
  /**
   * Injected clock so band reason logic shares one clock with the page and the
   * rest of the feed (mirrors event-card's `now` pattern).
   */
  now: Date;
}

export function MainLineBand({ events, now }: MainLineBandProps) {
  // NFR-2 honest state: an empty hot-events read model → the band does NOT
  // render (no fabricated "今日重点" copy). The page renders the band only when
  // there is data; this guard is defensive in case the component is reused.
  if (events.length === 0) {
    return null;
  }

  const top = events.slice(0, MAIN_LINE_BAND_TOP_N);

  return (
    <section
      aria-labelledby={MAIN_LINE_BAND_HEADING_ID}
      className="rounded-lg border border-border-hairline bg-surface-muted px-5 py-4"
    >
      <h2
        id={MAIN_LINE_BAND_HEADING_ID}
        className="text-sm font-semibold tracking-wide text-ink-secondary"
      >
        今日重点 / 市场主线
      </h2>
      <ul role="list" className="mt-3 space-y-2">
        {top.map((e) => {
          const reason = rankingReason(e.evidenceCount, e.latestEvidenceAt, now);
          return (
            <li key={e.hotEventId}>
              {/*
                Each band item is a Link to the detail page (1.8 whole-card-click
                pattern). The item shows the title + an honest ranking-reason tag
                (only when a real signal exists) + the evidence count as quiet
                meta. Tokens mirror event-card so the band reads as a sibling
                saliency surface.
              */}
              <Link
                href={`/events/${e.hotEventId}`}
                className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-raised"
              >
                <span className="flex items-baseline gap-2 min-w-0">
                  <span className="truncate text-sm font-medium text-ink-primary">
                    {e.title}
                  </span>
                  {reason !== null ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs",
                        reason.tone === "recent"
                          ? "bg-brand text-brand-foreground"
                          : "bg-surface-raised text-ink-secondary",
                      )}
                    >
                      {reason.label}
                    </span>
                  ) : null}
                </span>
                {/*
                  Evidence count as quiet meta. font-mono + ink-tertiary matches
                  the DESIGN numeric layer so the count reads as supporting meta,
                  not a headline.
                */}
                <span className="shrink-0 font-mono text-xs text-ink-tertiary">
                  {e.evidenceCount} 源
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
