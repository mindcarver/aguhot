/**
 * @aguhot/worker — ingest / normalize / cluster / explain / publish runtime.
 *
 * Story 1.4 registered the source-ingest worker. Story 1.5 added the event-
 * cluster worker. Story 1.8 adds the explain worker alongside them: validate
 * required env (DB + Redis), connect Redis, register all three workers, and
 * wire graceful shutdown (close all three). The web request path never imports
 * this module — heavy work is async (AD-4).
 *
 * The three workers are independent and idempotent: ingest does not trigger a
 * cluster job automatically, and cluster does not trigger an explain job
 * automatically (the jobs are decoupled; pipeline chaining/cron orchestration is
 * deferred — see deferred-work.md). Each can run in isolation against the shared
 * DB/Redis.
 */

import { requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import { registerEventClusterWorker } from "./queues/event-cluster-queue.js";
import { registerExplainWorker } from "./queues/explain-queue.js";
import { registerSourceIngestWorker } from "./queues/source-ingest-queue.js";

async function main(): Promise<void> {
  // Fail loud and early if infra is missing (Block-If): a worker without DB or
  // Redis cannot do its job, and silent degradation would hide broken ingest.
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  const redis = getRedis();
  await redis.ping();

  const sourceIngestWorker = registerSourceIngestWorker();
  const eventClusterWorker = registerEventClusterWorker();
  const explainWorker = registerExplainWorker();

  console.log("[worker] source-ingest + event-cluster + explain workers registered and running");

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    await Promise.all([
      sourceIngestWorker.close(),
      eventClusterWorker.close(),
      explainWorker.close(),
    ]);
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
