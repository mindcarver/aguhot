-- Issue #67: capital provider snapshot store.
-- Retains the raw provider payload + first-capture timestamp for sources
-- (NBS/ECOS/KRX) that provide no programmatic release timestamp or vintages.
-- firstCapturedAt is the auditable publishedAt source per AD-SNAP-1.
-- Append-only: snapshotKey uniqueness enforces "first occurrence" idempotency.
CREATE TABLE "capital_provider_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "first_captured_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "processing_version" TEXT NOT NULL,
    "trace_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_provider_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capital_provider_snapshots_market_check"
        CHECK ("market" IN ('global', 'us', 'cn', 'kr')),
    CONSTRAINT "capital_provider_snapshots_dimension_check"
        CHECK ("dimension" IN ('growth', 'inflation', 'liquidity', 'funding_price', 'risk_credit', 'market_breadth', 'institutional_positioning'))
);

CREATE UNIQUE INDEX "capital_provider_snapshots_snapshot_key_key"
    ON "capital_provider_snapshots"("snapshot_key");
CREATE INDEX "capital_provider_snapshots_provider_id_observed_at_idx"
    ON "capital_provider_snapshots"("provider_id", "observed_at");
CREATE INDEX "capital_provider_snapshots_metric_key_first_captured_at_idx"
    ON "capital_provider_snapshots"("metric_key", "first_captured_at");
