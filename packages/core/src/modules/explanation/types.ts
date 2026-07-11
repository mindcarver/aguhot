/**
 * explanation domain types — Story 1.8.
 *
 * The explanation module owns ExplanationVersion (AD-5 append-only) and the
 * deterministic three-partition derivation (V1 source="template"). It never
 * writes hot_events, evidence_records, or published_* tables (publish-
 * orchestrator owns the public projections; this module only appends
 * explanation_versions and lets publish-orchestrator read the latest at
 * projection time).
 *
 * The three partitions map directly to the epic's "detail page three blocks":
 *   - summary        → 发生了什么 (what happened)
 *   - whyItMatters   → 为什么重要 (why it matters)
 *   - uncertainties  → 当前仍不确定什么 (what remains uncertain)
 *
 * NFR: the deterministic derivation NEVER fabricates facts. summary is title +
 * latest record summary; whyItMatters is an objective statement of source count
 * / coverage span; uncertainties calls out data gaps (missing summary / missing
 * url / missing_fields records). No market implications, no stock-specific
 * judgment, no investment advice wording.
 */

import type { PrismaClient } from "../../../generated/client.js";

/**
 * The provenance of an explanation version. Stored on every ExplanationVersion
 * row so the operator audit chain can tell which version came from which source
 * (AD-5 "which version is from AI/human"). The public read model carries this
 * through as `explanationSource` but the public surface shows only the uniform
 * `<AiLabel>` (epic: uniform, identical on public and operator).
 *
 *   - template: V1 deterministic derivation from real evidence (this story).
 *   - ai:       a real LLM provider (deferred — not wired in 1.8).
 *   - human:    an operator-authored revision (1.9 operator revision UI).
 */
export const ExplanationSource = {
  Template: "template",
  Ai: "ai",
  Human: "human",
} as const;

export type ExplanationSource = (typeof ExplanationSource)[keyof typeof ExplanationSource];

/**
 * The three explanation partitions. Each is a non-empty string (the derivation
 * never produces an empty partition when there is evidence; when there is no
 * evidence, generateExplanation returns null and writes nothing — never an
 * empty version). All three are plain text derived from real evidence fields.
 */
export interface ExplanationPartitions {
  /** 发生了什么 — title + latest record's summary. */
  summary: string;
  /** 为什么重要 — objective statement of source count / coverage span. */
  whyItMatters: string;
  /** 当前仍不确定什么 — data gaps (missing summary / url / missing_fields). */
  uncertainties: string;
}

/**
 * Options for generateExplanation. `{ prisma, traceId, hotEventId }` mirrors
 * the established command pattern (clusterEvents, decideReview). The derivation
 * reads the HotEvent + its member evidence_records + their evidence_sources to
 * derive the partitions deterministically, then APPENDS one ExplanationVersion
 * row (source="template"). Returns null when the event has no member evidence
 * (no evidence → no honest derivation → no version written).
 */
export interface GenerateExplanationOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * The result of a successful generation: the newly-appended version's id +
 * partitions + provenance + createdAt. Callers (publish-orchestrator projection,
 * verify/seed) consume the partitions directly. The id is returned so the
 * audit chain can link back to the exact version.
 */
export interface GenerateExplanationResult extends ExplanationPartitions {
  explanationVersionId: string;
  hotEventId: string;
  source: ExplanationSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestExplanation — returns the most recent ExplanationVersion
 * for an event (createdAt desc first) or null if none exist. publish-
 * orchestrator uses this at projection time to surface the current version.
 */
export interface GetLatestExplanationOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * One explanation version row projected for read. Mirrors the ExplanationVersion
 * columns the public projection + operator audit need (no write paths here).
 */
export interface ExplanationVersionRecord extends ExplanationPartitions {
  id: string;
  hotEventId: string;
  source: ExplanationSource;
  createdAt: Date;
}

// --- Story 1.9: operator-authored explanation revision -----------------------

/**
 * Options for saveExplanation — the operator-authored explanation write-point.
 * The caller passes the three partitions verbatim (operator hand-typed text;
 * NOT LLM-generated — real LLM is deferred, see generateExplanation). `source`
 * is required: V1 callers pass `ExplanationSource.Human` so the provenance is
 * recorded (the public read model then DROPS the uniform <AiLabel> for human-
 * sourced partitions — AC3 + 1.8 defer, gated by `source !== "human"`).
 *
 * saveExplanation appends one ExplanationVersion row ONLY when the three
 * partitions differ from the latest version (change detection: no dirty
 * version, no spurious source flip). A no-op submit (same text) writes nothing.
 */
export interface SaveExplanationOptions extends ExplanationPartitions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  source: ExplanationSource;
}

/**
 * Result of saveExplanation. `appended: true` + `explanationVersionId` when a
 * new ExplanationVersion row was appended (the three partitions changed vs the
 * latest version). `appended: false` on no-op (no change — no dirty version, no
 * spurious source flip). `notFound: true` when the event does not exist.
 */
export interface SaveExplanationResult {
  appended: boolean;
  explanationVersionId?: string;
  notFound?: boolean;
}

