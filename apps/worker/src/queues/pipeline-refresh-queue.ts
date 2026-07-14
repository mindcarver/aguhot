/**
 * BullMQ pipeline-refresh queue + worker + 10-min self-heal schedule.
 *
 * Drives the FULL publish pipeline on a schedule so the public feed stays fresh
 * without a manual run-ingest + run-pipeline:
 *   source-ingest → event-cluster → explain → recommendation-reason →
 *   decideReview(approve each candidate) → daily-digest → publish-timeline
 *
 * This is the pipeline chaining the repo previously deferred ("auto orchestration
 * / cron is deferred" per the sibling queue headers). It is DEFAULT-ON: index.ts
 * registers the worker + schedule unconditionally. The stage workers (cluster /
 * explain / reason / digest / publish-timeline / source-ingest) are already
 * registered in the same process, so this worker only ENQUEUES + awaits each via
 * QueueEvents — it does not call the domain generators directly (reuses the
 * existing worker runtime verbatim, mirroring run-pipeline.ts's proven sequence).
 *
 * DEV AUTO-APPROVE: every candidate is auto-approved (decideReview outcome
 * "approve", reviewer "pipeline-auto-publish") — the same dev bypass run-pipeline
 * uses. In prod a human reviews in /console; this cron is a dev/local affordance.
 *
 * Idempotent end-to-end: ingest dedupes by content_hash, cluster only creates
 * candidates from unlinked evidence, explain/reason skip events that already have
 * them, approve is a no-op on already-published events, publish-timeline upserts.
 * So a 10-min re-run only does NEW work.
 */

import { Queue, Worker, QueueEvents, type Job } from "bullmq";

import { getRedis } from "./connection.js";
import { enqueueSourceIngest } from "./source-ingest-queue.js";
import { enqueueEventCluster, EVENT_CLUSTER_QUEUE_NAME } from "./event-cluster-queue.js";
import { enqueueExplain, EXPLAIN_QUEUE_NAME } from "./explain-queue.js";
import {
  enqueueRecommendationReason,
  RECOMMENDATION_REASON_QUEUE_NAME,
} from "./recommendation-reason-queue.js";
import { enqueueDailyDigest, DAILY_DIGEST_QUEUE_NAME } from "./daily-digest-queue.js";
import { enqueuePublishTimeline, PUBLISH_TIMELINE_QUEUE_NAME } from "./publish-timeline-queue.js";

export const PIPELINE_REFRESH_QUEUE_NAME = "pipeline-refresh";
export const PIPELINE_REFRESH_JOB_NAME = "pipeline-refresh";

/** Self-heal repeat interval (ms). Full pipeline pass every 10 min. */
export const PIPELINE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface PipelineRefreshJobData {
  traceId: string;
}

let queue: Queue | null = null;

export function getPipelineRefreshQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(PIPELINE_REFRESH_QUEUE_NAME, { connection: getRedis() });
  return queue;
}

/** Enqueue one pipeline-refresh pass on demand (verify/manual). */
export async function enqueuePipelineRefresh(traceId: string): Promise<Job> {
  return getPipelineRefreshQueue().add(
    PIPELINE_REFRESH_JOB_NAME,
    { traceId },
    { removeOnComplete: 100, removeOnFail: 500 },
  );
}

/**
 * Register the repeatable self-heal schedule (every 10 min). Idempotent on
 * restart via upsertJobScheduler. Default-on: index.ts calls this unconditionally.
 */
export async function schedulePipelineRefreshSelfHeal(): Promise<void> {
  await getPipelineRefreshQueue().upsertJobScheduler(
    "pipeline-refresh-self-heal",
    { every: PIPELINE_REFRESH_INTERVAL_MS },
    {
      name: PIPELINE_REFRESH_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    },
  );
}

/**
 * Run one stage: enqueue a job on `queueName` and await its completion via a
 * dedicated QueueEvents connection (BullMQ blocking sub needs its own conn).
 * Errors are logged + swallowed so one failed stage does not abort the whole pass
 * (the next 10-min run retries) — mirrors run-pipeline.ts's stage() tolerance.
 */
async function stage(
  name: string,
  queueName: string,
  enqueue: () => Promise<Job>,
): Promise<void> {
  const qe = new QueueEvents(queueName, { connection: getRedis() });
  try {
    const job = await enqueue();
    await job.waitUntilFinished(qe);
  } catch (e) {
    console.error(`[pipeline-refresh] stage ${name} ERROR`, e instanceof Error ? e.message : e);
  } finally {
    await qe.close();
  }
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Register the pipeline-refresh Worker. Each job runs the full chain. The handler
 * resolves the prisma client + newTraceId via dynamic import (keeps the worker
 * bundle the only place pulling domain+DB). Per-stage errors are isolated.
 */
export function registerPipelineRefreshWorker(): Worker {
  const worker = new Worker(
    PIPELINE_REFRESH_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, newTraceId, decideReview } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as PipelineRefreshJobData;
      const traceId = data.traceId === "scheduled" ? newTraceId() : data.traceId;

      // 1. Ingest (pull all enabled sources — idempotent dedup).
      await stage("source-ingest", "source-ingest", () => enqueueSourceIngest(newTraceId()));

      // 2. Cluster new evidence into candidates.
      await stage("event-cluster", EVENT_CLUSTER_QUEUE_NAME, () => enqueueEventCluster(newTraceId()));

      // 3. Explain (deterministic three-partition for new events).
      await stage("explain", EXPLAIN_QUEUE_NAME, () => enqueueExplain(newTraceId()));

      // 4. recommendation-reason (LLM, only events lacking one).
      await stage("recommendation-reason", RECOMMENDATION_REASON_QUEUE_NAME, () =>
        enqueueRecommendationReason(newTraceId()),
      );

      // 5. Auto-approve every candidate (dev bypass).
      const candidates = await prisma.hotEvent.findMany({
        where: { publicationStatus: "candidate" },
        select: { id: true, title: true },
      });
      let published = 0;
      for (const c of candidates) {
        try {
          await decideReview({
            prisma,
            traceId: newTraceId(),
            hotEventId: c.id,
            outcome: "approve",
            reviewer: "pipeline-auto-publish",
          });
          published += 1;
        } catch (e) {
          console.error(`[pipeline-refresh] approve ${c.id} ERROR`, e instanceof Error ? e.message : e);
        }
      }

      // 6. daily-digest for the latest evidence day.
      const latest = await prisma.publishedHotEvent.findFirst({
        orderBy: { latestEvidenceAt: "desc" },
        select: { latestEvidenceAt: true },
      });
      const coverageDate = latest?.latestEvidenceAt
        ? utcDay(latest.latestEvidenceAt)
        : utcDay(new Date());
      await stage("daily-digest", DAILY_DIGEST_QUEUE_NAME, () =>
        enqueueDailyDigest(newTraceId(), coverageDate),
      );

      // 7. publish-timeline (re-derive the feed read model).
      await stage("publish-timeline", PUBLISH_TIMELINE_QUEUE_NAME, () =>
        enqueuePublishTimeline(newTraceId()),
      );

      return { traceId, approved: published, candidates: candidates.length };
    },
    { connection: getRedis() },
  );
  return worker;
}
