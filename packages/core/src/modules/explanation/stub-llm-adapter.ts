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

import type { LLMAdapter, LlmDeepReadArgs, LlmDeepReadResult, LlmReasonResult, LlmTrendBriefingArgs, LlmTrendBriefingResult } from "./types.js";

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
 * The fixed three-segment AI 深读 the stub reports for every event. Exported so
 * verify/e2e can assert the projected published_hot_event_deep_reads carries exactly
 * these three strings (deterministic across runs). Each segment is ≤120 字
 * (DEEP_READ_SEGMENT_MAX_LENGTH) and free of the six forbidden phrase classes
 * (action / return-prediction / manipulation-frame / recommendation-strength /
 * timing-advice / over-certainty).
 *
 * The strings are intentionally restrained and factual: impact names the affected
 * chain without naming targets, beneficiaries stays as "may draw attention" (not
 * "will benefit"), risk names downstream uncertainty — no buy/sell/price/target/
 * timeframe wording, no over-certainty. This is the tone baseline a real provider
 * must match (PRD §10 + epic-5-context 语气基调: 克制、可证、不煽动).
 */
export const STUB_DEEP_READ = {
  impactSurface: "事件波及相关产业链上下游企业。",
  beneficiaries: "上游原材料供应商短期或受关注。",
  riskPoints: "下游需求不确定性仍存。",
} as const;

/**
 * The fixed single-paragraph AI 趋势研判 the stub reports for every coverageDate.
 * Exported so verify/e2e can assert the projected published_trend_briefings.briefing
 * carries exactly this string (deterministic across runs). ≤200 字
 * (TREND_BRIEFING_MAX_LENGTH) and free of the six forbidden phrase classes
 * (action / return-prediction / manipulation-frame / recommendation-strength /
 * timing-advice / over-certainty).
 *
 * The string is intentionally restrained and factual: it states the day's events cluster
 * around industry-chain stages, that the evidence is archived, and that details remain to
 * be confirmed — no buy/sell/price/target/timeframe wording, no over-certainty. This is
 * the tone baseline a real provider must match (PRD §10 + epic-5-context 语气基调:
 * 克制、可证、不煽动).
 *
 * NOTE: the substring "一定" (over-certainty class) is a known false-positive risk for
 * legitimate CJK compounds (e.g. "一定延续性") — see 5.2 deferred-work. The stub wording
 * is chosen to avoid all six forbidden substrings while staying natural; a real provider's
 * output is subject to the same guardrail and would need similar care (or the guardrail
 * refined when a real provider lands).
 */
export const STUB_TREND_BRIEFING =
  "当日热点围绕若干产业链环节展开，相关事件在证据归档基础上呈现延续性，部分细节仍待进一步确认。";

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
 * The fixed prompt version the stub reports for deep-read generation. Recorded on
 * every appended deep_reads row (NFR-7). "deepread-stub-v1" names this stub's
 * deep-read prompt template version (distinct from the reason-stub-v1 template —
 * a different generation shape gets a different prompt-version string).
 */
const STUB_DEEP_READ_PROMPT_VERSION = "deepread-stub-v1";

/**
 * The fixed prompt version the stub reports for trend-briefing generation. Recorded on
 * every appended trend_briefings row (NFR-7). "trendbriefing-stub-v1" names this stub's
 * trend-briefing prompt template version (distinct from the reason-stub-v1 +
 * deepread-stub-v1 templates — a different generation shape gets a different prompt-
 * version string).
 */
const STUB_TREND_BRIEFING_PROMPT_VERSION = "trendbriefing-stub-v1";

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

  /**
   * Deterministic stub deep-read generation. Returns a fixed non-null
   * LlmDeepReadResult on every call — the three STUB_DEEP_READ segments + the
   * fixed modelId/promptVersion provenance. See the module doc for why this is
   * test-only. Always returns a result (never null): the stub's contract is "given
   * any event with evidence, produce the fixture deep read". The event's evidence
   * existence is checked upstream by generateDeepRead (which returns null for an
   * evidence-less event before calling the adapter), so by the time the stub is
   * reached the event is known to have evidence.
   */
  async generateDeepRead(
    args: LlmDeepReadArgs,
  ): Promise<LlmDeepReadResult | null> {
    // Reference args to make the contract explicit (the stub ignores the event
    // context — a real adapter would use title/summary/evidence to ground the three
    // segments). Avoids an unused-vars lint while documenting that the fixture is
    // context-independent.
    void args.hotEventId;
    void args.title;
    void args.summary;
    void args.evidence;
    return {
      impactSurface: STUB_DEEP_READ.impactSurface,
      beneficiaries: STUB_DEEP_READ.beneficiaries,
      riskPoints: STUB_DEEP_READ.riskPoints,
      modelId: STUB_MODEL_ID,
      promptVersion: STUB_DEEP_READ_PROMPT_VERSION,
    };
  }

  /**
   * Deterministic stub trend-briefing generation. Returns a fixed non-null
   * LlmTrendBriefingResult on every call — the STUB_TREND_BRIEFING single paragraph + the
   * fixed modelId/promptVersion provenance. See the module doc for why this is test-only.
   * Always returns a result (never null): the stub's contract is "given a coverageDate
   * with eligible published events, produce the fixture briefing". The coverageDate's
   * eligible-events existence is checked upstream by generateTrendBriefing (which returns
   * null for a coverageDate with no eligible events before calling the adapter), so by the
   * time the stub is reached the day is known to have events.
   */
  async generateTrendBriefing(
    args: LlmTrendBriefingArgs,
  ): Promise<LlmTrendBriefingResult | null> {
    // Reference args to make the contract explicit (the stub ignores the day's events — a
    // real adapter would use title/summary per event to ground the cross-event briefing).
    // Avoids an unused-vars lint while documenting that the fixture is context-independent.
    void args.coverageDate;
    void args.events;
    return {
      briefing: STUB_TREND_BRIEFING,
      modelId: STUB_MODEL_ID,
      promptVersion: STUB_TREND_BRIEFING_PROMPT_VERSION,
    };
  }
}
