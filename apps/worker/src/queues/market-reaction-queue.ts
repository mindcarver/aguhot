/**
 * BullMQ market-reaction queue + worker (worker runtime).
 *
 * AD-4: market-reaction signal aggregation runs as a BullMQ job, off the web
 * request path. The worker dynamically imports @aguhot/core's
 * generateMarketReaction (the single writer of market_reaction_snapshots, AD-2)
 * and runs one pass over PUBLISHED hot events that have no snapshot yet (market
 * reaction happens AFTER publication — the market responds to public news).
 *
 * This mirrors explain-queue.ts in structure: lazy Queue singleton, enqueue
 * helper with job-retention caps, and a worker that resolves the Prisma client
 * via a dynamic import so the worker bundle stays the only place that pulls in
 * the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("market-reaction"). Like explain, this job is independent and idempotent: it
 * does NOT chain from explain automatically (cluster→explain→market auto
 * orchestration / cron is deferred). The worker processes published hot events
 * that have no market_reaction_snapshot; running it again is safe (a re-run over
 * an already-snapshotted event appends a fresh row, AD-5 — the intended
 * idempotent append behavior; V1 only processes the "no snapshot" set).
 *
 * V1 HONESTY RULE (load-bearing, see spec Design Notes): the worker runtime
 * resolves NO adapter (real market-data provider procurement is deferred). With
 * no adapter, generateMarketReaction returns null and writes nothing, so prod
 * degrades honestly — the detail page shows "市场反应数据暂不可用" (AC3).
 * StubMarketDataAdapter is TEST-ONLY (verify/e2e import it from core and pass it
 * to generateMarketReaction directly); apps/worker MUST NOT import it.
 *
 *   // ponytail: real provider wired when procured — V1 no adapter, prod degrades
 *   // honestly.
 *
 * When a real provider lands, the worker will resolve that adapter here (one
 * line), generateMarketReaction will flow signals through, and source will flip
 * from "template" to the provider id. The port + append-only write table + read
 * model are all already in place.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const MARKET_REACTION_QUEUE_NAME = "market-reaction";
export const MARKET_REACTION_JOB_NAME = "market-reaction";

export interface MarketReactionJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing market-reaction jobs. Reused across
 * enqueue calls in the same process.
 */
let queue: Queue | null = null;

export function getMarketReactionQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(MARKET_REACTION_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one market-reaction job. Returns the job so callers (e.g. the verify
 * script) can await its completion.
 */
export async function enqueueMarketReaction(traceId: string): Promise<Job> {
  const q = getMarketReactionQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as market-
  // reaction runs accumulate (keep a short tail for operator inspection).
  return q.add(MARKET_REACTION_JOB_NAME, { traceId }, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Register the market-reaction Worker in this process. The worker resolves the
 * prisma client, then finds PUBLISHED hot events (publication_status=
 * "published") that have no market_reaction_snapshot yet. The status filter is
 * load-bearing (see the spec Design Notes): market reaction summarizes the
 * market's response to a PUBLIC event, so only published events are eligible —
 * not candidate/rejected/taken_down.
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) → the whole pass
 * skips (no generateMarketReaction call possible) → returns {generated:0,
 * skipped} and prod degrades honestly. This is the intended V1 behavior: the
 * pipeline is correct (verify/e2e prove the happy path with
 * StubMarketDataAdapter), but the worker cannot produce real signals without a
 * real provider, so it writes nothing rather than fabricating fixture data.
 *
 * When an adapter IS available, the worker calls generateMarketReaction for each
 * eligible event, then refreshPublishedReadModel(publish) so the new snapshot
 * flows into published_hot_event_reactions immediately. Per-event try/catch
 * isolates failures (one bad event does not abort the rest).
 */
export function registerMarketReactionWorker(): Worker {
  const worker = new Worker(
    MARKET_REACTION_QUEUE_NAME,
    async (job: Job) => {
      const {
        getPrisma,
        generateMarketReaction,
        refreshPublishedReadModel,
      } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as MarketReactionJobData;

      // Find PUBLISHED hot events with no market-reaction snapshot yet. The
      // status filter is load-bearing (see the doc comment above + spec Design
      // Notes): market reaction is a response to a PUBLIC event. A left join via
      // the reverse relation selects events whose marketReactionSnapshots is
      // empty.
      const eligible = await prisma.hotEvent.findMany({
        where: {
          publicationStatus: "published",
          marketReactionSnapshots: { none: {} },
        },
        select: { id: true },
      });

      // V1 HONESTY RULE: no real market-data provider is wired (procurement
      // deferred). With no adapter, generateMarketReaction cannot run — it would
      // return null and write nothing. We skip the whole batch and report it as
      // skipped so the caller knows the pipeline ran but produced no signals
      // (honest degradation, AC3). StubMarketDataAdapter is test-only and is NOT
      // imported here.
      //
      // ponytail: real provider wired when procured — V1 no adapter, prod
      // degrades honestly.
      const adapter = undefined;
      if (adapter === undefined) {
        return { generated: 0, skipped: eligible.length };
      }

      let generated = 0;
      for (const ev of eligible) {
        try {
          const result = await generateMarketReaction({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
            adapter,
          });
          if (result !== null) {
            generated += 1;
            // Refresh the public projection so the new snapshot flows into
            // published_hot_event_reactions immediately (mirrors how decideReview
            // calls refresh after a status change — the trigger layer refreshes,
            // the generator only appends).
            await refreshPublishedReadModel({
              prisma,
              traceId: data.traceId,
              hotEventId: ev.id,
              action: "publish",
            });
          }
        } catch (error) {
          // Isolate per-event failures: log and continue so one bad event does
          // not abort the whole pass.
          console.error(
            `[market-reaction-worker] failed for hotEvent ${ev.id}`,
            error,
          );
        }
      }
      return { generated, considered: eligible.length };
    },
    { connection: getRedis() },
  );
  return worker;
}
