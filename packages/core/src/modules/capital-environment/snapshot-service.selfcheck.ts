/**
 * Deterministic acceptance checks for Issue #68's snapshot poll + conversion:
 * the append-only snapshot repository (first-occurrence idempotency) and the
 * snapshotsToProviderBatch conversion (AD-SNAP-1 publishedAt = firstCapturedAt).
 *
 * Runs offline with fake Prisma + an inline extractor, mirroring the #47/#48/#51
 * selfcheck pattern.
 */

import {
  appendCapitalProviderSnapshot,
  listCapitalProviderSnapshots,
  snapshotsToProviderBatch,
} from "./index.js";
import {
  appendCapitalProviderObservations,
  listCapitalDataRecordsAt,
  CapitalAvailability,
} from "./index.js";
import type { SnapshotValueExtractor, CapitalSnapshotInput } from "./index.js";
import type { PrismaClient, Prisma } from "../../../generated/client.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type StoredRow = Record<string, unknown> & {
  snapshotKey: string;
  id: string;
  providerId: string;
};

function fakePrisma() {
  const snapshotRows = new Map<string, StoredRow>();
  const recordRows = new Map<string, Record<string, unknown> & { recordKey: string; id: string }>();
  const client = {
    capitalProviderSnapshot: {
      async findUnique({ where }: { where: { snapshotKey: string } }) {
        return snapshotRows.get(where.snapshotKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
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
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return recordRows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> & { recordKey: string; id: string } }) {
        if (recordRows.has(data.recordKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        recordRows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
      }: {
        where?: {
          OR?: readonly [
            { publishedAt: { lte: Date } },
            { publishedAt: null; asOf: { lte: Date } },
          ];
        };
      } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallback = where?.OR?.[1]?.asOf.lte;
        return [...recordRows.values()].filter((row) => {
          const publishedAt = row.publishedAt as Date | null;
          const asOf = row.asOf as Date;
          if (cutoff !== undefined && fallback !== undefined) {
            if (publishedAt !== null ? publishedAt > cutoff : asOf > fallback) return false;
          }
          return true;
        });
      },
    },
  } as unknown as PrismaClient;
  return { client, snapshotRows, recordRows };
}

const assertions: Assertion[] = [];

// ---- A2: first-occurrence capture + idempotency ----

const store = fakePrisma();
const captureTime = "2026-07-15T10:30:00.000Z";
const snapshotInput: CapitalSnapshotInput = {
  providerId: "cn-nbs",
  metricKey: "cn-growth",
  market: "cn",
  dimension: "growth",
  observedAt: "2026-04-01T00:00:00.000Z",
  firstCapturedAt: captureTime,
  rawPayload: { datanodes: [{ data: { data: "5.3" } }] } as Prisma.InputJsonValue,
  processingVersion: "nbs-adapter-v1",
};

const firstCapture = await appendCapitalProviderSnapshot(store.client, snapshotInput, {
  traceId: "test",
});
assertions.push({
  name: "A2 first capture inserts a snapshot (inserted: true)",
  ok: firstCapture.inserted === true,
  detail: JSON.stringify(firstCapture),
});

// Second capture of the same period — idempotent skip.
const secondCapture = await appendCapitalProviderSnapshot(store.client, snapshotInput, {
  traceId: "test-2",
});
assertions.push({
  name: "A2 repeat capture is idempotent (inserted: false, no overwrite)",
  ok: secondCapture.inserted === false && store.snapshotRows.size === 1,
  detail: `rows=${store.snapshotRows.size}`,
});

// A later capture attempt with a different firstCapturedAt does NOT overwrite.
const storedRow = store.snapshotRows.get(firstCapture.snapshotKey)!;
assertions.push({
  name: "A2 firstCapturedAt locked on first capture (not overwritten)",
  ok: (storedRow.firstCapturedAt as Date).toISOString() === captureTime,
  detail: String(storedRow.firstCapturedAt),
});

// ---- A3 + A4: snapshotsToProviderBatch + append point-in-time ----

// An extractor that parses the NBS-like payload { datanodes: [{ data: { data: "5.3" } }] }.
const extractor: SnapshotValueExtractor = (snapshot) => {
  const payload = snapshot.rawPayload as { datanodes?: Array<{ data?: { data?: string } }> };
  const raw = payload.datanodes?.[0]?.data?.data;
  const value = raw !== undefined ? Number(raw) : null;
  return {
    value: Number.isFinite(value) ? value : null,
    unit: "percent",
    source: { id: "cn-nbs", name: "National Bureau of Statistics", dataset: "GDP", documentationUrl: "https://data.stats.gov.cn/" },
  };
};

const snapshots = await listCapitalProviderSnapshots(store.client, "cn-nbs");
const batch = snapshotsToProviderBatch(snapshots, {
  providerId: "cn-nbs",
  extractor,
  processingVersion: "nbs-adapter-v1",
});
assertions.push({
  name: "A3 publishedAt = firstCapturedAt (AD-SNAP-1 capture-time semantics)",
  ok:
    batch.observations.length === 1 &&
    batch.observations[0]!.publishedAt === captureTime &&
    batch.observations[0]!.value === 5.3 &&
    batch.observations[0]!.statusReason?.includes("采集时间") === true,
  detail: JSON.stringify(batch.observations[0]).slice(0, 200),
});
assertions.push({
  name: "A3 batch availability = available when value present",
  ok: batch.availability === CapitalAvailability.Available,
  detail: batch.availability,
});

// A4: the batch feeds appendCapitalProviderObservations; publishedAt <= asOf passes PIT.
const appendResult = await appendCapitalProviderObservations(store.client, batch, {
  asOf: "2026-07-16T00:00:00.000Z", // after captureTime
  traceId: "append-test",
});
const visible = await listCapitalDataRecordsAt(store.client, "2026-07-16T00:00:00.000Z");
const cnGrowth = visible.find((r) => r.metricKey === "cn-growth");
assertions.push({
  name: "A4 converted record appends + passes point-in-time (publishedAt <= asOf visible)",
  ok:
    appendResult.inserted === 1 &&
    cnGrowth !== undefined &&
    cnGrowth.value === 5.3 &&
    cnGrowth.publishedAt === captureTime &&
    cnGrowth.availability === CapitalAvailability.Available,
  detail: JSON.stringify({ inserted: appendResult.inserted, cnGrowthValue: cnGrowth?.value }),
});

// A4 negative: publishedAt (captureTime) > asOf → record withheld at replay.
const earlyCutoff = await listCapitalDataRecordsAt(store.client, "2026-07-14T00:00:00.000Z");
const earlyVisible = earlyCutoff.find((r) => r.metricKey === "cn-growth");
assertions.push({
  name: "A4 record withheld before captureTime (point-in-time safety)",
  ok: earlyVisible === undefined,
  detail: `visibleBeforeCapture=${earlyVisible !== undefined}`,
});

// ---- A5: null-value extractor → unknown degradation, no zero-fill ----

const nullStore = fakePrisma();
await appendCapitalProviderSnapshot(nullStore.client, {
  ...snapshotInput,
  rawPayload: { datanodes: [{ data: { data: "." } }] } as Prisma.InputJsonValue, // unparseable
});
const nullSnapshots = await listCapitalProviderSnapshots(nullStore.client, "cn-nbs");
const nullBatch = snapshotsToProviderBatch(nullSnapshots, {
  providerId: "cn-nbs",
  extractor,
  processingVersion: "nbs-adapter-v1",
});
assertions.push({
  name: "A5 unparseable payload → unknown, no zero-fill",
  ok:
    nullBatch.observations[0]!.value === null &&
    nullBatch.observations[0]!.availability === CapitalAvailability.Unknown,
  detail: JSON.stringify(nullBatch.observations[0]).slice(0, 150),
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
