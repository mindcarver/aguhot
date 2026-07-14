/**
 * digest domain types — Story 2.4.
 *
 * The digest module owns daily_digests (AD-2 append-only write table, one row
 * per generation, keyed by coverageDate NOT hotEventId). It derives a
 * DailyDigestEntry[] (one per published hot event whose latestEvidenceAt UTC day
 * = coverageDate) from a DigestAdapter's output — each entry carries the
 * event's identity (hotEventId, title), a NON-EMPTY conclusion (the day's brief
 * per-event summary, derived from the adapter), and evidence metadata
 * (latestEvidenceAt, evidenceCount). The public read model is owned by
 * publish-orchestrator (published_daily_digests).
 *
 * V1 has NO real digest LLM/summarizer provider (procurement deferred). The
 * daily-digest worker (epic lists daily digest as one of three Epic-2 BullMQ
 * job categories: market-signal 2-1 / theme-backfill 2-3 / daily-digest 2-4)
 * resolves adapter = undefined → generateDailyDigest returns null → prod
 * degrades honestly (AC3). StubDigestAdapter is test-only (verify/e2e call
 * generateDailyDigest directly with it to exercise the happy path). apps/worker
 * does NOT import the stub.
 *
 * NFR: digest conclusions are explanatory, never advisory. A conclusion
 * describes the day's key event and NEVER contains buy/sell/target-price/
 * position wording. generateDailyDigest validates each conclusion via
 * noInvestAdvice (throws on a keyword hit, AC2 fail-fast — never silently
 * truncates/rewrites).
 *
 * `items` is a variable-cardinality, display-only set that is always read whole
 * (/daily renders all entries as clickable rows). It is stored as a Prisma Json
 * column holding DailyDigestEntry[] rather than a normalized child table
 * (ponytail: no child table for a consumerless per-entry SQL query — mirrors
 * the 2.2/2.3 items-Json decision). The digest has NO FK to hot_events —
 * hotEventId in each entry is a data-only foreign-key-style link (epic:
 * "cross-page navigation is not a module").
 */

import type { PrismaClient } from "../../../generated/client.js";
import type { PublishedHotEventSummary } from "../publish-orchestrator/types.js";

/**
 * The provenance of a daily digest. Stored on every daily_digests row. The
 * public read model carries this through as `source`.
 *
 *   - template: V1 deterministic fixture-backed derivation
 *     (StubDigestAdapter, test-only). When a real LLM summarizer/provider lands,
 *     source becomes the provider id (e.g. "openai:v1").
 *
 * V1 worker resolves NO adapter (real digest LLM/summarizer provider
 * procurement is deferred), so no row with source="template" is ever written in
 * prod by the worker — only by verify/e2e direct calls. The worker exists (epic
 * lists daily-digest as a job category) but its adapter resolves to undefined →
 * generateDailyDigest returns null → honest degradation.
 */
export const DigestSource = {
  Template: "template",
} as const;

export type DigestSource = (typeof DigestSource)[keyof typeof DigestSource];

/**
 * One unit of adapter output — the brief conclusion for one hot event in the
 * day's digest. The adapter resolves the event's relevant summary and returns
 * it with a NON-EMPTY conclusion. generateDailyDigest validates each conclusion
 * is non-empty + free of investment-advice keywords (AC2, throws on violation).
 *
 *   - hotEventId: the event this conclusion pertains to. MUST be a member of
 *     the eligible (published, latestEvidenceAt UTC day = coverageDate) set.
 *     generateDailyDigest rejects conclusions for hotEventIds outside the
 *     eligible set (AC2 fail-fast).
 *   - conclusion: NON-EMPTY brief summary. Descriptive, never advisory.
 */
export interface DigestConclusion {
  hotEventId: string;
  conclusion: string;
  /**
   * LLM-assigned editorial category for the daily-report section grouping
   * (政策动态/行业景气/公司·标的/海外映射/资金面/风险提示/其它). Optional — stub/
   * reasons-backed adapters omit it and the service falls back to "其它". When
   * present, the /daily page groups entries under this category heading.
   */
  category?: string;
}

/**
 * The DigestAdapter port (AD-7). All digest knowledge sources (LLM summarizers,
 * extractive summarization providers) enter exclusively through this interface;
 * domain modules never import a third-party SDK. V1 has no concrete
 * implementation wired in prod (procurement deferred) — the daily-digest worker
 * resolves `adapter = undefined` so generateDailyDigest returns null and prod
 * degrades honestly (AC3). verify/e2e pass StubDigestAdapter directly to
 * generateDailyDigest. The only concrete implementation today is
 * StubDigestAdapter (test-only).
 *
 * Defined in digest-adapter.ts and re-exported here for the package barrel.
 */
