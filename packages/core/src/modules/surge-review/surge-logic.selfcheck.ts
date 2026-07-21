import { detectSurgeDays } from "./surge-logic.js";
import { upsertSurgeDays } from "./surge-review-service.js";
import { refreshPublishedSurgeDays } from "../publish-orchestrator/publish-service.js";
import { Prisma, type PrismaClient } from "../../../generated/client.js";

const dec = (value: number) => ({ toNumber: () => value });
const bar = (indexCode: string, day: number, pctChange: number, close: number) => ({
  indexCode,
  tradeDate: new Date(Date.UTC(2026, 0, day)),
  pctChange: dec(pctChange),
  close: dec(close),
});
const series = new Map([
  ["sh000001", [bar("sh000001", 2, 1.99, 100), bar("sh000001", 3, 2, 102), bar("sh000001", 4, -1, 101)]],
  ["sz399006", [bar("sz399006", 3, 0.3, 200), bar("sz399006", 4, 2.5, 205)]],
]);
const days = detectSurgeDays(series);
type StoredDay = {
  tradeDate: Date;
  threshold: number;
  surgeCount: number;
  indices: unknown;
  source: string;
  breadth?: unknown;
};

async function verifyReconciliation(): Promise<boolean> {
  let persistedBars = [bar("sh000001", 2, 2, 100), bar("sh000001", 3, 0.5, 101)];
  let breadthReadFails = true;
  const sourceRows = new Map<string, StoredDay>();
  const publicRows = new Map<string, StoredDay>();
  const key = (value: Date) => value.toISOString().slice(0, 10);
  const inScope = (
    row: StoredDay,
    options: { where?: { tradeDate?: { gte?: Date; lte?: Date } } } | undefined,
  ) => {
    const range = options?.where?.tradeDate;
    return (range?.gte === undefined || row.tradeDate >= range.gte)
      && (range?.lte === undefined || row.tradeDate <= range.lte);
  };
  const prisma = {
    indexDailyBar: {
      findMany: async () => persistedBars,
    },
    surgeDay: {
      upsert: async (write: { create: StoredDay }) => {
        sourceRows.set(key(write.create.tradeDate), write.create);
      },
      findMany: async (options?: { where?: { tradeDate?: { gte?: Date; lte?: Date } } }) =>
        [...sourceRows.values()].filter((row) => inScope(row, options)),
      delete: async ({ where }: { where: { tradeDate: Date } }) => {
        sourceRows.delete(key(where.tradeDate));
      },
    },
    sectorDailyBar: {
      findMany: async () => [],
    },
    marketBreadthDaily: {
      findUnique: async () => {
        if (breadthReadFails) throw new Error("breadth unavailable");
        return null;
      },
    },
    publishedSurgeDay: {
      upsert: async (write: { create: StoredDay }) => {
        publicRows.set(key(write.create.tradeDate), write.create);
      },
      findMany: async (options?: { where?: { tradeDate?: { gte?: Date; lte?: Date } } }) =>
        [...publicRows.values()].filter((row) => inScope(row, options)),
      delete: async ({ where }: { where: { tradeDate: Date } }) => {
        publicRows.delete(key(where.tradeDate));
      },
    },
  } as unknown as PrismaClient;

  const first = await upsertSurgeDays({ prisma, traceId: "surge-selfcheck" });
  const firstProjection = await refreshPublishedSurgeDays({ prisma, traceId: "surge-selfcheck" });
  const breadthFailurePreservesDate = publicRows.get("2026-01-02")?.breadth === Prisma.DbNull;
  breadthReadFails = false;
  const rerun = await upsertSurgeDays({ prisma, traceId: "surge-selfcheck" });
  const rerunProjection = await refreshPublishedSurgeDays({ prisma, traceId: "surge-selfcheck" });

  persistedBars = [bar("sh000001", 2, 1.99, 100), bar("sh000001", 3, 0.5, 101)];
  const revised = await upsertSurgeDays({ prisma, traceId: "surge-selfcheck" });
  const revisedProjection = await refreshPublishedSurgeDays({ prisma, traceId: "surge-selfcheck" });
  const revisedCleanupRemovedAllRows = sourceRows.size === 0 && publicRows.size === 0;
  const inRangeDate = new Date("2026-01-03T00:00:00.000Z");
  const outOfRangeDate = new Date("2026-01-04T00:00:00.000Z");
  publicRows.set(key(inRangeDate), { tradeDate: inRangeDate, threshold: 2, surgeCount: 1, indices: [], source: "test" });
  publicRows.set(key(outOfRangeDate), { tradeDate: outOfRangeDate, threshold: 2, surgeCount: 1, indices: [], source: "test" });
  const bounded = await refreshPublishedSurgeDays({
    prisma,
    traceId: "surge-selfcheck",
    fromDay: "2026-01-03",
    toDay: "2026-01-03",
  });
  const boundedPrunePreservesOutside = bounded.pruned === 1 && publicRows.has(key(outOfRangeDate));

  return first.upserted === 1
    && firstProjection.projected === 1
    && rerun.upserted === 1
    && rerunProjection.projected === 1
    && revisedCleanupRemovedAllRows
    && revised.pruned === 1
    && revisedProjection.pruned === 1
    && breadthFailurePreservesDate
    && boundedPrunePreservesOutside;
}

const reconciliationPasses = await verifyReconciliation();
const assertions = [
  ["threshold equality qualifies", days.some((day) => day.tradeDay === "2026-01-03" && day.surgeCount === 1)],
  ["any index qualifies", days.some((day) => day.tradeDay === "2026-01-04" && day.surgeCount === 1)],
  ["below threshold is omitted", !days.some((day) => day.tradeDay === "2026-01-02")],
  ["missing index is explicit and unavailable", days[0]?.indices.find((index) => index.indexCode === "sz399001")?.pctChange === null],
  ["unavailable T+20 remains null", days[0]?.indices[0]?.forwardReturns?.t20 === null],
  ["output is deterministic", JSON.stringify(detectSurgeDays(series)) === JSON.stringify(days)],
  ["rerun, revised-date cleanup, breadth fallback, and bounded projection are safe", reconciliationPasses],
];
let failed = 0;
for (const [name, ok] of assertions) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}
if (failed > 0) process.exit(1);
