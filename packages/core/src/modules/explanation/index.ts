/**
 * explanation module barrel — Story 1.8 + Story 5.1 + Story 5.2 + Story 5.3.
 *
 * Owns the ExplanationVersion table (AD-5 append-only), and as of Story 5.1,
 * the recommendation_reasons table (AD-5 append-only, the ≤40 字 AI 解读 card
 * hook), and as of Story 5.2, the deep_reads table (AD-5 append-only, the
 * three-segment 影响面/受益方/风险点 AI 深读 detail-page deep read). Exposes the
 * deterministic three-partition generator + the latest-version read query (1.8),
 * the LLMAdapter port + StubLlmAdapter test-only + the recommendation-reason
 * generator + the 6-class guardrail (5.1), and the deep-read generator (5.2,
 * reusing the same guardrail + port). Story 5.3 adds the third LLMAdapter method
 * generateTrendBriefing + the STUB_TREND_BRIEFING fixture + the LlmTrendBriefing*
 * port types — the trend briefing itself lives in the digest module (coverageDate-
 * keyed, not per-HotEvent), but its generation PORT is this module's LLMAdapter
 * (epic-5-context :108 "三者共用端口"). The Prisma client lives one level up and is
 * re-exported from the package barrel.
 *
 * This module never writes hot_events, evidence_records, or published_* tables.
 * It only appends explanation_versions + recommendation_reasons + deep_reads;
 * publish-orchestrator reads the latest of each at projection time and writes the
 * public read models (it is the SOLE writer of published_timeline_entries.
 * recommendation_reason AND published_hot_event_deep_reads — the worker only
 * appends here + triggers the existing projections).
 */

export { generateExplanation, getLatestExplanation, derivePartitions, saveExplanation } from "./explain-service.js";
export {
  generateRecommendationReason,
  getLatestRecommendationReason,
  passesRecommendationGuardrail,
  RECOMMENDATION_REASON_MAX_LENGTH,
  RECOMMENDATION_FORBIDDEN_PHRASES,
} from "./reason-service.js";
export {
  generateDeepRead,
  getLatestDeepRead,
  DEEP_READ_SEGMENT_MAX_LENGTH,
} from "./deep-read-service.js";
export {
  StubLlmAdapter,
  STUB_RECOMMENDATION_REASON,
  STUB_DEEP_READ,
  STUB_TREND_BRIEFING,
} from "./stub-llm-adapter.js";
export { ExplanationSource } from "./types.js";
export type {
  ExplanationSource as ExplanationSourceType,
  ExplanationPartitions,
  GenerateExplanationOptions,
  GenerateExplanationResult,
  GetLatestExplanationOptions,
  ExplanationVersionRecord,
  SaveExplanationOptions,
  SaveExplanationResult,
  LlmSource,
  LlmReasonResult,
  LlmDeepReadResult,
  LlmDeepReadArgs,
  LlmTrendBriefingResult,
  LlmTrendBriefingArgs,
  LLMAdapter,
  GenerateRecommendationReasonOptions,
  GenerateRecommendationReasonResult,
  RecommendationReasonRecord,
  GenerateDeepReadOptions,
  GenerateDeepReadResult,
  DeepReadRecord,
} from "./types.js";
