/**
 * @aguhot/worker — ingest / normalize / cluster / explain / publish runtime.
 *
 * Story 1.4 replaces the import-free stub with the first real worker entry:
 * validate required env (DB + Redis), connect Redis, register the source-ingest
 * worker, and wire graceful shutdown. The web request path never imports this
 * module — heavy work is async (AD-4).
 */

import { requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import { registerSourceIngestWorker } from "./queues/source-ingest-queue.js";

async function main(): Promise<void> {
  // Fail loud and early if infra is missing (Block-If): a worker without DB or
  // Redis cannot do its job, and silent degradation would hide broken ingest.
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  const redis = getRedis();
  await redis.ping();

  const worker = registerSourceIngestWorker();

  console.log("[worker] source-ingest worker registered and running");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    await worker.close();
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[worker] fatal startup error", error);
  process.exit(1);
});
