/**
 * AI 解读 signature block — Story 6.4 (Epic 6 视觉对齐参考站).
 *
 * Replaces the 4.2/6.3 inline AI slot (`<div class="flex gap-2"><AiLabel/><p>`)
 * with a solid-hairline signature block matching the reference site's
 * 「推荐理由」editorial separator (UX-DR8 extended, 2026-07-12). The reference
 * site divides each card's factual summary from its editorial commentary with
 * a rule line; this block does the same — a `border-t` hairline separates the
 * AI 解读 from the factual title/summary/source chips above.
 *
 * Weight reconciliation (PRD §10 / UX-DR8): the hairline SEPARATES the block
 * (signature feel, visual distinction) without RAISING its typographic weight.
 * The reason stays `body-sm` (14px) `ink-secondary` — strictly ≤ the factual
 * title (`<h3>` 17px `ink-primary` semibold). A regression that bolds the
 * reason or lifts its color to ink-primary fails the weight guard.
 *
 * Slot-specific label (Codex P2): the block renders a visible「AI 解读」label
 * (NOT the generic `<AiLabel>` whose literal text is "AI" — that badge is
 * shared with the detail page 深读 / daily 研判; reusing it here would not
 * identify this card-level commentary as「解读」). The label uses the same
 * `accent-warm` token as AiLabel (DESIGN `ai-label`) but its own text +
 * drops `uppercase`/`tracking-wide` (those are Latin-optimized; CJK「解读」
 * would over-space). Naming stays「AI 解读」(NOT the reference「推荐理由」—
 * PM P5, avoids investment-advice connotation).
 *
 * Honest state (NFR-2): null/empty reason → returns null (no empty marketing
 * placeholder, no orphan hairline, no label). Pre-5.1 the
 * `recommendationReason` field is null on every entry → the block does not
 * render (the slot is reserved, not fabricated).
 *
 * Server component: no client JS. Tokens: `border-border-hairline` +
 * `accent-warm` / `accent-warm-foreground` (label) + `ink-secondary`. No token
 * VALUE changes.
 */
export interface EditorialReasonBlockProps {
  /**
   * The AI 解读 copy (Story 5.1 `recommendationReason`, upper-bound 40 chars,
   * blacklist-constrained). Null/empty → the block does not render.
   */
  reason: string | null;
}

export function EditorialReasonBlock({ reason }: EditorialReasonBlockProps) {
  // NFR-2: null/empty reason → no block, no orphan hairline, no label.
  if (reason === null || reason === "") {
    return null;
  }
  return (
    // Solid hairline (NOT dashed) separates the AI commentary from the factual
    // source chips / summary above. `pt-2` keeps the rule off the reason text;
    // `mt-3` gives the signature block breathing room from the chips.
    <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-2">
      {/*
        Slot-specific「AI 解读」label — accent-warm token (same as AiLabel) but
        explicit text + no uppercase/tracking (CJK-clean). NOT the generic
        AiLabel ("AI") — this label identifies the card-level commentary.
      */}
      <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-accent-warm px-2 py-0.5 text-xs font-semibold text-accent-warm-foreground">
        AI 解读
      </span>
      <p className="text-sm leading-relaxed text-ink-secondary">{reason}</p>
    </div>
  );
}
