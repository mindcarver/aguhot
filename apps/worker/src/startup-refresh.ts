import { newTraceId } from "@aguhot/core";

import {
  enqueueMarketDataRefresh,
  type EnqueueMarketDataRefreshOptions,
} from "./queues/market-data-refresh-queue.js";
import {
  enqueuePipelineRefresh,
  type EnqueuePipelineRefreshOptions,
} from "./queues/pipeline-refresh-queue.js";

interface StartupRefreshDependencies {
  newTraceId: () => string;
  enqueuePipelineRefresh: (
    traceId: string,
    options: EnqueuePipelineRefreshOptions,
  ) => Promise<{ id?: string }>;
  enqueueMarketDataRefresh: (
    traceId: string,
    options: EnqueueMarketDataRefreshOptions,
  ) => Promise<{ id?: string }>;
}

export interface StartupRefreshResult {
  pipelineJobId: string;
  marketDataJobId: string;
}

const defaultDependencies: StartupRefreshDependencies = {
  newTraceId,
  enqueuePipelineRefresh,
  enqueueMarketDataRefresh,
};

export async function enqueueStartupRefreshes(
  dependencies: StartupRefreshDependencies = defaultDependencies,
): Promise<StartupRefreshResult> {
  const [pipelineJob, marketDataJob] = await Promise.all([
    dependencies.enqueuePipelineRefresh(dependencies.newTraceId(), {
      deduplication: {
        id: "worker-startup",
      },
    }),
    dependencies.enqueueMarketDataRefresh(dependencies.newTraceId(), {
      deduplication: {
        id: "worker-startup",
      },
    }),
  ]);

  return {
    pipelineJobId: String(pipelineJob.id),
    marketDataJobId: String(marketDataJob.id),
  };
}
