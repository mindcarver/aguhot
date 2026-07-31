/** Deterministic orchestration checks for crash, surge, and breadth history refreshes. */
import { runMarketDataRefresh } from "./market-data-refresh.js";
import {
  MARKET_DATA_REFRESH_ATTEMPTS,
  MARKET_DATA_REFRESH_INTERVAL_MS,
} from "./queues/market-data-refresh-queue.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];

const order: string[] = [];
const result = await runMarketDataRefresh({
  ingestIndices: () => {
    order.push("index");
  },
  ingestSectors: () => {
    order.push("sector");
  },
  ingestBreadth: () => {
    order.push("breadth");
  },
  syncCapitalEnvironmentRecords: async () => {
    order.push("capital-environment-sync");
    return { inserted: 3, unchanged: 2, failed: 0 };
  },
  detectCrashDays: async () => {
    order.push("crash-detect");
    return { upserted: 2, crashDays: [{}, {}] };
  },
  publishCrashDays: async () => {
    order.push("crash-publish");
    return { projected: 2, pruned: 0 };
  },
  detectSurgeDays: async () => {
    order.push("surge-detect");
    return { upserted: 1, surgeDays: [{}] };
  },
  publishSurgeDays: async () => {
    order.push("surge-publish");
    return { projected: 1, pruned: 0 };
  },
  publishMarketBreadthHistory: async () => {
    order.push("breadth-history-publish");
    return { projected: 3, pruned: 1 };
  },
});
assertions.push({
  name: "crash, sector, surge, breadth history, and enriched projections preserve their order",
  ok:
    order.join(",") ===
    "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,surge-publish,breadth,capital-environment-sync,breadth-history-publish,crash-publish,surge-publish",
  detail: order.join(" → "),
});
assertions.push({
  name: "result exposes capital-record, surge, and breadth history counts",
  ok:
    result.detected === 2 &&
    result.detectedSurges === 1 &&
    result.surgeProjected === 1 &&
    result.breadthProjected === 3 &&
    result.breadthPruned === 1 &&
    result.capitalRecordsInserted === 3 &&
    result.capitalRecordsUnchanged === 2 &&
    result.capitalRecordsFailed === 0,
  detail: JSON.stringify(result),
});

const surgeFailure: string[] = [];
const isolatedFailureResult = await runMarketDataRefresh({
  ingestIndices: () => {
    surgeFailure.push("index");
  },
  ingestSectors: () => {
    surgeFailure.push("sector");
  },
  ingestBreadth: () => {
    surgeFailure.push("breadth");
  },
  syncCapitalEnvironmentRecords: async () => {
    surgeFailure.push("capital-environment-sync");
    return { inserted: 0, unchanged: 0, failed: 0 };
  },
  detectCrashDays: async () => {
    surgeFailure.push("crash-detect");
    return { upserted: 1, crashDays: [{}] };
  },
  publishCrashDays: async () => {
    surgeFailure.push("crash-publish");
    return { projected: 1, pruned: 0 };
  },
  detectSurgeDays: async () => {
    surgeFailure.push("surge-detect");
    throw new Error("surge unavailable");
  },
  publishSurgeDays: async () => {
    surgeFailure.push("surge-publish");
    return { projected: 1, pruned: 0 };
  },
  publishMarketBreadthHistory: async () => {
    surgeFailure.push("breadth-history-publish");
    return { projected: 1, pruned: 0 };
  },
});
assertions.push({
  name: "surge failure does not block breadth history and crash reprojection",
  ok:
    surgeFailure.join(",") ===
      "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,breadth,capital-environment-sync,breadth-history-publish,crash-publish" &&
    isolatedFailureResult.detectedSurges === 0,
  detail: surgeFailure.join(" → "),
});

const historyFailure: string[] = [];
const historyFailureResult = await runMarketDataRefresh({
  ingestIndices: () => {
    historyFailure.push("index");
  },
  ingestSectors: () => {
    historyFailure.push("sector");
  },
  ingestBreadth: () => {
    historyFailure.push("breadth");
  },
  syncCapitalEnvironmentRecords: async () => {
    historyFailure.push("capital-environment-sync");
    return { inserted: 0, unchanged: 0, failed: 0 };
  },
  detectCrashDays: async () => {
    historyFailure.push("crash-detect");
    return { upserted: 1, crashDays: [{}] };
  },
  publishCrashDays: async () => {
    historyFailure.push("crash-publish");
    return { projected: 1, pruned: 0 };
  },
  detectSurgeDays: async () => {
    historyFailure.push("surge-detect");
    return { upserted: 1, surgeDays: [{}] };
  },
  publishSurgeDays: async () => {
    historyFailure.push("surge-publish");
    return { projected: 1, pruned: 0 };
  },
  publishMarketBreadthHistory: async () => {
    historyFailure.push("breadth-history-publish");
    throw new Error("history unavailable");
  },
});
assertions.push({
  name: "breadth history projection failure leaves existing calendar projections running",
  ok:
    historyFailure.join(",") ===
      "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,surge-publish,breadth,capital-environment-sync,breadth-history-publish,crash-publish,surge-publish" &&
    historyFailureResult.breadthProjected === 0,
  detail: historyFailure.join(" → "),
});

