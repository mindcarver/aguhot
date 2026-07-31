import type { Prisma, PrismaClient } from "../../../generated/client.js";
import {
  assertFundConcentrationSnapshot,
  FundDisclosureStatus,
  IndustryClassificationStatus,
} from "./types.js";
import { aggregateReportHoldings, calculateConcentrationMetrics } from "./metrics.js";
import { assessPriceQuantityDecomposition } from "./price-quantity.js";
import { selectFundReportsAt } from "./point-in-time.js";
import type {
  ConcentrationMetrics,
  FundConcentrationSnapshot,
  FundQuarterlyReport,
  PriceQuantityDecompositionAssessment,
  SelectedFundQuarterlyReport,
  SnapshotProvenanceReport,
} from "./types.js";

/**
 * Calculation-vintage string carried on every snapshot (A3 — results carry a
 * calculation version). It folds the concentration formula identity with the
 * observed industry-classification version so a recompute under a different
 * classification baseline is a distinct vintage, not an in-place overwrite.
 */
export const FUND_CALCULATION_VERSION = "fund-concentration-v1";

export interface FundSnapshotAppendResult {
  inserted: boolean;
  snapshotKey: string;
}

export interface FundSnapshotAppendOptions {
  traceId?: string | null;
}

export interface FundSnapshotListOptions {
  processingVersion?: string;
}

export class FundSnapshotConflictError extends Error {
  constructor(snapshotKey: string) {
    super(`Fund concentration snapshot key already contains different data: ${snapshotKey}`);
    this.name = "FundSnapshotConflictError";
  }
}

type FundSnapshotRow = Awaited<
  ReturnType<PrismaClient["fundConcentrationSnapshot"]["findMany"]>
>[number];

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid fund snapshot timestamp: ${value}`);
  return parsed;
}

function date(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid fund snapshot timestamp: ${value}`);
  }
  return parsed;
}

function toProvenance(report: SelectedFundQuarterlyReport): SnapshotProvenanceReport {
  return {
    id: report.id,
    fundKey: report.fundKey,
    observedAt: report.observedAt,
    publishedAt: report.publishedAt,
    asOf: report.asOf,
    revision: report.revision,
    revisionSelection: report.revisionSelection,
    status: report.status,
    statusReason: report.statusReason,
    source: report.source,
    snapshot: report.snapshot,
    processingVersion: report.processingVersion,
  };
}

function previousVisible(
  reports: readonly FundQuarterlyReport[],
  identity: { fundKey: string; observedAt: string },
  cutoff: number,
): SelectedFundQuarterlyReport | null {
  // Price/quantity decomposition compares a fund's holdings against its
  // PREVIOUS disclosure period (an earlier observedAt quarter), not an earlier
  // revision of the same period. Select the most recent strictly-earlier
  // quarter that was visible at the cutoff.
  const currentObservedAt = timestamp(identity.observedAt);
  const earlierQuarters = reports.filter(
    (report) =>
      report.fundKey === identity.fundKey && timestamp(report.observedAt) < currentObservedAt,
  );
  if (earlierQuarters.length === 0) return null;
  const selected = selectFundReportsAt(earlierQuarters, new Date(cutoff).toISOString());
  return selected.length > 0 ? selected[selected.length - 1]! : null;
}

/**
 * Build the auditable concentration snapshot for the fund sample at `asOf`,
 * WITHOUT persistence. Pure and deterministic: it selects the reports visible
 * at the cutoff, aggregates their holdings, computes the concentration metrics,
 * assesses the price/quantity decomposition, and derives the sample-level
 * availability. Missing reports, revision gaps and unclassified holdings are
 * kept as explicit degradation, never coerced to zero.
 */
