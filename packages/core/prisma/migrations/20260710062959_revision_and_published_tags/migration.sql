-- AlterTable
ALTER TABLE "published_hot_events" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "hot_event_revisions" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewer" TEXT NOT NULL,
    "note" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hot_event_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hot_event_revisions_hot_event_id_idx" ON "hot_event_revisions"("hot_event_id");

-- CreateIndex
CREATE INDEX "hot_event_revisions_created_at_idx" ON "hot_event_revisions"("created_at");

-- AddForeignKey
ALTER TABLE "hot_event_revisions" ADD CONSTRAINT "hot_event_revisions_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
