-- GitHub #30: independent source and public read models for the A-share surge calendar.
-- These tables intentionally do not share rows or direction flags with crash_days.

CREATE TABLE "surge_days" (
    "id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "threshold" DECIMAL(8,4) NOT NULL,
    "surge_count" INTEGER NOT NULL,
    "indices" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    CONSTRAINT "surge_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surge_days_trade_date_key" ON "surge_days"("trade_date");
CREATE INDEX "surge_days_trade_date_idx" ON "surge_days"("trade_date");

CREATE TABLE "published_surge_days" (
    "trade_date" DATE NOT NULL,
    "threshold" DECIMAL(8,4) NOT NULL,
    "surge_count" INTEGER NOT NULL,
    "indices" JSONB NOT NULL,
    "leading_sectors" JSONB NOT NULL,
    "breadth" JSONB,
    "source" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "published_surge_days_pkey" PRIMARY KEY ("trade_date")
);