export function buildFundConcentrationSnapshotAt(
  reports: readonly FundQuarterlyReport[],
  asOf: string,
  options: {
    samplePolicyVersion: string;
    processingVersion: string;
    id: string;
    calculationVersion?: string;
    traceId?: string | null;
  },
): FundConcentrationSnapshot {
  const cutoff = timestamp(asOf);
  const selected = selectFundReportsAt(reports, asOf);
  const holdings = aggregateReportHoldings(selected);

  const metrics: ConcentrationMetrics =
    holdings.length > 0
      ? calculateConcentrationMetrics(holdings)
      : {
          holdings: [],
          totalReportedWeight: 0,
          cr5: null,
          cr10: null,
          cr20: null,
          industryHhi: null,
          observedIndustryCount: 0,
          effectiveIndustryCount: null,
          classifiedWeight: 0,
          unclassifiedWeight: 0,
          industryClassificationVersion: null,
          industryClassificationStatus: IndustryClassificationStatus.Unavailable,
        };

  // Price/quantity assessment compares the sample's latest contributing
  // disclosure period against its strictly-earlier predecessor. This baseline
  // has no per-security price series, so a present predecessor still yields the
  // honest non-decomposable status; an absent predecessor yields not_applicable.
  // Either way no value is fabricated (A4).
  let priceQuantity: PriceQuantityDecompositionAssessment = {
    status: "not_applicable",
    reason: "缺少上一披露期，无法计算持仓变化。",
  };
  if (holdings.length > 0) {
    const contributing = selected.filter(
      (report) =>
        report.status === FundDisclosureStatus.Available ||
        report.status === FundDisclosureStatus.Partial,
    );
    if (contributing.length > 0) {
      const latestContributing = contributing.reduce((latest, report) =>
        timestamp(report.observedAt) > timestamp(latest.observedAt) ? report : latest,
      );
      const previous = previousVisible(
        reports,
        { fundKey: latestContributing.fundKey, observedAt: latestContributing.observedAt },
        cutoff,
      );
      priceQuantity = assessPriceQuantityDecomposition(previous, latestContributing);
    }
  }

  const hasIncomplete = selected.some(
    (report) => report.status === FundDisclosureStatus.IncompleteReconstruction,
  );
  const hasUnavailable = selected.every(
    (report) =>
      report.status === FundDisclosureStatus.Unavailable ||
      report.status === FundDisclosureStatus.Failed ||
      report.status === FundDisclosureStatus.PendingReview,
  );
  const hasPartial = selected.some((report) => report.status === FundDisclosureStatus.Partial);

  let availability: FundDisclosureStatus;
  let statusReason: string | null;
  if (selected.length === 0 || hasUnavailable) {
    availability = FundDisclosureStatus.Unavailable;
    statusReason =
      selected.length === 0
        ? "无可见样本报告，未生成持仓数值。"
        : "所有可见样本报告缺少可用持仓披露，未生成持仓数值。";
  } else if (hasIncomplete) {
    availability = FundDisclosureStatus.IncompleteReconstruction;
    statusReason = "部分报告存在修订缺口，无法完整还原该点时持仓。";
  } else if (hasPartial) {
    availability = FundDisclosureStatus.Partial;
    statusReason = "部分报告披露为 partial，结果按已披露口径呈现。";
  } else {
    availability = FundDisclosureStatus.Available;
    statusReason = null;
  }

  const observedAt = selected.length > 0
    ? selected.reduce((latest, report) => {
        const time = timestamp(report.observedAt);
        return time > timestamp(latest) ? report.observedAt : latest;
      }, selected[0]!.observedAt)
    : asOf;

  const snapshot: FundConcentrationSnapshot = {
    id: options.id,
    snapshotKey: fundConcentrationSnapshotKey({
      asOf,
      samplePolicyVersion: options.samplePolicyVersion,
      processingVersion: options.processingVersion,
      calculationVersion: options.calculationVersion ?? FUND_CALCULATION_VERSION,
      availability,
    }),
    asOf,
    observedAt,
    samplePolicyVersion: options.samplePolicyVersion,
    processingVersion: options.processingVersion,
    calculationVersion: options.calculationVersion ?? FUND_CALCULATION_VERSION,
    revision: 1,
    fundCount: selected.length,
    selectedReports: selected.map(toProvenance),
    metrics,
    priceQuantity,
    availability,
    statusReason,
  };
  assertFundConcentrationSnapshot(snapshot);
  return snapshot;
}

/**
 * Deterministic snapshot key. It includes the as-of cutoff, sample policy,
 * processing version, calculation version and sample-level availability so a
 * later recompute under a different vintage or degradation state cannot
 * overwrite an earlier row.
 */
