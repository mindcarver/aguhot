/**
 * Auditable baseline types for Chinese public-fund concentration research.
 *
 * This module is deliberately persistence- and provider-agnostic. It defines
 * the sample policy, disclosure evidence, and calculation inputs that an
 * adapter may later persist. No network fetch or production writer belongs
 * here.
 */

export const FundType = {
  ActiveEquity: "active_equity",
  PartialStockMixed: "partial_stock_mixed",
  Index: "index",
  Bond: "bond",
  Monetary: "monetary",
  Fof: "fof",
  Qdii: "qdii",
  Other: "other",
} as const;

export type FundType = (typeof FundType)[keyof typeof FundType];

export const FundDisclosureStatus = {
  Available: "available",
  Partial: "partial",
  Unavailable: "unavailable",
  Failed: "failed",
  PendingReview: "pending_review",
  IncompleteReconstruction: "incomplete_reconstruction",
} as const;

export type FundDisclosureStatus =
  (typeof FundDisclosureStatus)[keyof typeof FundDisclosureStatus];

export const FundSourceTier = {
  RegulatoryFiling: "regulatory_filing",
  OfficialFundReport: "official_fund_report",
  OfficialProvider: "official_provider",
  PublicDisclosure: "public_disclosure",
  Secondary: "secondary",
} as const;

export type FundSourceTier = (typeof FundSourceTier)[keyof typeof FundSourceTier];

export interface FundSourceReference {
  id: string;
  name: string;
  tier: FundSourceTier;
  documentationUrl: string | null;
}

/** A saved, immutable source response or document snapshot. */
export interface FundSnapshotEvidence {
  id: string;
  capturedAt: string;
  contentHash: string;
  uri: string | null;
}

/** One candidate fund before the sample policy is applied. */
export interface FundSampleCandidate {
  /** Stable underlying fund identity; share classes use the same fundKey. */
  fundKey: string;
  /** Provider/display code is retained only as evidence, not as identity. */
  displayCode: string;
  shareClass: string;
  type: FundType;
  closed: boolean;
  disclosureQualified: boolean;
}

export const FundSampleExclusionReason = {
  Included: "included",
  UnsupportedFundType: "unsupported_fund_type",
  ClosedFund: "closed_fund",
  UnqualifiedDisclosure: "unqualified_disclosure",
  DuplicateFundShare: "duplicate_fund_share",
  PendingReview: "pending_review",
} as const;

export type FundSampleExclusionReason =
  (typeof FundSampleExclusionReason)[keyof typeof FundSampleExclusionReason];

export interface FundSampleDecision {
  candidate: FundSampleCandidate;
  included: boolean;
  reason: FundSampleExclusionReason;
}

export interface FundSample {
  policyVersion: string;
  decisions: readonly FundSampleDecision[];
  included: readonly FundSampleCandidate[];
}

/**
 * A normalized holding row from one fund's quarterly report.
 *
 * Null is intentional: a source may disclose the row but omit one field. It
 * must then remain unavailable instead of being coerced to zero.
 */
export interface FundHolding {
  securityKey: string;
  quantity: number | null;
  marketValue: number | null;
  weight: number | null;
  holderFundCount: number | null;
  industryCode: string | null;
  industryClassificationVersion: string | null;
}

export interface FundQuarterlyReport {
  id: string;
  fundKey: string;
  /** Quarter-end UTC timestamp; this is the holding observation date. */
  observedAt: string;
  /** Provider report publication timestamp, not ingestion time. */
  publishedAt: string;
  /** Point-in-time visibility/as-of timestamp for the saved disclosure. */
  asOf: string;
  revision: number;
  samplePolicyVersion: string;
  status: FundDisclosureStatus;
  statusReason: string | null;
  source: FundSourceReference | null;
  snapshot: FundSnapshotEvidence | null;
  processingVersion: string;
  holdings: readonly FundHolding[];
}

export interface NormalizedFundHolding extends FundHolding {
  /** Number of source rows merged into this security key. */
  sourceRowCount: number;
}

export const IndustryClassificationStatus = {
  Consistent: "consistent",
  Mixed: "mixed",
  Unavailable: "unavailable",
  Mismatch: "mismatch",
} as const;

