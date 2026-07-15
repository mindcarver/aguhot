-- Story 8.1: market history daily bars — two new tables for the 大跌日历 data foundation.
--
-- index_daily_bars: 三大宽基 (上证综指 sh000001 / 深证成指 sz399001 / 创业板指 sz399006) daily
-- pct_change + close. sector_daily_bars: 申万一级行业 (~31) daily pct_change + close. Both are
-- written SOLELY by the Python sidecar apps/market-sidecar via psycopg v3 raw SQL (NEVER
-- Prisma/SQLAlchemy/Alembic — single-schema ownership stays with Node/Prisma, AD-2). Node
-- domain modules (crash-review 8.2, market-reaction) read these rows; they never call AkShare
-- (AD-7: the sidecar is the MarketDataAdapter impl side).
--
-- Minimal scope: pct_change + close only (decimal, NOT float — Consistency Convention:
-- 涨跌和比率以 decimal 存储). OHLC/volume/turnover are YAGNI until a consumer needs them.
-- trade_date is a DATE (A-share trading day). The Python side assigns the UUIDv7 id app-side
-- (uuid7 lib), mirroring the system-wide app-side PK convention (no DB default). Idempotent
-- upsert on @@unique([*_code, trade_date]) — re-running the same day is a no-op (AC3). NO FK
-- to hot_events — these are market-data time series (code+date-keyed aggregates), not
-- hotEvent-owned sub-aggregates (mirrors daily_digests' no-FK invariant).

-- CreateTable: index_daily_bars (三大宽基 daily bars; Python sidecar is sole writer)
CREATE TABLE "index_daily_bars" (
    "id" TEXT NOT NULL,
    "index_code" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "pct_change" DECIMAL(8,4) NOT NULL,
    "close" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,

    CONSTRAINT "index_daily_bars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique idempotency key (index, trading day). Backs the psycopg upsert
-- ON CONFLICT (index_code, trade_date) DO NOTHING and the 8.2 date-range lookups.
CREATE UNIQUE INDEX "index_daily_bars_index_code_trade_date_key" ON "index_daily_bars"("index_code", "trade_date");

-- CreateIndex: trade_date backs the 8.2 crash-review "all indices on a date" read.
CREATE INDEX "index_daily_bars_trade_date_idx" ON "index_daily_bars"("trade_date");

-- CreateIndex: index_code backs the per-index time-series read.
CREATE INDEX "index_daily_bars_index_code_idx" ON "index_daily_bars"("index_code");

-- CreateTable: sector_daily_bars (申万一级 daily bars; Python sidecar is sole writer)
CREATE TABLE "sector_daily_bars" (
    "id" TEXT NOT NULL,
    "sector_code" TEXT NOT NULL,
    "sector_name" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "pct_change" DECIMAL(8,4) NOT NULL,
    "close" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,

    CONSTRAINT "sector_daily_bars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique idempotency key (sector, trading day). Backs the psycopg upsert
-- ON CONFLICT (sector_code, trade_date) DO NOTHING and the 8.2 date-range lookups.
CREATE UNIQUE INDEX "sector_daily_bars_sector_code_trade_date_key" ON "sector_daily_bars"("sector_code", "trade_date");

-- CreateIndex: trade_date backs the 8.2 crash-review "all sectors on a date" read.
CREATE INDEX "sector_daily_bars_trade_date_idx" ON "sector_daily_bars"("trade_date");

-- CreateIndex: sector_code backs the per-sector time-series read.
CREATE INDEX "sector_daily_bars_sector_code_idx" ON "sector_daily_bars"("sector_code");
