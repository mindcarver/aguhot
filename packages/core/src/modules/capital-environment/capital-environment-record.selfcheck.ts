/** Deterministic acceptance checks for Issue #47's core persistence slice. */

import { getCapitalMetricCatalogEntry } from "./metric-catalog.js";
import {
  appendCapitalDataRecord,
  CapitalRecordConflictError,
  listCapitalDataRecordsAt,
} from "./record-repository.js";
import { capitalRecordKey } from "./point-in-time.js";
import { mapAshareObservation } from "./ashare-observation-adapter.js";
import { syncAshareCapitalEnvironmentRecords } from "./ashare-observation-service.js";
import type { AshareObservationInput } from "./ashare-observation-adapter.js";
import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "./types.js";
import type { CapitalDataRecord, CapitalMetricSourceFieldMapping } from "./types.js";
import type { PrismaClient } from "../../../generated/client.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type StoredRow = Record<string, unknown> & {
  recordKey: string;
  id: string;
};

type FakeWhere = {
  metricKey?: string;
  market?: string;
  OR?: readonly [
    { publishedAt: { lte: Date } },
    { publishedAt: null; asOf: { lte: Date } },
  ];
};

type FakeOrderBy = readonly [
  { observedAt: "asc" | "desc" },
  { revision: "asc" | "desc" },
];

