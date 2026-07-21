/** Deterministic orchestration checks for crash and gated surge calendars. */
import { runMarketDataRefresh } from "./market-data-refresh.js";
import { MARKET_DATA_REFRESH_INTERVAL_MS } from "./queues/market-data-refresh-queue.js";

interface Assertion { name: string; ok: boolean; detail?: string }
const assertions: Assertion[] = [];

const order: string[] = [];
const result = await runMarketDataRefresh({
  ingestIndices: () => { order.push("index"); },
  ingestSectors: () => { order.push("sector"); },
  ingestBreadth: () => { order.push("breadth"); },
  detectCrashDays: async () => { order.push("crash-detect"); return { upserted: 2, crashDays: [{}, {}] }; },
  publishCrashDays: async () => { order.push("crash-publish"); return { projected: 2, pruned: 0 }; },
  detectSurgeDays: async () => { order.push("surge-detect"); return { upserted: 1, surgeDays: [{}] }; },
  publishSurgeDays: async () => { order.push("surge-publish"); return { projected: 1, pruned: 0 }; },
  isSurgeCalendarPublicationEnabled: () => true,
});
assertions.push({
  name: "crash base, sector, surge, and breadth stages preserve their order",
  ok: order.join(",") === "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,surge-publish,breadth,crash-publish,surge-publish",
  detail: order.join(" → "),
});
assertions.push({
  name: "result exposes independent surge counts",
  ok: result.detected === 2 && result.detectedSurges === 1 && result.surgeProjected === 1,
  detail: JSON.stringify(result),
});

const disabled: string[] = [];
const disabledResult = await runMarketDataRefresh({
  ingestIndices: () => { disabled.push("index"); },
  ingestSectors: () => { disabled.push("sector"); },
  ingestBreadth: () => { disabled.push("breadth"); },
  detectCrashDays: async () => { disabled.push("crash-detect"); return { upserted: 0, crashDays: [] }; },
  publishCrashDays: async () => { disabled.push("crash-publish"); return { projected: 0, pruned: 0 }; },
  detectSurgeDays: async () => { disabled.push("surge-detect"); return { upserted: 1, surgeDays: [{}] }; },
  publishSurgeDays: async () => { disabled.push("surge-publish"); return { projected: 1, pruned: 0 }; },
  isSurgeCalendarPublicationEnabled: () => false,
});
assertions.push({
  name: "disabled surge publication keeps detection but writes no public surge row",
  ok: disabled.join(",") === "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,breadth,crash-publish"
    && disabledResult.surgeProjected === 0,
  detail: disabled.join(" → "),
});

const surgeFailure: string[] = [];
const isolatedFailureResult = await runMarketDataRefresh({
  ingestIndices: () => { surgeFailure.push("index"); },
  ingestSectors: () => { surgeFailure.push("sector"); },
  ingestBreadth: () => { surgeFailure.push("breadth"); },
  detectCrashDays: async () => { surgeFailure.push("crash-detect"); return { upserted: 1, crashDays: [{}] }; },
  publishCrashDays: async () => { surgeFailure.push("crash-publish"); return { projected: 1, pruned: 0 }; },
  detectSurgeDays: async () => { surgeFailure.push("surge-detect"); throw new Error("surge unavailable"); },
  publishSurgeDays: async () => { surgeFailure.push("surge-publish"); return { projected: 1, pruned: 0 }; },
  isSurgeCalendarPublicationEnabled: () => true,
});
assertions.push({
  name: "surge failure does not block existing breadth and crash reprojection",
  ok: surgeFailure.join(",") === "index,crash-detect,crash-publish,sector,crash-publish,surge-detect,breadth,crash-publish"
    && isolatedFailureResult.detectedSurges === 0,
  detail: surgeFailure.join(" → "),
});

const sectorFailure: string[] = [];
let sectorFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => { sectorFailure.push("index"); },
    ingestSectors: () => { sectorFailure.push("sector"); throw new Error("sector unavailable"); },
    ingestBreadth: () => { sectorFailure.push("breadth"); },
    detectCrashDays: async () => { sectorFailure.push("crash-detect"); return { upserted: 1, crashDays: [{}] }; },
    publishCrashDays: async () => { sectorFailure.push("crash-publish"); return { projected: 1, pruned: 0 }; },
    detectSurgeDays: async () => ({ upserted: 0, surgeDays: [] }),
    publishSurgeDays: async () => ({ projected: 0, pruned: 0 }),
    isSurgeCalendarPublicationEnabled: () => false,
  });
} catch (error) {
  sectorFailedLoudly = error instanceof Error && error.message === "sector unavailable";
}
assertions.push({
  name: "sector failure preserves the base crash-day projection and stops later stages",
  ok: sectorFailedLoudly && sectorFailure.join(",") === "index,crash-detect,crash-publish,sector",
  detail: sectorFailure.join(" → "),
});

const indexFailure: string[] = [];
let indexFailedLoudly = false;
try {
  await runMarketDataRefresh({
    ingestIndices: () => { indexFailure.push("index"); throw new Error("source unavailable"); },
    ingestSectors: () => { indexFailure.push("sector"); },
    ingestBreadth: () => { indexFailure.push("breadth"); },
    detectCrashDays: async () => ({ upserted: 0, crashDays: [] }),
    publishCrashDays: async () => ({ projected: 0, pruned: 0 }),
    detectSurgeDays: async () => ({ upserted: 0, surgeDays: [] }),
    publishSurgeDays: async () => ({ projected: 0, pruned: 0 }),
    isSurgeCalendarPublicationEnabled: () => false,
  });
} catch (error) {
  indexFailedLoudly = error instanceof Error && error.message === "source unavailable";
}
assertions.push({ name: "index failure stops both calendar domains", ok: indexFailedLoudly && indexFailure.join(",") === "index" });
assertions.push({
  name: "scheduled refresh interval is 30 minutes",
  ok: MARKET_DATA_REFRESH_INTERVAL_MS === 30 * 60 * 1000,
  detail: `${MARKET_DATA_REFRESH_INTERVAL_MS}ms`,
});

let failed = 0;
for (const assertion of assertions) {
  console.log(`${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`);
  if (!assertion.ok) failed++;
}
if (failed > 0) process.exit(1);
