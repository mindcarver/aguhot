/**
 * BullMQ event-cluster queue + worker (worker runtime).
 *
 * AD-4: clustering runs as a BullMQ job, off the web request path. The worker
 * dynamically imports @aguhot/core's `clusterEvents` (the single writer of
 * hot_events + hot_event_evidence, AD-2) and runs one clustering pass over
 * unlinked archived records.
 *
 * This mirrors source-ingest-queue.ts in structure: lazy Queue singleton,
 * enqueue helper with job-retention caps, and a worker that resolves the Prisma
 * client via a dynamic import so the worker bundle stays the only place that
 * pulls in the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const EVENT_CLUSTER_QUEUE_NAME = "event-cluster";
export const EVENT_CLUSTER_JOB_NAME = "event-cluster";

export interface EventClusterJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing event-cluster jobs. Reused across
 * enqueue calls in the same process.
 */
let queue: Queue | null = null;

export function getEventClusterQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(EVENT_CLUSTER_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one event-cluster job. Returns the job so callers (e.g. the verify
 * script) can await its completion.
 */
export async function enqueueEventCluster(traceId: string): Promise<Job> {
  const q = getEventClusterQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as cluster
  // runs accumulate (keep a short tail for operator inspection).
  return q.add(EVENT_CLUSTER_JOB_NAME, { traceId }, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Register the event-cluster Worker in this process. The worker resolves the
 * prisma client, then calls clusterEvents which is the single writer of
 * hot_events + hot_event_evidence (AD-2). The job resolves as long as the
 * infrastructure (DB/Redis) is reachable; per-record errors are isolated inside
 * clusterEvents (it skips already-linked records and guards duplicate links).
 */
export function registerEventClusterWorker(): Worker {
  const worker = new Worker(
    EVENT_CLUSTER_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, clusterEvents } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as EventClusterJobData;
      return clusterEvents({ prisma, traceId: data.traceId });
    },
    { connection: getRedis() },
  );
  return worker;
}
