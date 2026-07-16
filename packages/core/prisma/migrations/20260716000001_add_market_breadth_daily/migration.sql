-- Story 8.6: market breadth daily — one new table for the 大跌日历 deep-detail breadth data.
--
-- market_breadth_daily: a SINGLE-ROW-per-trade_date aggregate of 5 AkShare breadth sources
-- (limit-up/down/broken-board pools, A-share spot advancing/declining/turnover, dragon-tiger
-- 龙虎榜, margin 融资融券). Written SOLELY by the Python sidecar apps/market-sidecar via
-- psycopg v3 raw SQL (NEVER Prisma/SQLAlchemy/Alembic — single-schema ownership stays with
-- Node/Prisma, AD-2). The 8.7 projection (published_crash_days.breadth) and 8.8 deep detail
-- page READ this table; they never call AkShare (AD-7: the sidecar is the MarketDataAdapter
-- impl side).
--
-- Core counts (limit_up/down, consecutive_board_max, broken_board_count) are NOT NULL: a breadth
-- row is only written when the date-specific pool sources return data (NFR-5 — never fabricate; a
-- missing core source ⇒ the day is simply absent from the table). The SPOT-derived fields
-- (advancing/declining/flat, total_turnover) are NULLABLE: stock_zh_a_spot_em() takes NO date and
-- serves ONLY the latest trading day's snapshot, so historical-day rows carry NULL for these four
-- fields (NFR-5 honest empty, not fabricated onto past trade_dates). margin_balance_change (T-1
-- 融资融券) and dragon_tiger (龙虎榜) are also NULLABLE: a day with no dragon-tiger listings is
-- honestly stored as a zero object ({stockCount:0,...}), while a fetch failure stores NULL
-- (NFR-5 > the proposal table sketch).
-- total_turnover/margin_balance_change are DECIMAL(20,2) (两市成交额 reaches trillions of yuan);
-- counts are INTEGER. trade_date is a DATE and the UNIQUE key. The Python side assigns the
-- UUIDv7 id app-side (uuid7 lib), mirroring the app-side PK convention (no DB default).
-- Idempotent upsert on UNIQUE(trade_date) with ON CONFLICT (trade_date) DO NOTHING —
-- re-running the same day is a no-op (AC2). NO FK to crash_days / index_daily_bars — breadth
-- is a market-data time series keyed by date, not a sub-aggregate (mirrors index_daily_bars'
-- no-FK invariant). North-bound capital is deliberately NOT collected (exchanges stopped
-- real-time disclosure on 2024-08-19; showing it would fabricate empty data).

-- CreateTable: market_breadth_daily (single-row-per-day breadth aggregate; Python sidecar is sole writer)
CREATE TABLE "market_breadth_daily" (
    "id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "limit_up_count" INTEGER NOT NULL,
    "limit_down_count" INTEGER NOT NULL,
    "consecutive_board_max" INTEGER NOT NULL,
    "broken_board_count" INTEGER NOT NULL,
    "advancing_count" INTEGER,
    "declining_count" INTEGER,
    "flat_count" INTEGER,
    "total_turnover" DECIMAL(20,2),
    "margin_balance_change" DECIMAL(20,2),
    "dragon_tiger" JSONB,
    "source" TEXT NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,

    CONSTRAINT "market_breadth_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique idempotency key (trading day). Backs the psycopg upsert
-- ON CONFLICT (trade_date) DO NOTHING (AC2) and the 8.7 projection tradeDate match.
CREATE UNIQUE INDEX "market_breadth_daily_trade_date_key" ON "market_breadth_daily"("trade_date");

-- CreateIndex: trade_date backs the 8.7 projection range read (same pattern as the bar tables).
CREATE INDEX "market_breadth_daily_trade_date_idx" ON "market_breadth_daily"("trade_date");
