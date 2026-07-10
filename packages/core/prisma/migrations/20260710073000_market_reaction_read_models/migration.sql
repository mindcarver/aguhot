-- CreateTable
CREATE TABLE "market_reaction_snapshots" (
    "id" TEXT NOT NULL,
    "hot_event_id" TEXT NOT NULL,
    "price_volume_tone" TEXT NOT NULL,
    "price_volume_value" TEXT NOT NULL,
    "sector_limit_up_tone" TEXT NOT NULL,
    "sector_limit_up_value" TEXT NOT NULL,
    "limit_up_count" INTEGER NOT NULL,
    "trading_session" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_reaction_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_hot_event_reactions" (
    "hot_event_id" TEXT NOT NULL,
    "price_volume_tone" TEXT NOT NULL,
    "price_volume_value" TEXT NOT NULL,
    "sector_limit_up_tone" TEXT NOT NULL,
    "sector_limit_up_value" TEXT NOT NULL,
    "limit_up_count" INTEGER NOT NULL,
    "trading_session" TIMESTAMP(3) NOT NULL,
    "reaction_source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_hot_event_reactions_pkey" PRIMARY KEY ("hot_event_id")
);

-- CreateIndex
CREATE INDEX "market_reaction_snapshots_hot_event_id_idx" ON "market_reaction_snapshots"("hot_event_id");

-- CreateIndex
CREATE INDEX "market_reaction_snapshots_created_at_idx" ON "market_reaction_snapshots"("created_at");

-- AddForeignKey
ALTER TABLE "market_reaction_snapshots" ADD CONSTRAINT "market_reaction_snapshots_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_hot_event_reactions" ADD CONSTRAINT "published_hot_event_reactions_hot_event_id_fkey" FOREIGN KEY ("hot_event_id") REFERENCES "hot_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
