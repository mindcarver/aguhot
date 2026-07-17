/**
 * Incremental market-index ingest followed by crash detection and public projection.
 *
 * This is the single orchestration path used by the scheduled worker. The Python
 * sidecar remains the only writer of index_daily_bars; Node owns crash_days and
 * published_crash_days through their existing domain services.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MarketDataRefreshDependencies {
  ingestIndices: () => void | Promise<void>;
  detectCrashDays: () => Promise<{ upserted: number; crashDays: readonly unknown[] }>;
  publishCrashDays: () => Promise<{ projected: number; pruned: number }>;
}

export interface MarketDataRefreshResult {
  detected: number;
  upserted: number;
  projected: number;
  pruned: number;
}

/** Execute the three stages in strict order. A failed stage stops later writes. */
export async function runMarketDataRefresh(
  dependencies: MarketDataRefreshDependencies,
): Promise<MarketDataRefreshResult> {
  await dependencies.ingestIndices();
  const detection = await dependencies.detectCrashDays();
  const projection = await dependencies.publishCrashDays();

  return {
    detected: detection.crashDays.length,
    upserted: detection.upserted,
    projected: projection.projected,
    pruned: projection.pruned,
  };
}

/** Production entry used by BullMQ and available to manual operators. */
export async function refreshLatestMarketData(traceId: string): Promise<MarketDataRefreshResult> {
  const { getPrisma, refreshPublishedCrashDays, upsertCrashDays } = await import("@aguhot/core");
  const prisma = getPrisma();

  return runMarketDataRefresh({
    ingestIndices: runIncrementalIndexIngest,
    detectCrashDays: () => upsertCrashDays({ prisma, traceId }),
    publishCrashDays: () => refreshPublishedCrashDays({ prisma, traceId }),
  });
}

async function runIncrementalIndexIngest(): Promise<void> {
  const workerSourceDir = path.dirname(fileURLToPath(import.meta.url));
  const sidecarCwd = path.resolve(workerSourceDir, "..", "..", "market-sidecar");
  const child = spawn(
    "uv",
    ["run", "python", "-m", "market_sidecar", "ingest", "--incremental", "--scope", "index"],
    {
      cwd: sidecarCwd,
      env: process.env,
      stdio: "inherit",
    },
  );

  const timeout = setTimeout(() => child.kill("SIGTERM"), 10 * 60 * 1000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", (error) => {
        reject(new Error(`market index ingest could not start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        if (signal !== null) {
          reject(new Error(`market index ingest was killed by ${signal}`));
        } else if (code !== 0) {
          reject(new Error(`market index ingest exited with status ${String(code)}`));
        } else {
          resolve();
        }
      });
    });
  } finally {
    clearTimeout(timeout);
  }
}
