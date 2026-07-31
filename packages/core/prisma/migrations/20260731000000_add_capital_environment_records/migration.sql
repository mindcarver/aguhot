-- Issue #47: append-only canonical capital-environment records.
-- Node/Prisma owns this table; the Python sidecar remains the sole writer of
-- index_daily_bars, sector_daily_bars and market_breadth_daily.
CREATE TABLE "capital_environment_records" (
    "id" TEXT NOT NULL,
    "record_key" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "value" DECIMAL(24,8),
    "unit" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "as_of" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_dataset" TEXT NOT NULL,
    "source_documentation_url" TEXT,
    "processing_version" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "status_reason" TEXT,
    "revision" INTEGER NOT NULL,
    "trace_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_environment_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capital_environment_records_published_before_as_of_check"
        CHECK ("published_at" IS NULL OR "published_at" <= "as_of"),
    CONSTRAINT "capital_environment_records_revision_positive_check"
        CHECK ("revision" > 0),
    CONSTRAINT "capital_environment_records_market_check"
        CHECK ("market" IN ('global', 'us', 'cn', 'kr')),
    CONSTRAINT "capital_environment_records_dimension_check"
        CHECK ("dimension" IN ('growth', 'inflation', 'liquidity', 'funding_price', 'risk_credit', 'market_breadth', 'institutional_positioning')),
    CONSTRAINT "capital_environment_records_availability_check"
        CHECK ("availability" IN ('available', 'partial', 'unknown', 'failed', 'pending_review', 'incomplete_reconstruction'))
);

CREATE UNIQUE INDEX "capital_environment_records_record_key_key"
    ON "capital_environment_records"("record_key");
CREATE INDEX "capital_environment_records_metric_key_observed_at_idx"
    ON "capital_environment_records"("metric_key", "observed_at");
CREATE INDEX "capital_environment_records_metric_key_published_at_idx"
    ON "capital_environment_records"("metric_key", "published_at");
CREATE INDEX "capital_environment_records_metric_key_as_of_idx"
    ON "capital_environment_records"("metric_key", "as_of");
CREATE INDEX "capital_environment_records_market_dimension_observed_at_idx"
    ON "capital_environment_records"("market", "dimension", "observed_at");
CREATE INDEX "capital_environment_records_market_published_at_idx"
    ON "capital_environment_records"("market", "published_at");
CREATE INDEX "capital_environment_records_market_as_of_idx"
    ON "capital_environment_records"("market", "as_of");
CREATE INDEX "capital_environment_records_as_of_idx"
    ON "capital_environment_records"("as_of");
CREATE INDEX "capital_environment_records_published_at_idx"
    ON "capital_environment_records"("published_at");
