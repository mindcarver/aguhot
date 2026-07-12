/**
 * BullMQ deep-read queue + worker (worker runtime) — Story 5.2.
 *
 * AD-4: AI 深读 generation runs as a BullMQ job, off the web request path. The
 * worker dynamically imports @aguhot/core's `generateDeepRead` (the single writer
 * of deep_reads, AD-5) and runs one pass over candidate + published hot events that
 * have no deep read yet.
 *
 * This mirrors recommendation-reason-queue.ts byte-for-byte in shape (self-
 * discovering candidate query, per-event try/catch isolation, no auto-trigger) —
 * the two LLM jobs (5.1 card reason + 5.2 detail deep read) are nearly identical
 * workers. Differences: queue/job name, the generator fn, and the projection
 * refresh call (deep-read projects via refreshPublishedReadModel(action:"publish")
 * rather than refreshPublishedTimelineForEvent, since the deep read lands on the
 * detail page's published_hot_event_deep_reads projection, not the timeline). Same
 * structure: lazy Queue singleton, enqueue helper with job-retention caps, and a
 * worker that resolves the Prisma client via a dynamic import so the worker bundle
 * stays the only place that pulls in the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions ("deep-
 * read"). Like the other workers, this job is independent: it does NOT chain from
 * explain/recommendation-reason automatically (orchestration is deferred — same
 * decoupling as the other jobs). IDEMPOTENCY IS ENFORCED BY THE CANDIDATE QUERY's
 * `deepReads: { none: {} }` filter below — the worker only ever selects events with
 * no deep read yet, so a re-run never re-processes an already-read event.
 * generateDeepRead itself is NOT idempotent (it appends a fresh row on every call,
 * AD-5) — the dedupe is the worker's `none: {}` prefilter, so any future caller that
 * bypasses this query must dedupe upstream.
 *
 * V1 HONESTY RULE (load-bearing, mirrors recommendation-reason-queue.ts): the worker
 * runtime resolves NO adapter (real LLM provider procurement is deferred). With no
 * adapter, generateDeepRead returns null and writes nothing, so prod degrades
 * honestly — the detail page renders the "AI 深读生成中。" degraded state. StubLlmAdapter
 * is TEST-ONLY (verify/e2e import it from core and pass it to generateDeepRead
 * directly); apps/worker MUST NOT import it.
 *
 *   // ponytail: real provider wired when procured — V1 no adapter, prod degrades
 *   // honestly.
 *
 * When a real provider lands, the worker will resolve that adapter here (one line),
 * generateDeepRead will flow deep reads through, and the append → projection →
 * detail-page pipeline is already in place.
 *
 * Scope: candidate + published (NOT rejected/taken_down). The AC reads "已发布/候选
 * HotEvent" — deep reads are generated while an event is a review candidate (pre-
 * publish) AND for already-published events (so a published event that predates the
 * worker gets a deep read on the next pass). After a successful append to a PUBLISHED
 * event, the worker calls refreshPublishedReadModel (action:"publish") to project the
 * new deep read onto the detail page immediately (no need to wait for a self-heal).
 * Candidate events get the deep read appended but skip the projection refresh (their
 * published_hot_event_deep_reads row does not exist yet — it is created inside
 * decideReview's transaction on publish, which reads the latest deep_reads row at
 * projection time).
 *
 * Design note: epic-5-context :65 literally says "深读挂 explain-queue", but :108
 * "三者共用 worker resolve 模式" refers to the adapter-resolve queue shape, and
 * explain-queue is deterministic / candidate-only / no-adapter / no-projection-
 * refresh — a different shape from deep-read (LLM/adapter/candidate+published/needs
 * refresh), which is instead byte-for-byte the recommendation-reason-queue shape. A
 * separate queue keeps explain worker's deterministic purity. This is a deliberate
 * deviation from the epic's literal text (recorded for reviewer judgment), consistent
 * with how 5.1 already opened a separate queue for the same LLM-job shape.
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";

export const DEEP_READ_QUEUE_NAME = "deep-read";
export const DEEP_READ_JOB_NAME = "deep-read";

export interface DeepReadJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing deep-read jobs. Reused across enqueue calls
 * in the same process.
 */
let queue: Queue | null = null;

