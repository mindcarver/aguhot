/**
 * End-to-end integration acceptance for Issue #70 (snapshot-integration-gate,
 * Initiative #71).
 *
 * Composes the assembled snapshot store system across slices and verifies the
 * cross-slice contracts that no single child Issue's selfcheck proves:
 *   snapshot capture (#67 append) → conversion (#68 snapshotsToProviderBatch,
 *   AD-SNAP-1 publishedAt=firstCapturedAt) → record append (#51/#47) → replay
 *   (#55) → conclusion (#58).
 *
 * Validates: China GDP/CPI reach the dashboard point-in-time-compliant via the
 * snapshot path; publishedAt = capture time is honest (labeled, not official
 * release); point-in-time safety holds (data withheld before capture);
 * degradation is honest (failed/empty → unknown, no zero-fill); determinism.
 *
 * Uses an isolated fake Prisma (no network, no real DB, no sidecar spawn).
 */

import {
  appendCapitalProviderSnapshot,
  appendCapitalProviderObservations,
  snapshotsToProviderBatch,
  replayCapitalEnvironmentAt,
  CapitalAvailability as Avail,
  type SnapshotValueExtractor,
  type CapitalSnapshotInput,
  type Prisma,
} from "@aguhot/core";
import { getPrisma } from "@aguhot/core";
import { buildCapitalConclusion } from "./capital-conclusion.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type RecordRow = Record<string, unknown> & { recordKey: string; id: string };
type SnapshotRow = Record<string, unknown> & { snapshotKey: string; id: string; providerId: string };

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

