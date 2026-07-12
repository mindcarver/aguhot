-- Story 5.1: recommendation_reasons append-only table (AD-5).
-- One row per generation of the ≤40 字 AI 解读 (card hook) for a HotEvent. The
-- explanation module is the sole writer. publish-orchestrator projects the LATEST
-- row (created_at desc first) into published_timeline_entries.recommendation_reason
-- (the sole writer of that column stays publish-orchestrator, AD-2/AD-3b). Every
-- row carries source + model_id + prompt_version for NFR-7 version + provenance
-- audit. FK onDelete: Cascade so a HotEvent deletion cleans up its reason history.

-- CreateTable
CREATE TABLE "recommendation_reasons" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: hot_event_id backs the publish-orchestrator latest-row projection
-- lookup and the worker's `recommendationReasons: { none: {} }` candidate query.
CREATE INDEX "recommendation_reasons_hot_event_id_idx" ON "recommendation_reasons"("hot_event_id");

-- CreateIndex: created_at backs the createdAt desc + id desc tiebreaker ordering
-- used to resolve the latest row for the projection.
CREATE INDEX "recommendation_reasons_created_at_idx" ON "recommendation_reasons"("created_at");

-- AddForeignKey: Cascade so a HotEvent deletion cleans up its AI 解读 history.
ALTER TABLE "recommendation_reasons" ADD CONSTRAINT "recommendation_reasons_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
