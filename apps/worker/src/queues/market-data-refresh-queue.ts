/** BullMQ worker and schedule for keeping the public crash calendar current. */
import { Queue, Worker, type Job } from "bullmq";

import { refreshLatestMarketData } from "../market-data-refresh.js";
import { getRedis } from "./connection.js";

export const MARKET_DATA_REFRESH_QUEUE_NAME = "market-data-refresh";
export const MARKET_DATA_REFRESH_JOB_NAME = "market-data-refresh";
export const MARKET_DATA_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface MarketDataRefreshJobData {
  traceId: string;
}

let queue: Queue | null = null;

export function getMarketDataRefreshQueue(): Queue {
  if (queue !== null) return queue;
  queue = new Queue(MARKET_DATA_REFRESH_QUEUE_NAME, { connection: getRedis() });
  return queue;
}

export async function enqueueMarketDataRefresh(traceId: string): Promise<Job> {
  return getMarketDataRefreshQueue().add(
    MARKET_DATA_REFRESH_JOB_NAME,
    { traceId },
    { removeOnComplete: 100, removeOnFail: 500 },
  );
}

export async function scheduleMarketDataRefresh(): Promise<void> {
  await getMarketDataRefreshQueue().upsertJobScheduler(
    "market-data-refresh-schedule",
    { every: MARKET_DATA_REFRESH_INTERVAL_MS },
    {
      name: MARKET_DATA_REFRESH_JOB_NAME,
      data: { traceId: "scheduled" },
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    },
  );
}

export function registerMarketDataRefreshWorker(): Worker {
  return new Worker(
    MARKET_DATA_REFRESH_QUEUE_NAME,
    async (job: Job) => {
      const { newTraceId } = await import("@aguhot/core");
      const data = job.data as MarketDataRefreshJobData;
      const traceId = data.traceId === "scheduled" ? newTraceId() : data.traceId;

      try {
        const result = await refreshLatestMarketData(traceId);
        console.log(
          `[market-data-refresh ${traceId.slice(0, 8)}] detected=${result.detected} upserted=${result.upserted} projected=${result.projected} pruned=${result.pruned}`,
        );
        return result;
      } catch (error) {
        console.error(`[market-data-refresh ${traceId.slice(0, 8)}] failed`, error);
        throw error;
      }
    },
    { connection: getRedis() },
  );
}
