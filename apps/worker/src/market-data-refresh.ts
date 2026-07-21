/**
 * Incremental index, sector, and breadth ingest followed by crash detection and public projection.
 *
 * This is the single orchestration path used by the scheduled worker. The Python
 * sidecar remains the only writer of index_daily_bars and sector_daily_bars;
 * Node owns crash_days and published_crash_days through their existing domain services.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MarketDataRefreshDependencies {
  ingestIndices: () => void | Promise<void>;
  ingestSectors: () => void | Promise<void>;
  ingestBreadth: () => void | Promise<void>;
  detectCrashDays: () => Promise<{ upserted: number; crashDays: readonly unknown[] }>;
  publishCrashDays: () => Promise<{ projected: number; pruned: number }>;
  detectSurgeDays: () => Promise<{ upserted: number; surgeDays: readonly unknown[] }>;
  publishSurgeDays: () => Promise<{ projected: number; pruned: number }>;
  isSurgeCalendarPublicationEnabled: () => boolean;
}

export interface MarketDataRefreshResult {
  detected: number;
  upserted: number;
  projected: number;
  pruned: number;
  detectedSurges: number;
  surgeUpserted: number;
  surgeProjected: number;
  surgePruned: number;
}

/** Execute the refresh stages in strict order. A failed stage stops later writes. */
export async function runMarketDataRefresh(
  dependencies: MarketDataRefreshDependencies,
): Promise<MarketDataRefreshResult> {
  await dependencies.ingestIndices();
  const detection = await dependencies.detectCrashDays();
  // Publish the base crash day first. A sector or breadth-source outage must not
  // make the date disappear from the calendar; the failed job retries later.
  await dependencies.publishCrashDays();
  await dependencies.ingestSectors();
  await dependencies.publishCrashDays();
  const surgePublishingEnabled = dependencies.isSurgeCalendarPublicationEnabled();
  let surgeDetection = { upserted: 0, surgeDays: [] as readonly unknown[] };
  let surgeDetectionSucceeded = false;
  let surgeProjection = { projected: 0, pruned: 0 };
  try {
    surgeDetection = await dependencies.detectSurgeDays();
    surgeDetectionSucceeded = true;
    if (surgePublishingEnabled) {
      surgeProjection = await dependencies.publishSurgeDays();
    }
  } catch (error) {
    console.error(`[market-data-refresh] surge refresh failed: ${(error as Error).message}`);
  }
  await dependencies.ingestBreadth();
  const projection = await dependencies.publishCrashDays();
  if (surgePublishingEnabled && surgeDetectionSucceeded) {
    try {
      surgeProjection = await dependencies.publishSurgeDays();
    } catch (error) {
      console.error(`[market-data-refresh] surge reprojection failed: ${(error as Error).message}`);
    }
  }

  return {
    detected: detection.crashDays.length,
    upserted: detection.upserted,
    projected: projection.projected,
    pruned: projection.pruned,
    detectedSurges: surgeDetection.surgeDays.length,
    surgeUpserted: surgeDetection.upserted,
    surgeProjected: surgeProjection.projected,
    surgePruned: surgeProjection.pruned,
  };
}

/** Production entry used by BullMQ and available to manual operators. */
export async function refreshLatestMarketData(traceId: string): Promise<MarketDataRefreshResult> {
  const {
    getPrisma,
    refreshPublishedCrashDays,
    refreshPublishedSurgeDays,
    upsertCrashDays,
    upsertSurgeDays,
  } = await import("@aguhot/core");
  const prisma = getPrisma();

  return runMarketDataRefresh({
    ingestIndices: () => runIncrementalSidecar("index", 10 * 60 * 1000),
    ingestSectors: () => runIncrementalSidecar("sector", 30 * 60 * 1000),
    ingestBreadth: () => runIncrementalSidecar("breadth", 30 * 60 * 1000),
    detectCrashDays: () => upsertCrashDays({ prisma, traceId }),
    publishCrashDays: () => refreshPublishedCrashDays({ prisma, traceId }),
    detectSurgeDays: () => upsertSurgeDays({ prisma, traceId }),
    publishSurgeDays: () => refreshPublishedSurgeDays({ prisma, traceId }),
    isSurgeCalendarPublicationEnabled: () => process.env.SURGE_CALENDAR_PUBLICATION_ENABLED === "true",
  });
}

async function runIncrementalSidecar(
  scope: "index" | "sector" | "breadth",
  timeoutMs: number,
): Promise<void> {
  const workerSourceDir = path.dirname(fileURLToPath(import.meta.url));
  const sidecarCwd = path.resolve(workerSourceDir, "..", "..", "market-sidecar");
  const child = spawn(
    "uv",
    ["run", "python", "-m", "market_sidecar", "ingest", "--incremental", "--scope", scope],
    {
      cwd: sidecarCwd,
      env: process.env,
      stdio: "inherit",
    },
  );

  const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        reject(new Error(`market ${scope} ingest could not start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        if (signal !== null) {
          reject(new Error(`market ${scope} ingest was killed by ${signal}`));
        } else if (code !== 0) {
          reject(new Error(`market ${scope} ingest exited with status ${String(code)}`));
        } else {
          resolve();
        }
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}
