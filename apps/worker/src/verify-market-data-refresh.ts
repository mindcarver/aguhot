/** Deterministic self-check for the crash-calendar refresh orchestration. */
import { runMarketDataRefresh } from "./market-data-refresh.js";
import { MARKET_DATA_REFRESH_INTERVAL_MS } from "./queues/market-data-refresh-queue.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];
const order: string[] = [];

const result = await runMarketDataRefresh({
  ingestIndices: () => {
    order.push("ingest-index");
  },
  ingestSectors: () => {
    order.push("ingest-sector");
  },
  ingestBreadth: () => {
    order.push("ingest-breadth");
  },
  detectCrashDays: async () => {
    order.push("detect");
    return { upserted: 2, crashDays: [{ day: "2026-07-16" }, { day: "2026-07-17" }] };
  },
  publishCrashDays: async () => {
    order.push(
      order.includes("ingest-breadth")
        ? "publish-breadth"
        : order.includes("ingest-sector")
          ? "publish-sector"
          : "publish-base",
    );
    return { projected: 2, pruned: 0 };
  },
});

assertions.push({
  name: "index → detect → base publish → sector → breadth projections are fixed",
  ok:
    order.join(",") ===
    "ingest-index,detect,publish-base,ingest-sector,publish-sector,ingest-breadth,publish-breadth",
  detail: order.join(" → "),
});
assertions.push({
  name: "result exposes detection and projection counts",
  ok:
    result.detected === 2 && result.upserted === 2 && result.projected === 2 && result.pruned === 0,
  detail: JSON.stringify(result),
});
assertions.push({
  name: "scheduled refresh interval is 30 minutes",
  ok: MARKET_DATA_REFRESH_INTERVAL_MS === 30 * 60 * 1000,
  detail: `${MARKET_DATA_REFRESH_INTERVAL_MS}ms`,
});

const afterFailure: string[] = [];
let failedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      afterFailure.push("ingest-index");
      throw new Error("source unavailable");
    },
    ingestSectors: () => {
      afterFailure.push("ingest-sector");
    },
    ingestBreadth: () => {
      afterFailure.push("ingest-breadth");
    },
    detectCrashDays: async () => {
      afterFailure.push("detect");
      return { upserted: 0, crashDays: [] };
    },
    publishCrashDays: async () => {
      afterFailure.push("publish");
      return { projected: 0, pruned: 0 };
    },
  });
} catch (error) {
  failedLoudly = error instanceof Error && error.message === "source unavailable";
}

assertions.push({
  name: "ingest failure stops detection and publication",
  ok: failedLoudly && afterFailure.join(",") === "ingest-index",
  detail: afterFailure.join(" → "),
});

const breadthFailureOrder: string[] = [];
let breadthFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      breadthFailureOrder.push("ingest-index");
    },
    ingestSectors: () => {
      breadthFailureOrder.push("ingest-sector");
    },
    detectCrashDays: async () => {
      breadthFailureOrder.push("detect");
      return { upserted: 1, crashDays: [{}] };
    },
    publishCrashDays: async () => {
      breadthFailureOrder.push("publish");
      return { projected: 1, pruned: 0 };
    },
    ingestBreadth: () => {
      breadthFailureOrder.push("ingest-breadth");
      throw new Error("breadth unavailable");
    },
  });
} catch (error) {
  breadthFailedLoudly = error instanceof Error && error.message === "breadth unavailable";
}

assertions.push({
  name: "breadth failure happens after sector data has been projected",
  ok:
    breadthFailedLoudly &&
    breadthFailureOrder.join(",") ===
      "ingest-index,detect,publish,ingest-sector,publish,ingest-breadth",
  detail: breadthFailureOrder.join(" → "),
});

const sectorFailureOrder: string[] = [];
let sectorFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      sectorFailureOrder.push("ingest-index");
    },
    detectCrashDays: async () => {
      sectorFailureOrder.push("detect");
      return { upserted: 1, crashDays: [{}] };
    },
    publishCrashDays: async () => {
      sectorFailureOrder.push("publish");
      return { projected: 1, pruned: 0 };
    },
    ingestSectors: () => {
      sectorFailureOrder.push("ingest-sector");
      throw new Error("sector unavailable");
    },
    ingestBreadth: () => {
      sectorFailureOrder.push("ingest-breadth");
    },
  });
} catch (error) {
  sectorFailedLoudly = error instanceof Error && error.message === "sector unavailable";
}

assertions.push({
  name: "sector failure preserves the base crash-day projection and signals a failed refresh",
  ok:
    sectorFailedLoudly &&
    sectorFailureOrder.join(",") === "ingest-index,detect,publish,ingest-sector",
  detail: sectorFailureOrder.join(" → "),
});

let failed = 0;
for (const assertion of assertions) {
  console.log(
    `${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`,
  );
  if (!assertion.ok) failed += 1;
}

if (failed > 0) process.exit(1);
