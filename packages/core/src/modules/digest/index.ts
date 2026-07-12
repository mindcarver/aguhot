/**
 * digest module barrel — Story 2.4 (daily digest generation + reading) + Story 5.3
 * (daily-page cross-event AI 趋势研判).
 *
 * Owns the daily_digests table (AD-2 append-only, one row per generation,
 * coverageDate-keyed) and, as of Story 5.3, the trend_briefings table (AD-2 append-only,
 * coverageDate-keyed cross-event AI trend briefing). Exposes the digest generator, the
 * trend-briefing generator, the latest-digest + latest-trend-briefing read queries, the
 * DigestAdapter port, and the test-only stub. The Prisma client lives one level up and is
 * re-exported from the package barrel.
 *
 * This module never writes published_* (publish-orchestrator owns the public projections
 * published_daily_digests + published_trend_briefings) or hot_events (event-assembly owns
 * those). It only appends daily_digests + trend_briefings; publish-orchestrator reads the
 * latest at projection time and writes the public read models.
 *
 * Story 2.4 adds a daily-digest worker (epic lists daily digest as a job category). The
 * worker resolves adapter = undefined (procurement deferred) so generateDailyDigest returns
 * null and prod degrades honestly. The worker does NOT import StubDigestAdapter; verify/e2e
 * pass it to generateDailyDigest directly.
 *
 * Story 5.3 extends the daily-digest worker with a second adapter injection point
 * (llmAdapter: LLMAdapter | undefined) for the trend briefing; V1 both adapters undefined
 * → short-circuit honest degradation. The trend briefing reuses the explanation module's
 * LLMAdapter port (epic-5-context :108 "三者共用端口") — a cross-module port-type
 * dependency, NOT an aggregate-write dependency (digest does not write explanation
 * aggregates). The trend briefing's 6-class wording guardrail is reused from explanation's
 * reason-service (passesRecommendationGuardrail — generic PRD §10).
 *
 * Unlike the other Epic-2 modules, the digest + trend briefing are keyed by coverageDate
 * (not hotEventId) — they aggregate the day's eligible published events into one versioned
 * artifact. publish-orchestrator therefore has SIBLING functions refreshPublishedDailyDigest
 * + refreshPublishedTrendBriefing (not new branches in refreshPublishedReadModel) to
 * project the coverageDate-keyed read models.
 */

export {
  generateDailyDigest,
  getLatestDigest,
  noInvestAdvice,
  filterByCoverageDay,
} from "./digest-service.js";
export {
  generateTrendBriefing,
  getLatestTrendBriefing,
  validateTrendBriefing,
  TREND_BRIEFING_MAX_LENGTH,
} from "./trend-briefing-service.js";
export type {
  GenerateTrendBriefingOptions,
  GenerateTrendBriefingResult,
  TrendBriefingRecord,
} from "./trend-briefing-service.js";
export { StubDigestAdapter, STUB_DIGEST_CONCLUSION } from "./stub-digest-adapter.js";
export { DigestSource } from "./types.js";
export type {
  DigestSource as DigestSourceType,
  DigestConclusion,
  DailyDigestEntry,
  DigestAdapter,
  GenerateDailyDigestOptions,
  GenerateDailyDigestResult,
  GetLatestDigestOptions,
  DigestRecord,
} from "./types.js";
