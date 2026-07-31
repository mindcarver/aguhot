/**
 * FR-009 interpretable text conclusion generator (Issue #58).
 *
 * Produces a structured environment summary from a #55 replay result. The
 * conclusion is evidence-constrained: it distinguishes observed facts,
 * computed results, system interpretation, and unknown states — and it NEVER
 * produces a single total score, deterministic bull/bear verdict, buy/sell
 * recommendation, target price, or target position (PRD hard constraint).
 *
 * Pure function — no I/O, no random, deterministic. Designed for selfcheck
 * verification of the FR-009 constraints (A4/A5).
 */

import type {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "@aguhot/core";
import { CapitalAvailability as Avail, CapitalDimension as Dim, CapitalMarket as Mkt } from "@aguhot/core";
import type { CapitalReplayResult } from "@aguhot/core";

/** Human labels for the four markets and seven dimensions (Chinese, per PRD). */
const MARKET_LABELS: Record<CapitalMarket, string> = {
  [Mkt.Global]: "全球",
  [Mkt.UnitedStates]: "美国",
  [Mkt.China]: "中国",
  [Mkt.Korea]: "韩国",
};

const DIMENSION_LABELS: Record<CapitalDimension, string> = {
  [Dim.Growth]: "增长",
  [Dim.Inflation]: "通胀",
  [Dim.Liquidity]: "流动性",
  [Dim.FundingPrice]: "资金价格",
  [Dim.RiskCredit]: "风险偏好与信用",
  [Dim.MarketBreadth]: "市场宽度",
  [Dim.InstitutionalPositioning]: "机构持仓与拥挤度",
};

/** Coarse coverage label for a dimension, surfaced honestly. */
function availabilityLabel(availability: CapitalAvailability): string {
  switch (availability) {
    case Avail.Available:
      return "可得";
    case Avail.Partial:
      return "部分可得";
    case Avail.Unknown:
      return "未知";
    case Avail.Failed:
      return "采集失败";
    case Avail.PendingReview:
      return "待复核";
    case Avail.IncompleteReconstruction:
      return "无法完整还原";
    default:
      return "未知";
  }
}

/** One sentence per non-empty dimension, distinguishing fact vs unknown. */
export interface CapitalConclusionDimensionLine {
  readonly market: CapitalMarket;
  readonly dimension: CapitalDimension;
  /** "observed" when a value is present, "unknown" when degraded. */
  readonly kind: "observed" | "unknown";
  readonly text: string;
}

export interface CapitalConclusion {
  /** Overall coverage sentence (e.g. "全球总览：部分覆盖，3/4 市场有可得数据"). */
  readonly overview: string;
  /** Per-dimension lines, one per non-empty market/dimension cell. */
  readonly dimensions: readonly CapitalConclusionDimensionLine[];
  /** Honest note that this is research aid, not investment advice (PRD). */
  readonly disclaimer: string;
}

const FORBIDDEN_TERMS = [
  "买入",
  "卖出",
  "建议买",
  "建议卖",
  "目标价",
  "目标仓位",
  "牛熊分数",
  "总分",
  "确定牛",
  "确定熊",
  "必然涨",
  "必然跌",
] as const;

/**
 * Assert the generated text never contains a forbidden advisory term. Exported
 * so the selfcheck and the page can both enforce the PRD constraint.
 */
export function assertNoForbiddenTerms(text: string): void {
  const hit = FORBIDDEN_TERMS.find((term) => text.includes(term));
  if (hit !== undefined) {
    throw new Error(`FR-009 violation: conclusion contains forbidden term "${hit}"`);
  }
}

function formatValue(value: number, unit: string | null): string {
  const rounded = Math.round(value * 100) / 100;
  return unit === null ? String(rounded) : `${rounded} ${unit}`;
}

/**
 * Build an evidence-constrained conclusion from a replay result. Pure and
 * deterministic. Each dimension line is either an observed fact (with value +
 * source) or an explicit unknown — never a zero-fill and never an advisory.
 */
export function buildCapitalConclusion(replay: CapitalReplayResult): CapitalConclusion {
  const dimensionLines: CapitalConclusionDimensionLine[] = [];

  for (const market of replay.markets) {
    for (const dim of market.dimensions) {
      const valueRecord = dim.records.find((r) => r.value !== null);
      if (valueRecord !== undefined && dim.availability === Avail.Available) {
        dimensionLines.push({
          market: market.market,
          dimension: dim.dimension,
          kind: "observed",
          text: `${MARKET_LABELS[market.market]}${DIMENSION_LABELS[dim.dimension]}：观测值 ${formatValue(valueRecord.value!, valueRecord.unit)}（来源 ${valueRecord.source.id}，发布于 ${valueRecord.publishedAt?.slice(0, 10) ?? "未知"}）`,
        });
      } else {
        dimensionLines.push({
          market: market.market,
          dimension: dim.dimension,
          kind: "unknown",
          text: `${MARKET_LABELS[market.market]}${DIMENSION_LABELS[dim.dimension]}：${availabilityLabel(dim.availability)}${dim.statusReason ? `（${dim.statusReason}）` : ""}`,
        });
      }
    }
  }

  const marketsWithAvailable = replay.markets.filter(
    (m) => m.availability === Avail.Available || m.availability === Avail.Partial,
  ).length;
  const coverage =
    marketsWithAvailable === 0
      ? "无可得数据"
      : marketsWithAvailable === replay.markets.length
        ? "完全覆盖"
        : `部分覆盖，${marketsWithAvailable}/${replay.markets.length} 市场有可得数据`;

  const overview = `截至 ${replay.asOf.slice(0, 10)} 的资本环境：${coverage}。以下为各市场维度的可观测状态，区分已观测事实与未知。`;

  const disclaimer =
    "以上为证据约束下的环境解释与研究辅助，不代表未来收益、因果关系或投资建议。";

  // Enforce the FR-009 constraint on every generated string.
  const allText = [overview, disclaimer, ...dimensionLines.map((l) => l.text)].join(" ");
  assertNoForbiddenTerms(allText);

  return { overview, dimensions: dimensionLines, disclaimer };
}
