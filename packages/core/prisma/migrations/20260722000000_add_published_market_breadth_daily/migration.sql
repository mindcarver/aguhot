-- Issue #33: public read model for the daily 涨停 / 跌停 history surface.
--
-- The Python sidecar remains the sole writer of market_breadth_daily. This table is the narrow,
-- replaceable publish-orchestrator projection that the public page reads. Row absence means the
-- source date was not successfully collected or has not yet been projected; it is never replaced
-- with zeroes.

CREATE TABLE "published_market_breadth_daily" (
    "trade_date" DATE NOT NULL,
    "limit_up_count" INTEGER NOT NULL,
    "limit_down_count" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_market_breadth_daily_pkey" PRIMARY KEY ("trade_date")
);
