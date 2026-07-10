/**
 * digest-service — derive a daily digest from an adapter's output and append a
 * daily_digests row (AD-2/AD-5 append-only).
 *
 * Story 2.4. This module owns the daily_digests table (AD-2 append-only). It
 * derives DailyDigestEntry[] for one coverageDate from:
 *   1. the day's eligible published events (latestEvidenceAt UTC day =
 *      coverageDate, JS-filtered from listPublishedHotEvents — same window
 *      filter pattern as 1.7/2.2/2.3);
 *   2. a DigestAdapter's per-event conclusions.
 *
 *   - generateDailyDigest: select eligible events → read adapter conclusions →
 *     validate each conclusion (non-empty, no advice keywords, hotEventId ∈
 *     eligible; throw on violation — AC2 fail-fast, never silently truncate) →
 *     assemble entries (sorted evidenceCount DESC for stable display) → APPEND
 *     one daily_digests row (never update/delete prior rows — AD-5). Returns
 *     null when coverageDate has no eligible published events, adapter is
 *     missing, returns null, or returns [] (no honest derivation possible;
 *     never writes a fabricated digest). source="template" in V1.
 *   - getLatestDigest: createdAt desc + id desc first row for a coverageDate,
 *     or null. publish-orchestrator reads this at projection time.
 *   - noInvestAdvice: pure function (text → bool), testable without a DB.
 *
 * This module never writes published_* (publish-orchestrator owns those
 * projections) and never writes hot_events (event-assembly owns those). It only
 * appends daily_digests.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed
 * scripts can call it directly without Redis — same convention as
 * generateThemes / generateMarketReaction / generateExplanation / clusterEvents.
 * The daily-digest worker calls this with adapter = undefined in V1 prod
 * (procurement deferred) → honest degradation.
 */

import type { Prisma } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import {
  listPublishedHotEvents,
} from "../publish-orchestrator/publish-service.js";
import type { PublishedHotEventSummary } from "../publish-orchestrator/types.js";
import { DigestSource } from "./types.js";
import type {
  DailyDigestEntry,
  DigestConclusion,
  DigestRecord,
  GenerateDailyDigestOptions,
  GenerateDailyDigestResult,
  GetLatestDigestOptions,
} from "./types.js";

/**
 * Generate a daily digest for the given coverageDate from the adapter's output,
 * then APPEND one daily_digests row (source="template"). Returns null and
 * writes nothing when:
 *   - the coverageDate has NO eligible published events (no event whose
 *     latestEvidenceAt UTC day = coverageDate) — never writes an empty digest, OR
 *   - adapter is undefined (V1 prod: daily-digest worker resolves none), OR
 *   - adapter.fetchConclusions returns null, OR
 *   - adapter.fetchConclusions returns an empty array.
 *
 * Honest degradation (NFR: never fake data): no eligible events / no adapter /
 * no data → no digest → the public /daily page shows the degraded state (AC3).
 * Never fabricates a digest from nothing.
 *
 * AC2 non-advisory + identity: every adapter-returned conclusion MUST be
 * non-empty AND free of investment-advice keywords AND its hotEventId MUST be a
 * member of the eligible set. A conclusion violating any of these is rejected —
 * generateDailyDigest THROWS (fail-fast). It never silently truncates/rewrites
 * a conclusion, because that would make the NFR "never advisory" decorative.
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are
 * never updated or deleted — the full digest history for a coverageDate is the
 * version series. publish-orchestrator projects the LATEST row (createdAt desc,
 * id desc tiebreaker) into the public read model.
 *
 * NFR: the conclusion describes the day's key event and NEVER contains
 * buy/sell/target-price/position wording (explanatory, not advisory).
 */