// --- Story 5.1: LLMAdapter port + RecommendationReason (card AI 解读) -----------

/**
 * The provenance of a recommendation reason (AI 解读). Stored on every
 * recommendation_reasons row so the audit chain can trace which provider +
 * model + prompt version produced it (NFR-7). Mirrors `ExplanationSource` and
 * reuses its "ai" value (already reserved there): V1 rows all carry source="ai"
 * (the stub also writes "ai" so the projection pipeline is identical — only
 * modelId/promptVersion mark a row as stub-generated).
 *
 * This alias exists so the LLMAdapter port + reason-service can name the source
 * type in its own terms without reaching back into the ExplanationVersion
 * vocabulary; the wire value is the same string union.
 */
export type LlmSource = ExplanationSource;

/**
 * One unit of LLMAdapter output — the ≤40 字 AI 解读 hook for one hot event.
 * The adapter resolves a one-line reason from the event's title + summary and
 * returns it with a non-empty `reason` plus its own provenance (modelId +
 * promptVersion, recorded on the appended row for NFR-7). reason-service
 * validates the reason is non-empty, ≤40 字, and passes the 6-class wording
 * guardrail (passesRecommendationGuardrail) — violations throw (fail-fast,
 * never silently truncates/rewrites).
 *
 *   - reason: NON-EMPTY one-line AI 解读, ≤40 字, free of the six forbidden
 *     phrase classes (action / return-prediction / manipulation-frame /
 *     recommendation-strength / timing-advice / over-certainty).
 *   - modelId: the provider + model that produced it (e.g. "stub:v1"; a future
 *     real provider would carry e.g. "openai:gpt-4o"). Recorded verbatim on the
 *     appended row.
 *   - promptVersion: the prompt template version (e.g. "reason-stub-v1").
 *     Recorded verbatim on the appended row.
 */
export interface LlmReasonResult {
  reason: string;
  modelId: string;
  promptVersion: string;
}

/**
 * The LLMAdapter port (AD-7). All LLM knowledge sources for AI 解读 (and,
 * transitively, the future 5.2 AI 深读 / 5.3 趋势研判) enter through this
 * interface; domain modules never import a third-party LLM SDK. V1 has no
 * concrete implementation wired in prod (real provider procurement deferred) —
 * the recommendation-reason worker resolves `adapter = undefined` so
 * generateRecommendationReason returns null and prod degrades honestly (AC).
 * verify/e2e pass StubLlmAdapter directly to generateRecommendationReason. The
 * only concrete implementation today is StubLlmAdapter (test-only).
 *
 * Defined in types.ts (single source of truth, alongside the other explanation
 * domain types) and re-exported from llm-adapter.ts as the port's home (mirrors
 * the DigestAdapter precedent: types.ts holds the interface, *-adapter.ts is the
 * thin re-export home).
 *
 * The adapter receives the event's title + summary as context (the same fields
 * the card renders) so it can produce a one-line hook grounded in the evidence.
 * A real LLM would also read the member evidence records; V1 keeps the context
 * minimal (title + summary) since the stub returns a fixed string and a real
 * provider's context window is a story-time decision when the provider lands.
 */
export interface LLMAdapter {
  /**
   * Resolve a one-line (≤40 字) AI 解读 for the given event. Implementations
   * return a NON-EMPTY reason ≤40 字, free of the six forbidden phrase classes,
   * plus their own modelId + promptVersion. Return null when no reason is
   * available (the caller writes nothing and degrades honestly). Each returned
   * reason is validated by generateRecommendationReason (non-empty, ≤40 字,
   * passes guardrail) — violations throw at the generator, never silently
   * truncated.
   *
   * The adapter receives the event's title + summary (the same context the card
   * renders) so the reason is grounded in the factual evidence, not fabricated.
   */
  generateReason(args: {
    hotEventId: string;
    title: string;
    summary: string;
  }): Promise<LlmReasonResult | null>;
}

/**
 * Options for generateRecommendationReason. `{ prisma, traceId, hotEventId,
 * adapter? }` mirrors the established command pattern (generateExplanation,
 * generateDailyDigest) plus an optional LLMAdapter. When adapter is omitted (or
 * the event is missing / has no evidence), the function returns null and writes
 * nothing (honest degradation — never fabricates a reason). Otherwise it loads
 * the HotEvent, calls the adapter, validates the result (non-empty, ≤40 字,
 * passesRecommendationGuardrail), and APPENDS one recommendation_reasons row
 * (source="ai").
 */
export interface GenerateRecommendationReasonOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: LLMAdapter;
}

/**
 * The result of a successful generation: the newly-appended reason row's id +
 * the reason text + provenance + createdAt. Callers (the worker's projection
 * refresh, verify/seed) consume the reason directly.
 */
export interface GenerateRecommendationReasonResult {
  recommendationReasonId: string;
  hotEventId: string;
  reason: string;
  source: LlmSource;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
  traceId: string;
}

/**
 * One recommendation_reasons row projected for read. Mirrors the columns the
 * worker + audit need (no write paths here).
 */
export interface RecommendationReasonRecord {
  id: string;
  hotEventId: string;
  reason: string;
  source: LlmSource;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
}
