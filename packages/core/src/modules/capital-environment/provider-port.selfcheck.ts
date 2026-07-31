/**
 * Deterministic acceptance checks for Issue #51's capital provider port,
 * append service, and resolver skeleton. Uses an isolated fake Prisma (no
 * network, no real DB), mirroring the #47/#48 selfcheck pattern.
 */

import {
  appendCapitalDataRecord,
  CapitalRecordConflictError,
  listCapitalDataRecordsAt,
} from "./record-repository.js";
import { appendCapitalProviderObservations } from "./provider-service.js";
import type {
  CapitalProviderPort,
  CapitalProviderRequest,
  ProviderObservation,
  ProviderObservationBatch,
} from "./provider-port.js";
import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "./types.js";
import type { CapitalDataRecord } from "./types.js";
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
            )
              return false;
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

function usObservation(overrides: Partial<ProviderObservation> = {}): ProviderObservation {
  return {
    metricKey: "us.funding_rate.effective_federal_funds",
    market: CapitalMarket.UnitedStates,
    dimension: CapitalDimension.FundingPrice,
    value: 4.5,
    unit: "percent",
    observedAt: "2024-01-31T00:00:00.000Z",
    publishedAt: "2024-02-02T00:00:00.000Z",
    source: {
      id: "us-fred",
      name: "Federal Reserve Economic Data",
      dataset: "DFF",
      documentationUrl: "https://fred.stlouisfed.org/series/DFF",
    },
    processingVersion: "fred-v1",
    availability: CapitalAvailability.Available,
    statusReason: null,
    revision: 1,
    ...overrides,
  };
}

function batch(
  providerId: string,
  observations: readonly ProviderObservation[],
  availability: CapitalAvailability = CapitalAvailability.Available,
  statusReason: string | null = null,
): ProviderObservationBatch {
  return { providerId, observations, availability, statusReason };
}

const assertions: Assertion[] = [];

// A1: port shape — the interface is structural; verify a minimal implementation
// satisfies CapitalProviderPort and round-trips a batch.
const stubPort: CapitalProviderPort = {
  providerId: "stub-provider",
  async fetchObservations(request: CapitalProviderRequest) {
    return batch(request.traceId, [usObservation()]);
  },
};
const stubRequest: CapitalProviderRequest = {
  observedFrom: "2024-01-01T00:00:00.000Z",
  observedTo: "2024-02-28T00:00:00.000Z",
  traceId: "stub-trace",
};
const stubBatch = await stubPort.fetchObservations(stubRequest);
assertions.push({
  name: "A1 CapitalProviderPort implementation round-trips a batch",
  ok:
    stubBatch.providerId === stubRequest.traceId &&
    stubBatch.observations.length === 1 &&
    stubBatch.observations[0]?.metricKey === "us.funding_rate.effective_federal_funds",
  detail: JSON.stringify(stubBatch).slice(0, 200),
});

// A2: valid observation composes into a CapitalDataRecord and appends once;
// repeat is idempotent; a conflicting value is rejected.
const store = fakePrisma();
const validBatch = batch("us-fred", [usObservation()]);
const firstAppend = await appendCapitalProviderObservations(store.client, validBatch, {
  asOf: "2024-03-01T00:00:00.000Z",
  traceId: "fred-trace",
});
const repeatedAppend = await appendCapitalProviderObservations(store.client, validBatch, {
  asOf: "2024-03-01T00:00:00.000Z",
  traceId: "fred-trace",
});
assertions.push({
  name: "A2 valid observation appends once and repeats idempotently",
  ok:
    firstAppend.inserted === 1 &&
    repeatedAppend.inserted === 0 &&
    repeatedAppend.unchanged === 1 &&
    store.rows.size === 1,
  detail: JSON.stringify({ firstAppend, repeatedAppend, rowCount: store.rows.size }),
});

let conflictCaught = false;
const beforeConflict = JSON.stringify([...store.rows.values()]);
try {
  await appendCapitalProviderObservations(
    store.client,
    batch("us-fred", [usObservation({ value: 4.25 })]),
    { asOf: "2024-03-01T00:00:00.000Z" },
  );
} catch (error) {
  conflictCaught = error instanceof CapitalRecordConflictError;
}
assertions.push({
  name: "A2 conflicting observation is rejected without overwrite",
  ok: conflictCaught && store.rows.size === 1 && JSON.stringify([...store.rows.values()]) === beforeConflict,
});

// A2: revision append — a new revision of the same observation appends a new row.
const revisionStore = fakePrisma();
await appendCapitalProviderObservations(
  revisionStore.client,
  batch("us-fred", [usObservation({ revision: 1, value: 4.5 })]),
  { asOf: "2024-03-01T00:00:00.000Z" },
);
await appendCapitalProviderObservations(
  revisionStore.client,
  batch("us-fred", [usObservation({ revision: 2, value: 4.4 })]),
  { asOf: "2024-03-01T00:00:00.000Z" },
);
assertions.push({
  name: "A2 new revision appends without overwriting the prior row",
  ok: revisionStore.rows.size === 2,
  detail: `rows=${revisionStore.rows.size}`,
});

