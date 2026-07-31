/**
 * Deterministic acceptance checks for Issue #57's two-point trend comparison
 * read model. Uses an isolated fake Prisma (no network, no real DB) that
 * honors #47's point-in-time query semantics, mirroring the #55 selfcheck.
 */

import { compareCapitalEnvironment } from "./comparison-service.js";
import { TrendDirection } from "./comparison-service.js";
import { appendCapitalDataRecord } from "./record-repository.js";
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

/** Fake Prisma supporting the capital-environment records table (#47 query semantics). */
function fakePrisma() {
  const rows = new Map<string, StoredRow>();
  const client = {
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return rows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.recordKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        rows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
        orderBy,
      }: { where?: CapitalWhere; orderBy?: CapitalOrderBy } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallbackCutoff = where?.OR?.[1]?.asOf.lte;
        const selected = [...rows.values()].filter((row) => {
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
      async findMany() {
        return [];
      },
    },
  } as unknown as PrismaClient;
  return { client, rows };
}

function record(overrides: Partial<CapitalDataRecord> = {}): CapitalDataRecord {
  return {
    id: "fixture-1",
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

// ---- A1/A2: improved direction with provenance on both sides ----
// revision 1 (value 5.5) visible at fromAsOf; revision 2 (value 5.0) visible
// only at toAsOf → direction deteriorated (value decreased).
const store = fakePrisma();
await appendCapitalDataRecord(
  store.client,
  record({ id: "r1", revision: 1, value: 5.5, publishedAt: "2024-02-02T00:00:00.000Z", asOf: "2024-02-02T00:00:00.000Z" }),
);
await appendCapitalDataRecord(
  store.client,
  record({ id: "r2", revision: 2, value: 5.0, publishedAt: "2024-04-02T00:00:00.000Z", asOf: "2024-04-02T00:00:00.000Z" }),
);
const comparison = await compareCapitalEnvironment(
  store.client,
  "2024-03-01T00:00:00.000Z",
  "2024-05-01T00:00:00.000Z",
);
const us = comparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!;
const usFunding = us.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
const usFundingMetric = usFunding.metrics.find((m) => m.metricKey === "us-funding-price")!;
assertions.push({
  name: "A1 deteriorated direction when value decreased across cutoffs",
  ok:
    usFunding.direction === TrendDirection.Deteriorated &&
    usFundingMetric.direction === TrendDirection.Deteriorated,
  detail: JSON.stringify({ dimDir: usFunding.direction, metricDir: usFundingMetric.direction }),
});
assertions.push({
  name: "A2 both sides carry provenance (source/publishedAt/processingVersion/value)",
  ok:
    usFundingMetric.from.record?.source.id === "us-fred" &&
    usFundingMetric.from.record?.value === 5.5 &&
    usFundingMetric.from.record?.publishedAt === "2024-02-02T00:00:00.000Z" &&
    usFundingMetric.to.record?.value === 5.0 &&
    usFundingMetric.to.record?.publishedAt === "2024-04-02T00:00:00.000Z" &&
    usFundingMetric.to.record?.processingVersion === "fred-v1",
  detail: JSON.stringify({ from: usFundingMetric.from.record?.value, to: usFundingMetric.to.record?.value }),
});

// A1: improved direction when value increases.
const incStore = fakePrisma();
await appendCapitalDataRecord(incStore.client, record({ id: "r1", revision: 1, value: 4.0, publishedAt: "2024-02-02T00:00:00.000Z", asOf: "2024-02-02T00:00:00.000Z" }));
await appendCapitalDataRecord(incStore.client, record({ id: "r2", revision: 2, value: 4.5, publishedAt: "2024-04-02T00:00:00.000Z", asOf: "2024-04-02T00:00:00.000Z" }));
const incComparison = await compareCapitalEnvironment(incStore.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
const incFunding = incComparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A1 improved direction when value increased across cutoffs",
  ok: incFunding.direction === TrendDirection.Improved,
  detail: JSON.stringify({ dir: incFunding.direction }),
});

// A1: unchanged direction when value identical.
const sameStore = fakePrisma();
await appendCapitalDataRecord(sameStore.client, record({ id: "r1", revision: 1, value: 5.0, publishedAt: "2024-02-02T00:00:00.000Z", asOf: "2024-02-02T00:00:00.000Z" }));
await appendCapitalDataRecord(sameStore.client, record({ id: "r2", revision: 2, value: 5.0, publishedAt: "2024-04-02T00:00:00.000Z", asOf: "2024-04-02T00:00:00.000Z" }));
const sameComparison = await compareCapitalEnvironment(sameStore.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
const sameFunding = sameComparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A1 unchanged direction when value identical across cutoffs",
  ok: sameFunding.direction === TrendDirection.Unchanged,
});

