/**
 * BullMQ daily-digest queue + worker (worker runtime) — Story 2.4.
 *
 * AD-4: daily digest generation runs as a BullMQ job, off the web request path.
 * The worker dynamically imports @aguhot/core's generateDailyDigest (the single
 * writer of daily_digests, AD-2) and processes ONE coverageDate per job (the
 * day's digest aggregates all eligible published events for that date).
 *
 * This mirrors theme-backfill-queue.ts / market-reaction-queue.ts in structure
 * (Story 2.1/2.3): lazy Queue singleton, enqueue helper with job-retention
 * caps, and a worker that resolves the Prisma client via a dynamic import so
 * the worker bundle stays the only place that pulls in the domain+DB layer.
 * epic-2-context lists daily digest as one of three Epic-2 BullMQ job
 * categories (market-signal aggregation 2-1 / theme backfill 2-3 / daily digest
 * 2-4) — the worker is built here.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("daily-digest"). Like the other workers, this job is independent and
 * idempotent: it does NOT chain from explain/market/theme/publish automatically
 * (publish→digest auto orchestration / cron is deferred). The worker processes
 * the coverageDate passed in the job data; running it again is safe (a re-run
 * appends a fresh row, AD-5 — the intended idempotent append behavior).
 *
 * V1 HONESTY RULE (load-bearing, mirrors theme-backfill-queue.ts): the worker
 * runtime resolves NO adapter (real digest LLM/summarizer provider procurement
 * is deferred). With no adapter, generateDailyDigest returns null and writes
 * nothing, so prod degrades honestly — the /daily page shows the degraded state
 * (AC3). StubDigestAdapter is TEST-ONLY (verify/e2e import it from core and
 * pass it to generateDailyDigest directly); apps/worker MUST NOT import it.
 *
 *   // ponytail: real provider wired when procured — V1 no adapter, prod degrades
 *   // honestly.
 *
 * When a real provider lands, the worker will resolve that adapter here (one
 * line), generateDailyDigest will flow conclusions through, and source will
 * flip from "template" to the provider id. The port + append-only write table +
 * read model + /daily page are all already in place.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const DAILY_DIGEST_QUEUE_NAME = "daily-digest";
export const DAILY_DIGEST_JOB_NAME = "daily-digest";

export interface DailyDigestJobData {
  traceId: string;
  // ISO YYYY-MM-DD string for serialization safety across BullMQ/Redis. The
  // worker parses this back into a Date (UTC) before calling generateDailyDigest.
  coverageDate: string;
}

/**
 * Lazily-constructed Queue for enqueuing daily-digest jobs. Reused across
 * enqueue calls in the same process.
 */
let queue: Queue | null = null;

export function getDailyDigestQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(DAILY_DIGEST_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one daily-digest job for the given coverageDate. Returns the job so
 * callers (e.g. the verify script) can await its completion.
 *
 * coverageDate is serialized as an ISO YYYY-MM-DD string (BullMQ serializes job
 * data to JSON; Date objects lose fidelity across the Redis boundary, so the
 * caller passes a Date and we serialize it here).
 */
export async function enqueueDailyDigest(
  traceId: string,
  coverageDate: Date,
): Promise<Job> {
  const q = getDailyDigestQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as daily-
  // digest runs accumulate (keep a short tail for operator inspection).
  return q.add(
    DAILY_DIGEST_JOB_NAME,
    {
      traceId,
      coverageDate: coverageDate.toISOString(),
    },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

/**
 * Register the daily-digest Worker in this process. The worker resolves the
 * prisma client, parses the coverageDate from the job data, and calls
 * generateDailyDigest for that coverageDate. The eligible set (published hot
 * events whose latestEvidenceAt UTC day = coverageDate) is computed inside
 * generateDailyDigest (JS filter on listPublishedHotEvents).
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) →
 * generateDailyDigest returns null → the whole job skips → returns
 * {generated:0, skipped} and prod degrades honestly. This is the intended V1
 * behavior: the pipeline is correct (verify/e2e prove the happy path with
 * StubDigestAdapter), but the worker cannot produce real conclusions without a
 * real provider, so it writes nothing rather than fabricating fixture data.
 *
 * When an adapter IS available, the worker calls generateDailyDigest, then
 * refreshPublishedDailyDigest so the new digest flows into
 * published_daily_digests immediately. try/catch isolates failures (a bad
 * coverageDate does not abort the worker).
 */
export function registerDailyDigestWorker(): Worker {
  const worker = new Worker(
    DAILY_DIGEST_QUEUE_NAME,
    async (job: Job) => {
      const {
        getPrisma,
        generateDailyDigest,
        refreshPublishedDailyDigest,
      } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as DailyDigestJobData;
      const coverageDate = new Date(data.coverageDate);

      // V1 HONESTY RULE: no real digest LLM/summarizer provider is wired
      // (procurement deferred). With no adapter, generateDailyDigest cannot
      // run — it would return null and write nothing. We skip and report it as
      // skipped so the caller knows the pipeline ran but produced no digest
      // (honest degradation, AC3). StubDigestAdapter is test-only and is NOT
      // imported here.
      //
      // ponytail: real provider wired when procured — V1 no adapter, prod
      // degrades honestly.
      const adapter = undefined;
      if (adapter === undefined) {
        return { generated: 0, considered: 1, skipped: 1 };
      }

      try {
        const result = await generateDailyDigest({
          prisma,
          traceId: data.traceId,
          coverageDate,
          adapter,
        });
        if (result !== null) {
          // Refresh the public projection so the new digest flows into
          // published_daily_digests immediately (mirrors how the theme-backfill
          // / market-reaction workers call refresh after a successful generate —
          // the trigger layer refreshes, the generator only appends).
          await refreshPublishedDailyDigest({
            prisma,
            traceId: data.traceId,
            coverageDate,
          });
          return { generated: 1, considered: 1 };
        }
        // No eligible events / adapter returned nothing → degrade honestly.
        return { generated: 0, considered: 1, skipped: 1 };
      } catch (error) {
        // Isolate failures: log and re-throw so BullMQ marks the job failed
        // (operator can inspect). A bad coverageDate or adapter error does not
        // crash the worker process.
        console.error(
          `[daily-digest-worker] failed for coverageDate ${data.coverageDate}`,
          error,
        );
        throw error;
      }
    },
    { connection: getRedis() },
  );
  return worker;
}
