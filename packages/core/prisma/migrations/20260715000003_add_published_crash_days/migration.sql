-- Story 8.3: published_crash_days — the PUBLIC read model for /crash-calendar, owned SOLELY by
-- publish-orchestrator (AD-3 single write-owner). It is the only table the /crash-calendar page
-- reads; the page NEVER reads crash_days / index_daily_bars / sector_daily_bars directly (AD-3).
-- Row existence = a currently-published crash day (no status column); absent ⇒ the page renders
-- the honest empty state (AC4).
--
-- Mirrors published_daily_digests exactly: tradeDate-keyed (the PK), no separate id column, an
-- updatedAt stamp. A crash day is a tradeDate-keyed statistics projection, NOT a hotEvent aggregate,
-- so its projection is a SIBLING to refreshPublishedDailyDigest (same key family) rather than a
-- branch in the hotEventId-keyed refreshPublishedReadModel. NO FK to crash_days /
-- sector_daily_bars — derived projection.
--
-- `indices` is copied verbatim from crash_days.indices (IndexCrashDetail[]). `leadingSectors` is
-- materialized at projection time from sector_daily_bars (Top-N 申万一级 down sectors that trade day;
-- 8.3 is the first Node consumer of sector_daily_bars). Missing sector rows ⇒ leadingSectors = []
-- (page shows honest "暂不可用", NFR-5).
--
-- Compliance gate (§12 Q10): prod does NOT run refreshPublishedCrashDays until the financial-info
-- compliance review clears; row absence ⇒ empty state. /crash-calendar is also robots-noindex.

-- CreateTable: published_crash_days (publish-orchestrator is sole writer)
CREATE TABLE "published_crash_days" (
    "trade_date" DATE NOT NULL,
    "threshold" DECIMAL(8,4) NOT NULL,
    "crash_count" INTEGER NOT NULL,
    "indices" JSONB NOT NULL,
    "leading_sectors" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_crash_days_pkey" PRIMARY KEY ("trade_date")
);
