-- Story 5.4: AI content operator sampling — surgical suppress signal + audit target columns.
--
-- Three additive ALTER TABLEs, all nullable, no FKs, no publication_status changes:
--   1. review_decisions gains target_type + target_id (nullable; the traditional 4-outcome
--      decisions leave both null since they are per-HotEvent; a suppress_ai_content decision
--      sets target_type ∈ {"reason","deepread"} + target_id = the suppressed
--      RecommendationReason.id / DeepRead.id). Structured audit columns let SM-6 query by
--      outcome + target_type without parsing free-text notes.
--   2. recommendation_reasons gains suppressed_at (nullable; set to now() by the sole writer
--      suppressRecommendationReason when an operator judges the reason misleading).
--   3. deep_reads gains suppressed_at (same shape; sole writer = suppressDeepRead).
--
-- The content columns of recommendation_reasons / deep_reads are NEVER cleared — only the
-- nullable suppressed_at timestamp marks suppression, keeping NFR-7 audit / traceability
-- intact. publish-orchestrator's reason + deep-read projections add `where:{suppressedAt:null}`
-- so a suppressed source row is skipped at projection time (published reason → null, published
-- deep-read row → deleted). The signal is co-located on the source rows the projection already
-- reads, so no cross-module reverse dependency on review-workflow / ReviewDecision is needed
-- (see spec-5-4 Design Notes). Suppression survives republish / whole-event refresh because the
-- projection re-derives from source each pass.

-- AddColumn: review_decisions.target_type — Story 5.4 suppress_ai_content target type
-- ("reason" | "deepread"); null for the traditional 4-outcome per-HotEvent decisions.
ALTER TABLE "review_decisions" ADD COLUMN "target_type" TEXT;

-- AddColumn: review_decisions.target_id — the suppressed RecommendationReason.id /
-- DeepRead.id; null for the traditional 4-outcome decisions.
ALTER TABLE "review_decisions" ADD COLUMN "target_id" TEXT;

-- AddColumn: recommendation_reasons.suppressed_at — set when an operator suppresses this
-- reason via the sibling suppressAiContent path; null while live.
ALTER TABLE "recommendation_reasons" ADD COLUMN "suppressed_at" TIMESTAMP(3);

-- AddColumn: deep_reads.suppressed_at — same semantics as recommendation_reasons.suppressed_at.
ALTER TABLE "deep_reads" ADD COLUMN "suppressed_at" TIMESTAMP(3);
