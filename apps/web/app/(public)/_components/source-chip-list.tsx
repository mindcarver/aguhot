/**
 * Source chip list — Story 6.4 (Epic 6 视觉对齐参考站).
 *
 * Replaces the 4.2/6.3 evidence-count `<dl>` (`证据源 N`) with a chip row
 * matching the reference site's `关联讨论 N 条` + source-chip row (UX-DR4b /
 * UX-DR16, spec 6.4 AC). Two chips:
 *   - `关联讨论 {count} 条` — the evidence-record count (surface-base +
 *     hairline border + ink-primary + font-mono numeric).
 *   - `{sourceName}` — the representative source tag (hairline border +
 *     ink-tertiary).
 *
 * Honest data boundary (NFR-2, Codex P2): `published_timeline.evidenceCount`
 * counts evidence RECORDS (`projectTimelineFields` uses `input.evidence.length`),
 * NOT distinct publishers — multiple records can share one `EvidenceSource` (the
 * timeline seed creates 2 semiconductor records under 1 source). So the count
 * chip says `关联讨论 {count} 条` (records discussing this), NOT "N sources" —
 * and there is NO `+N` chip implying more publishers (that would fabricate
 * distinct sources the read model doesn't carry). The representative
 * `sourceName` is the ONE source the projection exposes; a full per-source list
 * is the detail page's `证据时间线` job (1.8) — a per-source published read path
 * is a logged deferral.
 *
 * The representative `sourceName` also appears as the card's byline (6.3,
 * promoted above the title); the chip here is the scannable tag form, matching
 * the reference site which shows both a source byline and source chips.
 *
 * Server component: no client JS. Tokens: `surface-base` + `border-hairline`
 * + `ink-primary`/`ink-tertiary` + `font-mono`. No token VALUE changes.
 */
export interface SourceChipListProps {
  /** Number of evidence records backing the event (`published_timeline.evidenceCount`). */
  count: number;
  /** Representative source name (`published_timeline.sourceName`). */
  sourceName: string;
}

export function SourceChipList({ count, sourceName }: SourceChipListProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center rounded-full border border-border-hairline bg-surface-base px-2 py-0.5 font-mono text-xs text-ink-primary">
        关联讨论 {count} 条
      </span>
      <span className="inline-flex items-center rounded-full border border-border-hairline px-2 py-0.5 text-xs text-ink-tertiary">
        {sourceName}
      </span>
    </div>
  );
}
