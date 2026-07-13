/**
 * DEV runner — backfill recommendation_reason for every published/candidate
 * hot_event that lacks one. The worker self-discovers them (publicationStatus
 * in [candidate, published] + no reason). One job processes all pending events
 * sequentially; the 120s per-call timeout (openai-compatible-llm-adapter)
 * keeps one stalled call from blocking the rest.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-reason.ts
 */
import { QueueEvents } from "bullmq";
import { getPrisma, newTraceId } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";
import { closeRedis, getRedis } from "./queues/connection.js";
import {
  RECOMMENDATION_REASON_QUEUE_NAME,
  enqueueRecommendationReason,
  registerRecommendationReasonWorker,
} from "./queues/recommendation-reason-queue.js";

resetEnvCache();
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
const redis = getRedis();
await redis.ping();
const prisma = getPrisma();

const pending = await prisma.hotEvent.count({
  where: {
    publicationStatus: { in: ["candidate", "published"] },
    recommendationReasons: { none: {} },
  },
});
console.log(`events needing a reason: ${pending}`);

const worker = registerRecommendationReasonWorker();
const qe = new QueueEvents(RECOMMENDATION_REASON_QUEUE_NAME, { connection: getRedis() });
try {
  console.log("[reason] start");
  const job = await enqueueRecommendationReason(newTraceId());
  await job.waitUntilFinished(qe);
  console.log("[reason] done");
} catch (e) {
  console.error("[reason] ERROR", e instanceof Error ? e.message : e);
} finally {
  await qe.close();
  await worker.close();
  await closeRedis();
}

const after = await prisma.hotEvent.count({
  where: {
    publicationStatus: { in: ["candidate", "published"] },
    recommendationReasons: { none: {} },
  },
});
console.log(`events still without a reason: ${after}`);
await prisma.$disconnect();