export interface DigestAdapter {
  /**
   * Fetch the per-event brief conclusions for the given coverage date.
   * Implementations resolve each eligible hot event's relevant summary and
   * return them with a NON-EMPTY conclusion on each item (AC2). Return null or
   * an empty array when no conclusions are available (the caller writes nothing
   * and degrades honestly). Each returned item MUST have a non-empty conclusion
   * free of investment-advice keywords — items with empty/advisory conclusions
   * are rejected by generateDailyDigest (it throws, never silently truncates).
   *
   * The adapter receives the full eligible hotEventId list so it can produce a
   * conclusion per event (V1 stub returns one fixed conclusion for every
   * passed id; a real LLM would summarize each event's evidence).
   */
  fetchConclusions(args: {
    coverageDate: Date;
    hotEventIds: string[];
  }): Promise<DigestConclusion[] | null>;
}

/**
 * One daily-digest entry — the display-only projection the /daily page renders
 * as one clickable row per event. Each entry carries:
 *
 *   - hotEventId: data-only foreign-key-style link to /events/{hotEventId}
 *     (FR10 daily→detail jump). Not a DB FK — the digest is coverageDate-keyed.
 *   - title: the event's title at digest generation time (carried from the
 *     eligible published summary). Descriptive, never advisory.
 *   - conclusion: NON-EMPTY brief summary (from the adapter). AC2: descriptive,
 *     never advisory (no buy/sell/target-price/position).
 *   - latestEvidenceAt: ISO 8601 string of the event's most recent evidence
 *     time (carried from the eligible published summary for display).
 *   - evidenceCount: number of supporting evidence records (multi-source signal
 *     for display).
 *
 * Entries are sorted by evidenceCount DESC at generation time so the /daily
 * page renders the strongest-signal events first (stable order, deterministic).
 */
export interface DailyDigestEntry {
  hotEventId: string;
  title: string;
  conclusion: string;
  latestEvidenceAt: string; // ISO 8601
  evidenceCount: number;
  /**
   * Editorial category (LLM-assigned at digest generation). The /daily page
   * groups entries under category headings (政策动态/行业景气/...). "其它" when the
   * adapter did not assign one.
   */
  category: string;
  /**
   * The event's primary evidence source name (the most-recent member record's
   * source), for the daily-report 信源 attribution row. Carried from evidence at
   * digest generation so the /daily page needs no per-entry source query.
   */
  sourceName: string;
}

/**
 * Options for generateDailyDigest. `{ prisma, traceId, coverageDate, adapter? }`
 * mirrors the established command pattern (generateThemes,
 * generateMarketReaction) plus an optional adapter, but keyed by coverageDate
 * (the day the digest covers) rather than hotEventId (the digest aggregates
 * multiple events). When adapter is omitted, returns null, or returns null/[],
 * the function returns null and writes nothing (honest degradation — never
 * fabricates a digest from no data). Otherwise it selects the day's eligible
 * (published + latestEvidenceAt UTC day = coverageDate) events, validates each
 * adapter conclusion (non-empty + no advice keywords + hotEventId ∈ eligible),
 * and APPENDS one daily_digests row (source="template").
 */
export interface GenerateDailyDigestOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
  adapter?: DigestAdapter;
}

/**
 * The result of a successful generation: the newly-appended digest's id + the
 * coverageDate + the entries + provenance + createdAt. Callers
 * (publish-orchestrator projection, verify/seed) consume the entries directly.
 */
export interface GenerateDailyDigestResult {
  dailyDigestId: string;
  coverageDate: Date;
  entries: DailyDigestEntry[];
  source: DigestSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestDigest — returns the most recent daily_digests row for a
 * coverageDate (createdAt desc, id desc tiebreaker) or null if none exist.
 * publish-orchestrator uses this at projection time.
 */
export interface GetLatestDigestOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
}

/**
 * One daily-digest row projected for read. Mirrors the daily_digests columns
 * the public projection + operator audit need (no write paths here).
 */
export interface DigestRecord {
  id: string;
  coverageDate: Date;
  entries: DailyDigestEntry[];
  source: DigestSource;
  createdAt: Date;
}

/**
 * Re-export so digest-service can import the eligible-event summary type from
 * one place. The digest's eligible set = published hot events whose
 * latestEvidenceAt UTC day = coverageDate (JS filter on
 * listPublishedHotEvents output, same window-filter pattern as 1.7/2.2/2.3).
 */
export type { PublishedHotEventSummary };
