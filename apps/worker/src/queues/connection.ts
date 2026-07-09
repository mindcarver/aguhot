/**
 * Redis connection singleton for BullMQ (worker runtime).
 *
 * The connection string comes from @aguhot/config's `requireEnv("REDIS_URL")`
 * so a missing/unreachable Redis fails loudly at worker startup (Block-If)
 * rather than silently degrading. The web app never imports this module, so
 * the public build stays REDIS_URL-free (AD-3/AD-6).
 */

import IORedis from "ioredis";
import { requireEnv } from "@aguhot/config";

let redis: IORedis | null = null;

/**
 * Return the shared IORedis instance used by every BullMQ Queue and Worker in
 * this process. Constructs the connection on first call.
 */
export function getRedis(): IORedis {
  if (redis !== null) return redis;
  const url = requireEnv("REDIS_URL");
  redis = new IORedis(url, {
    // BullMQ manages its own reconnection; defer to its defaults.
    maxRetriesPerRequest: null,
  });
  return redis;
}

/**
 * Close the shared connection if one was created. Intended for graceful
 * shutdown (SIGTERM) and tests.
 */
export async function closeRedis(): Promise<void> {
  if (redis === null) return;
  await redis.quit();
  redis = null;
}
