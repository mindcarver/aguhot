/**
 * Deterministic acceptance checks for Issue #55's point-in-time replay read
 * model. Uses an isolated fake Prisma (no network, no real DB) that honors the
 * #47/#48 point-in-time query semantics, mirroring the #47/#51 selfcheck
 * pattern.
 */

import { replayCapitalEnvironmentAt } from "./replay-service.js";
import { listCapitalDataRecordsAt } from "./record-repository.js";
import { appendCapitalDataRecord } from "./record-repository.js";
import { capitalRecordKey } from "./point-in-time.js";
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

type StoredRow = Record<string, unknown> & { recordKey: string; id: string };

type CapitalWhere = {
  metricKey?: string;
  market?: string;
  OR?: readonly [
    { publishedAt: { lte: Date } },
    { publishedAt: null; asOf: { lte: Date } },
  ];
};

type CapitalOrderBy = readonly [
  { observedAt: "asc" | "desc" },
  { revision: "asc" | "desc" },
];

type SnapshotRow = Record<string, unknown> & { snapshotKey: string; id: string };

/**
 * Fake Prisma supporting both the capital-environment records table (#47) and
 * the fund concentration snapshots table (#48), with their respective
 * point-in-time query semantics.
 */
function fakePrisma() {
  const capitalRows = new Map<string, StoredRow>();
  const snapshotRows = new Map<string, SnapshotRow>();
  const client = {
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return capitalRows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (capitalRows.has(data.recordKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        capitalRows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
        orderBy,
      }: { where?: CapitalWhere; orderBy?: CapitalOrderBy } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallbackCutoff = where?.OR?.[1]?.asOf.lte;
        const selected = [...capitalRows.values()].filter((row) => {
          if (where?.metricKey !== undefined && row.metricKey !== where.metricKey) return false;
          if (where?.market !== undefined && row.market !== where.market) return false;
          if (cutoff !== undefined && fallbackCutoff !== undefined) {
            const publishedAt = row.publishedAt as Date | null;
            const asOf = row.asOf as Date;
            if (publishedAt !== null ? publishedAt > cutoff : asOf > fallbackCutoff) return false;
          }
          return true;
        });
        if (orderBy !== undefined) {
          selected.sort((left, right) => {
            const observed = (left.observedAt as Date).getTime() - (right.observedAt as Date).getTime();
            if (observed !== 0) return orderBy[0].observedAt === "asc" ? observed : -observed;
            const revision = Number(left.revision) - Number(right.revision);
            return orderBy[1].revision === "asc" ? revision : -revision;
          });
        }
        return selected;
      },
    },
    fundConcentrationSnapshot: {
      async findUnique({ where }: { where: { snapshotKey: string } }) {
        return snapshotRows.get(where.snapshotKey) ?? null;
      },
      async create({ data }: { data: SnapshotRow }) {
        if (snapshotRows.has(data.snapshotKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        snapshotRows.set(data.snapshotKey, data);
        return data;
      },
      async findMany({
        orderBy,
      }: { orderBy?: readonly { asOf?: "asc" | "desc"; processingVersion?: "asc" | "desc"; calculationVersion?: "asc" | "desc" }[] } = {}) {
        const selected = [...snapshotRows.values()];
        if (orderBy !== undefined) {
          selected.sort((left, right) => {
            for (const clause of orderBy) {
              if (clause.asOf !== undefined) {
                const cmp = (left.asOf as Date).getTime() - (right.asOf as Date).getTime();
                if (cmp !== 0) return clause.asOf === "asc" ? cmp : -cmp;
              }
              if (clause.processingVersion !== undefined) {
                const cmp = String(left.processingVersion).localeCompare(String(right.processingVersion));
                if (cmp !== 0) return clause.processingVersion === "asc" ? cmp : -cmp;
              }
              if (clause.calculationVersion !== undefined) {
                const cmp = String(left.calculationVersion).localeCompare(String(right.calculationVersion));
                if (cmp !== 0) return clause.calculationVersion === "asc" ? cmp : -cmp;
              }
            }
            return 0;
          });
        }
        return selected;
      },
    },
  } as unknown as PrismaClient;
  return { client, capitalRows, snapshotRows };
}

function capitalRecord(overrides: Partial<CapitalDataRecord> = {}): CapitalDataRecord {
  return {
    id: "fixture-record-1",
    metricKey: "us-funding-price",
    market: CapitalMarket.UnitedStates,
    dimension: CapitalDimension.FundingPrice,
    value: 5.5,
    unit: "percent",
    observedAt: "2024-01-31T00:00:00.000Z",
    publishedAt: "2024-02-02T00:00:00.000Z",
    asOf: "2024-02-02T00:00:00.000Z",
    source: {
      id: "us-fred",
      name: "Federal Reserve Economic Data",
      dataset: "DFF",
      documentationUrl: "https://fred.stlouisfed.org/",
    },
    processingVersion: "fred-v1",
    availability: CapitalAvailability.Available,
    statusReason: null,
    revision: 1,
    ...overrides,
  };
}

const assertions: Assertion[] = [];

// ---- A1/A2/A3: valid replay with one available US dimension ----
const store = fakePrisma();
await appendCapitalDataRecord(store.client, capitalRecord());
const replay = await replayCapitalEnvironmentAt(store.client, "2024-02-15T00:00:00.000Z");
const us = replay.markets.find((m) => m.market === CapitalMarket.UnitedStates)!;
const usFunding = us.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A1 replay aggregates the visible record under the right market/dimension",
  ok:
    replay.asOf === "2024-02-15T00:00:00.000Z" &&
    replay.markets.length === 4 &&
    usFunding.records.length === 1 &&
    usFunding.records[0]?.value === 5.5 &&
    usFunding.availability === CapitalAvailability.Available,
  detail: JSON.stringify({ markets: replay.markets.length, usFunding: usFunding.records.length }),
});

