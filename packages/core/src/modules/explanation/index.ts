/**
 * explanation module barrel — Story 1.8 + Story 5.1.
 *
 * Owns the ExplanationVersion table (AD-5 append-only) and, as of Story 5.1,
 * the recommendation_reasons table (AD-5 append-only, the ≤40 字 AI 解读 card
 * hook). Exposes the deterministic three-partition generator + the latest-
 * version read query (1.8), the LLMAdapter port + StubLlmAdapter test-only +
 * the recommendation-reason generator + the 6-class guardrail (5.1). The Prisma
 * client lives one level up and is re-exported from the package barrel.
 *
 * This module never writes hot_events, evidence_records, or published_* tables.
 * It only appends explanation_versions + recommendation_reasons; publish-
 * orchestrator reads the latest of each at projection time and writes the public
 * read models (it is the SOLE writer of published_timeline_entries.recommendation_
 * reason — the worker only appends here + triggers the existing projection).
 */

export { generateExplanation, getLatestExplanation, derivePartitions, saveExplanation } from "./explain-service.js";
export {
  generateRecommendationReason,
  getLatestRecommendationReason,
  passesRecommendationGuardrail,
  RECOMMENDATION_REASON_MAX_LENGTH,
  RECOMMENDATION_FORBIDDEN_PHRASES,
} from "./reason-service.js";
export { StubLlmAdapter, STUB_RECOMMENDATION_REASON } from "./stub-llm-adapter.js";
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
  LLMAdapter,
  GenerateRecommendationReasonOptions,
  GenerateRecommendationReasonResult,
  RecommendationReasonRecord,
} from "./types.js";
