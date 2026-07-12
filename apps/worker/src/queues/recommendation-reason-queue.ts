/**
 * BullMQ recommendation-reason queue + worker (worker runtime) — Story 5.1.
 *
 * AD-4: AI 解读 generation runs as a BullMQ job, off the web request path. The
 * worker dynamically imports @aguhot/core's `generateRecommendationReason` (the
 * single writer of recommendation_reasons, AD-5) and runs one pass over
 * candidate + published hot events that have no recommendation_reason yet.
 *
 * This mirrors explain-queue.ts (self-discovering candidate query, per-event
 * try/catch isolation, no auto-trigger) and daily-digest-queue.ts (the
 * `const adapter = undefined` honest-degradation injection point). Same
 * structure: lazy Queue singleton, enqueue helper with job-retention caps, and a
 * worker that resolves the Prisma client via a dynamic import so the worker
 * bundle stays the only place that pulls in the domain+DB layer.
 *
 * Queue name + job name are kebab-case per ARCHITECTURE-SPINE conventions
 * ("recommendation-reason"). Like the other workers, this job is independent:
 * it does NOT chain from explain/publish automatically (explain →
 * recommendation-reason auto orchestration / cron is deferred — same decoupling
 * as the other jobs). IDEMPOTENCY IS ENFORCED BY THE CANDIDATE QUERY's
 * `recommendationReasons: { none: {} }` filter below — the worker only ever
 * selects events with no reason yet, so a re-run never re-processes an
 * already-reasoned event. generateRecommendationReason itself is NOT idempotent
 * (it appends a fresh row on every call, AD-5) — the dedupe is the worker's
 * `none: {}` prefilter, so any future caller that bypasses this query must
 * dedupe upstream.
 *
 * V1 HONESTY RULE (load-bearing, mirrors daily-digest-queue.ts): the worker
 * runtime resolves NO adapter (real LLM provider procurement is deferred). With
 * no adapter, generateRecommendationReason returns null and writes nothing, so
 * prod degrades honestly — the timeline card renders NO AI 解读 slot (absent
 * state). StubLlmAdapter is TEST-ONLY (verify/e2e import it from core and pass
 * it to generateRecommendationReason directly); apps/worker MUST NOT import it.
 *
 *   // ponytail: real provider wired when procured — V1 no adapter, prod degrades
 *   // honestly.
 *
 * When a real provider lands, the worker will resolve that adapter here (one
 * line), generateRecommendationReason will flow reasons through, and the append
 * → projection → card pipeline is already in place.
 *
 * Scope: candidate + published (NOT rejected/taken_down). The AC reads "已发布/
 * 候选 HotEvent" — reasons are generated while an event is a review candidate
 * (pre-publish) AND for already-published events (so a published event that
 * predates the worker gets a reason on the next pass). After a successful append
 * to a PUBLISHED event, the worker calls refreshPublishedTimelineForEvent
 * (action:"publish") to project the new reason onto the card immediately (no
 * need to wait for the 15-min timeline self-heal). Candidate events get the
 * reason appended but skip the projection refresh (their timeline row does not
 * exist yet — it is created inside decideReview's transaction on publish, which
 * reads the latest recommendation_reasons row at projection time).
 */

import { Queue, Worker, type Job } from "bullmq";

import { resolveLlmAdapter } from "../llm-adapter-resolver.js";

import { getRedis } from "./connection.js";

export const RECOMMENDATION_REASON_QUEUE_NAME = "recommendation-reason";
export const RECOMMENDATION_REASON_JOB_NAME = "recommendation-reason";

export interface RecommendationReasonJobData {
  traceId: string;
}

/**
 * Lazily-constructed Queue for enqueuing recommendation-reason jobs. Reused
 * across enqueue calls in the same process.
 */
let queue: Queue | null = null;

