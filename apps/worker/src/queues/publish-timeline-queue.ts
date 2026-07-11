/**
 * BullMQ publish-timeline queue + worker (worker runtime) — Story 4.1.
 *
 * AD-4 + AD-3b: the periodic self-heal of published_timeline_entries runs as a
 * BullMQ job, off the web request path. The worker dynamically imports
 * @aguhot/core's refreshPublishedTimelineAll (the full corrective recompute of
 * the timeline read model) and runs one full pass per job.
 *
 * THIS IS THE SELF-HEAL JOB, NOT THE MAIN REFRESH PATH. The main refresh path
 * is refreshPublishedTimelineForEvent, which runs INSIDE decideReview's
 * $transaction (gate-atomic, zero visibility window, method A). This job is a
 * corrective safety net only: it catches rows that missed the in-tx path (a
 * failed decideReview, a backfilled publish, a derived-field drift after a
 * revision/explanation update). AD-3b is explicit: the in-tx incremental path
 * is mandatory; this job is not allowed to replace it.
 *
 * This mirrors daily-digest-queue.ts / theme-backfill-queue.ts in structure:
 * lazy Queue singleton, enqueue helper with job-retention caps, and a worker
 * that resolves the Prisma client via a dynamic import so the worker bundle
 * stays the only place that pulls in the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("publish-timeline"). The job is idempotent (refreshPublishedTimelineAll
 * upserts stable-id rows + sweeps orphans), so running it repeatedly is safe
 * and produces no duplicates (AC6). On failure, the prior projection stays
 * readable — the public home feed does not crash (AC6 read-path isolation).
 *
 * SCHEDULING: this is the first worker in the repo to carry a repeatable
 * schedule (the other six are on-demand only — "auto orchestration / cron is
 * deferred" per their header comments). The spec (4.1 Code Map) asks for "注册
 * 自愈 worker + 周期 schedule", so registerPublishTimelineWorker registers the
 * Worker and schedulePublishTimelineSelfHeal adds the repeatable job via
 * upsertJobScheduler. index.ts wires both. The repeat interval is intentionally
 * coarse (every 15 min) — self-heal is corrective, not latency-sensitive; the
 * in-tx path is what keeps the feed fresh minute-to-minute.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const PUBLISH_TIMELINE_QUEUE_NAME = "publish-timeline";
export const PUBLISH_TIMELINE_JOB_NAME = "publish-timeline";

/** Self-heal repeat interval (ms). Corrective only — coarse on purpose. */
export const PUBLISH_TIMELINE_SELF_HEAL_INTERVAL_MS = 15 * 60 * 1000; // 15 min

export interface PublishTimelineJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing publish-timeline self-heal jobs. Reused
 * across enqueue + schedule calls in the same process.
 */
let queue: Queue | null = null;

export function getPublishTimelineQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(PUBLISH_TIMELINE_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one publish-timeline self-heal job on demand. Returns the job so
 * callers (e.g. the verify script) can await its completion. The job runs a full
 * refreshPublishedTimelineAll pass: re-derives every published event's timeline
 * row, sweeps orphans. Idempotent.
 */
export async function enqueuePublishTimeline(traceId: string): Promise<Job> {
  const q = getPublishTimelineQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as self-heal
  // runs accumulate (keep a short tail for operator inspection).
  return q.add(
    PUBLISH_TIMELINE_JOB_NAME,
    { traceId },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

/**
 * Register a repeatable self-heal schedule via upsertJobScheduler (BullMQ 5.x).
 * Called once at worker startup so the corrective pass runs every
 * PUBLISH_TIMELINE_SELF_HEAL_INTERVAL_MS without an external cron. Idempotent —
 * upsertJobScheduler replaces any existing schedule with the same key, so a
 * process restart does not create a duplicate schedule.
 *
 * The scheduled job carries a fresh traceId generated inside the worker handler
 * (BullMQ's typed JobData expects one; upsertJobScheduler's data is the static
 * payload for every fired instance). We use a sentinel "scheduled" traceId here;
 * the handler overwrites it with a real newTraceId() per fire so each run is
 * independently traceable.
 */
export async function schedulePublishTimelineSelfHeal(): Promise<void> {
  const q = getPublishTimelineQueue();
  await q.upsertJobScheduler(
    "publish-timeline-self-heal",
    {
      every: PUBLISH_TIMELINE_SELF_HEAL_INTERVAL_MS,
    },
    {
      name: PUBLISH_TIMELINE_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    },
  );
}

/**
 * Register the publish-timeline Worker in this process. The worker resolves the
 * prisma client + newTraceId via dynamic import of @aguhot/core, then calls
 * refreshPublishedTimelineAll for a full corrective pass. Failures are caught
 * and re-thrown so BullMQ marks the job failed (operator can inspect) without
 * crashing the worker process; the prior projection stays readable (AC6).
 */
export function registerPublishTimelineWorker(): Worker {
  const worker = new Worker(
    PUBLISH_TIMELINE_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, refreshPublishedTimelineAll, newTraceId } =
        await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as PublishTimelineJobData;
      // Mint a fresh traceId per fire so each run is independently traceable in
      // the published_timeline_entries.trace_id column. Scheduled fires carry
      // the sentinel "scheduled"; on-demand enqueues carry the caller's traceId.
      const traceId = data.traceId === "scheduled" ? newTraceId() : data.traceId;

      try {
        await refreshPublishedTimelineAll({ prisma, traceId });
        return { ok: true };
      } catch (error) {
        // Isolate failures: log and re-throw so BullMQ marks the job failed.
        // The prior projection stays readable (AC6 read-path isolation).
        console.error(
          `[publish-timeline-worker] self-heal pass failed`,
          error,
        );
        throw error;
      }
    },
    { connection: getRedis() },
  );
  return worker;
}
