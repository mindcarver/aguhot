-- CreateTable
CREATE TABLE "hot_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "cluster_signature" TEXT NOT NULL,
    "publication_status" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hot_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hot_event_evidence" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "evidence_record_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hot_event_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hot_events_publication_status_idx" ON "hot_events"("publication_status");

-- CreateIndex
CREATE INDEX "hot_event_evidence_evidence_record_id_idx" ON "hot_event_evidence"("evidence_record_id");

-- CreateIndex
CREATE INDEX "hot_event_evidence_hot_event_id_idx" ON "hot_event_evidence"("hot_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "hot_event_evidence_hot_event_id_evidence_record_id_key" ON "hot_event_evidence"("hot_event_id", "evidence_record_id");

-- AddForeignKey
ALTER TABLE "hot_event_evidence" ADD CONSTRAINT "hot_event_evidence_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hot_event_evidence" ADD CONSTRAINT "hot_event_evidence_evidence_record_id_fkey" FOREIGN KEY ("evidence_record_id") REFERENCES "evidence_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
