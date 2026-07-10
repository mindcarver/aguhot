/**
 * digest module barrel — Story 2.4 (daily digest generation + reading).
 *
 * Owns the daily_digests table (AD-2 append-only, one row per generation,
 * coverageDate-keyed). Exposes the digest generator, the latest-digest read
 * query, the DigestAdapter port, and the test-only stub. The Prisma client
 * lives one level up and is re-exported from the package barrel.
 *
 * This module never writes published_* (publish-orchestrator owns the public
 * projection published_daily_digests) or hot_events (event-assembly owns those).
 * It only appends daily_digests; publish-orchestrator reads the latest at
 * projection time and writes the public read model.
 *
 * Story 2.4 adds a daily-digest worker (epic lists daily digest as a job
 * category). The worker resolves adapter = undefined (procurement deferred) so
 * generateDailyDigest returns null and prod degrades honestly. The worker does
 * NOT import StubDigestAdapter; verify/e2e pass it to generateDailyDigest
 * directly.
 *
 * Unlike the other Epic-2 modules, the digest is keyed by coverageDate (not
 * hotEventId) — it aggregates the day's eligible published events into one
 * versioned artifact. publish-orchestrator therefore has a SIBLING function
 * refreshPublishedDailyDigest (not a new branch in refreshPublishedReadModel)
 * to project the coverageDate-keyed read model.
 */

export {
  generateDailyDigest,
  getLatestDigest,
  noInvestAdvice,
  filterByCoverageDay,
} from "./digest-service.js";
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