// A2: read-back via #47 listCapitalDataRecordsAt confirms composition is valid.
const readable = await listCapitalDataRecordsAt(store.client, "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A2 composed record is readable via listCapitalDataRecordsAt",
  ok:
    readable.length === 1 &&
    readable[0]?.source.id === "us-fred" &&
    readable[0]?.value === 4.5 &&
    readable[0]?.unit === "percent" &&
    readable[0]?.availability === CapitalAvailability.Available,
  detail: JSON.stringify(readable).slice(0, 200),
});

// A3: publishedAt=null demotes an available observation to unknown (non-value),
// and the observation date is never promoted to publishedAt.
const nullPubStore = fakePrisma();
const nullPubBatch = batch(
  "us-fred",
  [usObservation({ publishedAt: null })],
);
const nullPubResult = await appendCapitalProviderObservations(nullPubStore.client, nullPubBatch, {
  asOf: "2024-03-01T00:00:00.000Z",
});
const nullPubRecords = await listCapitalDataRecordsAt(nullPubStore.client, "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A3 publishedAt=null demotes to unknown non-value, observation date not promoted",
  ok:
    nullPubResult.inserted === 1 &&
    nullPubRecords.length === 1 &&
    nullPubRecords[0]?.availability === CapitalAvailability.Unknown &&
    nullPubRecords[0]?.value === null &&
    nullPubRecords[0]?.publishedAt === null &&
    nullPubRecords[0]?.statusReason?.includes("publishedAt unavailable") === true,
  detail: JSON.stringify(nullPubRecords[0]).slice(0, 200),
});

// A3: publishedAt later than asOf is intercepted as pending_review (non-value).
// The original violating publishedAt is preserved in statusReason; the record's
// own publishedAt becomes the cutoff so #47's publishedAt<=asOf invariant holds.
const futureStore = fakePrisma();
const futureBatch = batch(
  "us-fred",
  [usObservation({ publishedAt: "2024-04-15T00:00:00.000Z" })],
);
const futureResult = await appendCapitalProviderObservations(futureStore.client, futureBatch, {
  asOf: "2024-03-01T00:00:00.000Z",
});
const futureRecords = await listCapitalDataRecordsAt(futureStore.client, "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A3 publishedAt > asOf intercepted as pending_review, value withheld",
  ok:
    futureResult.pendingReview === 1 &&
    futureRecords.length === 1 &&
    futureRecords[0]?.availability === CapitalAvailability.PendingReview &&
    futureRecords[0]?.value === null &&
    futureRecords[0]?.statusReason?.includes("2024-04-15T00:00:00.000Z") === true &&
    [...futureStore.rows.values()].every((row) => row.value === null),
  detail: JSON.stringify(futureRecords[0]).slice(0, 200),
});

// A4: a failed batch with no observations writes a provider-level failed audit
// record count; it does not throw.
const failedStore = fakePrisma();
const failedBatch = batch(
  "us-fred",
  [],
  CapitalAvailability.Failed,
  "FRED API rate limit exceeded",
);
let failedThrew = false;
let failedResult;
try {
  failedResult = await appendCapitalProviderObservations(failedStore.client, failedBatch, {
    asOf: "2024-03-01T00:00:00.000Z",
  });
} catch {
  failedThrew = true;
}
assertions.push({
  name: "A4 failed empty batch is auditable and does not throw",
  ok:
    !failedThrew &&
    failedResult !== undefined &&
    failedResult.failed === 1 &&
    failedResult.inserted === 0,
  detail: JSON.stringify(failedResult),
});

// A4: a partial batch (some available, some failed per-observation) persists
// the available observations and counts honestly.
const partialStore = fakePrisma();
const partialBatch = batch(
  "us-fred",
  [
    usObservation({ metricKey: "us.funding_rate.effective_federal_funds", value: 4.5 }),
    usObservation({
      metricKey: "us.growth.gdp_real_yoy",
      dimension: CapitalDimension.Growth,
      availability: CapitalAvailability.Failed,
      value: null,
      unit: null,
      statusReason: "GDPC1 series unavailable",
    }),
  ],
  CapitalAvailability.Partial,
  "one series failed",
);
const partialResult = await appendCapitalProviderObservations(partialStore.client, partialBatch, {
  asOf: "2024-03-01T00:00:00.000Z",
});
const partialRecords = await listCapitalDataRecordsAt(partialStore.client, "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A4 partial batch persists available observations and failed non-value observations",
  ok:
    partialResult.inserted === 2 &&
    partialRecords.some((r) => r.value === 4.5 && r.availability === CapitalAvailability.Available) &&
    partialRecords.some(
      (r) =>
        r.availability === CapitalAvailability.Failed &&
        r.value === null &&
        r.statusReason === "GDPC1 series unavailable",
    ),
  detail: JSON.stringify(partialResult),
});

// A6: empty observations with available batch-level state is a no-op (not failed).
const emptyStore = fakePrisma();
const emptyResult = await appendCapitalProviderObservations(
  emptyStore.client,
  batch("us-fred", []),
  { asOf: "2024-03-01T00:00:00.000Z" },
);
assertions.push({
  name: "A6 empty available batch is a no-op without fabricating failed",
  ok:
    emptyResult.inserted === 0 &&
    emptyResult.failed === 0 &&
    emptyStore.rows.size === 0,
  detail: JSON.stringify(emptyResult),
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

// Touch imports used for type-level assertions so they are not elided.
void appendCapitalDataRecord;
void (null as unknown as CapitalDataRecord);
