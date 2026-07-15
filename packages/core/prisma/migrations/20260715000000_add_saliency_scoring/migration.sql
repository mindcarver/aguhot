-- Story 7.1/7.2 (sprint-change-proposal-2026-07-15): investment-relevance gate +
-- cluster-time significance score. Five additive ALTER TABLEs, all nullable, no FKs,
-- no publication_status changes — purely additive scoring columns.
--
--   1. hot_events gains relevance_label + saliency + saliency_breakdown. event-assembly
--      is the SOLE writer (AD-2b): these are computed at cluster time from the
--      candidate's member evidence (relevance keywords + distinct-source breadth +
--      arrival velocity). relevance_label is the RelevanceLabel union
--      ("pass"|"suspicious"|"fail"); saliency is a 0–100 score; saliency_breakdown is
--      the component object ({breadth,velocity,marketReaction,association,total}) used
--      for the FR-3 sort-reason chip and for publish-time re-score (Story 7.4 folds in
--      marketReaction + association, which are 0 at cluster time). Nullable: pre-7.2
--      rows + the self-heal path leave them null; the publish gate treats null as
--      "unscored → hold" (never auto-publish an unscored event).
--   2. published_hot_events gains saliency (projected from HotEvent.saliency, re-scored
--      at publish time per Story 7.4; sole writer = publish-orchestrator, AD-3).
--   3. published_timeline_entries gains saliency (same source/writer; timeline ranking
--      tiebreak + FR-3 sort-reason source, Story 7.5).
--
-- market_reaction_snapshots and event_association_sets are NOT touched — Story 7.4
-- reads them read-only at publish time; they keep their existing write-owners.

-- AddColumn: hot_events.relevance_label — RelevanceLabel union ("pass"|"suspicious"|"fail").
ALTER TABLE "hot_events" ADD COLUMN "relevance_label" TEXT;

-- AddColumn: hot_events.saliency — 0–100 cluster-time significance score.
ALTER TABLE "hot_events" ADD COLUMN "saliency" DOUBLE PRECISION;

-- AddColumn: hot_events.saliency_breakdown — component breakdown object (Json).
ALTER TABLE "hot_events" ADD COLUMN "saliency_breakdown" JSONB;

-- AddColumn: published_hot_events.saliency — projected saliency for feed ranking.
ALTER TABLE "published_hot_events" ADD COLUMN "saliency" DOUBLE PRECISION;

-- AddColumn: published_timeline_entries.saliency — projected saliency for timeline ranking.
ALTER TABLE "published_timeline_entries" ADD COLUMN "saliency" DOUBLE PRECISION;
