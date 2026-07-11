/**
 * StubLlmAdapter — a deterministic test-only LLMAdapter (AD-7).
 *
 * TEST-ONLY: this adapter is NOT wired in the worker/prod runtime. It returns a
 * fixed ≤40 字 reason for every event. Putting a fixture AI 解读 on a public
 * timeline card without a real LLM provider would mislead readers — a violation
 * of the NFR "absence shown as absence, never fabricated completeness" (see spec
 * Design Notes).
 *
 * V1 has a recommendation-reason worker (Epic 5 job category) but the worker
 * resolves adapter = undefined (procurement deferred) → generateRecommendationReason
 * returns null → prod degrades honestly (AC). This stub exists solely so
 * verify/e2e can call generateRecommendationReason directly and exercise the
 * happy path (proving the pipeline is correct end-to-end: append → projection →
 * card). apps/worker does NOT import it.
 *
 * The fixture is deterministic: every call returns the SAME reason string
 * (one fixed string, no per-event variation) so verify/e2e assertions on the
 * projected recommendation_reason are deterministic across runs. The reason is
 * ≤40 字 and passes the 6-class wording guardrail
 * (passesRecommendationGuardrail) — verify's self-check asserts both.
 */

import type { LLMAdapter, LlmReasonResult } from "./types.js";

/**
 * The fixed AI 解读 the stub reports for every event. Exported so verify/e2e
 * can assert the projected published_timeline_entries.recommendation_reason
 * carries exactly this string (deterministic across runs). ≤40 字 and free of
 * the six forbidden phrase classes (action / return-prediction / manipulation-
 * frame / recommendation-strength / timing-advice / over-certainty).
 *
 * The string is intentionally restrained and factual: it states the evidence is
 * archived and the event is still unfolding — no buy/sell/price/target/timeframe
 * wording, no over-certainty. This is the tone baseline a real provider must
 * match (PRD §10 + epic-5-context 语气基调: 克制、可证、不煽动).
 */
export const STUB_RECOMMENDATION_REASON = "证据链已归档，事件仍在演化。";

/**
 * The fixed provenance the stub reports. modelId + promptVersion are recorded
 * on every appended recommendation_reasons row (NFR-7). The "stub:" prefix on
 * modelId makes a stub-generated row trivially distinguishable from a future
 * real-provider row in the audit chain (a real provider would carry e.g.
 * "openai:gpt-4o"). promptVersion "reason-stub-v1" names this stub's prompt
 * template version.
 */
const STUB_MODEL_ID = "stub:v1";
const STUB_PROMPT_VERSION = "reason-stub-v1";

/**
 * Deterministic stub LLM adapter. Returns a fixed non-null LlmReasonResult on
 * every call — the STUB_RECOMMENDATION_REASON string + the fixed
 * modelId/promptVersion provenance. See the module doc for why this is
 * test-only.
 *
 * Always returns a result (never null): the stub's contract is "given any event,
 * produce the fixture reason". The event's evidence existence is checked
 * upstream by generateRecommendationReason (which returns null for an
 * evidence-less event before calling the adapter), so by the time the stub is
 * reached the event is known to have evidence.
 */
export class StubLlmAdapter implements LLMAdapter {
  async generateReason(args: {
    hotEventId: string;
    title: string;
    summary: string;
  }): Promise<LlmReasonResult | null> {
    // Reference args to make the contract explicit (the stub ignores the event
    // context — a real adapter would use it). Avoids an unused-vars lint while
    // documenting that the fixture is context-independent.
    void args.hotEventId;
    void args.title;
    void args.summary;
    return {
      reason: STUB_RECOMMENDATION_REASON,
      modelId: STUB_MODEL_ID,
      promptVersion: STUB_PROMPT_VERSION,
    };
  }
}
