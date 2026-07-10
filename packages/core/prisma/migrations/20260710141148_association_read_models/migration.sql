-- CreateTable
CREATE TABLE "event_association_sets" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_association_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_hot_event_associations" (
    "hot_event_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "association_source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_hot_event_associations_pkey" PRIMARY KEY ("hot_event_id")
);

-- CreateIndex
CREATE INDEX "event_association_sets_hot_event_id_idx" ON "event_association_sets"("hot_event_id");

-- CreateIndex
CREATE INDEX "event_association_sets_created_at_idx" ON "event_association_sets"("created_at");

-- AddForeignKey
ALTER TABLE "event_association_sets" ADD CONSTRAINT "event_association_sets_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_hot_event_associations" ADD CONSTRAINT "published_hot_event_associations_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