export type IndustryClassificationStatus =
  (typeof IndustryClassificationStatus)[keyof typeof IndustryClassificationStatus];

export interface ConcentrationMetrics {
  /** Holdings after duplicate security rows are merged and weights normalized. */
  holdings: readonly NormalizedFundHolding[];
  /** Sum of non-normalized, non-negative reported weights. */
  totalReportedWeight: number;
  /** Top-N shares of the normalized observed stock holdings. */
  cr5: number | null;
  cr10: number | null;
  cr20: number | null;
  /** Industry HHI over classified weight, normalized to classified weight. */
  industryHhi: number | null;
  /** Number of distinct classified industries with positive weight. */
  observedIndustryCount: number;
  /** Reciprocal of industry HHI; null when HHI cannot be established. */
  effectiveIndustryCount: number | null;
  classifiedWeight: number;
  unclassifiedWeight: number;
  industryClassificationVersion: string | null;
  industryClassificationStatus: IndustryClassificationStatus;
}

export const PriceQuantityDecompositionStatus = {
  Decomposable: "decomposable",
  NotDecomposable: "not_decomposable",
  NotApplicable: "not_applicable",
  Unavailable: "unavailable",
} as const;

export type PriceQuantityDecompositionStatus =
  (typeof PriceQuantityDecompositionStatus)[keyof typeof PriceQuantityDecompositionStatus];

export interface PriceQuantityDecompositionAssessment {
  status: PriceQuantityDecompositionStatus;
  reason: string;
}

export const RevisionSelectionStatus = {
  Original: "original",
  Revised: "revised",
  IncompleteReconstruction: "incomplete_reconstruction",
} as const;

export type RevisionSelectionStatus =
  (typeof RevisionSelectionStatus)[keyof typeof RevisionSelectionStatus];

export interface SelectedFundQuarterlyReport extends FundQuarterlyReport {
  revisionSelection: RevisionSelectionStatus;
}

export interface FundSourceBaseline {
  id: string;
  provider: string;
  dataset: string;
  tier: FundSourceTier;
  snapshotCapability: boolean;
  publicationDateCapability: "explicit" | "observation_only" | "unknown";
  readiness: "available" | "partial" | "planned";
  documentationUrl: string | null;
  notes: string;
}

const NON_VALUE_STATUSES = new Set<FundDisclosureStatus>([
  FundDisclosureStatus.Unavailable,
  FundDisclosureStatus.Failed,
  FundDisclosureStatus.PendingReview,
  FundDisclosureStatus.IncompleteReconstruction,
]);

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

function isQuarterEnd(value: string): boolean {
  const date = new Date(value);
  if (!isIsoTimestamp(value)) return false;
  const month = date.getUTCMonth();
  if (month !== 2 && month !== 5 && month !== 8 && month !== 11) return false;
  const nextDay = new Date(date.getTime() + 86_400_000);
  return nextDay.getUTCMonth() !== month;
}

function validateHolding(holding: FundHolding, index: number): string[] {
  const errors: string[] = [];
  if (!holding.securityKey.trim()) errors.push(`holdings[${index}].securityKey is required`);
  for (const [name, value] of [
    ["quantity", holding.quantity],
    ["marketValue", holding.marketValue],
    ["weight", holding.weight],
    ["holderFundCount", holding.holderFundCount],
  ] as const) {
    if (value !== null && !Number.isFinite(value)) {
      errors.push(`holdings[${index}].${name} must be finite or null`);
    }
  }
  if (holding.quantity !== null && holding.quantity < 0) {
    errors.push(`holdings[${index}].quantity must be non-negative`);
  }
  if (holding.marketValue !== null && holding.marketValue < 0) {
    errors.push(`holdings[${index}].marketValue must be non-negative`);
  }
  if (holding.weight !== null && (holding.weight < 0 || holding.weight > 1)) {
    errors.push(`holdings[${index}].weight must be between 0 and 1`);
  }
  if (
    holding.holderFundCount !== null &&
    (!Number.isInteger(holding.holderFundCount) || holding.holderFundCount < 0)
  ) {
    errors.push(`holdings[${index}].holderFundCount must be a non-negative integer or null`);
  }
  return errors;
}

