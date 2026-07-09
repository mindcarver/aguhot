/**
 * BullMQ source-ingest queue + worker (worker runtime).
 *
 * AD-4: ingest runs as a BullMQ job, off the web request path. The worker
 * resolves the SourceAdapter for each enabled source by kind (AD-7: adapter
 * assembly happens here in the worker layer, never in the domain service),
 * then hands off to `ingestSources` which is the single writer of evidence_*
 * tables (AD-2).
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions.
 */

import { Queue, Worker, type Job } from "bullmq";

import { ingestSources, RssAdapter } from "@aguhot/core";
import type { AdapterFactory } from "@aguhot/core";

import { getRedis } from "./connection.js";

export const SOURCE_INGEST_QUEUE_NAME = "source-ingest";
export const SOURCE_INGEST_JOB_NAME = "source-ingest";

/**
 * The worker-side adapter factory. This is the AD-7 boundary: the domain
 * service depends on the SourceAdapter port, and the worker is the only place
 * that maps a source kind to a concrete adapter. Adding a new kind means adding
 * a branch here (+ the adapter class), not editing ingestSources.
 */
export const workerAdapterFactory: AdapterFactory = (source) => {
  if (source.kind === "rss") {
    return new RssAdapter({ feedUrl: source.feedUrl });
  }
  throw new Error(`[worker] unknown source kind: ${source.kind}`);
};

export interface SourceIngestJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing source-ingest jobs. Reused across
 * enqueue calls in the same process. The type is inferred from `new Queue()`
 * so it tracks BullMQ's own generic defaults (explicit type params here fought
 * the library's inferred DataType/ResultType/NameType defaults).
 */
let queue: Queue | null = null;

export function getSourceIngestQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(SOURCE_INGEST_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one source-ingest job. Returns the job so callers (e.g. the verify
 * script) can await its completion.
 */
export async function enqueueSourceIngest(traceId: string): Promise<Job> {
  const q = getSourceIngestQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as ingest
  // runs accumulate (keep a short tail for operator inspection).
  return q.add(SOURCE_INGEST_JOB_NAME, { traceId }, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Register the source-ingest Worker in this process. The worker resolves the
 * prisma client + adapter factory, then calls ingestSources. Per-source errors
 * are already isolated inside ingestSources (AC3), so the job resolves as long
 * as the infrastructure (DB/Redis) is reachable.
 */
export function registerSourceIngestWorker(): Worker {
  const worker = new Worker(
    SOURCE_INGEST_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as SourceIngestJobData;
      return ingestSources({
        prisma,
        traceId: data.traceId,
        adapterFor: workerAdapterFactory,
      });
    },
    { connection: getRedis() },
  );
  return worker;
}
