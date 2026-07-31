-- Issue #48: append-only canonical concentration snapshots for the A-share
-- active-equity fund sample. Node/Prisma (the fund-concentration module) owns
-- this table; it consumes the standardized FundQuarterlyReport contract from
-- Issue #44 and writes the auditable concentration read model.
CREATE TABLE "fund_concentration_snapshots" (
    "id" TEXT NOT NULL,
    "snapshot_key" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "sample_policy_version" TEXT NOT NULL,
    "processing_version" TEXT NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "fund_count" INTEGER NOT NULL,
    "selected_reports" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "price_quantity" JSONB NOT NULL,
    "availability" TEXT NOT NULL,
    "status_reason" TEXT,
    "trace_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_concentration_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fund_concentration_snapshots_revision_positive_check"
        CHECK ("revision" > 0),
    CONSTRAINT "fund_concentration_snapshots_fund_count_non_negative_check"
        CHECK ("fund_count" >= 0),
    CONSTRAINT "fund_concentration_snapshots_availability_check"
        CHECK ("availability" IN ('available', 'partial', 'unavailable', 'failed', 'pending_review', 'incomplete_reconstruction'))
);

CREATE UNIQUE INDEX "fund_concentration_snapshots_snapshot_key_key"
    ON "fund_concentration_snapshots"("snapshot_key");
CREATE INDEX "fund_concentration_snapshots_as_of_idx"
    ON "fund_concentration_snapshots"("as_of");
CREATE INDEX "fund_concentration_snapshots_observed_at_idx"
    ON "fund_concentration_snapshots"("observed_at");
CREATE INDEX "fund_concentration_snapshots_processing_version_as_of_idx"
    ON "fund_concentration_snapshots"("processing_version", "as_of");
CREATE INDEX "fund_concentration_snapshots_availability_as_of_idx"
    ON "fund_concentration_snapshots"("availability", "as_of");