/** Return contract violations without mutating the report. */
export function validateFundQuarterlyReport(
  report: FundQuarterlyReport,
): string[] {
  const errors: string[] = [];
  if (!report.id.trim()) errors.push("id is required");
  if (!report.fundKey.trim()) errors.push("fundKey is required");
  if (!isQuarterEnd(report.observedAt)) {
    errors.push("observedAt must be a quarter-end ISO timestamp");
  }
  if (!isIsoTimestamp(report.publishedAt)) errors.push("publishedAt must be an ISO timestamp");
  if (!isIsoTimestamp(report.asOf)) errors.push("asOf must be an ISO timestamp");
  if (isIsoTimestamp(report.publishedAt) && isIsoTimestamp(report.asOf)) {
    if (Date.parse(report.asOf) < Date.parse(report.publishedAt)) {
      errors.push("asOf must not precede publishedAt");
    }
  }
  if (!Number.isInteger(report.revision) || report.revision < 1) {
    errors.push("revision must be a positive integer");
  }
  if (!report.samplePolicyVersion.trim()) errors.push("samplePolicyVersion is required");
  if (!report.processingVersion.trim()) errors.push("processingVersion is required");
  for (const [index, holding] of report.holdings.entries()) {
    errors.push(...validateHolding(holding, index));
  }

  const requiresEvidence =
    report.status === FundDisclosureStatus.Available ||
    report.status === FundDisclosureStatus.Partial;
  if (requiresEvidence) {
    if (report.source === null) errors.push("available disclosures require source evidence");
    if (report.snapshot === null) errors.push("available disclosures require snapshot evidence");
    if (report.snapshot !== null) {
      if (!report.snapshot.id.trim()) errors.push("snapshot.id is required");
      if (!report.snapshot.contentHash.trim()) errors.push("snapshot.contentHash is required");
      if (!isIsoTimestamp(report.snapshot.capturedAt)) {
        errors.push("snapshot.capturedAt must be an ISO timestamp");
      }
    }
  }
  if (NON_VALUE_STATUSES.has(report.status)) {
    if (report.statusReason === null || !report.statusReason.trim()) {
      errors.push("non-value disclosures require statusReason");
    }
    if (report.holdings.length > 0) errors.push("non-value disclosures must not carry holdings");
  }
  if (report.source !== null && !report.source.id.trim()) errors.push("source.id is required");
  return errors;
}

export function assertFundQuarterlyReport(report: FundQuarterlyReport): void {
  const errors = validateFundQuarterlyReport(report);
  if (errors.length > 0) {
    throw new Error(`Invalid fund quarterly report ${report.id}: ${errors.join("; ")}`);
  }
}

/**
 * Per-report provenance carried on a concentration snapshot (A1 traceability).
 * It is the minimal, auditable metadata of one point-in-time-visible selected
 * report, NOT a second source of the holdings. The full holdings live in the
 * metrics aggregate; this record only lets a reader trace which reports fed it.
 */
export interface SnapshotProvenanceReport {
  id: string;
  fundKey: string;
  observedAt: string;
  publishedAt: string;
  asOf: string;
  revision: number;
  revisionSelection: RevisionSelectionStatus;
  status: FundDisclosureStatus;
  statusReason: string | null;
  source: FundSourceReference | null;
  snapshot: FundSnapshotEvidence | null;
  processingVersion: string;
}

/**
 * The auditable concentration snapshot for the fund sample at one `as_of`.
 * Append-only: a later processing or calculation vintage gets a new row; the
 * earlier vintage is preserved. `availability` mirrors the sample-level state
 * (available / partial / unavailable / incomplete_reconstruction).
 */
export interface FundConcentrationSnapshot {
  id: string;
  snapshotKey: string;
  asOf: string;
  observedAt: string;
  samplePolicyVersion: string;
  processingVersion: string;
  calculationVersion: string;
  revision: number;
  fundCount: number;
  selectedReports: readonly SnapshotProvenanceReport[];
  metrics: ConcentrationMetrics;
  priceQuantity: PriceQuantityDecompositionAssessment;
  availability: FundDisclosureStatus;
  statusReason: string | null;
}

