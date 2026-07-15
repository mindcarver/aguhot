/**
 * saliency.ts — the pure relevance-gate + significance-score logic for Epic 7
 * (sprint-change-proposal-2026-07-15). No infra, no DB, no Date.now() — fully
 * deterministic and CI-gateable (see saliency.selfcheck.ts).
 *
 * Two concerns, both computed at cluster time from a candidate's member evidence:
 *
 *   1. Relevance gate (judgeRelevance) — "is this about investment/markets at
 *      all?" Filters the entertainment/gossip/social noise that leaks through
 *      curated 财经 RSS feeds. Deterministic keyword rules (whitelist +
 *      blacklist), NOT an LLM — cheap, reproducible, auditable (AD-5). LLM
 *      fallback for ambiguous items is deferred (V1 out-of-scope).
 *
 *   2. Saliency score (scoreSaliency) — "how significant is this?" A 0–100
 *      weighted score. At cluster time only breadth (distinct-source coverage)
 *      and velocity (how fast multiple sources piled on) are available, because
 *      market-reaction + association modules have NOT run yet. Those two
 *      components default to 0 here and are folded in at publish time by Story
 *      7.4 (publish-orchestrator reads MarketReactionSnapshot + EventAssociation
 *      Set read-only and re-scores; write-owner stays event-assembly, AD-2b).
 *
 * Write-ownership: event-assembly is the SOLE writer of HotEvent.saliency /
 * saliency_breakdown / relevance_label (AD-2b). market-reaction and
 * theme-linking only expose reads; they never write these fields.
 *
 * Tuning (SALIENCY_WEIGHTS, *_THRESHOLD, BREADTH_SATURATION_SOURCES,
 * VELOCITY_WINDOW_MS) are event-assembly module config constants — deliberately
 * NOT in global env, mirroring TIMELINE_FOLD_THRESHOLD (architect review: score
 * semantics belong with the scorer, not in global config). Operator-adjustable
 * override is a future story; V1 ships the fixed defaults below.
 */

/**
 * Relevance label union. Stored as a plain String column (no Prisma enum, per
 * erasableSyntaxOnly). The gate behavior (Story 7.3):
 *   - fail      → decideReview(reject): off-topic, never reaches the public feed.
 *   - suspicious → held as candidate for operator review (mixed signals).
 *   - pass      → eligible for auto-publish if saliency ≥ HIGH_THRESHOLD.
 */
export const RelevanceLabel = {
  Pass: "pass",
  Suspicious: "suspicious",
  Fail: "fail",
} as const;
export type RelevanceLabel = (typeof RelevanceLabel)[keyof typeof RelevanceLabel];

/**
 * Investment/market keyword whitelist. An item is relevant iff its text contains
 * at least one of these. Curated for A股/财经: market structure, instruments,
 * corporate actions, macro/policy, and generic sector vocabulary. Single chars
 * (涨跌股基债) are strong, unambiguous finance signals; the rest are ≥2-char
 * terms to avoid false positives (e.g. avoid bare 指/盘/价 which appear in
 * non-finance contexts).
 *
 * This is a positive enumerable constant (mirrors the AI 措辞 blacklist pattern
 * in the explanation module): adding a term is a code change + self-check, never
 * a runtime config. Sources are already curated 财经 feeds, so the bar is "does
 * this item show ANY investment vocabulary" — most items pass; the gate exists
 * to catch the occasional off-topic item that leaks through.
 */
const INVESTMENT_KEYWORDS = [
  // single-char market signals
  "涨",
  "跌",
  "股",
  "基",
  "债",
  // instruments / markets
  "基金",
  "债券",
  "期货",
  "期权",
  "ipo",
  "上市",
  "增发",
  "退市",
  "停牌",
  "复牌",
  // corporate actions / fundamentals
  "并购",
  "重组",
  "回购",
  "增持",
  "减持",
  "解禁",
  "分红",
  "财报",
  "业绩",
  "营收",
  "利润",
  "毛利",
  "净利",
  "预告",
  "预增",
  "预减",
  "中标",
  "订单",
  "签约",
  "产能",
  "估值",
  "市盈",
  "市净",
  // macro / policy / regulators
  "政策",
  "监管",
  "央行",
  "证监会",
  "银保监",
  "利率",
  "降准",
  "降息",
  "加息",
  "汇率",
  "补贴",
  "关税",
  // market structure / trading
  "涨停",
  "跌停",
  "板块",
  "概念",
  "龙头",
  "产业链",
  "大盘",
  "指数",
  "沪指",
  "创业板",
  "科创",
  "北向",
  "融资",
  "融券",
  "成交",
  "量能",
  "牛市",
  "熊市",
  "研报",
  "公告",
] as const;

