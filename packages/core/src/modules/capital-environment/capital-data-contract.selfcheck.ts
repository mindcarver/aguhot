/**
 * Deterministic acceptance checks for Issue #41.
 *
 * Run with: pnpm --filter @aguhot/core verify:capital-data-contract
 */

import {
  CAPITAL_SOURCE_BASELINE,
  CapitalAvailability,
  CapitalMarket,
  capitalRecordKey,
  capitalRecordIdentity,
  listCapitalSourceBaseline,
  selectCapitalRecordsAt,
  validateCapitalDataRecord,
} from "./index.js";
import { CAPITAL_DATA_FIXTURE } from "../../../test/fixtures/capital-data-contract.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];
const asOfMarch = selectCapitalRecordsAt(
  CAPITAL_DATA_FIXTURE,
  "2024-03-31T23:59:59.999Z",
);
const asOfMay = selectCapitalRecordsAt(
  CAPITAL_DATA_FIXTURE,
  "2024-05-31T23:59:59.999Z",
);

const marchPolicy = asOfMarch.find((record) => record.metricKey === "policy-rate");
const mayPolicy = asOfMay.find((record) => record.metricKey === "policy-rate");
const lateRelease = asOfMarch.find((record) => record.metricKey === "late-release");
const missingOriginal = asOfMay.find(
  (record) => record.metricKey === "missing-original",
);
const gappedRevision = asOfMay.find(
  (record) => record.metricKey === "gapped-revision",
);

assertions.push({
  name: "A1 record carries required point-in-time fields",
  ok:
    marchPolicy !== undefined &&
    marchPolicy.market === CapitalMarket.UnitedStates &&
    marchPolicy.value === 4.5 &&
    marchPolicy.unit === "percent" &&
    marchPolicy.observedAt !== "" &&
    marchPolicy.publishedAt !== null &&
    marchPolicy.asOf !== "" &&
    marchPolicy.source.id === "fixture-fred" &&
    marchPolicy.processingVersion === "contract-v1" &&
    marchPolicy.availability === CapitalAvailability.Available,
});

assertions.push({
  name: "A2 excludes data published after the replay cutoff",
  ok: lateRelease === undefined,
  detail: JSON.stringify(lateRelease),
});

assertions.push({
  name: "A3 uses the revision known at the cutoff without mutating history",
  ok:
    marchPolicy?.revision === 1 &&
    mayPolicy?.revision === 2 &&
    marchPolicy?.value === 4.5 &&
    mayPolicy?.value === 4.25 &&
    CAPITAL_DATA_FIXTURE.find((record) => record.id === "rates-r1")?.value === 4.5,
  detail: JSON.stringify({ march: marchPolicy, may: mayPolicy }),
});

assertions.push({
  name: "A3 marks a missing original revision as incomplete instead of backfilling",
  ok:
    missingOriginal?.availability === CapitalAvailability.IncompleteReconstruction &&
    missingOriginal.value === null &&
    missingOriginal.statusReason?.includes("原始历史版本不可得") === true,
  detail: JSON.stringify(missingOriginal),
});

assertions.push({
  name: "A3 marks a revision gap as incomplete even when another earlier revision survives",
  ok:
    gappedRevision?.revision === 3 &&
    gappedRevision.availability === CapitalAvailability.IncompleteReconstruction &&
    gappedRevision.value === null,
  detail: JSON.stringify(gappedRevision),
});

const statusRecords = asOfMarch.filter((record) =>
  [
    "empty-result",
    "source-failed",
    "schema-changed",
  ].includes(record.metricKey),
);
const statusByMetric = new Map(
  statusRecords.map((record) => [record.metricKey, record]),
);
assertions.push({
  name: "A4 preserves unknown, failed and pending-review states without zero values",
  ok:
    statusRecords.length === 3 &&
    statusRecords.every((record) => record.value === null) &&
    statusByMetric.get("empty-result")?.availability === CapitalAvailability.Unknown &&
    statusByMetric.get("source-failed")?.availability === CapitalAvailability.Failed &&
    statusByMetric.get("schema-changed")?.availability ===
      CapitalAvailability.PendingReview,
  detail: JSON.stringify(statusRecords),
});

const baselineMarkets = new Set(
  CAPITAL_SOURCE_BASELINE.map((source) => source.market),
);
const chinaSources = listCapitalSourceBaseline(CapitalMarket.China);
assertions.push({
  name: "A5 baseline covers US, China, Korea and existing A-share source",
  ok:
    baselineMarkets.has(CapitalMarket.UnitedStates) &&
    baselineMarkets.has(CapitalMarket.China) &&
    baselineMarkets.has(CapitalMarket.Korea) &&
    chinaSources.some((source) => source.id === "cn-akshare-index-sector") &&
    chinaSources.some((source) => source.id === "cn-akshare-breadth") &&
    chinaSources.every(
      (source) =>
        source.frequency !== undefined &&
        source.historicalCoverage.note.length > 0 &&
        source.publicationDateCapability !== undefined &&
        typeof source.snapshotCapability === "boolean" &&
        source.readiness !== undefined,
    ),
  detail: JSON.stringify(chinaSources),
});

const validRecord = validateCapitalDataRecord(CAPITAL_DATA_FIXTURE[0]!);
const keysBefore = CAPITAL_DATA_FIXTURE.map(capitalRecordKey);
const keysAfter = CAPITAL_DATA_FIXTURE.map(capitalRecordKey);
assertions.push({
  name: "A6 repeated reads and keys are deterministic",
  ok:
    validRecord.length === 0 &&
    JSON.stringify(asOfMay) ===
      JSON.stringify(selectCapitalRecordsAt(CAPITAL_DATA_FIXTURE, "2024-05-31T23:59:59.999Z")) &&
    JSON.stringify(keysBefore) === JSON.stringify(keysAfter) &&
    capitalRecordIdentity(CAPITAL_DATA_FIXTURE[0]!) ===
      capitalRecordIdentity(CAPITAL_DATA_FIXTURE[0]!),
  detail: JSON.stringify({ keys: keysBefore }),
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
