-- Story 4.1: published_timeline_entries read model (AD-3b).
-- One folded row per published HotEvent. Row existence = currently published
-- (no status column, mirroring the other published_* read models). Refresh is
-- gate-atomic via decideReview's $transaction (publish upsert / takedown delete)
-- beside refreshPublishedReadModel; a periodic self-heal BullMQ job does full
-- corrective recompute as a safety net. See ARCHITECTURE-SPINE AD-3b.

-- CreateTable
CREATE TABLE "published_timeline_entries" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "session_tag" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence_count" INTEGER NOT NULL,
    "folded_evidence_record_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "recommendation_reason" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: UNIQUE on hot_event_id — enforces one folded row per published
-- HotEvent and makes the upsert race-free (concurrent in-tx publish + self-heal
-- cannot duplicate a row). Also backs deleteMany/by-hotEventId lookups.
CREATE UNIQUE INDEX "published_timeline_entries_hot_event_id_key" ON "published_timeline_entries"("hot_event_id");

-- CreateIndex: composite backs the home feed grouped trade_date DESC read and
-- the Story 4.3 session_tag filter (built once here).
CREATE INDEX "published_timeline_entries_trade_date_session_tag_occurred_at_idx" ON "published_timeline_entries"("trade_date", "session_tag", "occurred_at");

-- AddForeignKey
ALTER TABLE "published_timeline_entries" ADD CONSTRAINT "published_timeline_entries_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