export function getDeepReadQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(DEEP_READ_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one deep-read job. Returns the job so callers (e.g. the verify script) can
 * await its completion.
 */
export async function enqueueDeepRead(traceId: string): Promise<Job> {
  const q = getDeepReadQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as deep-read runs
  // accumulate (keep a short tail for operator inspection).
  return q.add(
    DEEP_READ_JOB_NAME,
    { traceId },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

/**
 * Register the deep-read Worker in this process. The worker resolves the prisma
 * client, then finds CANDIDATE + PUBLISHED hot events (excludes rejected/
 * taken_down) that have no deep_reads yet and calls generateDeepRead for each (the
 * single writer of deep_reads, AD-5). The job resolves as long as the infrastructure
 * (DB/Redis) is reachable; per-event errors are isolated (one bad event does not
 * abort the rest — a guardrail violation throws at the generator and is caught here
 * so that event stays at null while the batch continues).
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) → generateDeepRead
 * returns null → the whole job skips → returns {generated:0, considered:0, skipped:0}
 * and prod degrades honestly. This is the intended V1 behavior: the pipeline is
 * correct (verify/e2e prove the happy path with StubLlmAdapter), but the worker
 * cannot produce real deep reads without a real provider, so it writes nothing
 * rather than fabricating fixture data.
 *
 * When an adapter IS available, the worker calls generateDeepRead per event. On a
 * successful append to a PUBLISHED event, it calls refreshPublishedReadModel
 * (action:"publish") to project the new deep read onto the detail page immediately
 * (reuses the same upsert decideReview uses — no new write path; publish-orchestrator
 * stays the sole writer of published_hot_event_deep_reads, AD-2/AD-3).
 */
export function registerDeepReadWorker(): Worker {
  const worker = new Worker(
    DEEP_READ_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, generateDeepRead, refreshPublishedReadModel } =
        await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as DeepReadJobData;

      // V1 HONESTY RULE: no real LLM provider is wired (procurement deferred).
      // With no adapter, generateDeepRead cannot run — it would return null and
      // write nothing. We skip and report it as skipped so the caller knows the
      // pipeline ran but produced no deep reads (honest degradation). StubLlmAdapter
      // is test-only and is NOT imported here.
      //
      // ponytail: real provider wired when procured — V1 no adapter, prod degrades
      // honestly.
      const adapter = undefined;
      if (adapter === undefined) {
        // No DB scan on the no-op path: the return value is fire-and-forget (no
        // caller consumes it — enqueueDeepRead does not await a structured result),
        // so a pending-count query here would be a per-job full-table anti-join for
        // nothing. Mirrors recommendation-reason-queue's no-adapter return. Coverage
        // is measured off the published read model, not from this job's return.
        //
        // ponytail: real provider wired when procured — V1 no adapter, prod degrades
        // honestly.
        return { generated: 0, considered: 0, skipped: 0 };
      }

      // Find CANDIDATE + PUBLISHED hot events with no deep read yet. The status
      // filter is load-bearing (see the doc comment above): without it the worker
      // would also process rejected/taken_down events (wasted work + read-chain
      // pollution on non-public events). A left join via the reverse relation
      // selects events whose deepReads is empty.
      const pending = await prisma.hotEvent.findMany({
        where: {
          publicationStatus: { in: ["candidate", "published"] },
          deepReads: { none: {} },
        },
        select: { id: true, publicationStatus: true },
      });

      let generated = 0;
      for (const ev of pending) {
        try {
          const result = await generateDeepRead({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
            adapter,
          });
          if (result === null) continue;
          generated += 1;
          // If the event is already published, project the new deep read onto its
          // detail page immediately by reusing the existing per-event refresh (the
          // same upsert decideReview uses on publish — publish-orchestrator stays the
          // sole writer of published_hot_event_deep_reads, AD-2/AD-3). Candidate
          // events skip this: their published_hot_event_deep_reads row does not exist
          // yet and will be created inside decideReview's transaction on publish,
          // reading the latest deep_reads row at projection time.
          if (ev.publicationStatus === "published") {
            await refreshPublishedReadModel({
              prisma,
              traceId: data.traceId,
              hotEventId: ev.id,
              action: "publish",
            });
          }
        } catch (error) {
          // Isolate per-event failures: log and continue so one bad event (e.g. a
          // guardrail violation) does not abort the whole pass. generateDeepRead
          // returns null (no write) for missing events / no-evidence events / no-
          // adapter; only guardrail/DB errors land here. The event stays at null
          // (detail page shows "AI 深读生成中。") — the next worker run naturally
          // retries (no retry loop here; retry is deferred per spec Never).
          console.error(
            `[deep-read-worker] failed for hotEvent ${ev.id}`,
            error,
          );
        }
      }
      return { generated, considered: pending.length };
    },
    { connection: getRedis() },
  );
  return worker;
}
