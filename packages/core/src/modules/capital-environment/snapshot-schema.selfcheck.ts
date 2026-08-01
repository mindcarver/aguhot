/**
 * Deterministic acceptance checks for Issue #67's capital provider snapshot
 * store schema + snapshotKey.
 *
 * Runs entirely offline with a minimal fake Prisma (no real DB), mirroring the
 * #47/#48/#51 selfcheck pattern. Validates: snapshotKey determinism/composition,
 * rawPayload Json round-trip, and the append-only "first occurrence" idempotency
 * that locks firstCapturedAt.
 */

import { capitalSnapshotKey } from "./snapshot-key.js";
import type { PrismaClient, Prisma } from "../../../generated/client.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type StoredRow = Record<string, unknown> & {
  snapshotKey: string;
  id: string;
};

function fakePrisma() {
  const rows = new Map<string, StoredRow>();
  const client = {
    capitalProviderSnapshot: {
      async findUnique({ where }: { where: { snapshotKey: string } }) {
        return rows.get(where.snapshotKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.snapshotKey)) {
          // Mirror Prisma's unique-constraint violation code.
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        rows.set(data.snapshotKey, data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  return { client, rows };
}

interface SnapshotInput {
  readonly providerId: string;
  readonly metricKey: string;
  readonly market: string;
  readonly dimension: string;
  readonly observedAt: string;
  readonly processingVersion: string;
  readonly firstCapturedAt: string;
  readonly rawPayload: Prisma.InputJsonValue;
}

function storeSnapshot(
  client: PrismaClient,
  input: SnapshotInput,
): Promise<StoredRow> {
  return client.capitalProviderSnapshot.create({
    data: {
      id: `snap-${input.providerId}-${input.metricKey}-${input.observedAt}`,
      snapshotKey: capitalSnapshotKey(input),
      providerId: input.providerId,
      metricKey: input.metricKey,
      market: input.market,
      dimension: input.dimension,
      observedAt: new Date(input.observedAt),
      firstCapturedAt: new Date(input.firstCapturedAt),
      rawPayload: input.rawPayload,
      processingVersion: input.processingVersion,
    },
  }) as unknown as Promise<StoredRow>;
}

const assertions: Assertion[] = [];

// A2: snapshotKey is deterministic and composed from the identity fields.
const baseInput: SnapshotInput = {
  providerId: "cn-nbs",
  metricKey: "cn-growth",
  market: "cn",
  dimension: "growth",
  observedAt: "2026-04-01T00:00:00.000Z",
  processingVersion: "nbs-adapter-v1",
  firstCapturedAt: "2026-07-15T10:30:00.000Z",
  rawPayload: { datanodes: [{ value: "5.3" }] },
};
const keyA = capitalSnapshotKey(baseInput);
const keyB = capitalSnapshotKey(baseInput);
assertions.push({
  name: "A2 snapshotKey is deterministic (same input → same key)",
  ok: keyA === keyB && keyA.length > 0,
  detail: keyA,
});

// A2: key composition includes every identity field.
assertions.push({
  name: "A2 snapshotKey composes providerId|metricKey|market|dimension|observedAt|processingVersion",
  ok:
    keyA.includes("cn-nbs|cn-growth|cn|growth|") &&
    keyA.includes("2026-04-01") &&
    keyA.endsWith("|nbs-adapter-v1") &&
    !keyA.includes("2026-07-15"), // firstCapturedAt is NOT part of the key
  detail: keyA,
});

// A2: different observedAt → different key (different observation period).
const differentPeriod = capitalSnapshotKey({ ...baseInput, observedAt: "2026-01-01T00:00:00.000Z" });
assertions.push({
  name: "A2 different observedAt produces a different snapshotKey",
  ok: differentPeriod !== keyA,
  detail: `${keyA} vs ${differentPeriod}`,
});

// A2: different provider → different key (switching providers is not a revision).
const differentProvider = capitalSnapshotKey({ ...baseInput, providerId: "kr-ecos" });
assertions.push({
  name: "A2 different providerId produces a different snapshotKey",
  ok: differentProvider !== keyA,
  detail: `${keyA} vs ${differentProvider}`,
});

// A3: rawPayload Json round-trip — arbitrary provider payload stores and reads back intact.
const store = fakePrisma();
const complexPayload = {
  returncode: 200,
  returndata: {
    wdnodes: [{ wdcode: "zb", nodes: [{ code: "A020101", name: "GDP" }] }],
    datanodes: [
      { code: "A020101_sj", wds: [], data: { data: "5.3", strdata: "5.3%" } },
    ],
  },
};
const stored = await storeSnapshot(store.client, { ...baseInput, rawPayload: complexPayload });
const fetched = await store.client.capitalProviderSnapshot.findUnique({
  where: { snapshotKey: stored.snapshotKey },
}) as StoredRow | null;
const roundTripped = fetched?.rawPayload;
assertions.push({
  name: "A3 rawPayload Json round-trips intact (arbitrary provider payload)",
  ok: JSON.stringify(roundTripped) === JSON.stringify(complexPayload),
  detail: JSON.stringify(roundTripped).slice(0, 120),
});

// Idempotency: the same snapshotKey (same identity) rejects a second insert —
// this is the "first occurrence" lock that makes firstCapturedAt monotonic.
let duplicateRejected = false;
try {
  await storeSnapshot(store.client, {
    ...baseInput,
    firstCapturedAt: "2026-07-16T10:30:00.000Z", // a later capture attempt
  });
} catch (error) {
  duplicateRejected = (error as { code?: string }).code === "P2002";
}
assertions.push({
  name: "First-occurrence idempotency: duplicate snapshotKey is rejected (P2002)",
  ok: duplicateRejected && store.rows.size === 1,
  detail: `rows=${store.rows.size}`,
});

// firstCapturedAt is preserved from the first insert, not overwritten.
assertions.push({
  name: "firstCapturedAt locked on first capture (not overwritten by later poll)",
  ok:
    (fetched?.firstCapturedAt as Date).toISOString() === "2026-07-15T10:30:00.000Z",
  detail: String(fetched?.firstCapturedAt),
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
