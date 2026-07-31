import {
  FundDisclosureStatus,
  FundType,
} from "../../src/modules/fund-concentration/types.js";
import type {
  FundHolding,
  FundQuarterlyReport,
  FundSampleCandidate,
} from "../../src/modules/fund-concentration/types.js";

const regulatorySource = {
  id: "fixture-regulatory-source",
  name: "De-identified regulatory filing",
  tier: "regulatory_filing" as const,
  documentationUrl: null,
};

const fundHouseSource = {
  id: "fixture-fund-house-source",
  name: "De-identified official fund report",
  tier: "official_fund_report" as const,
  documentationUrl: null,
};

const snapshot = (id: string) => ({
  id,
  capturedAt: "2024-04-23T00:00:00.000Z",
  contentHash: `sha256-${id}`,
  uri: `fixture://${id}`,
});

export const FUND_SAMPLE_FIXTURE: readonly FundSampleCandidate[] = [
  {
    fundKey: "fund-alpha",
    displayCode: "MASKED-A-A",
    shareClass: "A",
    type: FundType.ActiveEquity,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-alpha",
    displayCode: "MASKED-A-C",
    shareClass: "C",
    type: FundType.ActiveEquity,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-beta",
    displayCode: "MASKED-B",
    shareClass: "A",
    type: FundType.PartialStockMixed,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-index",
    displayCode: "MASKED-I",
    shareClass: "A",
    type: FundType.Index,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-bond",
    displayCode: "MASKED-BOND",
    shareClass: "A",
    type: FundType.Bond,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-closed",
    displayCode: "MASKED-CLOSED",
    shareClass: "A",
    type: FundType.ActiveEquity,
    closed: true,
    disclosureQualified: true,
  },
  {
    fundKey: "fund-unqualified",
    displayCode: "MASKED-U",
    shareClass: "A",
    type: FundType.ActiveEquity,
    closed: false,
    disclosureQualified: false,
  },
  {
    fundKey: "fund-qdii",
    displayCode: "MASKED-Q",
    shareClass: "A",
    type: FundType.Qdii,
    closed: false,
    disclosureQualified: true,
  },
  {
    fundKey: "",
    displayCode: "MASKED-NOKEY",
    shareClass: "A",
    type: FundType.ActiveEquity,
    closed: false,
    disclosureQualified: true,
  },
];

const alphaHoldings: readonly FundHolding[] = [
  {
    securityKey: "security-01",
    quantity: 100,
    marketValue: 500,
    weight: 0.25,
    holderFundCount: 3,
    industryCode: "industry-tech",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-01",
    quantity: 20,
    marketValue: 100,
    weight: 0.05,
    holderFundCount: 3,
    industryCode: "industry-tech",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-02",
    quantity: 80,
    marketValue: 400,
    weight: 0.2,
    holderFundCount: 5,
    industryCode: "industry-finance",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-03",
    quantity: 40,
    marketValue: 200,
    weight: 0.1,
    holderFundCount: 2,
    industryCode: "industry-tech",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-04",
    quantity: 20,
    marketValue: 100,
    weight: 0.05,
    holderFundCount: 1,
    industryCode: "industry-health",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-05",
    quantity: 20,
    marketValue: 100,
    weight: 0.05,
    holderFundCount: 4,
    industryCode: "industry-finance",
    industryClassificationVersion: "classification-v1",
  },
  {
    securityKey: "security-06",
    quantity: 20,
    marketValue: 100,
    weight: 0.05,
    holderFundCount: 2,
    industryCode: "industry-health",
    industryClassificationVersion: "classification-v1",
  },
];

const reportDefaults = {
  observedAt: "2024-03-31T23:59:59.999Z",
  asOf: "2024-04-23T00:00:00.000Z",
  revision: 1,
  samplePolicyVersion: "active-equity-partial-stock-v1",
  status: FundDisclosureStatus.Available,
  statusReason: null,
  source: regulatorySource,
  snapshot: snapshot("alpha-q1-r1"),
  processingVersion: "fund-baseline-v1",
  holdings: alphaHoldings,
} satisfies Omit<FundQuarterlyReport, "id" | "fundKey" | "publishedAt">;

export const FUND_REPORT_FIXTURE: readonly FundQuarterlyReport[] = [
  {
    ...reportDefaults,
    id: "report-alpha-q1-r1",
    fundKey: "fund-alpha",
    publishedAt: "2024-04-23T00:00:00.000Z",
  },
  {
    ...reportDefaults,
    id: "report-alpha-q1-r2",
    fundKey: "fund-alpha",
    publishedAt: "2024-05-23T00:00:00.000Z",
    asOf: "2024-05-23T00:00:00.000Z",
    revision: 2,
    snapshot: snapshot("alpha-q1-r2"),
    holdings: alphaHoldings.map((holding) =>
      holding.securityKey === "security-02"
        ? { ...holding, marketValue: 420, weight: 0.21 }
        : holding,
    ),
  },
  {
    ...reportDefaults,
    id: "report-beta-q1-r1",
    fundKey: "fund-beta",
    publishedAt: "2024-04-24T00:00:00.000Z",
    asOf: "2024-04-24T00:00:00.000Z",
    source: fundHouseSource,
    snapshot: snapshot("beta-q1-r1"),
    status: FundDisclosureStatus.Partial,
    statusReason: "部分股票持仓字段缺少逐证券价格序列。",
    holdings: [
      ...alphaHoldings.slice(0, 3).map((holding) => ({
        ...holding,
        industryClassificationVersion: "classification-v1",
      })),
      {
        securityKey: "security-missing-quantity",
        quantity: null,
        marketValue: 80,
        weight: 0.04,
        holderFundCount: 1,
        industryCode: "industry-tech",
        industryClassificationVersion: "classification-v1",
      },
    ],
  },
  {
    ...reportDefaults,
    id: "report-alpha-q2-r1",
    fundKey: "fund-alpha",
    observedAt: "2024-06-30T23:59:59.999Z",
    publishedAt: "2024-07-23T00:00:00.000Z",
    asOf: "2024-07-23T00:00:00.000Z",
    snapshot: snapshot("alpha-q2-r1"),
    holdings: alphaHoldings.map((holding) => ({
      ...holding,
      industryClassificationVersion: "classification-v2",
    })),
  },
  {
    ...reportDefaults,
    id: "report-late-q2-r1",
    fundKey: "fund-beta",
    observedAt: "2024-06-30T23:59:59.999Z",
    publishedAt: "2024-07-24T00:00:00.000Z",
    asOf: "2024-07-24T00:00:00.000Z",
    snapshot: snapshot("beta-q2-r1"),
  },
  {
    ...reportDefaults,
    id: "report-missing-q1",
    fundKey: "fund-missing",
    publishedAt: "2024-04-25T00:00:00.000Z",
    asOf: "2024-04-25T00:00:00.000Z",
    status: FundDisclosureStatus.Unavailable,
    statusReason: "原始报告快照不可得。",
    source: null,
    snapshot: null,
    holdings: [],
  },
  {
    ...reportDefaults,
    id: "report-gapped-q1-r2",
    fundKey: "fund-gapped",
    publishedAt: "2024-04-26T00:00:00.000Z",
    asOf: "2024-04-26T00:00:00.000Z",
    revision: 2,
    snapshot: snapshot("gapped-q1-r2"),
  },
];
