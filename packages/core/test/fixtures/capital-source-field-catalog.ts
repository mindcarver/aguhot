/**
 * Small, deterministic expectations for the Issue #43 catalog self-check.
 * This fixture contains no live data and intentionally records only contract
 * shape, stable keys and one unchanged source mapping.
 */
export const CAPITAL_METRIC_CATALOG_EXPECTED_KEYS = [
  "global-growth",
  "global-inflation",
  "global-liquidity",
  "global-funding-price",
  "global-risk-credit",
  "global-market-breadth",
  "global-institutional-positioning",
  "us-growth",
  "us-inflation",
  "us-liquidity",
  "us-funding-price",
  "us-risk-credit",
  "us-market-breadth",
  "us-institutional-positioning",
  "cn-growth",
  "cn-inflation",
  "cn-liquidity",
  "cn-funding-price",
  "cn-risk-credit",
  "cn-market-breadth",
  "cn-institutional-positioning",
  "kr-growth",
  "kr-inflation",
  "kr-liquidity",
  "kr-funding-price",
  "kr-risk-credit",
  "kr-market-breadth",
  "kr-institutional-positioning",
] as const;
