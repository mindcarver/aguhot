/**
 * BullMQ daily-digest queue + worker (worker runtime) — Story 2.4 + Story 5.3.
 *
 * AD-4: daily digest generation runs as a BullMQ job, off the web request path.
 * The worker dynamically imports @aguhot/core's generateDailyDigest (the single
 * writer of daily_digests, AD-2) and processes ONE coverageDate per job (the
 * day's digest aggregates all eligible published events for that date). Story
 * 5.3 extends this same job to also generate the cross-event AI 趋势研判
 * (trend briefing) for the same coverageDate — epic-5-context :22/:65 "趋势研判
 * 随日报生成 job 发布" / "趋势研判挂这里". The two share the coverageDate key and
 * the same adapter-driven honest-degradation shape, so they belong in one job
 * (NOT a 10th queue; the spec Design Notes explains why this differs from 5.2's
 * separate deep-read-queue).
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
 * runtime resolves NO adapter for EITHER path (real digest LLM/summarizer AND
 * real trend-briefing LLM provider procurement are both deferred). With no
 * digest adapter, generateDailyDigest returns null and writes nothing; with no
 * llmAdapter, generateTrendBriefing returns null and writes nothing. So prod
 * degrades honestly on BOTH paths — the /daily page shows the degraded states
 * (AC3). StubDigestAdapter + StubLlmAdapter are TEST-ONLY (verify/e2e import
 * them from core and pass them to the generators directly); apps/worker MUST
 * NOT import either.
 *
 *   // ponytail: real providers wired when procured — V1 no adapters, prod
 *   // degrades honestly on both paths.
 *
 * When real providers land, the worker will resolve those adapters here (one
 * line each), generateDailyDigest + generateTrendBriefing will flow content
 * through, and source will flip from "template" to the provider id. The ports +
 * append-only write tables + read models + /daily page are all already in place.
 *
 * The two adapter paths are INDEPENDENT (digestAdapter + llmAdapter): either can
 * be wired while the other stays undefined. The daily-digest generation and the
 * trend-briefing generation do NOT block each other (spec AC: "研判与日报互不阻
 * 塞，任一 adapter undefined 时另一路径仍可独立产出").
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
 * generateDailyDigest + generateTrendBriefing for that coverageDate. The
 * eligible set (published hot events whose latestEvidenceAt UTC day =
 * coverageDate) is computed inside each generator (JS filter on
 * listPublishedHotEvents).
 *
 * V1 worker runtime resolves NO adapter for EITHER path (both procurement
 * deferred) → both generators return null → the whole job skips → returns
 * {generated:0, skipped} and prod degrades honestly on both paths. This is the
 * intended V1 behavior: the pipeline is correct (verify/e2e prove the happy
 * paths with StubDigestAdapter + StubLlmAdapter), but the worker cannot produce
 * real content without real providers, so it writes nothing rather than
 * fabricating fixture data.
 *
 * When adapters ARE available, the worker runs each path independently inside
 * one try/catch: (1) digestAdapter !== undefined → generateDailyDigest + then
 * refreshPublishedDailyDigest; (2) llmAdapter !== undefined →
 * generateTrendBriefing + (on non-null) refreshPublishedTrendBriefing. The two
 * paths do not block each other. try/catch isolates failures (a bad
 * coverageDate / adapter error does not crash the worker; it re-throws so
 * BullMQ marks the job failed for operator inspection).
 */
export function registerDailyDigestWorker(): Worker {
  const worker = new Worker(
    DAILY_DIGEST_QUEUE_NAME,
    async (job: Job) => {
      const {
        getPrisma,
        generateDailyDigest,
        generateTrendBriefing,
        refreshPublishedDailyDigest,
        refreshPublishedTrendBriefing,
      } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as DailyDigestJobData;
      const coverageDate = new Date(data.coverageDate);

      // V1 HONESTY RULE (Story 2.4 digest path): no real digest LLM/summarizer
      // provider is wired (procurement deferred). With no digestAdapter,
      // generateDailyDigest would return null and write nothing.
      //
      // V1 HONESTY RULE (Story 5.3 trend-briefing path): no real trend-briefing
      // LLM provider is wired either (procurement deferred). With no llmAdapter,
      // generateTrendBriefing would return null and write nothing.
      //
      // When BOTH are undefined (V1 prod), the whole job short-circuits and
      // reports skipped so the caller knows the pipeline ran but produced no
      // content (honest degradation, AC3). StubDigestAdapter + StubLlmAdapter
      // are test-only and are NOT imported here.
      //
      // ponytail: real providers wired when procured — V1 no adapters, prod
      // degrades honestly on both paths.
      //
      // The two adapter injection points are kept as separate consts (NOT a
      // union) so either path can be wired independently while the other stays
      // undefined (spec AC: 研判与日报互不阻塞).
      const digestAdapter = undefined;
      const llmAdapter = undefined;
      if (digestAdapter === undefined && llmAdapter === undefined) {
        return { generated: 0, considered: 1, skipped: 1 };
      }

      let generated = 0;
      try {
        // --- Daily-digest path (Story 2.4) ---
        if (digestAdapter !== undefined) {
          const result = await generateDailyDigest({
            prisma,
            traceId: data.traceId,
            coverageDate,
            adapter: digestAdapter,
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
            generated += 1;
          }
        }

        // --- Trend-briefing path (Story 5.3) ---
        // Independent of the digest path: runs whether or not the digest path
        // produced content (spec AC: 研判与日报互不阻塞). Re-uses the same
        // coverageDate + traceId.
        if (llmAdapter !== undefined) {
          const trendResult = await generateTrendBriefing({
            prisma,
            traceId: data.traceId,
            coverageDate,
            adapter: llmAdapter,
          });
          if (trendResult !== null) {
            // Refresh the public projection so the new briefing flows into
            // published_trend_briefings immediately (mirrors the digest path's
            // refresh — the trigger layer refreshes, the generator only appends).
            await refreshPublishedTrendBriefing({
              prisma,
              traceId: data.traceId,
              coverageDate,
            });
            generated += 1;
          }
        }

        if (generated > 0) {
          return { generated, considered: 1 };
        }
        // No eligible events / both adapters returned nothing → degrade honestly.
        return { generated: 0, considered: 1, skipped: 1 };
      } catch (error) {
        // Isolate failures: log and re-throw so BullMQ marks the job failed
        // (operator can inspect). A bad coverageDate, a digest adapter error, or
        // a trend-briefing adapter error does not crash the worker process. The
        // failing coverageDate leaves a degraded state (missing briefing / missing
        // digest); the next worker run naturally retries (retry-loop deferred —
        // spec Never).
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
