/**
 * BullMQ investment-targets queue + worker + self-heal schedule (worker runtime).
 *
 * AD-4: candidate-pool generation runs as a BullMQ job, off the web request path.
 * The worker dynamically imports @aguhot/core's generateInvestmentTargets (the
 * single writer of investment_targets, AD-5) and runs one pass over candidate +
 * published hot events that have no investment_targets row yet.
 *
 * Mirrors deep-read-queue.ts in shape (self-discovering candidate query, per-event
 * try/catch isolation, no auto-trigger) AND publish-timeline-queue.ts for the
 * repeatable self-heal schedule (every 10 min). IDEMPOTENCY IS ENFORCED BY THE
 * CANDIDATE QUERY's `investmentTargets: { none: {} }` filter — the worker only
 * ever selects events with no pool yet, so a re-run never re-processes an already-
 * filled event. generateInvestmentTargets itself is NOT idempotent (it appends a
 * fresh row on every call, AD-5); the dedupe is the worker's `none: {}` prefilter.
 *
 * The adapter is the SDK-backed HeadlessAgentTargetsAdapter (resolved from env:
 * ANTHROPIC_API_KEY + AGENT_MODEL + skill file present). When env is unset / the
 * skill is missing → undefined → generateInvestmentTargets returns null → the whole
 * job skips → prod degrades honestly (no rows written, NFR-2). No operator path:
 * a bad run returns null and the next self-heal pass retries.
 *
 * Full-auto (cost-insensitive): the self-heal schedule fires every 10 min and
 * picks up any published/candidate event lacking a pool. No operator trigger, no
 * suppress path, no sampling console.
 *
 * On a successful append to a PUBLISHED event, the worker calls
 * refreshPublishedReadModel(action:"publish") which projects BOTH the new deep
 * read (the agent's byproduct) AND the new investment_targets pool onto the detail
 * page (publish-orchestrator stays the sole writer of both projections, AD-2/AD-3).
 */

import { Queue, Worker, type Job } from "bullmq";

import { resolveTargetsAdapter } from "../targets-adapter-resolver.js";

import { getRedis } from "./connection.js";

export const INVESTMENT_TARGETS_QUEUE_NAME = "investment-targets";
export const INVESTMENT_TARGETS_JOB_NAME = "investment-targets";

/** Self-heal repeat interval (ms). Full-auto sweep for events lacking a pool. */
export const INVESTMENT_TARGETS_SELF_HEAL_INTERVAL_MS = 10 * 60 * 1000; // 10 min

export interface InvestmentTargetsJobData {
  traceId: string;
}

let queue: Queue | null = null;

export function getInvestmentTargetsQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(INVESTMENT_TARGETS_QUEUE_NAME, {
    connection: getRedis(),
  });
  return queue;
}

/**
 * Enqueue one investment-targets job on demand. Returns the job so callers (e.g.
 * the verify script) can await its completion.
 */
export async function enqueueInvestmentTargets(traceId: string): Promise<Job> {
  const q = getInvestmentTargetsQueue();
  return q.add(
    INVESTMENT_TARGETS_JOB_NAME,
    { traceId },
    { removeOnComplete: 100, removeOnFail: 500 },
  );
}

/**
 * Register a repeatable self-heal schedule via upsertJobScheduler (BullMQ 5.x).
 * Idempotent — a process restart does not create a duplicate schedule. Mirrors
 * schedulePublishTimelineSelfHeal.
 */
export async function scheduleInvestmentTargetsSelfHeal(): Promise<void> {
  const q = getInvestmentTargetsQueue();
  await q.upsertJobScheduler(
    "investment-targets-self-heal",
    { every: INVESTMENT_TARGETS_SELF_HEAL_INTERVAL_MS },
    {
      name: INVESTMENT_TARGETS_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    },
  );
}

/**
 * Register the investment-targets Worker. Resolves the SDK adapter (or none →
 * honest-degradation no-op), finds CANDIDATE + PUBLISHED events with no pool yet,
 * and calls generateInvestmentTargets per event. Per-event errors are isolated.
 */
export function registerInvestmentTargetsWorker(): Worker {
  const worker = new Worker(
    INVESTMENT_TARGETS_QUEUE_NAME,
    async (job: Job) => {
      const { getPrisma, generateInvestmentTargets, refreshPublishedReadModel } =
        await import("@aguhot/core");
      const prisma = getPrisma();
      const data = job.data as InvestmentTargetsJobData;

      // Resolve the SDK adapter from env. Unset env / missing skill → undefined →
      // no-op (honest degradation). StubTargetsAdapter is test-only and NOT
      // imported here.
      const adapter = resolveTargetsAdapter();
      if (adapter === undefined) {
        return { generated: 0, considered: 0, skipped: 0 };
      }

      // Find CANDIDATE + PUBLISHED events with no investment_targets row yet
      // (excludes rejected/taken_down — wasted work + read-chain pollution).
      const pending = await prisma.hotEvent.findMany({
        where: {
          publicationStatus: { in: ["candidate", "published"] },
          investmentTargets: { none: {} },
        },
        select: { id: true, publicationStatus: true },
      });

      let generated = 0;
      for (const ev of pending) {
        try {
          const result = await generateInvestmentTargets({
            prisma,
            traceId: data.traceId,
            hotEventId: ev.id,
            adapter,
          });
          if (result === null) continue;
          generated += 1;
          // Project BOTH the new pool AND the deep-read byproduct onto the detail
          // page immediately for already-published events (candidate events get
          // their projection created inside decideReview's transaction on publish).
          if (ev.publicationStatus === "published") {
            await refreshPublishedReadModel({
              prisma,
              traceId: data.traceId,
              hotEventId: ev.id,
              action: "publish",
            });
          }
        } catch (error) {
          // Isolate per-event failures (guardrail/DB errors) so one bad event does
          // not abort the pass. The event stays at null; the next self-heal retries.
          console.error(
            `[investment-targets-worker] failed for hotEvent ${ev.id}`,
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
