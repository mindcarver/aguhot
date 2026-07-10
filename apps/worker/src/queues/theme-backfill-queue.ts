/**
 * BullMQ theme-backfill queue + worker (worker runtime) — Story 2.3.
 *
 * AD-4: theme membership backfill runs as a BullMQ job, off the web request
 * path. The worker dynamically imports @aguhot/core's generateThemes (the single
 * writer of event_theme_sets, AD-2) and runs one pass over PUBLISHED hot events
 * that have no theme set yet (themes are attached to published events — the
 * continuity substrate relates public events to themes).
 *
 * This mirrors market-reaction-queue.ts in structure (Story 2.1): lazy Queue
 * singleton, enqueue helper with job-retention caps, and a worker that resolves
 * the Prisma client via a dynamic import so the worker bundle stays the only
 * place that pulls in the domain+DB layer. epic-2-context lists theme-backfill
 * as one of three Epic-2 BullMQ job categories (market-signal aggregation 2-1 /
 * daily digest 2-4 / theme backfill 2-3) — unlike 2.2 associations (no worker),
 * theme-backfill is an epic-listed job category, so the worker is built here.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("theme-backfill"). Like the other workers, this job is independent and
 * idempotent: it does NOT chain from explain/market/publish automatically
 * (cluster→explain→market→theme auto orchestration / cron is deferred). The
 * worker processes published hot events that have no event_theme_set; running it
 * again is safe (a re-run over an already-set event appends a fresh row, AD-5 —
 * the intended idempotent append behavior; V1 only processes the "no set" set).
 *
 * V1 HONESTY RULE (load-bearing, mirrors market-reaction-queue.ts): the worker
 * runtime resolves NO adapter (real theme knowledge source procurement is
 * deferred). With no adapter, generateThemes returns null and writes nothing, so
 * prod degrades honestly — the detail page shows "暂无已确认的主题关联。" (AC3)
 * and /topics shows "暂无已确认的主题。" / unknown slugs 404. StubThemeAdapter
 * is TEST-ONLY (verify/e2e import it from core and pass it to generateThemes
 * directly); apps/worker MUST NOT import it.
 *
 *   // ponytail: real provider wired when procured — V1 no adapter, prod degrades
 *   // honestly.
 *
 * When a real provider lands, the worker will resolve that adapter here (one
 * line), generateThemes will flow themes through, and source will flip from
 * "template" to the provider id. The port + append-only write table + read model
 * + /topics pages are all already in place.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const THEME_BACKFILL_QUEUE_NAME = "theme-backfill";
export const THEME_BACKFILL_JOB_NAME = "theme-backfill";

export interface ThemeBackfillJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing theme-backfill jobs. Reused across
 * enqueue calls in the same process.
 */
let queue: Queue | null = null;

export function getThemeBackfillQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(THEME_BACKFILL_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one theme-backfill job. Returns the job so callers (e.g. the verify
 * script) can await its completion.
 */
export async function enqueueThemeBackfill(traceId: string): Promise<Job> {
  const q = getThemeBackfillQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as theme-
  // backfill runs accumulate (keep a short tail for operator inspection).
  return q.add(THEME_BACKFILL_JOB_NAME, { traceId }, {
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

/**
 * Register the theme-backfill Worker in this process. The worker resolves the
 * prisma client, then finds PUBLISHED hot events (publication_status=
 * "published") that have no event_theme_set yet. The status filter is
 * load-bearing (mirrors market-reaction-queue.ts): themes relate public events,
 * so only published events are eligible — not candidate/rejected/taken_down.
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) → the whole pass
 * skips (no generateThemes call possible) → returns {generated:0, skipped} and
 * prod degrades honestly. This is the intended V1 behavior: the pipeline is
 * correct (verify/e2e prove the happy path with StubThemeAdapter), but the
 * worker cannot produce real themes without a real provider, so it writes
 * nothing rather than fabricating fixture data.
 *
 * When an adapter IS available, the worker calls generateThemes for each
 * eligible event, then refreshPublishedReadModel(publish) so the new set flows
 * into published_hot_event_themes immediately. Per-event try/catch isolates
 * failures (one bad event does not abort the rest).
 */
export function registerThemeBackfillWorker(): Worker {
  const worker = new Worker(
    THEME_BACKFILL_QUEUE_NAME,
    async (job: Job) => {
      const {
        getPrisma,
        generateThemes,
        refreshPublishedReadModel,
      } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as ThemeBackfillJobData;

      // Find PUBLISHED hot events with no theme set yet. The status filter is
      // load-bearing (themes relate public events). A left join via the reverse
      // relation selects events whose eventThemeSets is empty.
      const eligible = await prisma.hotEvent.findMany({
        where: {
          publicationStatus: "published",
          eventThemeSets: { none: {} },
        },
        select: { id: true },
      });

      // V1 HONESTY RULE: no real theme knowledge source is wired (procurement
      // deferred). With no adapter, generateThemes cannot run — it would return
      // null and write nothing. We skip the whole batch and report it as
      // skipped so the caller knows the pipeline ran but produced no themes
      // (honest degradation, AC3). StubThemeAdapter is test-only and is NOT
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
          const result = await generateThemes({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
            adapter,
          });
          if (result !== null) {
            generated += 1;
            // Refresh the public projection so the new set flows into
            // published_hot_event_themes immediately (mirrors how decideReview
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
            `[theme-backfill-worker] failed for hotEvent ${ev.id}`,
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