function fakePrisma() {
  const recordRows = new Map<string, RecordRow>();
  const snapshotRows = new Map<string, SnapshotRow>();
  const client = {
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return recordRows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: RecordRow }) {
        if (recordRows.has(data.recordKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        recordRows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
        orderBy,
      }: { where?: CapitalWhere; orderBy?: CapitalOrderBy } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallbackCutoff = where?.OR?.[1]?.asOf.lte;
        const selected = [...recordRows.values()].filter((row) => {
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
    capitalProviderSnapshot: {
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
      async findMany({ where }: { where: { providerId?: string } }) {
        const vals = [...snapshotRows.values()];
        return where?.providerId !== undefined
          ? vals.filter((r) => r.providerId === where.providerId)
          : vals;
      },
    },
    fundConcentrationSnapshot: { async findMany() { return []; } },
  } as unknown as ReturnType<typeof getPrisma>;
  return { client, recordRows, snapshotRows };
}

// The Eastmoney extractor (mirrors eastmoney-capital-adapter.ts).
const extractor: SnapshotValueExtractor = (snapshot) => {
  const payload = snapshot.rawPayload as { value?: unknown; unit?: string };
  const raw = payload.value;
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return {
    value,
    unit: payload.unit ?? null,
    source: {
      id: "cn-eastmoney",
      name: "Eastmoney (via akshare, republishing NBS data)",
      dataset: "macro_china_gdp_cpi",
      documentationUrl: "https://data.eastmoney.com/cjsj/gdp.html",
    },
  };
};

const assertions: Assertion[] = [];

// ---- A1: end-to-end journey — capture → convert → append → replay → conclusion ----

const store = fakePrisma();
const captureTime = "2026-07-20T10:00:00.000Z";
const gdpInput: CapitalSnapshotInput = {
  providerId: "cn-eastmoney",
  metricKey: "cn-growth",
  market: "cn",
  dimension: "growth",
  observedAt: "2026-01-01T00:00:00.000Z",
  firstCapturedAt: captureTime,
  rawPayload: { metric_key: "cn-growth", value: 4.7, unit: "percent", indicator: "gdp_yoy", source_period: "2026年第1季度" } as unknown as Prisma.InputJsonValue,
  processingVersion: "eastmoney-akshare-v1",
};
const cpiInput: CapitalSnapshotInput = {
  ...gdpInput,
  metricKey: "cn-inflation",
  dimension: "inflation",
  observedAt: "2025-08-01T00:00:00.000Z",
  rawPayload: { metric_key: "cn-inflation", value: 0.0, unit: "percent", indicator: "cpi_yoy", source_period: "2025-08-09" } as unknown as Prisma.InputJsonValue,
};

// Step 1: capture snapshots (first occurrence).
await appendCapitalProviderSnapshot(store.client, gdpInput, { traceId: "gate" });
await appendCapitalProviderSnapshot(store.client, cpiInput, { traceId: "gate" });

// Step 2: convert → append records.
const replayAsOf = "2026-07-21T00:00:00.000Z"; // after captureTime
const snapshots = [
  ...store.snapshotRows.values(),
].map((r) => ({
  id: r.id as string,
  snapshotKey: r.snapshotKey,
  providerId: r.providerId as string,
  metricKey: r.metricKey as string,
  market: r.market as string,
  dimension: r.dimension as string,
  observedAt: (r.observedAt as Date).toISOString(),
  firstCapturedAt: (r.firstCapturedAt as Date).toISOString(),
  rawPayload: r.rawPayload as Prisma.JsonValue,
  processingVersion: r.processingVersion as string,
  traceId: r.traceId as string | null,
}));
const batch = snapshotsToProviderBatch(snapshots, {
  providerId: "cn-eastmoney",
  extractor,
  processingVersion: "eastmoney-akshare-v1",
});
const appendResult = await appendCapitalProviderObservations(store.client, batch, {
  asOf: replayAsOf,
  traceId: "gate",
});

// Step 3: replay at a cutoff after capture → China GDP/CPI visible.
assertions.push({
  name: "A1 snapshot → record append inserted 2 China records",
  ok: appendResult.inserted === 2,
  detail: `inserted=${appendResult.inserted}`,
});
const replay = await replayCapitalEnvironmentAt(store.client, replayAsOf, { traceId: "gate" });
const cnMarket = replay.markets.find((m) => m.market === "cn");
const cnGrowth = cnMarket?.dimensions.find((d) => d.dimension === "growth");
const cnInflation = cnMarket?.dimensions.find((d) => d.dimension === "inflation");

assertions.push({
  name: "A1 China GDP visible at replay after capture (available, value 4.7)",
  ok:
    cnGrowth !== undefined &&
    cnGrowth!.records.length === 1 &&
    cnGrowth!.records[0]!.value === 4.7 &&
    cnGrowth!.records[0]!.availability === Avail.Available,
  detail: JSON.stringify(cnGrowth?.records[0]).slice(0, 150),
});
assertions.push({
  name: "A1 China CPI visible at replay after capture (available, value 0.0)",
  ok:
    cnInflation !== undefined &&
    cnInflation!.records.length === 1 &&
    cnInflation!.records[0]!.value === 0.0 &&
    cnInflation!.records[0]!.availability === Avail.Available,
  detail: JSON.stringify(cnInflation?.records[0]).slice(0, 150),
});

// Step 4: conclusion builds without error and mentions coverage.
const conclusion = buildCapitalConclusion(replay);
assertions.push({
  name: "A1 conclusion builds with overview mentioning market coverage",
  ok:
    conclusion.overview.length > 0 &&
    conclusion.overview.includes("市场有可得数据") &&
    !conclusion.overview.includes("买入") && !conclusion.overview.includes("卖出"),
  detail: conclusion.overview.slice(0, 80),
});

// ---- A2: point-in-time traceability — publishedAt (capture time) <= asOf; honest labeling ----

assertions.push({
  name: "A2 publishedAt = firstCapturedAt (capture time, not official release)",
  ok:
    cnGrowth?.records[0]?.publishedAt === captureTime &&
    cnGrowth?.records[0]?.source.id === "cn-eastmoney",
  detail: JSON.stringify(cnGrowth?.records[0]).slice(0, 150),
});
assertions.push({
  name: "A2 statusReason honestly labels capture-time semantics",
  ok:
    cnGrowth?.records[0]?.statusReason?.includes("采集时间") === true &&
    cnGrowth?.records[0]?.statusReason?.includes("非官方发布时刻") === true,
  detail: cnGrowth?.records[0]?.statusReason ?? "(none)",
});

// A2: point-in-time safety — replay BEFORE captureTime → China data withheld.
const earlyReplay = await replayCapitalEnvironmentAt(store.client, "2026-07-19T00:00:00.000Z", { traceId: "gate-early" });
const earlyCn = earlyReplay.markets.find((m) => m.market === "cn");
const earlyGrowth = earlyCn?.dimensions.find((d) => d.dimension === "growth");
assertions.push({
  name: "A2 data withheld before captureTime (point-in-time safety)",
  ok:
    earlyGrowth !== undefined &&
    earlyGrowth!.records.length === 0,
  detail: `records=${earlyGrowth?.records.length ?? "undef"}`,
});

// ---- A3: honest degradation — unparseable payload → unknown, no zero-fill ----

const failStore = fakePrisma();
await appendCapitalProviderSnapshot(failStore.client, {
  ...gdpInput,
  rawPayload: { metric_key: "cn-growth", value: null, indicator: "gdp_yoy" } as unknown as Prisma.InputJsonValue,
}, { traceId: "gate-fail" });
const failSnapshots = [...failStore.snapshotRows.values()].map((r) => ({
  id: r.id as string, snapshotKey: r.snapshotKey, providerId: r.providerId as string,
  metricKey: r.metricKey as string, market: r.market as string, dimension: r.dimension as string,
  observedAt: (r.observedAt as Date).toISOString(), firstCapturedAt: (r.firstCapturedAt as Date).toISOString(),
  rawPayload: r.rawPayload as Prisma.JsonValue, processingVersion: r.processingVersion as string, traceId: r.traceId as string | null,
}));
const failBatch = snapshotsToProviderBatch(failSnapshots, {
  providerId: "cn-eastmoney", extractor, processingVersion: "eastmoney-akshare-v1",
});
await appendCapitalProviderObservations(failStore.client, failBatch, { asOf: replayAsOf, traceId: "gate-fail" });
const failReplay = await replayCapitalEnvironmentAt(failStore.client, replayAsOf, { traceId: "gate-fail" });
const failGrowth = failReplay.markets.find((m) => m.market === "cn")?.dimensions.find((d) => d.dimension === "growth");
assertions.push({
  name: "A3 unparseable payload → unknown, no zero-fill",
  ok:
    failGrowth !== undefined &&
    failGrowth!.records.length === 1 &&
    failGrowth!.records[0]!.availability === Avail.Unknown &&
    failGrowth!.records[0]!.value === null,
  detail: `availability=${failGrowth!.records[0]?.availability} value=${failGrowth!.records[0]?.value}`,
});

// ---- A4: determinism — same snapshot replayed twice yields identical results ----

const replay2 = await replayCapitalEnvironmentAt(store.client, replayAsOf, { traceId: "gate-determ" });
const replay2Growth = replay2.markets.find((m) => m.market === "cn")?.dimensions.find((d) => d.dimension === "growth");
const replay2Inflation = replay2.markets.find((m) => m.market === "cn")?.dimensions.find((d) => d.dimension === "inflation");
assertions.push({
  name: "A4 determinism — same cutoff replayed yields identical China GDP/CPI",
  ok:
    replay2Growth?.records[0]?.value === 4.7 &&
    replay2Inflation?.records[0]?.value === 0.0,
  detail: "replay stable",
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