// ---- A3: degraded side → unknown, no direction inferred ----
// Only revision 1 exists; toAsOf sees nothing new but the dimension still has
// the r1 record visible at both cutoffs → unchanged. To force unknown, make the
// to-side dimension degraded by inserting an incomplete_reconstruction record
// visible only at toAsOf (revision gap: r1 then r3, no r2).
const gapStore = fakePrisma();
await appendCapitalDataRecord(gapStore.client, record({ id: "g1", revision: 1, value: 5.5, publishedAt: "2024-02-02T00:00:00.000Z", asOf: "2024-02-02T00:00:00.000Z" }));
await appendCapitalDataRecord(gapStore.client, record({ id: "g3", revision: 3, value: 5.0, publishedAt: "2024-06-02T00:00:00.000Z", asOf: "2024-06-02T00:00:00.000Z" }));
const gapComparison = await compareCapitalEnvironment(gapStore.client, "2024-03-01T00:00:00.000Z", "2024-07-01T00:00:00.000Z");
const gapFunding = gapComparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A3 revision-gap degradation on to-side → unknown direction",
  ok:
    gapFunding.direction === TrendDirection.Unknown &&
    gapFunding.toAvailability === CapitalAvailability.IncompleteReconstruction,
  detail: JSON.stringify({ dir: gapFunding.direction, toAvail: gapFunding.toAvailability }),
});

// A3: both sides no data → unknown.
const emptyStore = fakePrisma();
const emptyComparison = await compareCapitalEnvironment(emptyStore.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
const emptyFunding = emptyComparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!;
assertions.push({
  name: "A3 dimension with no data on either side → unknown, not omitted",
  ok:
    emptyFunding.direction === TrendDirection.Unknown &&
    emptyFunding.fromAvailability === CapitalAvailability.Unknown &&
    emptyFunding.toAvailability === CapitalAvailability.Unknown &&
    emptyFunding.metrics.length === 0,
  detail: JSON.stringify({ dir: emptyFunding.direction }),
});

// A3: calibre incompatibility (different unit) → unknown.
const incompatStore = fakePrisma();
await appendCapitalDataRecord(incompatStore.client, record({ id: "i1", revision: 1, value: 5.5, unit: "percent", publishedAt: "2024-02-02T00:00:00.000Z", asOf: "2024-02-02T00:00:00.000Z" }));
await appendCapitalDataRecord(incompatStore.client, record({ id: "i2", revision: 2, value: 5500, unit: "basis_points", publishedAt: "2024-04-02T00:00:00.000Z", asOf: "2024-04-02T00:00:00.000Z" }));
const incompatComparison = await compareCapitalEnvironment(incompatStore.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
const incompatMetric = incompatComparison.markets.find((m) => m.market === CapitalMarket.UnitedStates)!.dimensions.find((d) => d.dimension === CapitalDimension.FundingPrice)!.metrics[0]!;
assertions.push({
  name: "A3 unit incompatibility between sides → unknown with reason",
  ok:
    incompatMetric.direction === TrendDirection.Unknown &&
    incompatMetric.statusReason?.includes("incompatible") === true,
  detail: JSON.stringify({ dir: incompatMetric.direction, reason: incompatMetric.statusReason }),
});

// ---- A4: no aggregate score / bull-bear verdict ----
assertions.push({
  name: "A4 result exposes no aggregate score or bull/bear verdict field",
  ok:
    !("score" in comparison) &&
    !("verdict" in comparison) &&
    !("bullBear" in comparison) &&
    !("recommendation" in comparison) &&
    comparison.markets.every((m) => !("score" in m) && !("verdict" in m)),
  detail: "result keys: " + Object.keys(comparison).join(","),
});

// ---- A5: determinism — same input → deep-equal result ----
const run1 = await compareCapitalEnvironment(store.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
const run2 = await compareCapitalEnvironment(store.client, "2024-03-01T00:00:00.000Z", "2024-05-01T00:00:00.000Z");
assertions.push({
  name: "A5 repeated comparison of the same snapshot is stable (deep equal)",
  ok: JSON.stringify(run1) === JSON.stringify(run2),
});

// ---- A1: every market has all 7 dimensions ----
assertions.push({
  name: "A1 every market exposes all 7 dimensions in the comparison",
  ok: comparison.markets.every((m) => m.dimensions.length === 7) && comparison.markets.length === 4,
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
