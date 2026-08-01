/**
 * BullMQ queue + cron worker for the capital snapshot poll job (Issue #68).
 *
 * This is the FIRST cron-`pattern` schedule in the repo (AD-SNAP-2). All
 * existing schedulers use fixed `every: ms`; this one uses a daily cron pattern
 * so providers are polled near their expected release windows. `immediately:
 * true` lets the first tick fire on startup without waiting for the next cron
 * boundary.
 */
import { Queue, Worker, type Job } from "bullmq";

import { pollCapitalSnapshots } from "../capital-snapshot-poll.js";
import { getRedis } from "./connection.js";

export const CAPITAL_SNAPSHOT_POLL_QUEUE_NAME = "capital-snapshot-poll";
export const CAPITAL_SNAPSHOT_POLL_JOB_NAME = "capital-snapshot-poll";
/**
 * Daily at 10:00 UTC. NBS typically publishes around 01:00-02:00 UTC (09:00-10:00
 * Beijing); a 10:00 UTC poll catches same-day releases. ECOS/KRX publish at
 * similar morning windows. Configurable via env for tuning.
 */
const DEFAULT_POLL_PATTERN =
  process.env.CAPITAL_SNAPSHOT_POLL_PATTERN ?? "0 10 * * *";
export const CAPITAL_SNAPSHOT_POLL_ATTEMPTS = 3;

export interface CapitalSnapshotPollJobData {
  traceId: string;
}

let queue: Queue | null = null;

export function getCapitalSnapshotPollQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(CAPITAL_SNAPSHOT_POLL_QUEUE_NAME, { connection: getRedis() });
  return queue;
}

export async function enqueueCapitalSnapshotPoll(traceId: string): Promise<Job> {
  return getCapitalSnapshotPollQueue().add(
    CAPITAL_SNAPSHOT_POLL_JOB_NAME,
    { traceId },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: CAPITAL_SNAPSHOT_POLL_ATTEMPTS,
    },
  );
}

/**
 * Register the cron-pattern schedule (AD-SNAP-2). `upsertJobScheduler` with a
 * `pattern` replaces any prior schedule with the same id. `immediately: true`
 * fires a first tick on startup.
 */
export async function scheduleCapitalSnapshotPoll(): Promise<void> {
  await getCapitalSnapshotPollQueue().upsertJobScheduler(
    "capital-snapshot-poll-schedule",
    { pattern: DEFAULT_POLL_PATTERN, immediately: true },
    {
      name: CAPITAL_SNAPSHOT_POLL_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: {
        removeOnComplete: 100,
        removeOnFail: 500,
        attempts: CAPITAL_SNAPSHOT_POLL_ATTEMPTS,
      },
    },
  );
}

export function registerCapitalSnapshotPollWorker(): Worker {
  return new Worker(
    CAPITAL_SNAPSHOT_POLL_QUEUE_NAME,
    async (job: Job) => {
      const { newTraceId } = await import("@aguhot/core");
      const data = job.data as CapitalSnapshotPollJobData;
      const traceId = data.traceId === "scheduled" ? newTraceId() : data.traceId;

      try {
        const results = await pollCapitalSnapshots(traceId);
        if (results.length > 0) {
          const summary = results
            .map(
              (r) =>
                `${r.providerId}(captured=${r.captured} skipped=${r.skipped} appended=${r.appended} failed=${r.failed})`,
            )
            .join(" ");
          console.log(`[capital-snapshot-poll ${traceId.slice(0, 8)}] ${summary}`);
        }
        return results;
      } catch (error) {
        console.error(`[capital-snapshot-poll ${traceId.slice(0, 8)}] failed`, error);
        throw error;
      }
    },
    { connection: getRedis() },
  );
}
