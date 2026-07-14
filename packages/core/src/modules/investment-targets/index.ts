/**
 * investment-targets module barrel.
 *
 * Owns investment_targets (AD-5 append-only). The agent-driven candidate pool
 * (ashare-news-investment-targets skill, 阶段A+B) lands here; the same run's
 * 影响面/受益方/风险点 byproduct is appended to the explanation module's deep_reads
 * so the existing detail-page deep-read block surfaces it. The TargetsAdapter port
 * + service + stub live here; the concrete SDK-backed HeadlessAgentTargetsAdapter
 * lives in apps/worker (keeps the heavy Claude Agent SDK dep out of the web build).
 */

export { generateInvestmentTargets, getLatestInvestmentTargets } from "./targets-service.js";
export { StubTargetsAdapter, STUB_TARGETS } from "./stub-targets-adapter.js";
export { TargetTier } from "./types.js";
export type {
  TargetTier as TargetTierType,
  TargetScores,
  TargetCandidate,
  LlmTargetsResult,
  LlmTargetsArgs,
  TargetsAdapter,
  GenerateInvestmentTargetsOptions,
  GenerateInvestmentTargetsResult,
  InvestmentTargetRecord,
} from "./types.js";
