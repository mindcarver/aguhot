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

  /**
   * Resolve the three-segment 影响面/受益方/风险点 AI 深读 for the given event's
   * detail page. Implementations return three NON-EMPTY segments (each ≤120 字,
   * free of the six forbidden phrase classes) plus their own modelId +
   * promptVersion. Return null when no deep read is available (the caller writes
   * nothing and degrades honestly). Each returned segment is validated by
   * generateDeepRead (non-empty, ≤120 字, passes guardrail) — violations throw at
   * the generator, never silently truncated.
   *
   * The adapter receives the event's title + summary + the member evidence records
   * (sourceName / summary / publishedAt) so the three segments are grounded in the
   * factual evidence timeline, not fabricated (NFR-2). Story 5.2 reuses the same
   * LLMAdapter port 5.1 introduced (epic-5-context :108 "三者共用 worker resolve
   * 模式"); the second method is added here rather than spawning a parallel port.
   */
  generateDeepRead(args: LlmDeepReadArgs): Promise<LlmDeepReadResult | null>;

  /**
   * Resolve the single-paragraph AI 趋势研判 (cross-event trend briefing) for the given
   * coverageDate's daily digest page. Implementations return a NON-EMPTY briefing
   * (≤ TREND_BRIEFING_MAX_LENGTH = 200 字, free of the six forbidden phrase classes)
   * plus their own modelId + promptVersion. Return null when no briefing is available
   * (the caller writes nothing and degrades honestly). The returned briefing is
   * validated by generateTrendBriefing (non-empty, ≤200 字, passes guardrail) —
   * violations throw at the generator, never silently truncated.
   *
   * The adapter receives the day's published hot events (hotEventId + title + summary
   * per event) so the briefing is grounded in the factual evidence timeline, not
   * fabricated (NFR-2: AI content must not fabricate sourceless conclusions; must stay
   * consistent with the evidence timeline). Story 5.3 reuses the same LLMAdapter port
   * 5.1/5.2 introduced (epic-5-context :108 "三者共用端口"); this third method is added
   * here rather than spawning a parallel port.
   */
  generateTrendBriefing(
    args: LlmTrendBriefingArgs,
  ): Promise<LlmTrendBriefingResult | null>;
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

// --- Story 5.2: LLMAdapter.generateDeepRead + DeepRead (detail-page AI 深读) ----

/**
 * One unit of LLMAdapter deep-read output — the three-segment 影响面/受益方/风险点
 * AI 深读 for one hot event's detail page. The adapter resolves the three segments
 * from the event's title + summary + member evidence and returns them with its own
 * provenance (modelId + promptVersion, recorded on the appended row for NFR-7).
 * deep-read-service validates each segment is non-empty, ≤ DEEP_READ_SEGMENT_MAX_LENGTH
 * (120 字), and passes the 6-class wording guardrail (passesRecommendationGuardrail,
 * reused from 5.1 — the guardrail is generic PRD §10, not reason-specific) — violations
 * throw (fail-fast, never silently truncates/rewrites).
 *
 *   - impactSurface: 影响面 — NON-EMPTY, ≤120 字, free of the six forbidden phrase
 *     classes.
 *   - beneficiaries: 受益方 — NON-EMPTY, ≤120 字, free of the six forbidden phrase
 *     classes.
 *   - riskPoints: 风险点 — NON-EMPTY, ≤120 字, free of the six forbidden phrase classes.
 *   - modelId: the provider + model that produced it (e.g. "stub:v1"; a future real
 *     provider would carry e.g. "openai:gpt-4o"). Recorded verbatim on the appended row.
 *   - promptVersion: the prompt template version (e.g. "deepread-stub-v1").
 *     Recorded verbatim on the appended row.
 */
export interface LlmDeepReadResult {
  impactSurface: string;
  beneficiaries: string;
  riskPoints: string;
  modelId: string;
  promptVersion: string;
}

/**
 * The context passed to LLMAdapter.generateDeepRead. Carries the event's title +
 * summary (same overlay rule as the reason adapter) PLUS the member evidence records
 * (sourceName + summary + publishedAt) so the adapter can ground the three segments in
 * the actual evidence timeline (NFR-2: AI content must not fabricate sourceless
 * conclusions; must stay consistent with the evidence timeline). evidence is a
 * ReadonlyArray so the adapter cannot mutate the caller's array.
 *
 * The evidence shape mirrors what publish-orchestrator projects into
 * published_hot_event_evidence (sourceName / summary / publishedAt) — the adapter
 * receives the same grounding the public detail page renders.
 */
