-- CreateTable
CREATE TABLE "daily_digests" (
    "id" TEXT NOT NULL,
    "coverage_date" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_daily_digests" (
    "coverage_date" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_daily_digests_pkey" PRIMARY KEY ("coverage_date")
);

-- CreateIndex
CREATE INDEX "daily_digests_coverage_date_idx" ON "daily_digests"("coverage_date");

-- CreateIndex
CREATE INDEX "daily_digests_created_at_idx" ON "daily_digests"("created_at");