export function getRecommendationReasonQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(RECOMMENDATION_REASON_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one recommendation-reason job. Returns the job so callers (e.g. the
 * verify script) can await its completion.
 */
export async function enqueueRecommendationReason(traceId: string): Promise<Job> {
  const q = getRecommendationReasonQueue();
  // Prune completed/failed jobs so Redis does not grow unbounded as
  // recommendation-reason runs accumulate (keep a short tail for operator
  // inspection).
  return q.add(
    RECOMMENDATION_REASON_JOB_NAME,
    { traceId },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  );
}

/**
 * Register the recommendation-reason Worker in this process. The worker resolves
 * the prisma client, then finds CANDIDATE + PUBLISHED hot events (excludes
 * rejected/taken_down) that have no recommendation_reasons yet and calls
 * generateRecommendationReason for each (the single writer of
 * recommendation_reasons, AD-5). The job resolves as long as the infrastructure
 * (DB/Redis) is reachable; per-event errors are isolated (one bad event does not
 * abort the rest — a guardrail violation throws at the generator and is caught
 * here so that event stays at null while the batch continues).
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) →
 * generateRecommendationReason returns null → the whole job skips → returns
 * {generated:0, skipped} and prod degrades honestly. This is the intended V1
 * behavior: the pipeline is correct (verify/e2e prove the happy path with
 * StubLlmAdapter), but the worker cannot produce real reasons without a real
 * provider, so it writes nothing rather than fabricating fixture data.
 *
 * When an adapter IS available, the worker calls generateRecommendationReason
 * per event. On a successful append to a PUBLISHED event, it calls
 * refreshPublishedTimelineForEvent(action:"publish") to project the new reason
 * onto the card immediately (reuses the same upsert decideReview uses — no new
 * write path; publish-orchestrator stays the sole writer of
 * published_timeline_entries.recommendation_reason).
 */
export function registerRecommendationReasonWorker(): Worker {
  const worker = new Worker(
    RECOMMENDATION_REASON_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, generateRecommendationReason, refreshPublishedTimelineForEvent } =
        await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as RecommendationReasonJobData;

      // Resolve the LLM adapter from env (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL).
      // When env is unset (provider not procured) → undefined → the no-op path
      // below (honest degradation, the unchanged 5.1 default). When env is set
      // → OpenAiCompatibleLlmAdapter → reasons flow through. StubLlmAdapter is
      // test-only and is NOT imported here (apps/worker resolves the real adapter
      // or none — never the stub).
      const adapter = resolveLlmAdapter();
      if (adapter === undefined) {
        // No DB scan on the no-op path: the return value is fire-and-forget
        // (no caller consumes it — enqueueRecommendationReason does not await a
        // structured result), so a pending-count query here would be a per-job
        // full-table anti-join for nothing. Mirrors daily-digest-queue's no-
        // adapter return. SM-7 coverage is measured off the published read
        // model, not from this job's return.
        return { generated: 0, considered: 0, skipped: 0 };
      }

      // Find CANDIDATE + PUBLISHED hot events with no recommendation_reason yet.
      // The status filter is load-bearing (see the doc comment above): without it
      // the worker would also process rejected/taken_down events (wasted work +
      // reason-chain pollution on non-public events). A left join via the reverse
      // relation selects events whose recommendationReasons is empty.
      const pending = await prisma.hotEvent.findMany({
        where: {
          publicationStatus: { in: ["candidate", "published"] },
          recommendationReasons: { none: {} },
        },
        select: { id: true, publicationStatus: true },
      });

      let generated = 0;
      for (const ev of pending) {
        try {
          const result = await generateRecommendationReason({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
            adapter,
          });
          if (result === null) continue;
          generated += 1;
          // If the event is already published, project the new reason onto its
          // timeline card immediately by reusing the existing per-event refresh
          // (the same upsert decideReview uses on publish — publish-orchestrator
          // stays the sole writer of published_timeline_entries.recommendation_
          // reason, AD-2/AD-3b). Candidate events skip this: their timeline row
          // does not exist yet and will be created inside decideReview's
          // transaction on publish, reading the latest reason row at projection
          // time.
          if (ev.publicationStatus === "published") {
            await refreshPublishedTimelineForEvent({
              prisma,
              traceId: data.traceId,
              hotEventId: ev.id,
              action: "publish",
            });
          }
        } catch (error) {
          // Isolate per-event failures: log and continue so one bad event
          // (e.g. a guardrail violation) does not abort the whole pass.
          // generateRecommendationReason returns null (no write) for missing
          // events / no-evidence events / no-adapter; only guardrail/DB errors
          // land here. The event stays at null (absent card slot) — the next
          // worker run naturally retries (no retry loop here; retry is deferred
          // per spec Never).
          console.error(`[recommendation-reason-worker] failed for hotEvent ${ev.id}`, error);
        }
      }
      return { generated, considered: pending.length };
    },
    { connection: getRedis() },
  );
  return worker;
}