function fakePrisma() {
  const rows = new Map<string, StoredRow>();
  const client = {
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return rows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.recordKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        rows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
        orderBy,
      }: { where?: FakeWhere; orderBy?: FakeOrderBy } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallbackCutoff = where?.OR?.[1]?.asOf.lte;
        const selected = [...rows.values()].filter((row) => {
          if (where?.metricKey !== undefined && row.metricKey !== where.metricKey) return false;
          if (where?.market !== undefined && row.market !== where.market) return false;
          if (cutoff !== undefined && fallbackCutoff !== undefined) {
            const publishedAt = row.publishedAt as Date | null;
            const asOf = row.asOf as Date;
            if (
              publishedAt !== null
                ? publishedAt > cutoff
                : asOf > fallbackCutoff
            ) return false;
          }
          return true;
        });
        if (orderBy !== undefined) {
          selected.sort((left, right) => {
            const leftObserved = left.observedAt as Date;
            const rightObserved = right.observedAt as Date;
            const observed = leftObserved.getTime() - rightObserved.getTime();
            if (observed !== 0) return orderBy[0].observedAt === "asc" ? observed : -observed;
            const revision = Number(left.revision) - Number(right.revision);
            return orderBy[1].revision === "asc" ? revision : -revision;
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
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        if (initialLookups < 2) {
          initialLookups += 1;
          return null;
        }
        return rows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.recordKey)) {
          const error = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw error;
        }
        rows.set(data.recordKey, data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { client, rows };
}

function ashareSidecarFakePrisma() {
  const { client: capitalClient, rows } = fakePrisma();
  let capturedAt = new Date("2024-02-01T00:00:00.000Z");
  const client = {
    ...capitalClient,
    indexDailyBar: {
      async findMany() {
        return [
          {
            id: "index-row-1",
            tradeDate: new Date("2024-01-31T00:00:00.000Z"),
            close: 3211.42,
            ingestedAt: capturedAt,
            traceId: "index-trace",
          },
        ];
      },
    },
    sectorDailyBar: {
      async findMany() {
        return [
          {
            id: "sector-row-1",
            tradeDate: new Date("2024-01-31T00:00:00.000Z"),
            close: 1876.35,
            ingestedAt: capturedAt,
            traceId: "sector-trace",
          },
        ];
      },
    },
    marketBreadthDaily: {
      async findMany() {
        return [
          {
            id: "breadth-row-1",
            tradeDate: new Date("2024-01-31T00:00:00.000Z"),
            advancingCount: 2317,
            ingestedAt: capturedAt,
            traceId: "breadth-trace",
          },
        ];
      },
    },
  } as unknown as PrismaClient;
  return {
    client,
    rows,
    advanceIngestedAt() {
      capturedAt = new Date("2024-02-02T00:00:00.000Z");
    },
  };
}

function indexFailureSidecarFakePrisma() {
  const { client, rows } = ashareSidecarFakePrisma();
  return {
    client: {
      ...client,
      indexDailyBar: {
        async findMany() {
          throw new Error("index sidecar unavailable");
        },
      },
    } as unknown as PrismaClient,
    rows,
  };
}

function relatedSourceFailuresSidecarFakePrisma() {
  const { client, rows } = ashareSidecarFakePrisma();
  return {
    client: {
      ...client,
      indexDailyBar: {
        async findMany() {
          throw new Error("index sidecar unavailable");
        },
      },
      sectorDailyBar: {
        async findMany() {
          throw new Error("sector sidecar unavailable");
        },
      },
    } as unknown as PrismaClient,
    rows,
  };
}

function emptySourceSidecarFakePrisma() {
  const { client, rows } = fakePrisma();
  return {
    client: {
      ...client,
      indexDailyBar: { async findMany() { return []; } },
      sectorDailyBar: { async findMany() { return []; } },
      marketBreadthDaily: { async findMany() { return []; } },
    } as unknown as PrismaClient,
    rows,
  };
}

function statusPersistenceFailureSidecarFakePrisma() {
  const { client, rows } = indexFailureSidecarFakePrisma();
  return {
    client: {
      ...client,
      capitalEnvironmentRecord: {
        ...client.capitalEnvironmentRecord,
        async create() {
          throw new Error("capital status store unavailable");
        },
      },
    } as unknown as PrismaClient,
    rows,
  };
}

function mappedPersistenceFailureSidecarFakePrisma() {
  const { client, rows } = ashareSidecarFakePrisma();
  return {
    client: {
      ...client,
      capitalEnvironmentRecord: {
        ...client.capitalEnvironmentRecord,
        async create() {
          throw new Error("capital mapped record store unavailable");
        },
      },
    } as unknown as PrismaClient,
    rows,
  };
}

function record(
  id: string,
  revision: number,
  publishedAt: string,
  value: number,
): CapitalDataRecord {
  return {
    id,
    metricKey: "policy-rate",
    market: CapitalMarket.UnitedStates,
    dimension: CapitalDimension.FundingPrice,
    value,
    unit: "percent",
    observedAt: "2024-01-31T00:00:00.000Z",
    publishedAt,
    asOf: publishedAt,
    source: {
      id: "fixture-fred",
      name: "Fixture FRED",
      dataset: "policy-rate",
      documentationUrl: null,
    },
    processingVersion: "record-v1",
    availability: CapitalAvailability.Available,
    statusReason: null,
    revision,
  };
}

function observedMapping(mapping: CapitalMetricSourceFieldMapping) {
  return {
    sourceId: mapping.sourceId,
    dataset: mapping.dataset,
    valueField: mapping.valueField,
    valueFields: mapping.valueFields,
    valueTransform: mapping.valueTransform,
    rawUnit: mapping.rawUnit,
    observedAtField: mapping.observedAtField,
    publishedAtField: mapping.publishedAtField,
    unitField: mapping.unitField,
    publicationDateCapability: mapping.publicationDateCapability,
  };
}

const assertions: Assertion[] = [];
const { client, rows } = fakePrisma();
const first = record("fixture-rate-r1", 1, "2024-02-02T00:00:00.000Z", 4.5);
const late = record("fixture-rate-late", 1, "2024-03-02T00:00:00.000Z", 4.25);
const gapped = record("fixture-rate-r3", 3, "2024-04-02T00:00:00.000Z", 4.0);

const firstAppend = await appendCapitalDataRecord(client, first);
const repeatedAppend = await appendCapitalDataRecord(client, {
  ...first,
  id: "fixture-rate-retry-generated-id",
}, { traceId: "retry-trace" });
assertions.push({
  name: "A1/A2 valid append and duplicate are deterministic",
  ok: firstAppend.inserted && !repeatedAppend.inserted && rows.size === 1,
  detail: JSON.stringify({ firstAppend, repeatedAppend, rowCount: rows.size }),
});

let conflictDetected = false;
const originalRow = JSON.stringify(rows.get(firstAppend.recordKey));
try {
  await appendCapitalDataRecord(client, { ...first, value: 4.4 }, { traceId: "different-trace" });
} catch (error) {
  conflictDetected = error instanceof CapitalRecordConflictError;
}
assertions.push({
  name: "A2 conflicting duplicate does not overwrite",
  ok: conflictDetected && rows.size === 1 && JSON.stringify(rows.get(firstAppend.recordKey)) === originalRow,
});

let invalidRejected = false;
try {
  await appendCapitalDataRecord(client, { ...first, value: null });
} catch {
  invalidRejected = true;
}
assertions.push({
  name: "A2 invalid record is rejected before persistence",
  ok: invalidRejected && rows.size === 1,
});

let precisionRejected = false;
try {
  await appendCapitalDataRecord(client, { ...first, value: 4.123456789 });
} catch {
  precisionRejected = true;
}
assertions.push({
  name: "A2 values beyond database decimal scale are rejected before persistence",
  ok: precisionRejected && rows.size === 1,
});

assertions.push({
  name: "A2 equivalent ISO timestamp spellings share one record key",
  ok:
    capitalRecordKey(first) ===
    capitalRecordKey({
      ...first,
      observedAt: "2024-01-31T08:00:00.000+08:00",
      publishedAt: "2024-02-02T08:00:00.000+08:00",
      asOf: "2024-02-02T08:00:00.000+08:00",
    }),
});

let invalidCutoffRejected = false;
try {
  await appendCapitalDataRecord(client, {
    ...first,
    asOf: "2024-02-01T00:00:00.000Z",
  });
} catch {
  invalidCutoffRejected = true;
}
assertions.push({
  name: "A2 publication after asOf is rejected before persistence",
  ok: invalidCutoffRejected && rows.size === 1,
});

const racing = racingFakePrisma();
const [raceInserted, raceRetried] = await Promise.all([
  appendCapitalDataRecord(racing.client, first),
  appendCapitalDataRecord(racing.client, { ...first, id: "fixture-rate-race-retry" }),
]);
assertions.push({
  name: "A2 concurrent duplicate converges through unique-key recovery",
  ok:
    new Set([raceInserted.inserted, raceRetried.inserted]).size === 2 &&
    racing.rows.size === 1,
});

await appendCapitalDataRecord(client, late);
const beforeLateRelease = await listCapitalDataRecordsAt(
  client,
  "2024-02-15T00:00:00.000Z",
);
assertions.push({
  name: "A1 cutoff excludes later publication",
  ok:
    beforeLateRelease.length === 1 &&
    beforeLateRelease[0]?.id === first.id &&
    beforeLateRelease[0]?.value === first.value &&
    beforeLateRelease[0]?.unit === first.unit &&
    beforeLateRelease[0]?.source.id === first.source.id &&
    beforeLateRelease[0]?.source.dataset === first.source.dataset &&
    beforeLateRelease[0]?.source.documentationUrl === first.source.documentationUrl &&
    beforeLateRelease[0]?.processingVersion === first.processingVersion &&
    beforeLateRelease[0]?.availability === first.availability,
  detail: JSON.stringify(beforeLateRelease),
});
const atExactPublication = await listCapitalDataRecordsAt(
  client,
  first.publishedAt!,
);
assertions.push({
  name: "A1 publication cutoff includes exact boundary",
  ok: atExactPublication.length === 1 && atExactPublication[0]?.id === first.id,
});

await appendCapitalDataRecord(client, gapped);
const afterGap = await listCapitalDataRecordsAt(client, "2024-05-01T00:00:00.000Z");
assertions.push({
  name: "A3 revision gap is degraded instead of backfilled",
  ok:
    afterGap.length === 1 &&
    afterGap[0]?.availability === CapitalAvailability.IncompleteReconstruction &&
    afterGap[0]?.value === null &&
    rows.size === 3 &&
    rows.has(firstAppend.recordKey) &&
    rows.has(capitalRecordKey(gapped)),
  detail: JSON.stringify(afterGap),
});

const statusRecord: CapitalDataRecord = {
  ...record("fixture-status", 1, "2024-02-03T00:00:00.000Z", 0),
  metricKey: "policy-status",
  value: null,
  unit: null,
  publishedAt: null,
  asOf: "2024-02-03T00:00:00.000Z",
  availability: CapitalAvailability.Unknown,
  statusReason: "provider snapshot unavailable",
};
await appendCapitalDataRecord(client, statusRecord, { traceId: "status-trace" });
const statusRows = await listCapitalDataRecordsAt(client, "2024-02-15T00:00:00.000Z", {
  metricKey: "policy-status",
});
assertions.push({
  name: "A1 non-value metadata survives repository round-trip",
  ok:
    statusRows.length === 1 &&
    statusRows[0]?.source.id === statusRecord.source.id &&
    statusRows[0]?.source.name === statusRecord.source.name &&
    statusRows[0]?.source.dataset === statusRecord.source.dataset &&
    statusRows[0]?.source.documentationUrl === statusRecord.source.documentationUrl &&
    statusRows[0]?.processingVersion === statusRecord.processingVersion &&
    statusRows[0]?.availability === statusRecord.availability &&
    statusRows[0]?.statusReason === statusRecord.statusReason &&
    statusRows[0]?.value === null,
  detail: JSON.stringify(statusRows),
});

const breadthEntry = getCapitalMetricCatalogEntry("cn-market-breadth");
if (breadthEntry === undefined || breadthEntry.sourceFieldMapping === null) {
  throw new Error("cn-market-breadth mapping missing");
}
const breadthMapping = observedMapping(breadthEntry.sourceFieldMapping);
const breadthInput: AshareObservationInput = {
  kind: "breadth",
  id: "breadth-2024-01-31",
  value: 100,
  observedAt: "2024-01-31T00:00:00.000Z",
  publishedAt: null,
  asOf: "2024-02-01T00:00:00.000Z",
  revision: 1,
  processingVersion: "ashare-v1",
  mapping: breadthMapping,
};
const breadthResult = mapAshareObservation(breadthInput);
assertions.push({
  name: "A3 observation-only breadth is non-valued",
  ok:
    breadthResult.record?.availability === CapitalAvailability.Unknown &&
    breadthResult.record.value === null &&
    breadthResult.record.statusReason?.includes("published_at") === true,
  detail: JSON.stringify(breadthResult),
});
const observationDateResult = mapAshareObservation({
  ...breadthInput,
  id: "breadth-date-2024-01-31",
  publishedAt: "2024-02-02T00:00:00.000Z",
});
assertions.push({
  name: "A3 observation-only date is not promoted to publishedAt",
  ok: observationDateResult.record?.publishedAt === null,
  detail: JSON.stringify(observationDateResult),
});

const related = breadthEntry.relatedSourceFieldMappings[0];
if (related === undefined) throw new Error("A-share related mapping missing");
const relatedResult = mapAshareObservation({
  ...breadthInput,
  kind: "index",
  id: "index-2024-01-31",
  mapping: observedMapping(related),
  statusReason: "related source explicitly failed",
});
assertions.push({
  name: "A3 related index mapping does not invent a metric",
  ok:
    relatedResult.record === null &&
    relatedResult.availability === CapitalAvailability.Unknown &&
    relatedResult.statusReason === "related source explicitly failed",
  detail: JSON.stringify(relatedResult),
});

const drifted = { ...breadthMapping, dataset: "changed-dataset" };
const driftResult = mapAshareObservation({ ...breadthInput, mapping: drifted });
assertions.push({
  name: "A4 mapping drift enters pending review",
  ok:
    driftResult.record?.availability === CapitalAvailability.PendingReview &&
    driftResult.record.value === null &&
    driftResult.record.source.dataset === "changed-dataset" &&
    driftResult.record.source.documentationUrl === null,
  detail: JSON.stringify(driftResult),
});

const sectorResult = mapAshareObservation({
  ...breadthInput,
  kind: "sector",
  id: "sector-2024-01-31",
  mapping: observedMapping(related),
});
assertions.push({
  name: "A3 related sector mapping stays non-promoted",
  ok:
    sectorResult.record === null &&
    sectorResult.availability === CapitalAvailability.Unknown,
  detail: JSON.stringify(sectorResult),
});

const unknownSourceResult = mapAshareObservation({
  ...breadthInput,
  mapping: { ...breadthMapping, sourceId: "new-unmapped-source" },
});

const sidecar = ashareSidecarFakePrisma();
const firstSidecarSync = await syncAshareCapitalEnvironmentRecords(sidecar.client, {
  traceId: "capital-sync-trace",
});
const sidecarBeforeCapture = await listCapitalDataRecordsAt(
  sidecar.client,
  "2024-01-31T23:59:59.999Z",
  { metricKey: "cn-market-breadth", market: CapitalMarket.China },
);
const sidecarAtCapture = await listCapitalDataRecordsAt(
  sidecar.client,
  "2024-02-01T00:00:00.000Z",
  { metricKey: "cn-market-breadth", market: CapitalMarket.China },
);
sidecar.advanceIngestedAt();
const repeatedSidecarSync = await syncAshareCapitalEnvironmentRecords(sidecar.client, {
  traceId: "capital-sync-trace",
});
assertions.push({
  name: "A3 sidecar index, sector, and breadth rows map without fabricated values",
  ok:
    firstSidecarSync.scanned.index === 1 &&
    firstSidecarSync.scanned.sector === 1 &&
    firstSidecarSync.scanned.breadth === 1 &&
    firstSidecarSync.inserted === 1 &&
    firstSidecarSync.skipped === 2 &&
    firstSidecarSync.availability[CapitalAvailability.Unknown] === 3 &&
    sidecarBeforeCapture.length === 0 &&
    sidecarAtCapture.length === 1 &&
    sidecar.rows.size === 1,
  detail: JSON.stringify(firstSidecarSync),
});
assertions.push({
  name: "A2 sidecar refresh is idempotent when mutable ingest time changes",
  ok:
    repeatedSidecarSync.inserted === 0 &&
    repeatedSidecarSync.unchanged === 1 &&
    sidecar.rows.size === 1,
  detail: JSON.stringify(repeatedSidecarSync),
});
const reprocessedSidecarSync = await syncAshareCapitalEnvironmentRecords(sidecar.client, {
  processingVersion: "capital-environment-ashare-v2",
  traceId: "capital-sync-trace",
});
assertions.push({
  name: "A2 processing-version changes append with a distinct primary key",
  ok:
    reprocessedSidecarSync.inserted === 1 &&
    reprocessedSidecarSync.skipped === 2 &&
    sidecar.rows.size === 2,
  detail: JSON.stringify(reprocessedSidecarSync),
});
const driftedSidecarSync = await syncAshareCapitalEnvironmentRecords(sidecar.client, {
  traceId: "capital-sync-trace",
  mappingOverrides: {
    breadth: { ...breadthMapping, dataset: "changed-sidecar-dataset" },
  },
});
const driftedSidecarRecords = await listCapitalDataRecordsAt(
  sidecar.client,
  "2100-01-01T00:00:00.000Z",
  { metricKey: "cn-market-breadth", market: CapitalMarket.China },
);
assertions.push({
  name: "A4 sidecar mapping drift persists an auditable pending-review record",
  ok:
    driftedSidecarSync.inserted === 1 &&
    driftedSidecarSync.availability[CapitalAvailability.PendingReview] === 1 &&
    driftedSidecarRecords.some(
      (entry) =>
        entry.availability === CapitalAvailability.PendingReview &&
        entry.value === null &&
        entry.source.dataset === "changed-sidecar-dataset (breadth sidecar)",
    ),
  detail: JSON.stringify(driftedSidecarSync),
});
const relatedDriftSidecar = ashareSidecarFakePrisma();
const relatedDriftSync = await syncAshareCapitalEnvironmentRecords(relatedDriftSidecar.client, {
  mappingOverrides: {
    index: { ...observedMapping(related), dataset: "changed-related-dataset" },
    sector: { ...observedMapping(related), dataset: "changed-related-dataset" },
  },
});
const relatedDriftRecords = await listCapitalDataRecordsAt(
  relatedDriftSidecar.client,
  "2100-01-01T00:00:00.000Z",
  { metricKey: "cn-market-breadth", market: CapitalMarket.China },
);
assertions.push({
  name: "A4 index and sector mapping drifts retain separate pending-review records",
  ok:
    relatedDriftSync.inserted === 3 &&
    relatedDriftSync.availability[CapitalAvailability.PendingReview] === 2 &&
    relatedDriftRecords.filter(
      (entry) => entry.availability === CapitalAvailability.PendingReview,
    ).length === 2 &&
    relatedDriftRecords.some(
      (entry) => entry.source.dataset === "changed-related-dataset (index sidecar)",
    ) &&
    relatedDriftRecords.some(
      (entry) => entry.source.dataset === "changed-related-dataset (sector sidecar)",
    ),
  detail: JSON.stringify(relatedDriftSync),
});

const indexFailureSidecar = indexFailureSidecarFakePrisma();
const partialSourceSync = await syncAshareCapitalEnvironmentRecords(indexFailureSidecar.client);
assertions.push({
  name: "A4 one failed sidecar source does not block other mapped records",
  ok:
    partialSourceSync.failed === 1 &&
    partialSourceSync.failedSources.length === 1 &&
    partialSourceSync.failedSources[0] === "index" &&
    partialSourceSync.scanned.index === 0 &&
    partialSourceSync.scanned.sector === 1 &&
    partialSourceSync.scanned.breadth === 1 &&
    partialSourceSync.inserted === 2 &&
    partialSourceSync.availability[CapitalAvailability.Failed] === 1 &&
    indexFailureSidecar.rows.size === 2,
  detail: JSON.stringify(partialSourceSync),
});
const failedSourceRecords = await listCapitalDataRecordsAt(
  indexFailureSidecar.client,
  "2100-01-01T00:00:00.000Z",
  { metricKey: "cn-market-breadth", market: CapitalMarket.China },
);
assertions.push({
  name: "A4/A5 failed sidecar reads persist auditable non-value records at their actual observation time",
  ok: failedSourceRecords.some(
    (entry) =>
      entry.availability === CapitalAvailability.Failed &&
      entry.source.id === "cn-akshare-index-sector" &&
      entry.value === null &&
      entry.asOf !== entry.observedAt &&
      entry.statusReason?.includes("index sidecar read failed") === true,
  ),
  detail: JSON.stringify(failedSourceRecords),
});
const repeatedPartialSourceSync = await syncAshareCapitalEnvironmentRecords(indexFailureSidecar.client);
assertions.push({
  name: "A2 persistent source failures preserve their first observed status",
  ok:
    repeatedPartialSourceSync.failed === 1 &&
    repeatedPartialSourceSync.unchanged === 2 &&
    indexFailureSidecar.rows.size === 2,
  detail: JSON.stringify(repeatedPartialSourceSync),
});
const relatedSourceFailures = relatedSourceFailuresSidecarFakePrisma();
const relatedFailureSync = await syncAshareCapitalEnvironmentRecords(relatedSourceFailures.client);
assertions.push({
  name: "A4 related sidecar failures each persist even with one catalog source",
  ok:
    relatedFailureSync.failed === 2 &&
    relatedFailureSync.failedSources.join(",") === "index,sector" &&
    relatedFailureSync.availability[CapitalAvailability.Failed] === 2 &&
    relatedSourceFailures.rows.size === 3,
  detail: JSON.stringify(relatedFailureSync),
});
const emptySources = emptySourceSidecarFakePrisma();
const emptySourceSync = await syncAshareCapitalEnvironmentRecords(emptySources.client);
const repeatedEmptySourceSync = await syncAshareCapitalEnvironmentRecords(emptySources.client);
const emptySourceRows = [...emptySources.rows.values()];
assertions.push({
  name: "A4 empty sidecar sources persist auditable current unknown states without duplication",
  ok:
    emptySourceSync.inserted === 3 &&
    emptySourceSync.availability[CapitalAvailability.Unknown] === 3 &&
    repeatedEmptySourceSync.inserted === 0 &&
    repeatedEmptySourceSync.unchanged === 3 &&
    emptySources.rows.size === 3 &&
    emptySourceRows.every(
      (entry) =>
        (entry.asOf as Date).getTime() !== (entry.observedAt as Date).getTime(),
    ),
  detail: JSON.stringify({ emptySourceSync, repeatedEmptySourceSync }),
});
const failedStatusPersistence = statusPersistenceFailureSidecarFakePrisma();
let statusPersistenceFailedLoudly = false;
try {
  await syncAshareCapitalEnvironmentRecords(failedStatusPersistence.client);
} catch (error) {
  statusPersistenceFailedLoudly =
    error instanceof Error && error.message === "capital status store unavailable";
}
assertions.push({
  name: "A4 failure-status persistence errors remain loud for queue retry",
  ok: statusPersistenceFailedLoudly && failedStatusPersistence.rows.size === 0,
});
const failedMappedPersistence = mappedPersistenceFailureSidecarFakePrisma();
let mappedPersistenceFailedLoudly = false;
try {
  await syncAshareCapitalEnvironmentRecords(failedMappedPersistence.client);
} catch (error) {
  mappedPersistenceFailedLoudly =
    error instanceof Error && error.message === "capital mapped record store unavailable";
}
assertions.push({
  name: "A4 mapped-record persistence errors remain loud for queue retry",
  ok: mappedPersistenceFailedLoudly && failedMappedPersistence.rows.size === 0,
});
assertions.push({
  name: "A4 unknown source mapping degrades without aborting",
  ok:
    unknownSourceResult.record === null &&
    unknownSourceResult.availability === CapitalAvailability.PendingReview,
  detail: JSON.stringify(unknownSourceResult),
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
