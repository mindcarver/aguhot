-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reviewer" TEXT NOT NULL,
    "note" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_decisions" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "reason" TEXT,
    "review_decision_id" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_hot_events" (
    "hot_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "evidence_count" INTEGER NOT NULL,
    "latest_evidence_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_hot_events_pkey" PRIMARY KEY ("hot_event_id")
);

-- CreateIndex
CREATE INDEX "review_decisions_hot_event_id_idx" ON "review_decisions"("hot_event_id");

-- CreateIndex
CREATE INDEX "review_decisions_created_at_idx" ON "review_decisions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "publication_decisions_review_decision_id_key" ON "publication_decisions"("review_decision_id");

-- CreateIndex
CREATE INDEX "publication_decisions_hot_event_id_idx" ON "publication_decisions"("hot_event_id");

-- CreateIndex
CREATE INDEX "publication_decisions_created_at_idx" ON "publication_decisions"("created_at");

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_decisions" ADD CONSTRAINT "publication_decisions_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_decisions" ADD CONSTRAINT "publication_decisions_review_decision_id_fkey" FOREIGN KEY ("review_decision_id") REFERENCES "review_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_hot_events" ADD CONSTRAINT "published_hot_events_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
