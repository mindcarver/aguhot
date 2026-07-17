/**
 * @aguhot/worker — ingest / normalize / cluster / explain / market-reaction /
 * theme-backfill / daily-digest / publish-timeline / recommendation-reason /
 * deep-read runtime.
 *
 * Story 1.4 registered the source-ingest worker. Story 1.5 added the event-
 * cluster worker. Story 1.8 added the explain worker. Story 2.1 added the
 * market-reaction worker. Story 2.3 added the theme-backfill worker. Story 2.4
 * added the daily-digest worker. Story 4.1 added the publish-timeline self-heal
 * worker. Story 5.1 added the recommendation-reason worker. Story 5.2 added the
 * deep-read worker alongside them: validate required env (DB + Redis), connect
 * Redis, register all nine workers, wire the timeline self-heal repeatable
 * schedule, and wire graceful shutdown (close all nine). The web request path
 * never imports this module — heavy work is async (AD-4).
 *
 * The nine workers are independent and idempotent: ingest does not trigger a
 * cluster job automatically, cluster does not trigger an explain job, explain
 * does not trigger a market-reaction job, market-reaction does not trigger a
 * theme-backfill job, theme-backfill does not trigger a daily-digest job, none
 * of those triggers the publish-timeline self-heal automatically, none triggers
 * the recommendation-reason job automatically, and none triggers the deep-read
 * job automatically (the jobs are decoupled; pipeline chaining/cron orchestration
 * is deferred — see deferred-work.md). The publish-timeline worker is the only
 * one carrying a repeatable self-heal schedule (every 15 min, corrective only —
 * the main timeline refresh is the in-transaction refreshPublishedTimelineForEvent
 * inside decideReview, AD-3b method A). Each worker can run in isolation against
 * the shared DB/Redis.
 */

import { requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import { registerDailyDigestWorker } from "./queues/daily-digest-queue.js";
import { registerDeepReadWorker } from "./queues/deep-read-queue.js";
import { registerEventClusterWorker } from "./queues/event-cluster-queue.js";
import { registerExplainWorker } from "./queues/explain-queue.js";
import { registerMarketReactionWorker } from "./queues/market-reaction-queue.js";
import {
  registerMarketDataRefreshWorker,
  scheduleMarketDataRefresh,
} from "./queues/market-data-refresh-queue.js";
import {
  registerPublishTimelineWorker,
  schedulePublishTimelineSelfHeal,
} from "./queues/publish-timeline-queue.js";
import { registerRecommendationReasonWorker } from "./queues/recommendation-reason-queue.js";
import { registerSourceIngestWorker } from "./queues/source-ingest-queue.js";
import { registerThemeBackfillWorker } from "./queues/theme-backfill-queue.js";
import {
  registerPipelineRefreshWorker,
  schedulePipelineRefreshSelfHeal,
} from "./queues/pipeline-refresh-queue.js";
import {
  registerInvestmentTargetsWorker,
  scheduleInvestmentTargetsSelfHeal,
} from "./queues/investment-targets-queue.js";

async function main(): Promise<void> {
  // Fail loud and early if infra is missing (Block-If): a worker without DB or
  // Redis cannot do its job, and silent degradation would hide broken ingest.
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  const redis = getRedis();
  await redis.ping();

  const sourceIngestWorker = registerSourceIngestWorker();
  const eventClusterWorker = registerEventClusterWorker();
  const explainWorker = registerExplainWorker();
  const marketReactionWorker = registerMarketReactionWorker();
  const marketDataRefreshWorker = registerMarketDataRefreshWorker();
  const themeBackfillWorker = registerThemeBackfillWorker();
  const dailyDigestWorker = registerDailyDigestWorker();
  const publishTimelineWorker = registerPublishTimelineWorker();
  const recommendationReasonWorker = registerRecommendationReasonWorker();
  const deepReadWorker = registerDeepReadWorker();
  const investmentTargetsWorker = registerInvestmentTargetsWorker();
  const pipelineRefreshWorker = registerPipelineRefreshWorker();

  // Wire the timeline self-heal repeatable schedule (Story 4.1). Corrective
  // only — the main timeline refresh is the in-tx refreshPublishedTimeline-
  // ForEvent inside decideReview. Idempotent: upsertJobScheduler replaces any
  // existing schedule with the same key on restart.
  await schedulePublishTimelineSelfHeal();
  // Wire the investment-targets self-heal (full-auto sweep for events lacking a
  // candidate pool). Idempotent on restart.
  await scheduleInvestmentTargetsSelfHeal();
  // Wire the pipeline-refresh self-heal (full ingest→cluster→explain→reason→
  // auto-approve→digest→publish-timeline pass every 10 min). Default-on. Dev
  // auto-approve bypass — prod uses the operator review gate.
  await schedulePipelineRefreshSelfHeal();
  // Keep index_daily_bars → crash_days → published_crash_days current without
  // requiring an operator to run the Epic 8 dev runners by hand.
  await scheduleMarketDataRefresh();

  console.log(
    "[worker] source-ingest + event-cluster + explain + market-reaction + market-data-refresh + theme-backfill + daily-digest + publish-timeline + recommendation-reason + deep-read + investment-targets + pipeline-refresh workers registered and running",
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down`);
    await Promise.all([
      sourceIngestWorker.close(),
      eventClusterWorker.close(),
      explainWorker.close(),
      marketReactionWorker.close(),
      marketDataRefreshWorker.close(),
      themeBackfillWorker.close(),
      dailyDigestWorker.close(),
      publishTimelineWorker.close(),
      recommendationReasonWorker.close(),
      deepReadWorker.close(),
      investmentTargetsWorker.close(),
      pipelineRefreshWorker.close(),
    ]);
    await closeRedis();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("[worker] fatal startup error", error);
  process.exit(1);
});
