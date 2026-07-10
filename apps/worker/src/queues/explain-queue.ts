/**
 * BullMQ explain queue + worker (worker runtime).
 *
 * AD-4: explanation generation runs as a BullMQ job, off the web request path.
 * The worker dynamically imports @aguhot/core's `generateExplanation` (the
 * single writer of explanation_versions, AD-5) and runs one explain pass over
 * candidate hot events that have no ExplanationVersion yet.
 *
 * This mirrors event-cluster-queue.ts in structure: lazy Queue singleton,
 * enqueue helper with job-retention caps, and a worker that resolves the Prisma
 * client via a dynamic import so the worker bundle stays the only place that
 * pulls in the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("explain"). Like event-cluster, this job is independent and idempotent: it
 * does NOT chain from event-cluster automatically (cluster→explain auto
 * orchestration / cron is deferred — same decoupling as ingest→cluster). The
 * worker processes candidate hot events that have no ExplanationVersion; running
 * it again is safe (generateExplanation appends a new version each time, AD-5 —
 * a re-run over an already-explained event produces a fresh appended version,
 * which is the intended idempotent append behavior).
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const EXPLAIN_QUEUE_NAME = "explain";
export const EXPLAIN_JOB_NAME = "explain";

export interface ExplainJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing explain jobs. Reused across enqueue
 * calls in the same process.
 */
let queue: Queue | null = null;

export function getExplainQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(EXPLAIN_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one explain job. Returns the job so callers (e.g. the verify script)
 * can await its completion.
 */
export async function enqueueExplain(traceId: string): Promise<Job> {
  const q = getExplainQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as explain
  // runs accumulate (keep a short tail for operator inspection).
  return q.add(EXPLAIN_JOB_NAME, { traceId }, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Register the explain Worker in this process. The worker resolves the prisma
 * client, then finds CANDIDATE hot events (publication_status="candidate") that
 * have no ExplanationVersion yet and calls generateExplanation for each (the
 * single writer of explanation_versions, AD-5). The job resolves as long as the
 * infrastructure (DB/Redis) is reachable; per-event errors are isolated (one
 * bad event does not abort the rest).
 *
 * Scoped to "candidate" only: the explanation is generated while an event is a
 * review candidate, and the publish-orchestrator projection surfaces the latest
 * ExplanationVersion at publish time (so pre-publish generation flows into the
 * public read model on publish). Generating for already-published events would
 * write a version the projection never reflects (the detail page only refreshes
 * its projection inside decideReview, not after a worker append → a stale
 * detail page); generating for rejected/taken_down events is wasted work plus
 * version-chain pollution on non-public events. This mirrors how verify/seed
 * call generateExplanation directly (no Redis) — the worker is the prod-runtime
 * carrier.
 */
export function registerExplainWorker(): Worker {
  const worker = new Worker(
    EXPLAIN_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, generateExplanation } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as ExplainJobData;

      // Find CANDIDATE hot events with no explanation version yet. The status
      // filter is load-bearing (see the doc comment above): without it the
      // worker would also process published/rejected/taken_down events. A left
      // join via the reverse relation selects events whose explanationVersions
      // is empty.
      const unexplained = await prisma.hotEvent.findMany({
        where: { publicationStatus: "candidate", explanationVersions: { none: {} } },
        select: { id: true },
      });

      let generated = 0;
      for (const ev of unexplained) {
        try {
          const result = await generateExplanation({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
          });
          if (result !== null) generated += 1;
        } catch (error) {
          // Isolate per-event failures: log and continue so one bad event does
          // not abort the whole pass. generateExplanation returns null (no
          // write) for evidence-less events, so only genuine DB errors land
          // here.
          console.error(
            `[explain-worker] failed for hotEvent ${ev.id}`,
            error,
          );
        }
      }
      return { generated, considered: unexplained.length };
    },
    { connection: getRedis() },
  );
  return worker;
}