export interface LlmDeepReadArgs {
  hotEventId: string;
  title: string;
  summary: string;
  evidence: ReadonlyArray<{
    sourceName: string;
    summary: string;
    publishedAt: Date | null;
  }>;
}

/**
 * Options for generateDeepRead. `{ prisma, traceId, hotEventId, adapter? }` mirrors
 * generateRecommendationReason's command pattern plus an optional LLMAdapter. When
 * adapter is omitted (or the event is missing / has no evidence), the function returns
 * null and writes nothing (honest degradation — never fabricates a deep read).
 * Otherwise it loads the HotEvent + member evidence, calls the adapter, validates the
 * result (each segment non-empty, ≤120 字, passesRecommendationGuardrail; modelId +
 * promptVersion non-empty), and APPENDS one deep_reads row (source="ai").
 */
export interface GenerateDeepReadOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: LLMAdapter;
}

/**
 * The result of a successful generation: the newly-appended deep-read row's id + the
 * three segments + provenance + createdAt. Callers (the worker's projection refresh,
 * verify/seed) consume the segments directly.
 */
export interface GenerateDeepReadResult {
  deepReadId: string;
  hotEventId: string;
  impactSurface: string;
  beneficiaries: string;
  riskPoints: string;
  source: LlmSource;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
  traceId: string;
}

/**
 * One deep_reads row projected for read. Mirrors the columns the worker + audit need
 * (no write paths here).
 */
export interface DeepReadRecord {
  id: string;
  hotEventId: string;
  impactSurface: string;
  beneficiaries: string;
  riskPoints: string;
  source: LlmSource;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
}

// --- Story 5.3: LLMAdapter.generateTrendBriefing + TrendBriefing (daily-page AI 趋势研判)

/**
 * One unit of LLMAdapter trend-briefing output — the single-paragraph cross-event AI
 * 趋势研判 for one coverageDate's daily digest page. The adapter resolves the paragraph
 * from the day's published hot events (title + summary per event) and returns it with its
 * own provenance (modelId + promptVersion, recorded on the appended row for NFR-7).
 * trend-briefing-service validates the briefing is non-empty, ≤ TREND_BRIEFING_MAX_LENGTH
 * (200 字), and passes the 6-class wording guardrail (passesRecommendationGuardrail,
 * reused from 5.1 — the guardrail is generic PRD §10, not reason-specific) — violations
 * throw (fail-fast, never silently truncates/rewrites).
 *
 *   - briefing: NON-EMPTY single-paragraph cross-event trend briefing, ≤200 字, free of
 *     the six forbidden phrase classes (action / return-prediction / manipulation-frame /
 *     recommendation-strength / timing-advice / over-certainty).
 *   - modelId: the provider + model that produced it (e.g. "stub:v1"; a future real
 *     provider would carry e.g. "openai:gpt-4o"). Recorded verbatim on the appended row.
 *   - promptVersion: the prompt template version (e.g. "trendbriefing-stub-v1").
 *     Recorded verbatim on the appended row.
 */
export interface LlmTrendBriefingResult {
  briefing: string;
  modelId: string;
  promptVersion: string;
}

/**
 * The context passed to LLMAdapter.generateTrendBriefing. Carries the coverageDate plus
 * the day's published hot events (hotEventId + title + summary per event) so the adapter
 * can ground the cross-event briefing in the factual evidence timeline (NFR-2: AI content
 * must not fabricate sourceless conclusions; must stay consistent with the evidence
 * timeline). events is a ReadonlyArray so the adapter cannot mutate the caller's array.
 *
 * Each event's title is the latest-revision overlay title (same overlay rule as the
 * detail-page projection); each event's summary is the latest ExplanationVersion summary
 * (same overlay rule as the deep-read adapter). The adapter receives the same grounding
 * the daily digest renders.
 */
export interface LlmTrendBriefingArgs {
  coverageDate: Date;
  events: ReadonlyArray<{
    hotEventId: string;
    title: string;
    summary: string;
  }>;
}

// --- Story 5.4: AI content operator sampling (suppress + sampling list) --------