/**
 * Noise keyword blacklist. An item that ALSO hits a noise term is demoted to
 * `suspicious` (held for review) even if it hit the whitelist — entertainment /
 * gossip frames dilute investment relevance. This is a demoter, NOT a hard
 * killer: an item with zero whitelist hits is already `fail` regardless of
 * noise, so this list only decides the pass→suspicious edge case. Kept small
 * and conservative to avoid false-positive demotion of real finance news.
 */
const NOISE_KEYWORDS = [
  "明星",
  "综艺",
  "娱乐",
  "八卦",
  "影视",
  "选秀",
  "演唱会",
  "电视剧",
  "出轨",
  "星座",
] as const;

export interface RelevanceJudgement {
  label: RelevanceLabel;
  /** The first whitelist keyword that matched (audit / debug), or null. */
  hitKeyword: string | null;
  /** Whether a noise keyword also matched (pass→suspicious demoter). */
  hitNoise: boolean;
}

/**
 * Judge investment relevance of a text blob (typically the concatenated
 * title + summary of a candidate's member evidence records). Pure substring
 * match — CJK-safe (String.prototype.includes works on multi-byte chars).
 *
 *   no whitelist hit        → fail      (off-topic)
 *   whitelist + noise hit   → suspicious (mixed signals)
 *   whitelist only          → pass
 */
export function judgeRelevance(text: string): RelevanceJudgement {
  const haystack = text.toLowerCase();
  let hitKeyword: string | null = null;
  for (const kw of INVESTMENT_KEYWORDS) {
    if (haystack.includes(kw)) {
      hitKeyword = kw;
      break;
    }
  }
  let hitNoise = false;
  for (const kw of NOISE_KEYWORDS) {
    if (haystack.includes(kw)) {
      hitNoise = true;
      break;
    }
  }
  const label: RelevanceLabel =
    hitKeyword === null
      ? RelevanceLabel.Fail
      : hitNoise
        ? RelevanceLabel.Suspicious
        : RelevanceLabel.Pass;
  return { label, hitKeyword, hitNoise };
}

// --- saliency score ----------------------------------------------------------

/**
 * Component weights (sum = 100). breadth + velocity are computed at cluster
 * time (max 60 combined); marketReaction + association are 0 at cluster time
 * and folded in at publish time by Story 7.4 (max 40 combined). So a freshly
 * clustered candidate peaks at ~60 until 7.4 re-scores — by design, the
 * cluster-time gate is conservative and market-confirmed events get a boost
 * once their snapshot lands.
 */
export const SALIENCY_WEIGHTS = {
  breadth: 40,
  velocity: 20,
  marketReaction: 25,
  association: 15,
} as const;

/**
 * Distinct-source count at which breadth saturates (full breadth points).
 * ≥3 distinct 财经 sources reporting the same event = strong multi-source
 * coverage (PRD's "多源覆盖" sort reason).
 */
export const BREADTH_SATURATION_SOURCES = 3;

/**
 * The window within which multiple sources arriving = "升温" (velocity). Sources
 * piling on within 6h = full velocity; spread over >6h tapers to 0. Mirrors the
 * PRD "近期升温" sort reason.
 */
export const VELOCITY_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Publish-gate thresholds (Story 7.3), against the 0–100 scale:
 *   score < LOW   → reject (held-back weak; reserved — see note)
 *   LOW ≤ < HIGH  → hold as candidate for operator review
 *   score ≥ HIGH  → auto-publish (relevance must also be pass)
 *
 * NOTE: with the cluster-time component ceiling of 60, HIGH=38 means "≥2
 * distinct sources arriving moderately fast" auto-publishes while single-source
 * items (breadth 12, velocity 0 → 12) are held for review. LOW=10 is below the
 * single-source floor of 12, so it only rejects degenerate/unscored-adjacent
 * cases in V1; tightening it is a follow-up once we observe the real score
 * distribution (deferred-work, do not guess).
 */
