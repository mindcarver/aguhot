import {
  FundDisclosureStatus,
  IndustryClassificationStatus,
} from "./types.js";
import type {
  ConcentrationMetrics,
  FundHolding,
  FundQuarterlyReport,
  NormalizedFundHolding,
} from "./types.js";

interface HoldingAccumulator {
  securityKey: string;
  rows: FundHolding[];
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function uniqueNonEmpty(values: readonly (string | null)[]): string | null {
  if (values.some((value) => value === null || value.trim() === "")) return null;
  const unique = new Set(
    values.filter((value): value is string => value !== null && value.trim() !== ""),
  );
  return unique.size === 1 ? [...unique][0]! : null;
}

/**
 * Merge duplicate security rows before any concentration calculation. Quantity,
 * market value, and weight are additive only when every duplicate row supplies
 * the field; otherwise the field remains null. Holder count is a security-level
 * count and therefore uses the largest disclosed value rather than double
 * counting duplicate share rows.
 */
export function dedupeFundHoldings(
  holdings: readonly FundHolding[],
): NormalizedFundHolding[] {
  const grouped = new Map<string, HoldingAccumulator>();
  for (const holding of holdings) {
    const bucket = grouped.get(holding.securityKey);
    if (bucket) bucket.rows.push(holding);
    else grouped.set(holding.securityKey, { securityKey: holding.securityKey, rows: [holding] });
  }

  return [...grouped.values()]
    .sort((a, b) => a.securityKey.localeCompare(b.securityKey))
    .map(({ securityKey, rows }) => ({
      securityKey,
      quantity: sumOrNull(rows.map((row) => row.quantity)),
      marketValue: sumOrNull(rows.map((row) => row.marketValue)),
      weight: sumOrNull(rows.map((row) => row.weight)),
      holderFundCount: rows.every((row) => row.holderFundCount === null)
        ? null
        : Math.max(...rows.map((row) => row.holderFundCount ?? 0)),
      industryCode: uniqueNonEmpty(rows.map((row) => row.industryCode)),
      industryClassificationVersion: uniqueNonEmpty(
        rows.map((row) => row.industryClassificationVersion),
      ),
      sourceRowCount: rows.length,
    }));
}

/** Normalize reported weights to the observed, non-null stock holding total. */
export function normalizeFundHoldings(
  holdings: readonly FundHolding[],
): { holdings: NormalizedFundHolding[]; totalReportedWeight: number } {
  const deduped = dedupeFundHoldings(holdings);
  const totalReportedWeight = deduped.reduce(
    (sum, holding) => sum + (holding.weight ?? 0),
    0,
  );
  if (totalReportedWeight <= 0) {
    return { holdings: deduped.map((holding) => ({ ...holding })), totalReportedWeight };
  }

  return {
    totalReportedWeight,
    holdings: deduped.map((holding) => ({
      ...holding,
      weight:
        holding.weight === null ? null : holding.weight / totalReportedWeight,
    })),
  };
}

function topNWeight(holdings: readonly NormalizedFundHolding[], n: number): number | null {
  const weights = holdings
    .map((holding) => holding.weight)
    .filter((weight): weight is number => weight !== null)
    .sort((a, b) => b - a);
  if (weights.length === 0) return null;
  return weights.slice(0, n).reduce((sum, weight) => sum + weight, 0);
}

function industryVersion(
  holdings: readonly NormalizedFundHolding[],
  expectedVersion: string | undefined,
): {
  version: string | null;
  status: IndustryClassificationStatus;
} {
  const versions = holdings
    .filter((holding) => holding.industryCode !== null && (holding.weight ?? 0) > 0)
    .map((holding) => holding.industryClassificationVersion)
    .filter((version): version is string => version !== null && version.trim() !== "");
  if (versions.length === 0) {
    return {
      version: null,
      status: expectedVersion
        ? IndustryClassificationStatus.Mismatch
        : IndustryClassificationStatus.Unavailable,
    };
  }
  const distinct = [...new Set(versions)].sort();
  if (distinct.length !== 1) {
    return { version: null, status: IndustryClassificationStatus.Mixed };
  }
  if (expectedVersion !== undefined && distinct[0] !== expectedVersion) {
    return { version: distinct[0]!, status: IndustryClassificationStatus.Mismatch };
  }
  return { version: distinct[0]!, status: IndustryClassificationStatus.Consistent };
}

/**
 * Calculate deterministic concentration measures over one report or an
 * already-aggregated sample. CR values use normalized observed stock weight;
 * industry HHI first normalizes to classified weight and is withheld when the
 * classification version is mixed or does not match the requested version.
 */
export function calculateConcentrationMetrics(
  holdings: readonly FundHolding[],
  options: { expectedIndustryClassificationVersion?: string } = {},
): ConcentrationMetrics {
  const normalized = normalizeFundHoldings(holdings);
  const rows = normalized.holdings;
  const numericRows = rows.filter((holding) => holding.weight !== null);
  const version = industryVersion(rows, options.expectedIndustryClassificationVersion);
  const classified = rows.filter(
    (holding) =>
      holding.weight !== null &&
      holding.weight > 0 &&
      holding.industryCode !== null &&
      holding.industryClassificationVersion !== null,
  );
  const classifiedWeight = classified.reduce(
    (sum, holding) => sum + (holding.weight ?? 0),
    0,
  );
  const unclassifiedWeight = numericRows.reduce(
    (sum, holding) =>
      sum + (holding.industryCode === null || holding.industryClassificationVersion === null
        ? holding.weight ?? 0
        : 0),
    0,
  );

  let industryHhi: number | null = null;
  let effectiveIndustryCount: number | null = null;
  let observedIndustryCount = 0;
  if (
    classifiedWeight > 0 &&
    version.status === IndustryClassificationStatus.Consistent
  ) {
    const industries = new Map<string, number>();
    for (const holding of classified) {
      const code = holding.industryCode!;
      industries.set(code, (industries.get(code) ?? 0) + (holding.weight ?? 0));
    }
    observedIndustryCount = [...industries.values()].filter((weight) => weight > 0).length;
    industryHhi = [...industries.values()].reduce(
      (sum, weight) => sum + (weight / classifiedWeight) ** 2,
      0,
    );
    effectiveIndustryCount = industryHhi > 0 ? 1 / industryHhi : null;
  } else {
    observedIndustryCount = new Set(
      classified.map((holding) => holding.industryCode!),
    ).size;
  }

  return {
    holdings: rows,
    totalReportedWeight: normalized.totalReportedWeight,
    cr5: topNWeight(rows, 5),
    cr10: topNWeight(rows, 10),
    cr20: topNWeight(rows, 20),
    industryHhi,
    observedIndustryCount,
    effectiveIndustryCount,
    classifiedWeight,
    unclassifiedWeight,
    industryClassificationVersion: version.version,
    industryClassificationStatus: version.status,
  };
}

export function aggregateReportHoldings(
  reports: readonly FundQuarterlyReport[],
): FundHolding[] {
  const available = reports.filter(
    (report) =>
      report.status === FundDisclosureStatus.Available ||
      report.status === FundDisclosureStatus.Partial,
  );
  return available.flatMap((report) => report.holdings);
}