export async function generateDailyDigest(
  options: GenerateDailyDigestOptions,
): Promise<GenerateDailyDigestResult | null> {
  const { prisma, traceId, coverageDate, adapter } = options;

  // 1. Select eligible events: published hot events whose latestEvidenceAt UTC
  // day = coverageDate UTC day. JS filter on listPublishedHotEvents output
  // (same window-filter pattern as 1.7/2.2/2.3). listPublishedHotEvents stays
  // filter-free (no signature change).
  const allPublished = await listPublishedHotEvents({ prisma, traceId });
  const eligible = filterByCoverageDay(allPublished, coverageDate);

  // No eligible events → no digest (never fabricate an empty digest).
  if (eligible.length === 0) return null;

  // 2. No adapter → honest degradation (V1 prod: daily-digest worker resolves
  // none). Never fabricate.
  if (adapter === undefined) return null;

  const hotEventIds = eligible.map((e) => e.hotEventId);
  const rawConclusions = await adapter.fetchConclusions({
    coverageDate,
    hotEventIds,
  });
  if (rawConclusions === null) return null;
  if (rawConclusions.length === 0) return null;

  // 3. Build a hotEventId → PublishedHotEventSummary lookup for entry assembly
  // + eligible-membership validation.
  const eligibleById = new Map<string, PublishedHotEventSummary>();
  for (const e of eligible) {
    eligibleById.set(e.hotEventId, e);
  }

  // 4. Validate each conclusion (AC2 + NFR + eligible membership) and assemble
  // entries. Throw on any violation (fail-fast, never silently truncate).
  const entries = assembleEntries(rawConclusions, eligibleById);

  // If the adapter returned conclusions but none matched eligible events (all
  // filtered out as non-eligible), there is nothing to write → degrade. (The
  // throw in assembleEntries handles hotEventId ∉ eligible; this empty check is
  // a defensive belt for a zero-entry result after validation.)
  if (entries.length === 0) return null;

  // 5. APPEND a new digest row (source="template"). Never update or delete
  // prior rows (AD-5). The items Json column accepts the typed array via a cast
  // to Prisma.InputJsonValue (Prisma's Json envelope does not infer the element
  // type; the cast is the documented boundary between TS types and the Json
  // column — same role as in theme-service.ts / association-service.ts).
  const created = await prisma.dailyDigest.create({
    data: {
      id: newTraceId(),
      coverageDate,
      items: entries as unknown as Prisma.InputJsonValue,
      source: DigestSource.Template,
      traceId,
    },
    select: {
      id: true,
      coverageDate: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  return {
    dailyDigestId: created.id,
    coverageDate: created.coverageDate,
    entries: created.items as unknown as DailyDigestEntry[],
    source: created.source as DigestSource,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest daily_digests row for a coverageDate (createdAt desc, id
 * desc tiebreaker — UUIDv7 ids embed a monotonic timestamp so two digests
 * sharing the same createdAt millisecond resolve deterministically to the newer
 * one), or null if none exist. publish-orchestrator uses this at projection
 * time to surface the current digest into the public read model.
 */
export async function getLatestDigest(
  options: GetLatestDigestOptions,
): Promise<DigestRecord | null> {
  const { prisma, coverageDate } = options;

  const latest = await prisma.dailyDigest.findFirst({
    where: { coverageDate },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      coverageDate: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    coverageDate: latest.coverageDate,
    entries: latest.items as unknown as DailyDigestEntry[],
    source: latest.source as DigestSource,
    createdAt: latest.createdAt,
  };
}

// --- deterministic helpers ---------------------------------------------------

/**
 * The investment-advice keywords the digest conclusion must NEVER contain (NFR:
 * the product must not imply investment advice). The check is conservative —
 * these are the common buy/sell/target-price/position terms. A digest
 * conclusion is descriptive (the day's key event summary), never advisory.
 *
 * Mirrors the noInvestAdvice check used by verify-themes / verify-associations;
 * centralized here so generateDailyDigest enforces it at write time (AC2
 * fail-fast at the generator, not just at verify).
 */
const ADVICE_KEYWORDS = [
  "买入",
  "卖出",
  "目标价",
  "持仓",
  "增持",
  "减持",
  "建议买",
  "建议卖",
];

/**
 * Pure function: returns true iff the text is free of investment-advice
 * keywords. Same input → identical output (deterministic, testable without DB).
 */
export function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

/**
 * Filter the published hot events down to those whose latestEvidenceAt UTC day
 * matches the coverageDate UTC day. Pure function (same input → identical
 * output). Mirrors the 1.7 filterByWindow + 2.2/2.3 JS-filter pattern.
 *
 * "coverageDate UTC day" = the YYYY-MM-DD of coverageDate interpreted as UTC.
 * "latestEvidenceAt UTC day" = the YYYY-MM-DD of the event's latestEvidenceAt
 * (stored UTC). A match means the event's most recent evidence falls on the
 * coverage day — the day-scoping rule for "this event was hot on this day".
 */
export function filterByCoverageDay(
  events: PublishedHotEventSummary[],
  coverageDate: Date,
): PublishedHotEventSummary[] {
  const covY = coverageDate.getUTCFullYear();
  const covM = coverageDate.getUTCMonth();
  const covD = coverageDate.getUTCDate();
  return events.filter((e) => {
    const t = e.latestEvidenceAt;
    return (
      t.getUTCFullYear() === covY &&
      t.getUTCMonth() === covM &&
      t.getUTCDate() === covD
    );
  });
}

/**
 * Validate each adapter conclusion (AC2 + NFR + eligible membership) and
 * assemble DailyDigestEntry[]. Throw on any violation (fail-fast). The entries
 * are sorted by evidenceCount DESC (strongest signal first) with a hotEventId
 * DESC tiebreaker for stable display order across re-generations.
 *
 * Pure function (same input → identical output), testable without DB.
 */
function assembleEntries(
  conclusions: DigestConclusion[],
  eligibleById: Map<string, PublishedHotEventSummary>,
): DailyDigestEntry[] {
  const entries: DailyDigestEntry[] = [];
  for (const c of conclusions) {
    // AC2: conclusion must be non-empty.
    if (c.conclusion === undefined || c.conclusion === null || c.conclusion.trim() === "") {
      throw new Error(
        `[digest] adapter returned a conclusion that is empty (hotEventId=${c.hotEventId}); AC2 requires a non-empty conclusion on every entry`,
      );
    }
    // NFR: conclusion must be free of investment-advice keywords.
    if (!noInvestAdvice(c.conclusion)) {
      throw new Error(
        `[digest] adapter returned a conclusion containing investment-advice keywords (hotEventId=${c.hotEventId}); NFR forbids buy/sell/target-price/position wording in digest conclusions`,
      );
    }
    // AC2: hotEventId must be a member of the eligible set (published +
    // latestEvidenceAt UTC day = coverageDate). A conclusion for a non-eligible
    // event is rejected — never silently dropped (the adapter contract is to
    // return conclusions ONLY for the passed eligible hotEventIds).
    const summary = eligibleById.get(c.hotEventId);
    if (summary === undefined) {
      throw new Error(
        `[digest] adapter returned a conclusion for hotEventId=${c.hotEventId} which is not in the eligible set (published + latestEvidenceAt UTC day = coverageDate); AC2 requires conclusions only for eligible events`,
      );
    }
    const iso = summary.latestEvidenceAt.toISOString();
    entries.push({
      hotEventId: summary.hotEventId,
      title: summary.title,
      conclusion: c.conclusion,
      latestEvidenceAt: iso,
      evidenceCount: summary.evidenceCount,
    });
  }
  // Sort by evidenceCount DESC (strongest signal first), tiebreaker hotEventId
  // DESC for deterministic stable order across re-generations.
  entries.sort((a, b) => {
    const byCount = b.evidenceCount - a.evidenceCount;
    if (byCount !== 0) return byCount;
    return a.hotEventId < b.hotEventId ? 1 : a.hotEventId > b.hotEventId ? -1 : 0;
  });
  return entries;
}
