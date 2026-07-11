-- Story 5.3: trend_briefings append-only truth table (AD-5) + published_trend_briefings
-- projection table (AD-3). One trend_briefings row per generation of the single-paragraph
-- cross-event AI 趋势研判 for a coverageDate. The digest module is the sole writer of
-- trend_briefings. publish-orchestrator projects the LATEST row (created_at desc first,
-- id desc tiebreaker) into published_trend_briefings via the sibling
-- refreshPublishedTrendBriefing (the sole writer of that projection stays publish-
-- orchestrator, AD-2/AD-3); the worker only appends here + calls
-- refreshPublishedTrendBriefing. Every row carries source + model_id + prompt_version for
-- NFR-7 version + provenance audit.
--
-- NO FK to hot_events — coverageDate-keyed aggregate, data-only based_on_hot_event_ids
-- link (mirrors daily_digests' no-FK invariant: "cross-page navigation is not a module").
-- based_on_hot_event_ids is a Json string[] carrying the set of hotEventIds the briefing
-- was derived from (satisfies the epic's `TREND_BRIEFING }o--o{ HOT_EVENT : based_on`
-- LOGICAL relation; physically a data-only link, same shape as daily_digests.items).
-- Distinct from DeepRead (per-HotEvent three-segment) and DailyDigest (per-coverageDate
-- event-item list); see the TrendBriefing model comment in schema.prisma for the
-- independent-table rationale.

-- CreateTable: trend_briefings (truth table, AD-5 append-only; coverageDate-keyed)
CREATE TABLE "trend_briefings" (
    "id" TEXT NOT NULL,
    "coverage_date" TIMESTAMP(3) NOT NULL,
    "briefing" TEXT NOT NULL,
    "based_on_hot_event_ids" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trend_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: coverage_date backs the publish-orchestrator latest-row projection lookup
-- (where coverageDate orderBy createdAt desc) and getLatestTrendBriefing.
CREATE INDEX "trend_briefings_coverage_date_idx" ON "trend_briefings"("coverage_date");

-- CreateIndex: created_at backs the createdAt desc + id desc tiebreaker ordering used
-- to resolve the latest row for the projection.
CREATE INDEX "trend_briefings_created_at_idx" ON "trend_briefings"("created_at");

-- CreateTable: published_trend_briefings (projection, AD-3; 1:1 per coverageDate)
CREATE TABLE "published_trend_briefings" (
    "coverage_date" TIMESTAMP(3) NOT NULL,
    "briefing" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "trace_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "published_trend_briefings_pkey" PRIMARY KEY ("coverage_date")
);