// A1: point-in-time boundary — a record published AFTER asOf must not appear.
const beforeRelease = await replayCapitalEnvironmentAt(store.client, "2024-02-01T00:00:00.000Z");
const beforeUsFunding = beforeRelease.markets
  .find((m) => m.market === CapitalMarket.UnitedStates)!
  .dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A1 record published after asOf is excluded (point-in-time boundary)",
  ok: beforeUsFunding.records.length === 0 && beforeUsFunding.availability === CapitalAvailability.Unknown,
  detail: JSON.stringify({ records: beforeUsFunding.records.length, availability: beforeUsFunding.availability }),
});

// A1: exact boundary — publishedAt == asOf is included.
const exactBoundary = await replayCapitalEnvironmentAt(store.client, "2024-02-02T00:00:00.000Z");
const exactUsFunding = exactBoundary.markets
  .find((m) => m.market === CapitalMarket.UnitedStates)!
  .dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A1 record with publishedAt == asOf is included at the boundary",
  ok: exactUsFunding.records.length === 1 && exactUsFunding.records[0]?.value === 5.5,
});

// A2/A3: provenance preserved on the resolved record.
assertions.push({
  name: "A2/A3 resolved record carries value, source, publishedAt, processingVersion, availability",
  ok:
    usFunding.records[0]?.source.id === "us-fred" &&
    usFunding.records[0]?.publishedAt === "2024-02-02T00:00:00.000Z" &&
    usFunding.records[0]?.processingVersion === "fred-v1" &&
    usFunding.records[0]?.unit === "percent" &&
    usFunding.records[0]?.availability === CapitalAvailability.Available,
  detail: JSON.stringify(usFunding.records[0]).slice(0, 160),
});

// ---- A4: empty dimension is surfaced as unknown, not omitted ----
const cn = replay.markets.find((m) => m.market === CapitalMarket.China)!;
const cnGrowth = cn.dimensions.find((d) => d.dimension === CapitalDimension.Growth)!;
assertions.push({
  name: "A4 dimension with no visible records is degraded, not omitted",
  ok:
    cnGrowth.records.length === 0 &&
    cnGrowth.availability === CapitalAvailability.Unknown &&
    cnGrowth.statusReason?.includes("no point-in-time") === true,
  detail: JSON.stringify(cnGrowth),
});

