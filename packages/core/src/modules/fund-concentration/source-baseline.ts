import { FundSourceTier } from "./types.js";
import type { FundSourceBaseline, FundSourceReference } from "./types.js";

/**
 * Source order for the V1 baseline. The list describes provenance and
 * readiness only; it intentionally does not fetch or transform any source.
 */
export const FUND_SOURCE_BASELINE: readonly FundSourceBaseline[] = [
  {
    id: "cn-regulatory-filing",
    provider: "China Securities Regulatory Commission / designated disclosure portal",
    dataset: "Public-fund quarterly reports and regulatory disclosures",
    tier: FundSourceTier.RegulatoryFiling,
    snapshotCapability: true,
    publicationDateCapability: "explicit",
    readiness: "partial",
    documentationUrl: "https://www.csrc.gov.cn/",
    notes:
      "Prioritize a filed report with an explicit publication date and retain its immutable response snapshot.",
  },
  {
    id: "cn-fund-house-report",
    provider: "Fund management company",
    dataset: "Official active-equity and partial-stock mixed quarterly reports",
    tier: FundSourceTier.OfficialFundReport,
    snapshotCapability: true,
    publicationDateCapability: "explicit",
    readiness: "partial",
    documentationUrl: null,
    notes:
      "Use the official fund report when the regulatory copy is unavailable; do not infer a vintage from observation date.",
  },
  {
    id: "cn-public-disclosure",
    provider: "Public disclosure archive",
    dataset: "Archived public-fund holdings disclosures",
    tier: FundSourceTier.PublicDisclosure,
    snapshotCapability: true,
    publicationDateCapability: "explicit",
    readiness: "planned",
    documentationUrl: null,
    notes:
      "A public archive is acceptable only when the original document and publication timestamp are retained.",
  },
];

export function listFundSourceBaseline(): FundSourceBaseline[] {
  return FUND_SOURCE_BASELINE.map((source) => ({ ...source }));
}

const SOURCE_TIER_ORDER: readonly FundSourceTier[] = [
  FundSourceTier.RegulatoryFiling,
  FundSourceTier.OfficialFundReport,
  FundSourceTier.OfficialProvider,
  FundSourceTier.PublicDisclosure,
  FundSourceTier.Secondary,
];

export function fundSourcePriority(tier: FundSourceTier): number {
  return SOURCE_TIER_ORDER.indexOf(tier);
}

/** Stable source priority ordering; ties are resolved by source id. */
export function sortFundSources(
  sources: readonly FundSourceReference[],
): FundSourceReference[] {
  return [...sources].sort((a, b) => {
    const rank = fundSourcePriority(a.tier) - fundSourcePriority(b.tier);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });
}
