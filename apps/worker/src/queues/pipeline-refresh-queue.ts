/**
 * BullMQ pipeline-refresh queue + worker + 10-min self-heal schedule.
 *
 * Drives the FULL publish pipeline on a schedule so the public feed stays fresh
 * without a manual run-ingest + run-pipeline:
 *   ingestSources → clusterEvents → generateExplanation(each candidate) →
 *   generateRecommendationReason(each, LLM) → decideReview(approve each) →
 *   refreshPublishedTimelineAll
 *
 * This is the pipeline chaining the repo previously deferred ("auto orchestration
 * / cron is deferred" per the sibling queue headers). It is DEFAULT-ON: index.ts
 * registers the worker + schedule unconditionally.
 *
 * IMPLEMENTATION: the handler calls the domain GENERATORS directly (not
 * enqueue+waitUntilFinished on the sibling queues). The nested-QueueEvents wait
 * pattern stalls inside a Worker handler (the Worker's lock renewal does not
 * survive awaiting a sub-job in a long-running handler). Direct generator calls
 * have no such nesting — each is pure logic + DB / LLM, same convention as
 * run-digest / run-targets. The sibling stage workers stay registered in index.ts
 * for on-demand/manual use; this cron does not depend on them.
 *
 * DEV AUTO-APPROVE: every candidate is auto-approved (decideReview outcome
 * "approve", reviewer "pipeline-auto-publish") — the same dev bypass run-pipeline
 * uses. In prod a human reviews in /console; this cron is a dev/local affordance.
 *
 * Idempotent end-to-end: ingest dedupes by content_hash, cluster only creates
 * candidates from unlinked evidence, explain/reason skip events that already have
 * them, approve is a no-op on already-published events, publish-timeline upserts.
 * So a 10-min re-run only does NEW work. The daily-digest stage is intentionally
 * omitted (the worker resolves no digest adapter → always null; the daily page is
 * a separate, lower-priority surface).
 */

import { Queue, Worker, type Job } from "bullmq";

import { getRedis } from "./connection.js";
import { resolveLlmAdapter } from "../llm-adapter-resolver.js";

export const PIPELINE_REFRESH_QUEUE_NAME = "pipeline-refresh";
export const PIPELINE_REFRESH_JOB_NAME = "pipeline-refresh";

/** Self-heal repeat interval (ms). Full pipeline pass every 10 min. */
export const PIPELINE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface PipelineRefreshJobData {
  traceId: string;
}

let queue: Queue | null = null;

export function getPipelineRefreshQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(PIPELINE_REFRESH_QUEUE_NAME, { connection: getRedis() });
  return queue;
}

/** Enqueue one pipeline-refresh pass on demand (verify/manual). */
export async function enqueuePipelineRefresh(traceId: string): Promise<Job> {
  return getPipelineRefreshQueue().add(
    PIPELINE_REFRESH_JOB_NAME,
    { traceId },
    { removeOnComplete: 100, removeOnFail: 500 },
  );
}

/**
 * Register the repeatable self-heal schedule (every 10 min). Idempotent on
 * restart via upsertJobScheduler. Default-on: index.ts calls this unconditionally.
 */
export async function schedulePipelineRefreshSelfHeal(): Promise<void> {
  await getPipelineRefreshQueue().upsertJobScheduler(
    "pipeline-refresh-self-heal",
    { every: PIPELINE_REFRESH_INTERVAL_MS },
    {
      name: PIPELINE_REFRESH_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    },
  );
}

/**
 * Register the pipeline-refresh Worker. Each job runs the full chain by calling
 * the domain generators directly. Per-stage errors are isolated (logged + skipped)
 * so one failed stage does not abort the whole pass — the next 10-min run retries.
 */
export function registerPipelineRefreshWorker(): Worker {
  const worker = new Worker(
    PIPELINE_REFRESH_QUEUE_NAME,
    async (job: Job) => {
      const {
        getPrisma,
        newTraceId,
        decideReview,
        ingestSources,
        clusterEvents,
        generateExplanation,
        generateRecommendationReason,
        refreshPublishedTimelineAll,
      } = await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as PipelineRefreshJobData;
      const rootTrace = data.traceId === "scheduled" ? newTraceId() : data.traceId;

      const tid = () => newTraceId();
      const log = (stage: string, msg: string) => console.log(`[pipeline-refresh ${rootTrace.slice(0, 8)}] ${stage}: ${msg}`);

      // 1. Ingest (idempotent dedup).
      try {
        await ingestSources({ prisma, traceId: tid() });
        log("ingest", "done");
      } catch (e) {
        log("ingest", `ERROR ${e instanceof Error ? e.message : e}`);
      }

      // 2. Cluster new evidence into candidates.
      try {
        const r = await clusterEvents({ prisma, traceId: tid() });
        log("cluster", `newCandidates=${r.newCandidates}`);
      } catch (e) {
        log("cluster", `ERROR ${e instanceof Error ? e.message : e}`);
      }

      // 3. Explain each candidate (deterministic, no LLM).
      const candidates = await prisma.hotEvent.findMany({
        where: { publicationStatus: "candidate" },
        select: { id: true },
      });
      let explained = 0;
      for (const c of candidates) {
        try {
          await generateExplanation({ prisma, traceId: tid(), hotEventId: c.id });
          explained += 1;
        } catch (e) {
          log("explain", `ERROR ${c.id} ${e instanceof Error ? e.message : e}`);
        }
      }
      log("explain", `processed ${explained}/${candidates.length}`);

      // 4. recommendation-reason (LLM, only events lacking one). No-ops if no LLM env.
      const llmAdapter = resolveLlmAdapter();
      if (llmAdapter !== undefined) {
        const lacking = await prisma.hotEvent.findMany({
          where: {
            publicationStatus: { in: ["candidate", "published"] },
            recommendationReasons: { none: {} },
          },
          select: { id: true },
        });
        let reasoned = 0;
        for (const ev of lacking) {
          try {
            const r = await generateRecommendationReason({ prisma, traceId: tid(), hotEventId: ev.id, adapter: llmAdapter });
            if (r !== null) reasoned += 1;
          } catch (e) {
            log("reason", `ERROR ${ev.id} ${e instanceof Error ? e.message : e}`);
          }
        }
        log("reason", `generated ${reasoned}/${lacking.length}`);
      } else {
        log("reason", "skipped (no LLM adapter)");
      }

      // 5. Auto-approve every candidate (dev bypass).
      const toApprove = await prisma.hotEvent.findMany({
        where: { publicationStatus: "candidate" },
        select: { id: true, title: true },
      });
      let published = 0;
      for (const c of toApprove) {
        try {
          await decideReview({
            prisma,
            traceId: tid(),
            hotEventId: c.id,
            outcome: "approve",
            reviewer: "pipeline-auto-publish",
          });
          published += 1;
        } catch (e) {
          log("approve", `ERROR ${c.id} ${e instanceof Error ? e.message : e}`);
        }
      }
      log("approve", `published ${published}/${toApprove.length}`);

      // 6. publish-timeline (re-derive the feed read model).
      try {
        await refreshPublishedTimelineAll({ prisma, traceId: tid() });
        log("publish-timeline", "done");
      } catch (e) {
        log("publish-timeline", `ERROR ${e instanceof Error ? e.message : e}`);
      }

      return { traceId: rootTrace, approved: published, candidates: toApprove.length };
    },
    // A full pass (ingest + LLM reason per new event) can take minutes; give the
    // lock enough headroom so BullMQ does not reclaim a still-running job.
    { connection: getRedis(), lockDuration: 60_000 },
  );
  return worker;
}
