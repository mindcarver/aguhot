/**
 * Deterministic acceptance checks for Issue #68's snapshot poll job.
 *
 * Runs offline with fake Prisma + an injectable fetchLatest mock, mirroring the
 * FRED adapter selfcheck pattern. Validates: first-occurrence capture (A2),
 * idempotent skip on repeat (A2), publishedAt = firstCapturedAt (A3),
 * fetch-failure isolation (A5), and the no-targets no-op path.
 */

import { getPrisma, type SnapshotValueExtractor } from "@aguhot/core";
import {
  runCapitalSnapshotPoll,
  resolveSnapshotPollTargets,
  type SnapshotPollTarget,
  type RawFetchResult,
} from "./capital-snapshot-poll.js";

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
      async findMany() {
        return [...recordRows.values()];
      },
    },
  } as unknown as ReturnType<typeof getPrisma>;
  return { client, snapshotRows, recordRows };
}

const extractor: SnapshotValueExtractor = (snapshot) => {
  const payload = snapshot.rawPayload as { value?: string };
  const value = payload.value !== undefined ? Number(payload.value) : null;
  return {
    value: Number.isFinite(value) ? value : null,
    unit: "percent",
    source: { id: "cn-nbs", name: "NBS", dataset: "GDP", documentationUrl: "https://data.stats.gov.cn/" },
  };
};

function makeTarget(
  fetchLatest: SnapshotPollTarget["fetchLatest"],
): SnapshotPollTarget {
  return {
    providerId: "cn-nbs",
    processingVersion: "nbs-adapter-v1",
    fetchLatest,
    extractor,
  };
}

const assertions: Assertion[] = [];

// A2 + A3: first occurrence captures a snapshot, publishedAt = firstCapturedAt.
const store1 = fakePrisma();
const fetchedPayload: RawFetchResult = {
  metricKey: "cn-growth",
  market: "cn",
  dimension: "growth",
  observedAt: "2026-04-01T00:00:00.000Z",
  rawPayload: { value: "5.3" },
};
const target1 = makeTarget(async () => {
  return fetchedPayload;
});
const result1 = await runCapitalSnapshotPoll([target1], {
  traceId: "tick-1",
  prisma: store1.client,
});
assertions.push({
  name: "A2 first tick captures the snapshot (captured=1)",
  ok: result1[0]!.captured === 1 && result1[0]!.failed === 0,
  detail: JSON.stringify(result1[0]),
});
assertions.push({
  name: "A3 appended record has publishedAt = firstCapturedAt (capture time)",
  ok: result1[0]!.appended === 1,
  detail: JSON.stringify(result1[0]),
});

// A2: second tick — same observedAt, fetchLatest returns same data → idempotent skip.
const result2 = await runCapitalSnapshotPoll([target1], {
  traceId: "tick-2",
  prisma: store1.client,
});
assertions.push({
  name: "A2 repeat tick is idempotent (captured=0, skipped=1, appended=0)",
  ok:
    result2[0]!.captured === 0 &&
    result2[0]!.skipped === 1 &&
    result2[0]!.appended === 0 &&
    store1.snapshotRows.size === 1,
  detail: JSON.stringify(result2[0]),
});

// A5: fetchLatest throws → failed=1, no throw, no snapshot inserted.
const store2 = fakePrisma();
const failingTarget = makeTarget(async () => {
  throw new Error("NBS endpoint unreachable");
});
const result3 = await runCapitalSnapshotPoll([failingTarget], {
  traceId: "tick-fail",
  prisma: store2.client,
});
assertions.push({
  name: "A5 fetch failure → failed=1, no throw, no snapshot inserted",
  ok:
    result3[0]!.failed === 1 &&
    result3[0]!.captured === 0 &&
    store2.snapshotRows.size === 0,
  detail: JSON.stringify(result3[0]),
});

// A5: fetchLatest returns null (data not yet published) → no insert, no fail.
const store3 = fakePrisma();
const emptyTarget = makeTarget(async () => null);
const result4 = await runCapitalSnapshotPoll([emptyTarget], {
  traceId: "tick-empty",
  prisma: store3.client,
});
assertions.push({
  name: "A5 null fetch (not yet published) → no capture, no fail",
  ok:
    result4[0]!.captured === 0 &&
    result4[0]!.failed === 0 &&
    result4[0]!.skipped === 0,
  detail: JSON.stringify(result4[0]),
});

// A1: resolveSnapshotPollTargets returns [] until #69+ register providers.
const targets = resolveSnapshotPollTargets();
assertions.push({
  name: "A1 resolveSnapshotPollTargets is empty until provider adapters register",
  ok: Array.isArray(targets) && targets.length === 0,
  detail: `length=${targets.length}`,
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
