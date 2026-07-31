/** Deterministic acceptance checks for Issue #48's concentration snapshot slice. */

import {
  appendFundConcentrationSnapshot,
  buildFundConcentrationSnapshotAt,
  FUND_CALCULATION_VERSION,
  FundDisclosureStatus,
  fundConcentrationSnapshotKey,
  FundSnapshotConflictError,
  listFundConcentrationSnapshotsAt,
  selectFundSnapshotsAt,
} from "./index.js";
import {
  FundDisclosureStatus as FundStatus,
  IndustryClassificationStatus,
} from "./types.js";
import type { FundConcentrationSnapshot, FundQuarterlyReport } from "./types.js";
import { FUND_REPORT_FIXTURE } from "../../../test/fixtures/fund-concentration.js";
import type { PrismaClient } from "../../../generated/client.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type StoredRow = Record<string, unknown> & {
  snapshotKey: string;
  id: string;
};

type FakeWhere = {
  asOf?: { lte: Date };
  processingVersion?: string;
};

type FakeOrderBy = readonly [
  { asOf: "asc" | "desc" },
  { processingVersion: "asc" | "desc" },
  { calculationVersion: "asc" | "desc" },
];

function fakePrisma() {
  const rows = new Map<string, StoredRow>();
  const client = {
    fundConcentrationSnapshot: {
      async findUnique({ where }: { where: { snapshotKey: string } }) {
        return rows.get(where.snapshotKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.snapshotKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        rows.set(data.snapshotKey, data);
        return data;
      },
      async findMany({
        where,
        orderBy,
      }: { where?: FakeWhere; orderBy?: FakeOrderBy } = {}) {
        const cutoff = where?.asOf?.lte;
        const selected = [...rows.values()].filter((row) => {
          if (cutoff !== undefined && (row.asOf as Date) > cutoff) return false;
          if (where?.processingVersion !== undefined && row.processingVersion !== where.processingVersion)
            return false;
          return true;
        });
        if (orderBy !== undefined) {
          selected.sort((left, right) => {
            const leftAsOf = left.asOf as Date;
            const rightAsOf = right.asOf as Date;
            const asOf = leftAsOf.getTime() - rightAsOf.getTime();
            if (asOf !== 0) return orderBy[0].asOf === "asc" ? asOf : -asOf;
            const proc = String(left.processingVersion).localeCompare(String(right.processingVersion));
            if (proc !== 0) return orderBy[1].processingVersion === "asc" ? proc : -proc;
            const calc = String(left.calculationVersion).localeCompare(String(right.calculationVersion));
            return orderBy[2].calculationVersion === "asc" ? calc : -calc;
          });
        }
        return selected;
      },
    },
  } as unknown as PrismaClient;
  return { client, rows };
}

function racingFakePrisma() {
  const rows = new Map<string, StoredRow>();
  let initialLookups = 0;
  const client = {
    fundConcentrationSnapshot: {
      async findUnique({ where }: { where: { snapshotKey: string } }) {
        if (initialLookups < 2) {
          initialLookups += 1;
          return null;
        }
        return rows.get(where.snapshotKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.snapshotKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        rows.set(data.snapshotKey, data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { client, rows };
}

const close = (actual: number | null, expected: number): boolean =>
  actual !== null && Math.abs(actual - expected) < 1e-9;

function snapshotFromReports(
  reports: readonly FundQuarterlyReport[],
  asOf: string,
  id: string,
  processingVersion = "fund-ingest-v1",
): FundConcentrationSnapshot {
  return buildFundConcentrationSnapshotAt(reports, asOf, {
    id,
    samplePolicyVersion: "active-equity-partial-stock-v1",
    processingVersion,
  });
}

const assertions: Assertion[] = [];

// Pure-computation fixtures (single fund, known exact values for A3).
const alphaQ1R1 = FUND_REPORT_FIXTURE.filter((report) => report.id === "report-alpha-q1-r1");
// Q2 (observedAt 2024-06-30) published 2024-07-23; Q1 (observedAt 2024-03-31)
// published 2024-04-23 is the strictly-earlier disclosure period for the same
// fund — the valid pair to exercise the price/quantity previous-period path.
const alphaQ1AndQ2 = FUND_REPORT_FIXTURE.filter(
  (report) => report.id === "report-alpha-q1-r1" || report.id === "report-alpha-q2-r1",
);

// ---- A3: CR5/10/20, HHI, effective industry count, classified weight + calc version ----
// Single alpha-q1-r1: deduped securities s01..s06 with weights 0.3,0.2,0.1,0.05,0.05,0.05
// (s01 deduped 0.25+0.05=0.3). Total reported = 0.75. Normalized:
// 0.4, 0.2667, 0.1333, 0.0667, 0.0667, 0.0667 → CR5 = 0.9333 = 14/15, CR10=CR20=1.
// Industries (classified): tech(s01+s03=0.5333), finance(s02+s05=0.3334), health(s04+s06=0.1334)
// normalized to classified=1 → HHI = 0.5333² + 0.3334² + 0.1334² = 31/75; effective = 75/31.
const alphaSnapshot = snapshotFromReports(alphaQ1R1, "2024-04-30T23:59:59.999Z", "snapshot-alpha-pure");
assertions.push({
  name: "A3 concentration metrics use deterministic normalized formula + carry calculation version",
  ok:
    alphaSnapshot.calculationVersion === FUND_CALCULATION_VERSION &&
    alphaSnapshot.availability === FundStatus.Available &&
    close(alphaSnapshot.metrics.totalReportedWeight, 0.75) &&
    close(alphaSnapshot.metrics.cr5, 14 / 15) &&
    close(alphaSnapshot.metrics.cr10, 1) &&
    close(alphaSnapshot.metrics.cr20, 1) &&
    close(alphaSnapshot.metrics.industryHhi, 31 / 75) &&
    close(alphaSnapshot.metrics.effectiveIndustryCount, 75 / 31) &&
    alphaSnapshot.metrics.observedIndustryCount === 3 &&
    close(alphaSnapshot.metrics.classifiedWeight, 1) &&
    close(alphaSnapshot.metrics.unclassifiedWeight, 0) &&
    alphaSnapshot.metrics.industryClassificationVersion === "classification-v1" &&
    alphaSnapshot.metrics.industryClassificationStatus === IndustryClassificationStatus.Consistent,
  detail: JSON.stringify(alphaSnapshot.metrics),
});

// ---- A4: price/quantity decomposition never fabricates ----
assertions.push({
  name: "A4 single period has no previous → not_applicable, never a fabricated decomposition",
  ok: alphaSnapshot.priceQuantity.status === "not_applicable",
  detail: JSON.stringify(alphaSnapshot.priceQuantity),
});
const alphaWithPrevious = snapshotFromReports(
  alphaQ1AndQ2,
  "2024-07-24T00:00:00.000Z",
  "snapshot-alpha-with-prev",
);
assertions.push({
  name: "A4 with previous period is non-decomposable without fabricated values",
  ok:
    alphaWithPrevious.priceQuantity.status === "not_decomposable" &&
    alphaWithPrevious.priceQuantity.reason.length > 0,
  detail: JSON.stringify(alphaWithPrevious.priceQuantity),
});

// ---- A1 + A5 + A2 (degradation): persistence round-trip over the full fixture ----
const { client, rows } = fakePrisma();
const aprilSnapshot = snapshotFromReports(
  FUND_REPORT_FIXTURE,
  "2024-04-30T23:59:59.999Z",
  "snapshot-april-full",
);
// The full fixture at 2024-04-30 includes a gapped (incomplete) report, so the
// sample-level availability is incomplete_reconstruction — this is the honest
// degradation the snapshot must preserve, not paper over.
const firstAppend = await appendFundConcentrationSnapshot(client, aprilSnapshot);
const repeatedAppend = await appendFundConcentrationSnapshot(client, {
  ...aprilSnapshot,
  id: "snapshot-april-full-retry",
});
const readBack = await listFundConcentrationSnapshotsAt(client, "2024-04-30T23:59:59.999Z");
const roundTrip = readBack[0];
const provenanceById = new Map(roundTrip?.selectedReports.map((report) => [report.id, report]));
const gappedProvenance = provenanceById.get("report-gapped-q1-r2");
const missingProvenance = provenanceById.get("report-missing-q1");
assertions.push({
  name: "A1 snapshot round-trip preserves selected reports, source/version/status metadata (incl. degraded)",
  ok:
    firstAppend.inserted &&
    !repeatedAppend.inserted &&
    rows.size === 1 &&
    readBack.length === 1 &&
    roundTrip?.fundCount === roundTrip?.selectedReports.length &&
    roundTrip?.availability === FundStatus.IncompleteReconstruction &&
    roundTrip?.statusReason !== null &&
    roundTrip?.calculationVersion === FUND_CALCULATION_VERSION &&
    roundTrip?.processingVersion === "fund-ingest-v1" &&
    roundTrip?.selectedReports.length === 4 &&
    provenanceById.get("report-alpha-q1-r1")?.source !== null &&
    provenanceById.get("report-alpha-q1-r1")?.snapshot !== null &&
    gappedProvenance?.status === FundStatus.IncompleteReconstruction &&
    gappedProvenance?.source === null &&
    gappedProvenance?.snapshot === null &&
    missingProvenance?.status === FundStatus.Unavailable &&
    missingProvenance?.source === null,
  detail: JSON.stringify({ firstAppend, repeatedAppend, roundTrip }),
});

// ---- A2: as_of cutoff excludes later publication; revision gap / missing degrade ----
const beforeLateRelease = snapshotFromReports(
  FUND_REPORT_FIXTURE,
  "2024-04-24T00:00:00.000Z",
  "snapshot-before-beta",
);
assertions.push({
  name: "A2 snapshot key is cutoff-sensitive (later publication excluded)",
  ok:
    aprilSnapshot.snapshotKey !== beforeLateRelease.snapshotKey &&
    beforeLateRelease.selectedReports.every(
      (report) => Date.parse(report.publishedAt) <= Date.parse("2024-04-24T00:00:00.000Z"),
    ),
  detail: JSON.stringify({
    aprilKey: aprilSnapshot.snapshotKey,
    beforeKey: beforeLateRelease.snapshotKey,
    beforeReports: beforeLateRelease.selectedReports.map((report) => report.fundKey),
  }),
});

const gappedOnly = FUND_REPORT_FIXTURE.filter((report) => report.fundKey === "fund-gapped");
const gappedSnapshot = snapshotFromReports(gappedOnly, "2024-04-30T23:59:59.999Z", "snapshot-gapped");
assertions.push({
  name: "A2 revision gap degrades to incomplete_reconstruction without zero-fill",
  ok:
    gappedSnapshot.availability === FundStatus.IncompleteReconstruction &&
    gappedSnapshot.statusReason !== null &&
    gappedSnapshot.metrics.cr5 === null &&
    gappedSnapshot.selectedReports.every(
      (report) => report.status === FundStatus.IncompleteReconstruction,
    ),
  detail: JSON.stringify(gappedSnapshot),
});

const missingOnly = FUND_REPORT_FIXTURE.filter((report) => report.fundKey === "fund-missing");
const missingSnapshot = snapshotFromReports(missingOnly, "2024-04-30T23:59:59.999Z", "snapshot-missing");
assertions.push({
  name: "A2 missing report degrades to unavailable without fabricating holdings",
  ok:
    missingSnapshot.availability === FundStatus.Unavailable &&
    missingSnapshot.statusReason !== null &&
    missingSnapshot.metrics.holdings.length === 0 &&
    missingSnapshot.metrics.totalReportedWeight === 0,
  detail: JSON.stringify(missingSnapshot),
});

const emptySnapshot = buildFundConcentrationSnapshotAt([], "2024-04-30T23:59:59.999Z", {
  id: "snapshot-empty",
  samplePolicyVersion: "active-equity-partial-stock-v1",
  processingVersion: "fund-ingest-v1",
});
assertions.push({
  name: "A2 empty sample degrades to unavailable with explicit reason",
  ok:
    emptySnapshot.availability === FundStatus.Unavailable &&
    emptySnapshot.fundCount === 0 &&
    emptySnapshot.statusReason !== null &&
    emptySnapshot.metrics.cr5 === null,
  detail: JSON.stringify(emptySnapshot),
});

// ---- A5: idempotent recompute; new processing version appends, never overwrites ----
const rerunAppend = await appendFundConcentrationSnapshot(client, {
  ...aprilSnapshot,
  id: "snapshot-april-full-rerun",
});
const originalRow = JSON.stringify(rows.get(firstAppend.snapshotKey));
assertions.push({
  name: "A5 duplicate recompute is idempotent (same key → no insert, no overwrite)",
  ok:
    !rerunAppend.inserted &&
    rerunAppend.snapshotKey === firstAppend.snapshotKey &&
    rows.size === 1 &&
    JSON.stringify(rows.get(firstAppend.snapshotKey)) === originalRow,
  detail: JSON.stringify({ rerunAppend, rowCount: rows.size }),
});

// A conflicting statusReason under the same key is rejected, not silently
// overwritten. statusReason changes the row content without changing the key
// (key depends on availability, not statusReason), so sameSnapshot must detect
// the divergence and raise a FundSnapshotConflictError.
let conflictDetected = false;
try {
  await appendFundConcentrationSnapshot(client, {
    ...aprilSnapshot,
    statusReason: "tampered conflicting reason",
  });
} catch (error) {
  conflictDetected = error instanceof FundSnapshotConflictError;
}
assertions.push({
  name: "A5 conflicting data under same key is rejected, not overwritten",
  ok: conflictDetected && rows.size === 1 && JSON.stringify(rows.get(firstAppend.snapshotKey)) === originalRow,
});

const reprocessedSnapshot = snapshotFromReports(
  FUND_REPORT_FIXTURE,
  "2024-04-30T23:59:59.999Z",
  "snapshot-april-full-v2",
  "fund-ingest-v2",
);
const reprocessedAppend = await appendFundConcentrationSnapshot(client, reprocessedSnapshot);
assertions.push({
  name: "A5 new processing version appends a distinct row without overwriting history",
  ok:
    reprocessedAppend.inserted &&
    reprocessedSnapshot.snapshotKey !== aprilSnapshot.snapshotKey &&
    rows.size === 2 &&
    rows.has(firstAppend.snapshotKey) &&
    rows.has(reprocessedAppend.snapshotKey),
  detail: JSON.stringify({
    originalKey: aprilSnapshot.snapshotKey,
    reprocessedKey: reprocessedSnapshot.snapshotKey,
    rowCount: rows.size,
  }),
});

const racing = racingFakePrisma();
const [raceInserted, raceRetried] = await Promise.all([
  appendFundConcentrationSnapshot(racing.client, aprilSnapshot),
  appendFundConcentrationSnapshot(racing.client, { ...aprilSnapshot, id: "snapshot-race-retry" }),
]);
assertions.push({
  name: "A5 concurrent duplicate converges through unique-key recovery",
  ok:
    new Set([raceInserted.inserted, raceRetried.inserted]).size === 2 &&
    racing.rows.size === 1,
});

assertions.push({
  name: "A5 equivalent ISO timestamp spellings share one snapshot key",
  ok:
    fundConcentrationSnapshotKey({
      asOf: "2024-04-30T23:59:59.999Z",
      samplePolicyVersion: "active-equity-partial-stock-v1",
      processingVersion: "fund-ingest-v1",
      calculationVersion: FUND_CALCULATION_VERSION,
      availability: FundDisclosureStatus.Available,
    }) ===
    fundConcentrationSnapshotKey({
      asOf: "2024-05-01T07:59:59.999+08:00",
      samplePolicyVersion: "active-equity-partial-stock-v1",
      processingVersion: "fund-ingest-v1",
      calculationVersion: FUND_CALCULATION_VERSION,
      availability: FundDisclosureStatus.Available,
    }),
});

// ---- A6: missing source/report/classification never becomes zero; pure select keeps latest vintage ----
const v0Snapshot: FundConcentrationSnapshot = {
  ...alphaSnapshot,
  id: "snapshot-select-v0",
  calculationVersion: "fund-concentration-v0",
  snapshotKey: fundConcentrationSnapshotKey({
    asOf: alphaSnapshot.asOf,
    samplePolicyVersion: alphaSnapshot.samplePolicyVersion,
    processingVersion: alphaSnapshot.processingVersion,
    calculationVersion: "fund-concentration-v0",
    availability: alphaSnapshot.availability,
  }),
};
const selectedLatest = selectFundSnapshotsAt([v0Snapshot, alphaSnapshot], "2024-05-15T00:00:00.000Z");
assertions.push({
  name: "A6 selectFundSnapshotsAt keeps the latest calculation vintage per cutoff",
  ok:
    selectedLatest.length === 1 &&
    selectedLatest[0]?.calculationVersion === FUND_CALCULATION_VERSION,
  detail: JSON.stringify(selectedLatest),
});
assertions.push({
  name: "A6 degraded snapshots never coerce missing metrics to zero",
  ok:
    gappedSnapshot.metrics.cr5 === null &&
    gappedSnapshot.metrics.industryHhi === null &&
    missingSnapshot.metrics.cr5 === null &&
    missingSnapshot.metrics.classifiedWeight === 0 &&
    emptySnapshot.metrics.cr5 === null,
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
