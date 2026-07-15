/**
 * DEV runner — drive the REAL publish pipeline end-to-end against whatever
 * evidence_records are in the DB. Bypasses the operator review gate by
 * auto-approving every candidate (dev only — in prod a human reviews in
 * /console). NOT a test: no resetState/cleanup, real writes left in place.
 *
 * Sequence (decoupled stages, awaited in order via QueueEvents):
 *   event-cluster → explain → recommendation-reason(LLM) → decideReview(approve
 *   each candidate) → daily-digest(LLM, coverageDate = max evidence day) →
 *   publish-timeline
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && NODE_USE_ENV_PROXY=1 node --import tsx/esm src/run-pipeline.ts
 */
import { QueueEvents } from "bullmq";

import {
  getPrisma,
  newTraceId,
  decideReview,
  decideAutoPublishOutcome,
  RelevanceLabel,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import {
  EVENT_CLUSTER_QUEUE_NAME,
  enqueueEventCluster,
  registerEventClusterWorker,
} from "./queues/event-cluster-queue.js";
import {
  EXPLAIN_QUEUE_NAME,
  enqueueExplain,
  registerExplainWorker,
} from "./queues/explain-queue.js";
import {
  RECOMMENDATION_REASON_QUEUE_NAME,
  enqueueRecommendationReason,
  registerRecommendationReasonWorker,
} from "./queues/recommendation-reason-queue.js";
import {
  DAILY_DIGEST_QUEUE_NAME,
  enqueueDailyDigest,
  registerDailyDigestWorker,
} from "./queues/daily-digest-queue.js";
import {
  PUBLISH_TIMELINE_QUEUE_NAME,
  enqueuePublishTimeline,
  registerPublishTimelineWorker,
} from "./queues/publish-timeline-queue.js";

resetEnvCache();
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
const redis = getRedis();
await redis.ping();
const prisma = getPrisma();

const workers = [
  registerEventClusterWorker(),
  registerExplainWorker(),
  registerRecommendationReasonWorker(),
  registerDailyDigestWorker(),
  registerPublishTimelineWorker(),
];

async function stage(name: string, queueName: string, enqueue: () => Promise<unknown>) {
  // QueueEvents needs its own dedicated connection (BullMQ blocking sub).
  const qe = new QueueEvents(queueName, { connection: getRedis() });
  try {
    console.log(`[${name}] start`);
    const job = await enqueue();
    await (job as { waitUntilFinished: (qe: QueueEvents) => Promise<unknown> }).waitUntilFinished(qe);
    console.log(`[${name}] done`);
  } catch (e) {
    console.error(`[${name}] ERROR`, e instanceof Error ? e.message : e);
  } finally {
    await qe.close();
  }
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

await stage("cluster", EVENT_CLUSTER_QUEUE_NAME, () => enqueueEventCluster(newTraceId()));
console.log("  candidate hot_events:", await prisma.hotEvent.count());

await stage("explain", EXPLAIN_QUEUE_NAME, () => enqueueExplain(newTraceId()));
await stage("reason", RECOMMENDATION_REASON_QUEUE_NAME, () =>
  enqueueRecommendationReason(newTraceId()),
);

// Score-aware auto-publish (Story 7.3). Replaces the blind "approve every
// candidate" dev bypass: each candidate is routed by decideAutoPublishOutcome
// from its cluster-time relevance label + saliency score:
//   reject  → decideReview(reject)   (off-topic noise / degenerate — kept out)
//   approve → decideReview(approve)   (multi-source confirmed — auto-published)
//   hold    → left as candidate       (operator review in /console)
// In prod the same outcome fn drives any future auto-publish path; the manual
// /console gate is NOT bound by it (AD-6 stays the gate).
const candidates = await prisma.hotEvent.findMany({
  where: { publicationStatus: "candidate" },
  select: { id: true, title: true, relevanceLabel: true, saliency: true },
});
const counts = { approve: 0, reject: 0, hold: 0 };
console.log(`score-aware publish: ${candidates.length} candidate(s)…`);
for (const c of candidates) {
  const outcome = decideAutoPublishOutcome(
    (c.relevanceLabel ?? RelevanceLabel.Fail) as RelevanceLabel,
    c.saliency ?? 0,
  );
  counts[outcome] += 1;
  const label = (c.title ?? c.id).slice(0, 50);
  try {
    if (outcome === "approve") {
      await decideReview({
        prisma,
        traceId: newTraceId(),
        hotEventId: c.id,
        outcome: "approve",
        reviewer: "dev-auto-publish",
      });
      console.log(`  ✓ published: ${label}`);
    } else if (outcome === "reject") {
      await decideReview({
        prisma,
        traceId: newTraceId(),
        hotEventId: c.id,
        outcome: "reject",
        reviewer: "dev-auto-publish",
        note: "low-relevance/low-saliency (Epic 7 gate)",
      });
      console.log(`  ✗ rejected:  ${label}`);
    } else {
      console.log(`  … held:      ${label}`);
    }
  } catch (e) {
    console.error(`  ✗ ${c.id}:`, e instanceof Error ? e.message : e);
  }
}
console.log(
  `  → ${counts.approve} published, ${counts.hold} held, ${counts.reject} rejected`,
);

// Digest coverageDate = the day of the latest evidence among published events
// (not necessarily "today" — RSS items may carry an earlier pubDate).
const latest = await prisma.publishedHotEvent.findFirst({
  orderBy: { latestEvidenceAt: "desc" },
  select: { latestEvidenceAt: true },
});
const coverageDate = latest?.latestEvidenceAt ? utcDay(latest.latestEvidenceAt) : utcDay(new Date());
console.log("digest coverageDate:", coverageDate.toISOString().slice(0, 10));

await stage("daily-digest", DAILY_DIGEST_QUEUE_NAME, () =>
  enqueueDailyDigest(newTraceId(), coverageDate),
);
await stage("publish-timeline", PUBLISH_TIMELINE_QUEUE_NAME, () =>
  enqueuePublishTimeline(newTraceId()),
);

await Promise.all(workers.map((w) => w.close()));
await closeRedis();
console.log("=== pipeline complete ===");
