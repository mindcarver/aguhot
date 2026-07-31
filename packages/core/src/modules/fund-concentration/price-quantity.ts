import {
  FundDisclosureStatus,
  PriceQuantityDecompositionStatus,
} from "./types.js";
import type {
  FundQuarterlyReport,
  PriceQuantityDecompositionAssessment,
} from "./types.js";

/**
 * Quantity and market value are disclosed fields, but this baseline has no
 * security price/vintage series. Therefore a change in value cannot be
 * attributed to price versus quantity; callers must display this status rather
 * than implying a decomposition.
 */
export function assessPriceQuantityDecomposition(
  previous: FundQuarterlyReport | null,
  current: FundQuarterlyReport,
): PriceQuantityDecompositionAssessment {
  if (
    current.status !== FundDisclosureStatus.Available &&
    current.status !== FundDisclosureStatus.Partial
  ) {
    return {
      status: PriceQuantityDecompositionStatus.Unavailable,
      reason: "当前披露不可用，无法比较持仓市值和持股数量。",
    };
  }
  if (previous === null) {
    return {
      status: PriceQuantityDecompositionStatus.NotApplicable,
      reason: "缺少上一披露期，无法计算持仓变化。",
    };
  }
  if (
    previous.status !== FundDisclosureStatus.Available &&
    previous.status !== FundDisclosureStatus.Partial
  ) {
    return {
      status: PriceQuantityDecompositionStatus.Unavailable,
      reason: "上一披露期不可用，无法比较持仓市值和持股数量。",
    };
  }
  return {
    status: PriceQuantityDecompositionStatus.NotDecomposable,
    reason:
      "当前样本没有逐证券价格序列和可比估值快照；持仓市值变化的价格效应与数量效应不可拆分。",
  };
}
