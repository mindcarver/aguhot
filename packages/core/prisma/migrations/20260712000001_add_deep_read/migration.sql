-- Story 5.2: deep_reads append-only truth table (AD-5) + published_hot_event_deep_reads
-- projection table (AD-3). One deep_reads row per generation of the three-segment
-- 影响面/受益方/风险点 detail-page deep read for a HotEvent. The explanation module is
-- the sole writer of deep_reads. publish-orchestrator projects the LATEST row
-- (created_at desc first) into published_hot_event_deep_reads (the sole writer of that
-- projection stays publish-orchestrator, AD-2/AD-3). Every row carries source + model_id
-- + prompt_version for NFR-7 version + provenance audit. FK onDelete: Cascade so a
-- HotEvent deletion cleans up both its deep-read history and its projection.
-- Distinct from ExplanationVersion (different semantic content, same detail page); see
-- the DeepRead model comment in schema.prisma for the independent-table rationale.

-- CreateTable: deep_reads (truth table, AD-5 append-only)
CREATE TABLE "deep_reads" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "impact_surface" TEXT NOT NULL,
    "beneficiaries" TEXT NOT NULL,
    "risk_points" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deep_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: hot_event_id backs the publish-orchestrator latest-row projection lookup
-- and the worker's `deepReads: { none: {} }` candidate query.
CREATE INDEX "deep_reads_hot_event_id_idx" ON "deep_reads"("hot_event_id");

-- CreateIndex: created_at backs the createdAt desc + id desc tiebreaker ordering used
-- to resolve the latest row for the projection.
CREATE INDEX "deep_reads_created_at_idx" ON "deep_reads"("created_at");

-- AddForeignKey: Cascade so a HotEvent deletion cleans up its deep-read history.
ALTER TABLE "deep_reads" ADD CONSTRAINT "deep_reads_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: published_hot_event_deep_reads (projection, AD-3; 1:1 per hotEventId)
CREATE TABLE "published_hot_event_deep_reads" (
    "hot_event_id" TEXT NOT NULL,
    "impact_surface" TEXT NOT NULL,
    "beneficiaries" TEXT NOT NULL,
    "risk_points" TEXT NOT NULL,
    "deep_read_source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_hot_event_deep_reads_pkey" PRIMARY KEY ("hot_event_id")
);

-- AddForeignKey: Cascade so a HotEvent deletion cleans up the projection (mirrors the
-- other published_hot_event_* tables).
ALTER TABLE "published_hot_event_deep_reads" ADD CONSTRAINT "published_hot_event_deep_reads_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