// A4: every market has exactly 7 dimensions (none omitted).
assertions.push({
  name: "A4 every market exposes all 7 dimensions",
  ok: replay.markets.every((m) => m.dimensions.length === 7),
});

// A4: partial coverage — US has one available dimension, rest degraded.
assertions.push({
  name: "A4 mixed availability yields market-level partial coverage",
  ok:
    us.availability === CapitalAvailability.Partial &&
    replay.availability === CapitalAvailability.Partial,
  detail: JSON.stringify({ usAvailability: us.availability, overall: replay.availability }),
});

// ---- A2: revision gap degradation passes through ----
const gapStore = fakePrisma();
await appendCapitalDataRecord(gapStore.client, capitalRecord({ revision: 1, value: 5.5, id: "gap-r1" }));
await appendCapitalDataRecord(gapStore.client, capitalRecord({ revision: 3, value: 5.0, id: "gap-r3" }));
const gapReplay = await replayCapitalEnvironmentAt(gapStore.client, "2024-12-31T00:00:00.000Z");
const gapDim = gapReplay.markets
  .find((m) => m.market === CapitalMarket.UnitedStates)!
  .dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A2 revision-gap incomplete_reconstruction passes through to the replay dimension",
  ok:
    gapDim.records.length === 1 &&
    gapDim.records[0]?.availability === CapitalAvailability.IncompleteReconstruction &&
    gapDim.records[0]?.value === null,
  detail: JSON.stringify(gapDim.records[0]).slice(0, 160),
});

// ---- A5: determinism — same input → deep-equal result ----
const run1 = await replayCapitalEnvironmentAt(store.client, "2024-02-15T00:00:00.000Z");
const run2 = await replayCapitalEnvironmentAt(store.client, "2024-02-15T00:00:00.000Z");
assertions.push({
  name: "A5 repeated replay of the same snapshot is stable (deep equal)",
  ok: JSON.stringify(run1) === JSON.stringify(run2),
});

// ---- A1: fund concentration snapshots field reflects #48 read path ----
// The replay layer delegates to #48's listFundConcentrationSnapshotsAt (already
// acceptance-verified in #48). With an empty snapshots table the replay result
// exposes an empty fundConcentrationSnapshots array, proving the field is wired
// and the replay does not fabricate snapshots.
const fundStore = fakePrisma();
await appendCapitalDataRecord(fundStore.client, capitalRecord());
const fundReplay = await replayCapitalEnvironmentAt(fundStore.client, "2024-02-15T00:00:00.000Z");
assertions.push({
  name: "A1 fundConcentrationSnapshots field wired (empty when no snapshots)",
  ok: Array.isArray(fundReplay.fundConcentrationSnapshots) && fundReplay.fundConcentrationSnapshots.length === 0,
  detail: JSON.stringify({ snapshots: fundReplay.fundConcentrationSnapshots.length }),
});

// ---- A6: read-back via listCapitalDataRecordsAt matches replay records ----
const directRead = await listCapitalDataRecordsAt(store.client, "2024-02-15T00:00:00.000Z");
assertions.push({
  name: "A6 replay records align with direct listCapitalDataRecordsAt read",
  ok:
    directRead.length === usFunding.records.length &&
    directRead[0]?.id === usFunding.records[0]?.id &&
    directRead[0]?.value === usFunding.records[0]?.value,
  detail: JSON.stringify({ direct: directRead.length, replay: usFunding.records.length }),
});

const failed = assertions.filter((a) => !a.ok);
for (const a of assertions) {
  console.log(`${a.ok ? "PASS" : "FAIL"} ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed.`);
  process.exit(1);
}
console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);

// Touch imports used for type-level guarantees.
void capitalRecordKey;