const sectorFailure: string[] = [];
let sectorFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      sectorFailure.push("index");
    },
    ingestSectors: () => {
      sectorFailure.push("sector");
      throw new Error("sector unavailable");
    },
    ingestBreadth: () => {
      sectorFailure.push("breadth");
    },
    syncCapitalEnvironmentRecords: async () => ({ inserted: 0, unchanged: 0, failed: 0 }),
    detectCrashDays: async () => {
      sectorFailure.push("crash-detect");
      return { upserted: 1, crashDays: [{}] };
    },
    publishCrashDays: async () => {
      sectorFailure.push("crash-publish");
      return { projected: 1, pruned: 0 };
    },
    detectSurgeDays: async () => ({ upserted: 0, surgeDays: [] }),
    publishSurgeDays: async () => ({ projected: 0, pruned: 0 }),
    publishMarketBreadthHistory: async () => ({ projected: 0, pruned: 0 }),
  });
} catch (error) {
  sectorFailedLoudly = error instanceof Error && error.message === "sector unavailable";
}
assertions.push({
  name: "sector failure preserves the base crash-day projection and stops later stages",
  ok:
    sectorFailedLoudly &&
    sectorFailure.join(",") === "index,crash-detect,crash-publish,sector",
  detail: sectorFailure.join(" → "),
});

const indexFailure: string[] = [];
let indexFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      indexFailure.push("index");
      throw new Error("source unavailable");
    },
    ingestSectors: () => {
      indexFailure.push("sector");
    },
    ingestBreadth: () => {
      indexFailure.push("breadth");
    },
    syncCapitalEnvironmentRecords: async () => ({ inserted: 0, unchanged: 0, failed: 0 }),
    detectCrashDays: async () => ({ upserted: 0, crashDays: [] }),
    publishCrashDays: async () => ({ projected: 0, pruned: 0 }),
    detectSurgeDays: async () => ({ upserted: 0, surgeDays: [] }),
    publishSurgeDays: async () => ({ projected: 0, pruned: 0 }),
    publishMarketBreadthHistory: async () => ({ projected: 0, pruned: 0 }),
  });
} catch (error) {
  indexFailedLoudly = error instanceof Error && error.message === "source unavailable";
}
assertions.push({
  name: "index failure stops all calendar projections",
  ok: indexFailedLoudly && indexFailure.join(",") === "index",
});

const capitalSyncFailure: string[] = [];
let capitalSyncFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => {
      capitalSyncFailure.push("index");
    },
    ingestSectors: () => {
      capitalSyncFailure.push("sector");
    },
    ingestBreadth: () => {
      capitalSyncFailure.push("breadth");
    },
    syncCapitalEnvironmentRecords: async () => {
      capitalSyncFailure.push("capital-environment-sync");
      throw new Error("capital store unavailable");
    },
    detectCrashDays: async () => {
      capitalSyncFailure.push("crash-detect");
      return { upserted: 0, crashDays: [] };
    },
    publishCrashDays: async () => {
      capitalSyncFailure.push("crash-publish");
      return { projected: 0, pruned: 0 };
    },
    detectSurgeDays: async () => {
      capitalSyncFailure.push("surge-detect");
      return { upserted: 0, surgeDays: [] };
    },
    publishSurgeDays: async () => {
      capitalSyncFailure.push("surge-publish");
      return { projected: 0, pruned: 0 };
    },
    publishMarketBreadthHistory: async () => {
      capitalSyncFailure.push("breadth-history-publish");
      return { projected: 0, pruned: 0 };
    },
  });
} catch (error) {
  capitalSyncFailedLoudly = error instanceof Error && error.message === "capital store unavailable";
}
assertions.push({
  name: "unexpected capital sync failure remains loud for queue retry",
  ok:
    capitalSyncFailedLoudly &&
    capitalSyncFailure.join(",") ===
      "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,surge-publish,breadth,capital-environment-sync",
  detail: capitalSyncFailure.join(" → "),
});
assertions.push({
  name: "scheduled refresh interval is 30 minutes",
  ok: MARKET_DATA_REFRESH_INTERVAL_MS === 30 * 60 * 1000,
  detail: `${MARKET_DATA_REFRESH_INTERVAL_MS}ms`,
});
assertions.push({
  name: "unexpected market refresh failures receive bounded queue retries",
  ok: MARKET_DATA_REFRESH_ATTEMPTS === 3,
  detail: `${MARKET_DATA_REFRESH_ATTEMPTS} attempts`,
});

let failed = 0;
for (const assertion of assertions) {
  console.log(
    `${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`,
  );
  if (!assertion.ok) failed++;
}
if (failed > 0) process.exit(1);