export function fundConcentrationSnapshotKey(input: {
  asOf: string;
  samplePolicyVersion: string;
  processingVersion: string;
  calculationVersion: string;
  availability: FundDisclosureStatus;
}): string {
  return [
    input.samplePolicyVersion,
    new Date(timestamp(input.asOf)).toISOString(),
    input.processingVersion,
    input.calculationVersion,
    input.availability,
  ].join("|");
}

function metricsToJson(metrics: ConcentrationMetrics): Prisma.JsonValue {
  return {
    holdings: metrics.holdings.map((holding) => ({ ...holding })),
    totalReportedWeight: metrics.totalReportedWeight,
    cr5: metrics.cr5,
    cr10: metrics.cr10,
    cr20: metrics.cr20,
    industryHhi: metrics.industryHhi,
    observedIndustryCount: metrics.observedIndustryCount,
    effectiveIndustryCount: metrics.effectiveIndustryCount,
    classifiedWeight: metrics.classifiedWeight,
    unclassifiedWeight: metrics.unclassifiedWeight,
    industryClassificationVersion: metrics.industryClassificationVersion,
    industryClassificationStatus: metrics.industryClassificationStatus,
  };
}

function jsonToMetrics(value: Prisma.JsonValue): ConcentrationMetrics {
  const data = value as unknown as {
    holdings: ConcentrationMetrics["holdings"];
    totalReportedWeight: number;
    cr5: number | null;
    cr10: number | null;
    cr20: number | null;
    industryHhi: number | null;
    observedIndustryCount: number;
    effectiveIndustryCount: number | null;
    classifiedWeight: number;
    unclassifiedWeight: number;
    industryClassificationVersion: string | null;
    industryClassificationStatus: ConcentrationMetrics["industryClassificationStatus"];
  };
  return {
    holdings: data.holdings,
    totalReportedWeight: data.totalReportedWeight,
    cr5: data.cr5,
    cr10: data.cr10,
    cr20: data.cr20,
    industryHhi: data.industryHhi,
    observedIndustryCount: data.observedIndustryCount,
    effectiveIndustryCount: data.effectiveIndustryCount,
    classifiedWeight: data.classifiedWeight,
    unclassifiedWeight: data.unclassifiedWeight,
    industryClassificationVersion: data.industryClassificationVersion,
    industryClassificationStatus: data.industryClassificationStatus,
  };
}

function toRowData(
  snapshot: FundConcentrationSnapshot,
  traceId: string | null,
): Prisma.FundConcentrationSnapshotCreateInput {
  return {
    id: snapshot.id,
    snapshotKey: snapshot.snapshotKey,
    asOf: date(snapshot.asOf),
    observedAt: date(snapshot.observedAt),
    samplePolicyVersion: snapshot.samplePolicyVersion,
    processingVersion: snapshot.processingVersion,
    calculationVersion: snapshot.calculationVersion,
    revision: snapshot.revision,
    fundCount: snapshot.fundCount,
    selectedReports: snapshot.selectedReports.map((report) => ({ ...report })) as Prisma.InputJsonValue,
    metrics: metricsToJson(snapshot.metrics) as Prisma.InputJsonValue,
    priceQuantity: { ...snapshot.priceQuantity } as Prisma.InputJsonValue,
    availability: snapshot.availability,
    statusReason: snapshot.statusReason,
    traceId,
  };
}

function sameSnapshot(row: FundSnapshotRow, snapshot: FundConcentrationSnapshot): boolean {
  return (
    row.snapshotKey === snapshot.snapshotKey &&
    row.samplePolicyVersion === snapshot.samplePolicyVersion &&
    row.processingVersion === snapshot.processingVersion &&
    row.calculationVersion === snapshot.calculationVersion &&
    row.revision === snapshot.revision &&
    row.fundCount === snapshot.fundCount &&
    row.availability === snapshot.availability &&
    row.statusReason === snapshot.statusReason &&
    row.asOf.toISOString() === date(snapshot.asOf).toISOString() &&
    row.observedAt.toISOString() === date(snapshot.observedAt).toISOString()
  );
}

