/**
 * StubTargetsAdapter — a deterministic test-only TargetsAdapter.
 *
 * TEST-ONLY: NOT wired in the worker/prod runtime. Returns a fixed candidate
 * pool + deep read for every event so verify/e2e can exercise the happy path
 * (append investment_targets + deep_reads → projection → detail page) without a
 * real agent run. apps/worker does NOT import it; the worker resolves the SDK
 * adapter or none (honest degradation).
 *
 * The fixture is restrained and factual: tiers are research positions, scores are
 * mid-range, no buy/sell/price/target/timeframe wording — the tone baseline a real
 * agent run must match (PRD §10). Each deep-read segment ≤120 字 and guardrail-clean.
 */

import type {
  LlmTargetsArgs,
  LlmTargetsResult,
  TargetsAdapter,
} from "./types.js";

/**
 * The fixed candidate pool + deep read the stub reports. Exported so verify can
 * assert the projected rows carry exactly these values (deterministic across runs).
 */
export const STUB_TARGETS: Omit<LlmTargetsResult, "modelId" | "promptVersion"> = {
  newsConclusion: "海外龙头财报超预期，映射A股供应链。",
  transmissionPath: "海外龙头业绩超预期 → 产业链订单与出货上修 → A股供应商收入弹性。",
  candidates: [
    {
      name: "示例供应链公司",
      code: null,
      codeVerified: false,
      tier: "一级受益",
      benefitLogic: "直接供货海外龙头，订单随龙头出货上修。",
      scores: { newsStrength: 14, linkStrength: 16, expectationGap: 9, earningsElasticity: 10 },
      toVerify: ["最新订单确认", "营收占比"],
      evidenceChain: "新闻提及龙头出货上修，该公司为其披露供应商。",
    },
    {
      name: "示例二线标的",
      code: null,
      codeVerified: false,
      tier: "二级受益",
      benefitLogic: "间接受益于产业链景气，订单验证尚不充分。",
      scores: { newsStrength: 10, linkStrength: 9, expectationGap: 7, earningsElasticity: 6 },
      toVerify: ["客户结构", "毛利率影响"],
      evidenceChain: "行业景气传导，暂无直接订单证据。",
    },
  ],
  deepRead: {
    impactSurface: "事件波及相关产业链上下游企业。",
    beneficiaries: "相关供应链公司短期或受关注。",
    riskPoints: "需求兑现节奏仍存不确定性。",
  },
  downgradeNote: "含30分待核验项，按70分口径换算",
};

const STUB_MODEL_ID = "stub:v1";
const STUB_PROMPT_VERSION = "targets-stub-v1";

/**
 * Deterministic stub. Returns the fixed pool on every call (never null): the
 * stub's contract is "given any event with evidence, produce the fixture pool".
 * Evidence existence is checked upstream by generateInvestmentTargets.
 */
export class StubTargetsAdapter implements TargetsAdapter {
  async generateInvestmentTargets(args: LlmTargetsArgs): Promise<LlmTargetsResult | null> {
    void args.hotEventId;
    void args.title;
    void args.summary;
    void args.evidence;
    return { ...STUB_TARGETS, modelId: STUB_MODEL_ID, promptVersion: STUB_PROMPT_VERSION };
  }
}
