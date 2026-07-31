/**
 * Deterministic acceptance checks for Issue #44's fund sample baseline.
 *
 * Run with:
 *   pnpm --filter @aguhot/core exec tsx src/modules/fund-concentration/fund-concentration.selfcheck.ts
 *
 * The fixture is de-identified and contains no network or database dependency.
 */

import {
  assessPriceQuantityDecomposition,
  buildFundSample,
  calculateConcentrationMetrics,
  compareReportClassificationVersions,
  dedupeFundHoldings,
  FundDisclosureStatus,
  FundSampleExclusionReason,
  FundSourceTier,
  FUND_SAMPLE_POLICY_VERSION,
  FUND_SOURCE_BASELINE,
  fundReportKey,
  selectFundReportsAt,
  sortFundSources,
  validateFundQuarterlyReport,
} from "./index.js";
import type {
  FundSourceReference,
} from "./types.js";
import { FUND_REPORT_FIXTURE, FUND_SAMPLE_FIXTURE } from "../../../test/fixtures/fund-concentration.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];
const sample = buildFundSample(FUND_SAMPLE_FIXTURE);
const aprilReports = selectFundReportsAt(
  FUND_REPORT_FIXTURE,
  "2024-04-30T23:59:59.999Z",
);
const juneReports = selectFundReportsAt(
  FUND_REPORT_FIXTURE,
  "2024-06-01T23:59:59.999Z",
);
const alphaApril = aprilReports.find((report) => report.fundKey === "fund-alpha");
const alphaJune = juneReports.find((report) => report.fundKey === "fund-alpha");
const betaApril = aprilReports.find((report) => report.fundKey === "fund-beta");
const gappedApril = aprilReports.find((report) => report.fundKey === "fund-gapped");
const missingApril = aprilReports.find((report) => report.fundKey === "fund-missing");

assertions.push({
  name: "A1 includes only active-equity/partial-stock funds and dedupes share classes",
  ok:
    sample.policyVersion === FUND_SAMPLE_POLICY_VERSION &&
    sample.included.map((candidate) => candidate.fundKey).join(",") ===
      "fund-alpha,fund-beta" &&
    sample.decisions.some(
      (decision) =>
        decision.candidate.displayCode === "MASKED-A-C" &&
        decision.reason === FundSampleExclusionReason.DuplicateFundShare,
    ) &&
    sample.decisions.some(
      (decision) =>
        decision.candidate.fundKey === "fund-index" &&
        decision.reason === FundSampleExclusionReason.UnsupportedFundType,
    ) &&
    sample.decisions.some(
      (decision) =>
        decision.candidate.fundKey === "fund-closed" &&
        decision.reason === FundSampleExclusionReason.ClosedFund,
    ) &&
    sample.decisions.some(
      (decision) =>
        decision.candidate.fundKey === "fund-unqualified" &&
        decision.reason === FundSampleExclusionReason.UnqualifiedDisclosure,
    ) &&
    sample.decisions.some(
      (decision) =>
        decision.candidate.displayCode === "MASKED-NOKEY" &&
        decision.reason === FundSampleExclusionReason.PendingReview,
    ),
  detail: JSON.stringify(sample),
});

const invalidReports = FUND_REPORT_FIXTURE.flatMap((report) =>
  validateFundQuarterlyReport(report).map((error) => `${report.id}: ${error}`),
);
assertions.push({
  name: "A2 reports carry quarter-end observedAt, publication/as-of, source snapshot, and processing version",
  ok:
    invalidReports.length === 0 &&
    alphaApril?.observedAt === "2024-03-31T23:59:59.999Z" &&
    alphaApril.publishedAt === "2024-04-23T00:00:00.000Z" &&
    alphaApril.asOf === "2024-04-23T00:00:00.000Z" &&
    alphaApril.source?.id === "fixture-regulatory-source" &&
    alphaApril.snapshot?.contentHash === "sha256-alpha-q1-r1" &&
    alphaApril.processingVersion === "fund-baseline-v1",
  detail: JSON.stringify(invalidReports),
});

const deduped = alphaApril ? dedupeFundHoldings(alphaApril.holdings) : [];
const firstHolding = deduped.find((holding) => holding.securityKey === "security-01");
const nullMetadataDuplicate = dedupeFundHoldings([
  {
    ...FUND_REPORT_FIXTURE[0]!.holdings[0]!,
    industryCode: null,
    industryClassificationVersion: null,
  },
  FUND_REPORT_FIXTURE[0]!.holdings[0]!,
])[0];
const missingQuantity = betaApril?.holdings.find(
  (holding) => holding.securityKey === "security-missing-quantity",
);
assertions.push({
  name: "A3 holding fields are typed and duplicate security rows merge without double-counting holder funds",
  ok:
    firstHolding?.sourceRowCount === 2 &&
    firstHolding.quantity === 120 &&
    firstHolding.marketValue === 600 &&
    firstHolding.weight === 0.3 &&
    firstHolding.holderFundCount === 3 &&
    firstHolding.industryClassificationVersion === "classification-v1" &&
    betaApril?.status === "partial" &&
    missingQuantity?.quantity === null &&
    nullMetadataDuplicate?.industryCode === null &&
    nullMetadataDuplicate.industryClassificationVersion === null,
  detail: JSON.stringify({ firstHolding, missingQuantity, nullMetadataDuplicate }),
});