/**
 * The discriminator for which kind of AI content a Story 5.4 operation targets.
 * Stored as a free String column value (on ReviewDecision.targetType) and used to
 * route suppressAiContent to the right source-table writer + projection refresh.
 *
 * The wire values are "reason" and "deepread" (lowercase, matching the table-name
 * family). TrendBriefing is DELIBERATELY excluded (epic Gap 2: V1 does not allow
 * marking / taking down trend briefings — the sampling console is browse-only for
 * them, and SM-6 numerator / denominator both exclude trend briefings). The
 * server action whitelist rejects any targetType outside this const's values, so
 * a forged "trend_briefing" submit never reaches suppressAiContent.
 *
 * Kept as a const + type pair (no Prisma enum, per erasableSyntaxOnly). Mirrors
 * the FollowTargetKind / PublicationStatus precedent.
 */
export const AiContentType = {
  Reason: "reason",
  DeepRead: "deepread",
} as const;

export type AiContentType = (typeof AiContentType)[keyof typeof AiContentType];

/**
 * Options for suppressRecommendationReason — the SOLE writer of
 * recommendation_reasons.suppressedAt (AD-2 source-table ownership). Idempotent:
 * if the row's suppressedAt is already non-null, returns `{ suppressed: false,
 * reason: "already-suppressed" }` and writes nothing (prevents SM-6 numerator
 * double-counting via repeat ReviewDecision appends). If the row is missing,
 * Prisma's findUniqueOrThrow raises P2025 → the caller's transaction rolls back
 * (fail-fast, no partial state).
 *
 * `{ prisma, traceId, id }` accepts either the root PrismaClient or a
 * `$transaction` tx handle (the sibling suppressAiContent passes its tx cast to
 * PrismaClient so the source suppress + ReviewDecision append + projection
 * refresh are atomic). Mirrors the established `{ prisma, traceId }` shape.
 */
export interface SuppressRecommendationReasonOptions {
  prisma: PrismaClient;
  traceId: string;
  id: string;
}

/**
 * The result of a source-row suppress attempt. `{ suppressed: true }` on a fresh
 * suppress (suppressedAt was null → set to now). `{ suppressed: false, reason:
 * "already-suppressed" }` on an idempotent re-suppress (suppressedAt was already
 * set → no write, no duplicate ReviewDecision). The caller (suppressAiContent)
 * branches on `suppressed` to decide whether to append the audit row.
 */
export interface SuppressResult {
  suppressed: boolean;
  reason?: "already-suppressed";
}

/**
 * Options for suppressDeepRead — the SOLE writer of deep_reads.suppressedAt.
 * Same shape + idempotency contract as SuppressRecommendationReasonOptions (the
 * two source tables have identical append-only + suppress semantics).
 */
export interface SuppressDeepReadOptions {
  prisma: PrismaClient;
  traceId: string;
  id: string;
}

/**
 * Options for listAiContentForSampling — the operator sampling-console data
 * source. Returns a unified list across recommendation_reasons + deep_reads
 * (trend briefings are EXCLUDED — epic Gap 2). `type?` filters to one kind;
 * omitted returns both. The list is NOT filtered by suppressedAt (operators need
 * to see already-suppressed rows + their "已下线" marker). Ordered by createdAt
 * desc across both kinds. No pagination (V1 volume is tiny; matches the
 * listPendingCandidates / listPublishedHotEvents no-pagination precedent — real
 * pagination is deferred).
 */
export interface ListAiContentForSamplingOptions {
  prisma: PrismaClient;
  traceId: string;
  /** Optional filter to one kind. Omitted = both reason + deepread. */
  type?: AiContentType;
}

/**
 * One unified sampling-console row. The `type` discriminator lets the UI render
 * a type tag + route the suppress form to the right targetType. `content` is a
 * display preview: the reason text for "reason", or the three deep-read segments
 * concatenated for "deepread" (the console shows a preview, not the full block).
 * `suppressedAt` is null while live, non-null when an operator has suppressed the
 * row (the UI renders a "已下线" marker and hides the suppress button, UX-DR14).
 */
export interface AiContentSamplingItem {
  type: AiContentType;
  id: string;
  hotEventId: string;
  eventTitle: string;
  content: string;
  source: string;
  createdAt: Date;
  suppressedAt: Date | null;
}
