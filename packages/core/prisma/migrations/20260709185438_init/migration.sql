-- CreateTable
CREATE TABLE "evidence_sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feed_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_error" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_records" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "published_at" TIMESTAMP(3),
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failure_reason" TEXT,
    "raw_payload" JSONB NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evidence_records_content_hash_key" ON "evidence_records"("content_hash");

-- CreateIndex
CREATE INDEX "evidence_records_source_id_idx" ON "evidence_records"("source_id");

-- CreateIndex
CREATE INDEX "evidence_records_status_idx" ON "evidence_records"("status");

-- AddForeignKey
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "evidence_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
