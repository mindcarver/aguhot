/**
 * Deterministic contract check for Issue #33's daily limit-pool history projection.
 *
 * Run with: pnpm --filter @aguhot/core verify:market-breadth-history
 */
import {
  listPublishedMarketBreadthHistory,
  refreshPublishedMarketBreadthHistory,
} from "./publish-service.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

type HistoryRow = {
  tradeDate: Date;
  limitUpCount: number;
  limitDownCount: number;
  source: string;
  traceId?: string | null;
};

const sourceRows: HistoryRow[] = [
  {
    tradeDate: new Date("2026-07-01T00:00:00.000Z"),
    limitUpCount: 12,
    limitDownCount: 2,
    source: "akshare",
  },
  {
    tradeDate: new Date("2026-07-02T00:00:00.000Z"),
    limitUpCount: 0,
    limitDownCount: 5,
    source: "akshare",
  },
  {
    tradeDate: new Date("2026-07-03T00:00:00.000Z"),
    limitUpCount: 24,
    limitDownCount: 1,
    source: "akshare",
  },
];

const projected = new Map<string, HistoryRow>([
  [
    "2026-06-30",
    {
      tradeDate: new Date("2026-06-30T00:00:00.000Z"),
      limitUpCount: 99,
      limitDownCount: 99,
      source: "stale",
    },
  ],
]);
const requestedTakes: number[] = [];

const fakePrisma = {
  marketBreadthDaily: {
    findMany: async () => sourceRows,
  },
  publishedMarketBreadthDaily: {
    upsert: async (args: { create: HistoryRow; update: HistoryRow }) => {
      projected.set(args.create.tradeDate.toISOString().slice(0, 10), {
        ...args.create,
        ...args.update,
        tradeDate: args.create.tradeDate,
      });
    },
    findMany: async (args: { take?: number }) => {
      const rows = [...projected.values()].sort(
        (a, b) => b.tradeDate.getTime() - a.tradeDate.getTime(),
      );
      if (args.take === undefined) return rows.map((row) => ({ tradeDate: row.tradeDate }));
      requestedTakes.push(args.take);
      return rows.slice(0, args.take);
    },
    delete: async (args: { where: { tradeDate: Date } }) => {
      projected.delete(args.where.tradeDate.toISOString().slice(0, 10));
    },
  },
};

const prisma = fakePrisma as never;
const assertions: Assertion[] = [];

const refreshed = await refreshPublishedMarketBreadthHistory({
  prisma,
  traceId: "trace-issue-33",
});
assertions.push({
  name: "source rows copy their real counts and stale projection rows are pruned",
  ok:
    refreshed.projected === 3 &&
    refreshed.pruned === 1 &&
    projected.get("2026-07-02")?.limitUpCount === 0 &&
    projected.get("2026-07-02")?.limitDownCount === 5 &&
    !projected.has("2026-06-30"),
  detail: JSON.stringify(refreshed),
});

const latestTwo = await listPublishedMarketBreadthHistory({
  prisma,
  traceId: "trace-issue-33",
  limit: 2,
});
assertions.push({
  name: "latest bounded window returns chronological display order",
  ok:
    latestTwo.map((row) => row.tradeDate.toISOString().slice(0, 10)).join(",") ===
      "2026-07-02,2026-07-03" &&
    latestTwo[0]?.limitUpCount === 0 &&
    latestTwo[0]?.limitDownCount === 5,
  detail: latestTwo.map((row) => row.tradeDate.toISOString().slice(0, 10)).join(" → "),
});

await listPublishedMarketBreadthHistory({ prisma, traceId: "trace-issue-33", limit: 0 });
await listPublishedMarketBreadthHistory({ prisma, traceId: "trace-issue-33", limit: 999 });
assertions.push({
  name: "invalid and overlarge limits stay within the guarded query range",
  ok: requestedTakes.join(",") === "2,1,365",
  detail: requestedTakes.join(","),
});

let failed = 0;
for (const assertion of assertions) {
  console.log(
    `${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`,
  );
  if (!assertion.ok) failed += 1;
}

if (failed > 0) process.exit(1);