export const SALIENCY_LOW_THRESHOLD = 10;
export const SALIENCY_HIGH_THRESHOLD = 38;

export interface SaliencyInput {
  /** Total member evidence records (EvidenceRecord count in the cluster). */
  evidenceCount: number;
  /** Distinct EvidenceSource feeds among the members (breadth driver). */
  distinctSourceCount: number;
  /** max(publishedAt) − min(publishedAt) among members, in ms (velocity driver). */
  spanMs: number;
}

export interface SaliencyBreakdown {
  breadth: number;
  velocity: number;
  marketReaction: number;
  association: number;
  total: number;
}

export interface SaliencyResult {
  score: number;
  breakdown: SaliencyBreakdown;
}

/**
 * Breadth component (0..SALIENCY_WEIGHTS.breadth). Stepwise on distinct sources
 * rather than purely linear, so the jump from 1→2 sources (the "got a second
 * confirmation" threshold) is the steepest signal — single-source is weak,
 * two-source is credible, three+ is saturated. Steps chosen so single-source =
 * 12 (above LOW=10 → held not rejected, preserving the 单源快讯 feature) and
 * two-source = 24.
 *
 * ponytail: stepwise table over a curve — the three meaningful tiers (1/2/3+)
 * are all the resolution that matters; a continuous formula would be false
 * precision without real calibration data.
 */
function breadthPoints(distinctSourceCount: number): number {
  if (distinctSourceCount >= BREADTH_SATURATION_SOURCES) return SALIENCY_WEIGHTS.breadth; // 40
  if (distinctSourceCount === 2) return 24;
  return 12; // 1 source (or 0 — guarded by caller, but defensive)
}

/**
 * Velocity component (0..SALIENCY_WEIGHTS.velocity). Only meaningful when ≥2
 * distinct sources exist — a single source cannot "升温" itself. With ≥2, it is
 * a linear decay from full points (sources within the same instant) to 0
 * (sources spread ≥ VELOCITY_WINDOW_MS apart). Clamped to [0, max].
 */
function velocityPoints(distinctSourceCount: number, spanMs: number): number {
  if (distinctSourceCount < 2) return 0;
  const ratio = Math.min(1, Math.max(0, 1 - spanMs / VELOCITY_WINDOW_MS));
  return ratio * SALIENCY_WEIGHTS.velocity;
}

/**
 * Compute the cluster-time saliency score (0–100). marketReaction + association
 * are 0 here; Story 7.4 re-scores at publish time with a sibling function that
 * takes those two inputs. Returns the integer-rounded score + the component
 * breakdown (stored on HotEvent.saliency_breakdown for the FR-3 sort-reason
 * chip and for 7.4 incremental re-scoring).
 */
export function scoreSaliency(input: SaliencyInput): SaliencyResult {
  const breadth = breadthPoints(input.distinctSourceCount);
  const velocity = velocityPoints(input.distinctSourceCount, input.spanMs);
  const breakdown: SaliencyBreakdown = {
    breadth,
    velocity,
    marketReaction: 0, // Story 7.4 folds in at publish time
    association: 0, // Story 7.4 folds in at publish time
    total: 0,
  };
  breakdown.total = Math.round(breadth + velocity);
  return { score: breakdown.total, breakdown };
}

/**
 * The publish-gate tier for a scored candidate (Story 7.3). Pure function of
 * score; the relevance label is consulted by the caller to decide reject vs
 * hold (relevance=fail rejects regardless of tier).
 *   < LOW    → "reject-tier" (weak)
 *   < HIGH   → "hold-tier"   (operator review)
 *   ≥ HIGH   → "publish-tier" (auto-publish eligible)
 */
export type SaliencyTier = "reject-tier" | "hold-tier" | "publish-tier";

export function saliencyTier(score: number): SaliencyTier {
  if (score < SALIENCY_LOW_THRESHOLD) return "reject-tier";
  if (score < SALIENCY_HIGH_THRESHOLD) return "hold-tier";
  return "publish-tier";
}
