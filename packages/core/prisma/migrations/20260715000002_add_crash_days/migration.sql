-- Story 8.2: crash_days — one row per A-share crash trading day, owned SOLELY by the
-- crash-review module (AD-2 single-writer). crash-review READS index_daily_bars (8.1) and
-- writes here; no other module writes crash_days. A crash day = any of the three broad
-- indices (sh000001 / sz399001 / sz399006) whose pct_change ≤ CRASH_THRESHOLD (default
-- -2.0%, operator-tunable module constant — NOT global env, mirroring TIMELINE_FOLD_THRESHOLD).
--
-- `indices` is a read-only statistics projection with no cross-row query need, so per the
-- 2026-07-15b sprint-change-proposal #2 it is a single JSONB column: one entry per index
-- present that day ({ indexCode, pctChange, close, crashed, forwardReturns }). A missing
-- index_daily_bars row ⇒ that index is omitted (never faked to 0, NFR-5). forwardReturns
-- T+1/T+5/T+20 are HISTORIC ACTUAL `(close[t+N]/close[t]-1)*100` over the index's own
-- trading-day series; null when fewer than N future bars exist (NFR-5).
--
-- Upsert semantics: keyed by trade_date (one row per crash day), recompute UPDATES in place
-- to fill forward returns as new bars arrive — a materialized projection, NOT append-only
-- (mirrors published_*, unlike market_reaction_snapshots' AD-5 append-only). NO FK to
-- index_daily_bars — derived projection. The public read model published_crash_days is
-- built in 8.3; this table is the source-of-truth the projection reads.

-- CreateTable: crash_days (crash-review is sole writer)
CREATE TABLE "crash_days" (
    "id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "threshold" DECIMAL(8,4) NOT NULL,
    "crash_count" INTEGER NOT NULL,
    "indices" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,

    CONSTRAINT "crash_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique key (one row per crash trading day). Backs the upsert by trade_date.
CREATE UNIQUE INDEX "crash_days_trade_date_key" ON "crash_days"("trade_date");

-- CreateIndex: trade_date backs the 8.3 calendar range read.
CREATE INDEX "crash_days_trade_date_idx" ON "crash_days"("trade_date");