function validateSnapshotProvenanceReport(
  report: SnapshotProvenanceReport,
  index: number,
): string[] {
  const errors: string[] = [];
  if (!report.id.trim()) errors.push(`selectedReports[${index}].id is required`);
  if (!report.fundKey.trim()) errors.push(`selectedReports[${index}].fundKey is required`);
  if (!isIsoTimestamp(report.observedAt)) {
    errors.push(`selectedReports[${index}].observedAt must be an ISO timestamp`);
  }
  if (!isIsoTimestamp(report.publishedAt)) {
    errors.push(`selectedReports[${index}].publishedAt must be an ISO timestamp`);
  }
  if (!isIsoTimestamp(report.asOf)) {
    errors.push(`selectedReports[${index}].asOf must be an ISO timestamp`);
  }
  if (Date.parse(report.asOf) < Date.parse(report.publishedAt)) {
    errors.push(`selectedReports[${index}].asOf must not precede publishedAt`);
  }
  if (!Number.isInteger(report.revision) || report.revision < 1) {
    errors.push(`selectedReports[${index}].revision must be a positive integer`);
  }
  if (!report.processingVersion.trim()) {
    errors.push(`selectedReports[${index}].processingVersion is required`);
  }
  if (!Object.values(FundDisclosureStatus).includes(report.status)) {
    errors.push(`selectedReports[${index}].status is not a recognized disclosure status`);
  }
  if (!Object.values(RevisionSelectionStatus).includes(report.revisionSelection)) {
    errors.push(`selectedReports[${index}].revisionSelection is not recognized`);
  }
  return errors;
}

/** Return snapshot contract violations without mutating it. */
export function validateFundConcentrationSnapshot(
  snapshot: FundConcentrationSnapshot,
): string[] {
  const errors: string[] = [];
  if (!snapshot.id.trim()) errors.push("id is required");
  if (!snapshot.snapshotKey.trim()) errors.push("snapshotKey is required");
  if (!isIsoTimestamp(snapshot.asOf)) errors.push("asOf must be an ISO timestamp");
  if (!isIsoTimestamp(snapshot.observedAt)) {
    errors.push("observedAt must be an ISO timestamp");
  }
  if (Date.parse(snapshot.observedAt) > Date.parse(snapshot.asOf)) {
    errors.push("observedAt must not be later than asOf");
  }
  if (!snapshot.samplePolicyVersion.trim()) {
    errors.push("samplePolicyVersion is required");
  }
  if (!snapshot.processingVersion.trim()) errors.push("processingVersion is required");
  if (!snapshot.calculationVersion.trim()) errors.push("calculationVersion is required");
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
    errors.push("revision must be a positive integer");
  }
  if (
    !Number.isInteger(snapshot.fundCount) ||
    snapshot.fundCount < 0 ||
    snapshot.fundCount !== snapshot.selectedReports.length
  ) {
    errors.push("fundCount must equal selectedReports.length and be non-negative");
  }
  for (const [index, report] of snapshot.selectedReports.entries()) {
    errors.push(...validateSnapshotProvenanceReport(report, index));
  }
  if (!Object.values(FundDisclosureStatus).includes(snapshot.availability)) {
    errors.push("availability is not a recognized disclosure status");
  }
  const NON_VALUE = new Set<FundDisclosureStatus>([
    FundDisclosureStatus.Unavailable,
    FundDisclosureStatus.Failed,
    FundDisclosureStatus.PendingReview,
    FundDisclosureStatus.IncompleteReconstruction,
  ]);
  if (NON_VALUE.has(snapshot.availability) && snapshot.statusReason === null) {
    errors.push("non-value snapshot availability requires statusReason");
  }
  return errors;
}

export function assertFundConcentrationSnapshot(snapshot: FundConcentrationSnapshot): void {
  const errors = validateFundConcentrationSnapshot(snapshot);
  if (errors.length > 0) {
    throw new Error(`Invalid fund concentration snapshot ${snapshot.id}: ${errors.join("; ")}`);
  }
}
