/**
 * investment-targets domain types.
 *
 * This module owns investment_targets (AD-5 append-only, one row per agent run of
 * the ashare-news-investment-targets skill). The agent runs the skill's阶段A
 * (extract + score) and阶段B (verify codes) only;阶段C (技术面/买卖点) is not in
 * the output schema and never lands here. Scoring is the skill's 70-point降级口径
 * — the system has no per-stock realtime data, so 30 points (股价位置/板块强度/
 * 资金痕迹) are unscorable and carried as downgradeNote instead of faked.
 *
 * One agent run produces TWO artifacts atomically: the candidate pool AND the
 * 影响面/受益方/风险点 deep-read three-segment set (the skill's传导链 naturally
 * yields both). generateInvestmentTargets writes investment_targets AND a deep_reads
 * row (the latter reusing explanation's deep_reads table so the EXISTING detail-page
 * deep-read block surfaces the skill's output — no new deep-read UI). This makes the
 * investment-targets agent path the de-facto deep-read producer for events it
 * covers; the sibling deep-read worker (single-completion, adapter=undefined in V1
 * prod) stays dormant and its `deepReads:{none:{}}` candidate query naturally skips
 * events this path already filled.
 *
 * The port (TargetsAdapter) lives in core; the concrete SDK-backed adapter
 * (HeadlessAgentTargetsAdapter) lives in apps/worker so the heavy Claude Agent SDK
 * dependency (it bundles the Claude Code binary) never enters the web build. The
 * worker's targets-adapter-resolver constructs it from env, mirroring
 * llm-adapter-resolver. A StubTargetsAdapter (test-only, no SDK) lives in core for
 * verify/e2e.
 */

import type { PrismaClient } from "../../../generated/client.js";

/**
 * Candidate tier — the skill's受益分层 (factual传导链 position), reframed as
 * "研究强度" rather than the skill's "交易池准入" wording so it never brushes the
 * PRD §10 recommendation-strength class. Wire values are kebab-ish CJK labels.
 */
export const TargetTier = {
  PrimaryBeneficiary: "一级受益",
  SecondaryBeneficiary: "二级受益",
  Conceptual: "三级概念",
  RiskOrFake: "伪受益/风险",
} as const;

export type TargetTier = (typeof TargetTier)[keyof typeof TargetTier];

/**
 * The four scorable dimensions (out of a 70-point ceiling — the other 30 points
 * need per-stock realtime data the system does not have, so they are unscorable
 * and noted in downgradeNote rather than faked). Each is a non-negative number;
 * the service caps each at its max so an over-enthusiastic agent cannot inflate.
 */
export interface TargetScores {
  /** 新闻强度, max 20. */
  newsStrength: number;
  /** 关联强度, max 20. */
  linkStrength: number;
  /** 预期差, max 15. */
  expectationGap: number;
  /** 业绩弹性, max 15. */
  earningsElasticity: number;
}

/**
 * One extracted candidate. `code` is null when the agent could not confirm a
 * ticker (the skill's own "待核验" fallback — aguhot has no stock master to
 * validate against, so an unconfirmed code is left out rather than fabricated).
 * `codeVerified` records whether阶段B web search corroborated it.
 */
export interface TargetCandidate {
  name: string;
  code: string | null;
  codeVerified: boolean;
  tier: TargetTier;
  /** 受益逻辑 — the传导链 from news → industry variable → this company. */
  benefitLogic: string;
  scores: TargetScores;
  /** 待核验项 — explicit data gaps (股东减持/订单进展/财务细节…). */
  toVerify: string[];
  /** 与新闻的证据链. */
  evidenceChain: string;
}

/**
 * One unit of adapter output — the candidate pool + the deep-read three-segment
 * byproduct, plus provenance (modelId + promptVersion, recorded on the appended
 * investment_targets row for NFR-7). The adapter returns null when the agent
 * times out / aborts / cannot conform to the schema (honest degradation — the
 * caller writes nothing).
 */
export interface LlmTargetsResult {
  newsConclusion: string;
  transmissionPath: string;
  candidates: TargetCandidate[];
  /** 影响面/受益方/风险点 — also appended to deep_reads so the existing detail-page
   * deep-read block surfaces the skill's output. Each ≤120 字, guardrail-clean. */
  deepRead: {
    impactSurface: string;
    beneficiaries: string;
    riskPoints: string;
  };
  downgradeNote: string;
  modelId: string;
  promptVersion: string;
}

/**
 * The context passed to TargetsAdapter.generateInvestmentTargets. Carries the
 * event's effective title + summary + member evidence (same grounding shape as
 * the deep-read adapter) so the agent extracts candidates FROM the evidence
 * timeline, never fabricating sourceless targets (NFR-2).
 */
export interface LlmTargetsArgs {
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
 * The TargetsAdapter port. The investment-targets service depends only on this
 * interface; the concrete SDK-backed adapter is constructed in the worker. When
 * the worker resolves NO adapter (env unset), generateInvestmentTargets returns
 * null and writes nothing (honest degradation, mirroring the LLMAdapter default).
 */
export interface TargetsAdapter {
  generateInvestmentTargets(args: LlmTargetsArgs): Promise<LlmTargetsResult | null>;
}

/**
 * Options for generateInvestmentTargets. `{ prisma, traceId, hotEventId, adapter? }`
 * mirrors the established command pattern (generateDeepRead, generateExplanation).
 * When adapter is omitted (or the event is missing / has no evidence), returns
 * null and writes nothing.
 */
export interface GenerateInvestmentTargetsOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: TargetsAdapter;
}

/**
 * The result of a successful generation: the newly-appended investment_targets
 * row's id + the candidate pool + provenance + createdAt. The deep-read byproduct
 * is appended to deep_reads in the same call (not returned here — its projection
 * is read back via the existing published_hot_event_deep_reads read model).
 */
export interface GenerateInvestmentTargetsResult {
  investmentTargetId: string;
  hotEventId: string;
  newsConclusion: string;
  transmissionPath: string;
  candidates: TargetCandidate[];
  downgradeNote: string;
  source: string;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
  traceId: string;
}

/**
 * One investment_targets row projected for read. Mirrors the columns the worker
 * + audit need (no write paths here).
 */
export interface InvestmentTargetRecord {
  id: string;
  hotEventId: string;
  newsConclusion: string;
  transmissionPath: string;
  candidates: TargetCandidate[];
  downgradeNote: string;
  source: string;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
}
