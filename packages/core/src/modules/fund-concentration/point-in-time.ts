import {
  assertFundQuarterlyReport,
  FundDisclosureStatus,
} from "./types.js";
import { fundSourcePriority } from "./source-baseline.js";
import type {
  FundQuarterlyReport,
  SelectedFundQuarterlyReport,
} from "./types.js";

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return parsed;
}

/** Stable identity for a fund's quarter before publication revisions. */
export function fundReportIdentity(report: FundQuarterlyReport): string {
  return [report.fundKey, report.observedAt, report.samplePolicyVersion].join("|");
}

/** Deterministic key that keeps publication and processing vintages distinct. */
export function fundReportKey(report: FundQuarterlyReport): string {
  return [
    fundReportIdentity(report),
    report.publishedAt,
    report.asOf,
    report.processingVersion,
    String(report.revision),
    report.status,
  ].join("|");
}

function compareReports(a: FundQuarterlyReport, b: FundQuarterlyReport): number {
  if (a.revision !== b.revision) return b.revision - a.revision;
  const published = timestamp(b.publishedAt) - timestamp(a.publishedAt);
  if (published !== 0) return published;
  const sourcePriority =
    (b.source === null ? Number.MAX_SAFE_INTEGER : fundSourcePriority(b.source.tier)) -
    (a.source === null ? Number.MAX_SAFE_INTEGER : fundSourcePriority(a.source.tier));
  if (sourcePriority !== 0) return sourcePriority;
  return a.id.localeCompare(b.id);
}

function incompleteReconstruction(
  report: FundQuarterlyReport,
): SelectedFundQuarterlyReport {
  return {
    ...report,
    status: FundDisclosureStatus.IncompleteReconstruction,
    statusReason:
      "原始历史版本不可得，无法完整还原该点时披露；后来修订值未用于回填。",
    source: null,
    snapshot: null,
    holdings: [],
    revisionSelection: "incomplete_reconstruction",
  };
}

/**
 * Select reports visible at an information cutoff.
 *
 * `publishedAt`, rather than quarter-end `observedAt`, controls visibility.
 * A later revision is selected only when its publication was already visible;
 * if retained revisions have a gap, the value is withheld as incomplete.
 */
export function selectFundReportsAt(
  reports: readonly FundQuarterlyReport[],
  cutoff: string,
): SelectedFundQuarterlyReport[] {
  const cutoffTimestamp = timestamp(cutoff);
  const visible = reports.filter((report) => {
    assertFundQuarterlyReport(report);
    return timestamp(report.publishedAt) <= cutoffTimestamp;
  });

  const grouped = new Map<string, FundQuarterlyReport[]>();
  for (const report of visible) {
    const key = fundReportIdentity(report);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(report);
    else grouped.set(key, [report]);
  }

  const selected: SelectedFundQuarterlyReport[] = [];
  for (const bucket of grouped.values()) {
    const ordered = [...bucket].sort(compareReports);
    const latest = ordered[0]!;
    const revisions = new Set(ordered.map((report) => report.revision));
    const hasRevisionGap = Array.from(
      { length: latest.revision },
      (_, index) => index + 1,
    ).some((revision) => !revisions.has(revision));

    if (
      latest.revision > 1 &&
      hasRevisionGap &&
      (latest.status === FundDisclosureStatus.Available ||
        latest.status === FundDisclosureStatus.Partial)
    ) {
      selected.push(incompleteReconstruction(latest));
      continue;
    }

    selected.push({
      ...latest,
      revisionSelection: latest.revision > 1 ? "revised" : "original",
    });
  }

  return selected.sort((a, b) => {
    const identity = fundReportIdentity(a).localeCompare(fundReportIdentity(b));
    if (identity !== 0) return identity;
    return compareReports(a, b);
  });
}

export function compareReportClassificationVersions(
  previous: FundQuarterlyReport,
  current: FundQuarterlyReport,
): "same" | "changed" | "unknown" {
  const classifiedRows = [...previous.holdings, ...current.holdings].filter(
    (holding) => holding.industryCode !== null,
  );
  if (
    classifiedRows.some(
      (holding) =>
        holding.industryClassificationVersion === null ||
        holding.industryClassificationVersion.trim() === "",
    )
  ) {
    return "unknown";
  }
  const versions = classifiedRows
    .map((holding) => holding.industryClassificationVersion)
    .filter((version): version is string => version !== null && version.trim() !== "");
  if (versions.length === 0) return "unknown";
  return new Set(versions).size === 1 ? "same" : "changed";
}