const metrics = alphaApril
  ? calculateConcentrationMetrics(alphaApril.holdings, {
      expectedIndustryClassificationVersion: "classification-v1",
    })
  : null;
const close = (actual: number | null, expected: number): boolean =>
  actual !== null && Math.abs(actual - expected) < 1e-9;
assertions.push({
  name: "A4 CR5/10/20, HHI, and effective industry count use deterministic normalized formulas",
  ok:
    metrics !== null &&
    close(metrics.totalReportedWeight, 0.75) &&
    close(metrics.cr5, 14 / 15) &&
    close(metrics.cr10, 1) &&
    close(metrics.cr20, 1) &&
    close(metrics.industryHhi, 31 / 75) &&
    close(metrics.effectiveIndustryCount, 75 / 31) &&
    metrics.observedIndustryCount === 3 &&
    close(metrics.classifiedWeight, 1) &&
    close(metrics.unclassifiedWeight, 0) &&
    metrics.industryClassificationVersion === "classification-v1" &&
    metrics.industryClassificationStatus === "consistent",
  detail: JSON.stringify(metrics),
});

assertions.push({
  name: "A5 cutoff, revision, classification-version, and price/quantity flags are explicit",
  ok:
    alphaApril?.revisionSelection === "original" &&
    alphaJune?.revisionSelection === "revised" &&
    !aprilReports.some((report) => report.id === "report-alpha-q2-r1") &&
    gappedApril?.status === FundDisclosureStatus.IncompleteReconstruction &&
    missingApril?.status === FundDisclosureStatus.Unavailable &&
    compareReportClassificationVersions(
      FUND_REPORT_FIXTURE[0]!,
      FUND_REPORT_FIXTURE[3]!,
    ) === "changed" &&
    compareReportClassificationVersions(
      FUND_REPORT_FIXTURE[0]!,
      {
        ...FUND_REPORT_FIXTURE[0]!,
        holdings: FUND_REPORT_FIXTURE[0]!.holdings.map((holding, index) =>
          index === 0
            ? { ...holding, industryClassificationVersion: null }
            : holding,
        ),
      },
    ) === "unknown" &&
    assessPriceQuantityDecomposition(FUND_REPORT_FIXTURE[0]!, FUND_REPORT_FIXTURE[1]!).status ===
      "not_decomposable" &&
    assessPriceQuantityDecomposition(null, FUND_REPORT_FIXTURE[0]!).status ===
      "not_applicable",
  detail: JSON.stringify({
    april: alphaApril,
    june: alphaJune,
    gapped: gappedApril,
    missing: missingApril,
  }),
});

const sourceReferences: FundSourceReference[] = [
  {
    id: "secondary",
    name: "secondary",
    tier: FundSourceTier.Secondary,
    documentationUrl: null,
  },
  {
    id: "official",
    name: "official",
    tier: FundSourceTier.OfficialFundReport,
    documentationUrl: null,
  },
  {
    id: "regulatory",
    name: "regulatory",
    tier: FundSourceTier.RegulatoryFiling,
    documentationUrl: null,
  },
];
const sortedSources = sortFundSources(sourceReferences);
const firstRun = JSON.stringify({
  sample,
  reports: aprilReports,
  metrics,
  keys: FUND_REPORT_FIXTURE.map(fundReportKey),
});
const secondRun = JSON.stringify({
  sample: buildFundSample([...FUND_SAMPLE_FIXTURE].reverse()),
  reports: selectFundReportsAt([...FUND_REPORT_FIXTURE].reverse(), "2024-04-30T23:59:59.999Z"),
  metrics: alphaApril
    ? calculateConcentrationMetrics([...alphaApril.holdings].reverse(), {
        expectedIndustryClassificationVersion: "classification-v1",
      })
    : null,
  keys: FUND_REPORT_FIXTURE.map(fundReportKey),
});
assertions.push({
  name: "A6 official/regulatory evidence is prioritized and repeated runs are byte-stable",
  ok:
    FUND_SOURCE_BASELINE.some((source) => source.tier === FundSourceTier.RegulatoryFiling) &&
    sortedSources.map((source) => source.tier).join(",") ===
      `${FundSourceTier.RegulatoryFiling},${FundSourceTier.OfficialFundReport},${FundSourceTier.Secondary}` &&
    firstRun === secondRun,
  detail: JSON.stringify({ sortedSources, stable: firstRun === secondRun }),
});

const failed = assertions.filter((assertion) => !assertion.ok);
for (const assertion of assertions) {
  console.log(
    `${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`,
  );
}
if (failed.length > 0) {
  console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed.`);
  process.exit(1);
}
console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