function fromRow(row: FundSnapshotRow): FundConcentrationSnapshot {
  const snapshot: FundConcentrationSnapshot = {
    id: row.id,
    snapshotKey: row.snapshotKey,
    asOf: row.asOf.toISOString(),
    observedAt: row.observedAt.toISOString(),
    samplePolicyVersion: row.samplePolicyVersion,
    processingVersion: row.processingVersion,
    calculationVersion: row.calculationVersion,
    revision: row.revision,
    fundCount: row.fundCount,
    selectedReports: row.selectedReports as unknown as SnapshotProvenanceReport[],
    metrics: jsonToMetrics(row.metrics),
    priceQuantity: row.priceQuantity as unknown as PriceQuantityDecompositionAssessment,
    availability: row.availability as FundConcentrationSnapshot["availability"],
    statusReason: row.statusReason,
  };
  assertFundConcentrationSnapshot(snapshot);
  return snapshot;
}

/** Append one validated snapshot without overwriting a prior vintage. */
export async function appendFundConcentrationSnapshot(
  prisma: PrismaClient,
  snapshot: FundConcentrationSnapshot,
  options: FundSnapshotAppendOptions = {},
): Promise<FundSnapshotAppendResult> {
  assertFundConcentrationSnapshot(snapshot);
  const traceId = options.traceId ?? null;
  const snapshotKey = snapshot.snapshotKey;
  const existing = await prisma.fundConcentrationSnapshot.findUnique({
    where: { snapshotKey },
  });
  if (existing !== null) {
    if (!sameSnapshot(existing, snapshot)) throw new FundSnapshotConflictError(snapshotKey);
    return { inserted: false, snapshotKey };
  }

  try {
    await prisma.fundConcentrationSnapshot.create({ data: toRowData(snapshot, traceId) });
    return { inserted: true, snapshotKey };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await prisma.fundConcentrationSnapshot.findUnique({
      where: { snapshotKey },
    });
    if (raced === null) throw error;
    if (!sameSnapshot(raced, snapshot)) throw new FundSnapshotConflictError(snapshotKey);
    return { inserted: false, snapshotKey };
  }
}

/** Read persisted snapshots visible at `asOf` and keep the latest vintage. */
export async function listFundConcentrationSnapshotsAt(
  prisma: PrismaClient,
  asOf: string,
  options: FundSnapshotListOptions = {},
): Promise<FundConcentrationSnapshot[]> {
  const cutoff = date(asOf);
  const rows = await prisma.fundConcentrationSnapshot.findMany({
    where: {
      asOf: { lte: cutoff },
      ...(options.processingVersion === undefined ? {} : { processingVersion: options.processingVersion }),
    },
    orderBy: [{ asOf: "desc" }, { processingVersion: "asc" }, { calculationVersion: "asc" }],
  });
  return selectFundSnapshotsAt(rows.map(fromRow), asOf);
}

/**
 * Keep the latest snapshot per (sample policy, as-of, processing, calculation)
 * vintage that is visible at the cutoff. A later processing/calculation
 * vintage is preferred; earlier vintages remain append-only history.
 */
export function selectFundSnapshotsAt(
  snapshots: readonly FundConcentrationSnapshot[],
  asOf: string,
): FundConcentrationSnapshot[] {
  const cutoff = timestamp(asOf);
  const visible = snapshots.filter((snapshot) => timestamp(snapshot.asOf) <= cutoff);
  const grouped = new Map<string, FundConcentrationSnapshot[]>();
  for (const snapshot of visible) {
    const key = [
      snapshot.samplePolicyVersion,
      new Date(timestamp(snapshot.asOf)).toISOString(),
      snapshot.processingVersion,
    ].join("|");
    const bucket = grouped.get(key);
    if (bucket) bucket.push(snapshot);
    else grouped.set(key, [snapshot]);
  }

  const selected: FundConcentrationSnapshot[] = [];
  for (const bucket of grouped.values()) {
    const ordered = [...bucket].sort((a, b) =>
      b.calculationVersion.localeCompare(a.calculationVersion),
    );
    selected.push(ordered[0]!);
  }
  return selected.sort((a, b) => timestamp(b.asOf) - timestamp(a.asOf));
}
