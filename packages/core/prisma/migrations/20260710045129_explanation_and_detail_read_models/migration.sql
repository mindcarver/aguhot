-- CreateTable
CREATE TABLE "explanation_versions" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "why_it_matters" TEXT NOT NULL,
    "uncertainties" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "explanation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_hot_event_explanations" (
    "hot_event_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "why_it_matters" TEXT NOT NULL,
    "uncertainties" TEXT NOT NULL,
    "explanation_source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_hot_event_explanations_pkey" PRIMARY KEY ("hot_event_id")
);

-- CreateTable
CREATE TABLE "published_hot_event_evidence" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "source_name" TEXT NOT NULL,
    "url" TEXT,
    "summary" TEXT,
    "published_at" TIMESTAMP(3),
    "link_status" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_hot_event_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "explanation_versions_hot_event_id_idx" ON "explanation_versions"("hot_event_id");

-- CreateIndex
CREATE INDEX "explanation_versions_created_at_idx" ON "explanation_versions"("created_at");

-- CreateIndex
CREATE INDEX "published_hot_event_evidence_hot_event_id_idx" ON "published_hot_event_evidence"("hot_event_id");

-- AddForeignKey
ALTER TABLE "explanation_versions" ADD CONSTRAINT "explanation_versions_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_hot_event_explanations" ADD CONSTRAINT "published_hot_event_explanations_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_hot_event_evidence" ADD CONSTRAINT "published_hot_event_evidence_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
