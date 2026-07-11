/**
 * trend-briefing-service — generate the single-paragraph cross-event AI 趋势研判 (trend
 * briefing) for a coverageDate's daily digest page from an LLMAdapter's output and append
 * a trend_briefings row (AD-5 append-only).
 *
 * Story 5.3. This module owns the trend_briefings table (AD-2 append-only, coverageDate-
 * keyed — mirrors DailyDigest's ownership shape). It derives one trend briefing for a
 * coverageDate from:
 *   1. the day's eligible published hot events (latestEvidenceAt UTC day = coverageDate,
 *      JS-filtered from listPublishedHotEvents — same window-filter pattern as
 *      generateDailyDigest);
 *   2. an LLMAdapter's trend-briefing output (single paragraph + its provenance).
 *
 *   - generateTrendBriefing: select eligible events (empty → null) → no adapter → null
 *     (V1 prod: daily-digest worker resolves none) → load each event's title + summary
 *     (latest revision + latest ExplanationVersion overlay, same overlay rule as
 *     deep-read) → bound to top 12 by evidenceCount desc (bound prompt) → call adapter →
 *     validate (non-empty, ≤ TREND_BRIEFING_MAX_LENGTH (200 字),
 *     passesRecommendationGuardrail; throw on violation — fail-fast, never silently
 *     truncate) → APPEND one trend_briefings row (source="ai", basedOnHotEventIds =
 *     day's event ids as data-only Json link). Returns null when the adapter is missing,
 *     the coverageDate has no eligible events, or the adapter returns null.
 *
 * This module NEVER writes published_trend_briefings (publish-orchestrator owns that
 * projection — the sole writer of it, AD-2/AD-3). It only appends trend_briefings;
 * publish-orchestrator reads the latest at projection time (refreshPublishedTrendBriefing
 * derives the projection from the latest row). The worker triggers that projection by
 * calling refreshPublishedTrendBriefing after a successful append (mirrors the daily-
 * digest worker calling refreshPublishedDailyDigest after generateDailyDigest).
 *
 * The 6-class wording guardrail (passesRecommendationGuardrail) is REUSED from 5.1's
 * reason-service unchanged. The constant is named "recommendation..." but carries the
 * generic PRD §10 six classes (the epic AC applies to ALL AI content, not just card
 * reasons). 5.2 deep-read already reuses it per-segment; 5.3 reuses it for the single
 * briefing paragraph.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed scripts
 * can call it directly without Redis — same convention as generateDailyDigest /
 * generateDeepRead / generateRecommendationReason. The daily-digest worker calls this with
 * adapter = undefined in V1 prod (procurement deferred) → honest degradation.
 *
 * NFR-2/NFR-3/NFR-7: every appended row carries source="ai" + modelId + promptVersion +
 * createdAt + basedOnHotEventIds for audit + version tracing. The 6-class wording
 * guardrail is enforced at write time on the briefing so a forbidden phrase can never
 * reach the /daily page.
 *
 * NO FK to hot_events (digest-module invariant: "no FK, data-only link"). basedOnHotEventIds
 * is a data-only Json string[] — the physical form of the epic's `TREND_BRIEFING }o--o{
 * HOT_EVENT : based_on` LOGICAL relation (same shape as DailyDigest.items).
 */

import type { Prisma, PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { passesRecommendationGuardrail } from "../explanation/reason-service.js";
import { ExplanationSource } from "../explanation/types.js";
import type { LLMAdapter, LlmTrendBriefingResult } from "../explanation/types.js";
import {
  listPublishedHotEvents,
} from "../publish-orchestrator/publish-service.js";
import type { PublishedHotEventSummary } from "../publish-orchestrator/types.js";
import { filterByCoverageDay } from "./digest-service.js";

/**
 * The max length of the trend briefing paragraph in codepoints (字). PRD SM-C3 says
 * "研判有上限" without giving a number; 200 字 is the story-time default (a one-line edit
 * to adjust). Checked at write time so an over-length adapter output can never reach the
 * /daily page. Mirrors 5.1's RECOMMENDATION_REASON_MAX_LENGTH (40 字) and 5.2's
 * DEEP_READ_SEGMENT_MAX_LENGTH (120 字 per segment) precedents.
 */
export const TREND_BRIEFING_MAX_LENGTH = 200;

/**
 * The bound on how many day-events are passed to the adapter as grounding context.
 * Without a bound, a heavy-evidence day could overflow a real provider's prompt context.
 * Top 12 by evidenceCount desc (strongest-signal first) mirrors the daily-digest
 * evidenceCount-desc ordering precedent and is a generous cap (the /daily page itself
 * renders all entries; this bound only shapes the adapter's grounding context, not the
 * page). A one-line edit to adjust.
 */
const TREND_BRIEFING_MAX_EVENTS = 12;

/**
 * Options for generateTrendBriefing. `{ prisma, traceId, coverageDate, adapter? }` mirrors
 * generateDailyDigest's command pattern (coverageDate-keyed) plus an optional LLMAdapter.
 * When adapter is omitted (or the coverageDate has no eligible published events), the
 * function returns null and writes nothing (honest degradation — never fabricates a
 * briefing). Otherwise it loads the day's events, calls the adapter, validates the result
 * (non-empty, ≤200 字, passesRecommendationGuardrail; modelId + promptVersion non-empty),
 * and APPENDS one trend_briefings row (source="ai").
 */
export interface GenerateTrendBriefingOptions {
  prisma: PrismaClient;
  traceId: string;
  coverageDate: Date;
  adapter?: LLMAdapter;
}

/**
 * The result of a successful generation: the newly-appended briefing row's id + the
 * coverageDate + the briefing text + provenance + createdAt. Callers (the worker's
 * projection refresh, verify/seed) consume the briefing directly.
 */
export interface GenerateTrendBriefingResult {
  trendBriefingId: string;
  coverageDate: Date;
  briefing: string;
  basedOnHotEventIds: string[];
  source: string;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
  traceId: string;
}

/**
 * Generate the single-paragraph AI 趋势研判 for a coverageDate from the adapter's output,
 * then APPEND one trend_briefings row (source="ai"). Returns null and writes nothing when:
 *   - the coverageDate has NO eligible published events (no event whose
 *     latestEvidenceAt UTC day = coverageDate) — never writes an empty-context briefing, OR
 *   - adapter is undefined (V1 prod: daily-digest worker resolves none).
 *
 * Honest degradation (NFR: never fake data): no eligible events / no adapter → no briefing
 * → the public /daily page shows the degraded state (AC3). Never fabricates a briefing
 * from nothing.
 *
 * Fail-fast validation: every adapter-returned briefing MUST be non-empty AND ≤200 字 AND
 * free of the six forbidden phrase classes. A briefing violating any of these is rejected
 * — generateTrendBriefing THROWS (the worker's try/catch isolates it so that coverageDate
 * stays at null without aborting the whole daily-digest job). It never silently
 * truncates/rewrites a briefing, because that would make the NFR "never advisory / never
 * over-certain" decorative.
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are never
 * updated or deleted — the full briefing history for a coverageDate is the version series.
 * publish-orchestrator projects the LATEST row (createdAt desc, id desc tiebreaker) into
 * published_trend_briefings.
 */
export async function generateTrendBriefing(
  options: GenerateTrendBriefingOptions,
): Promise<GenerateTrendBriefingResult | null> {
  const { prisma, traceId, coverageDate, adapter } = options;

  // 1. No adapter → honest degradation (V1 prod: daily-digest worker resolves none).
  // Checked FIRST (mirrors generateDeepRead) so an adapter-less prod never hits the DB to
  // load day-events. Never fabricate.
  if (adapter === undefined) return null;

  // 2. Select eligible events: published hot events whose latestEvidenceAt UTC day =
  // coverageDate UTC day. JS filter on listPublishedHotEvents output (same window-filter
  // pattern as generateDailyDigest). listPublishedHotEvents stays filter-free.
  const allPublished = await listPublishedHotEvents({ prisma, traceId });
  const eligible = filterByCoverageDay(allPublished, coverageDate);

  // No eligible events → no briefing (never fabricate a contextless cross-event briefing).
  if (eligible.length === 0) return null;

  // 3. Bound the adapter grounding context to top TREND_BRIEFING_MAX_EVENTS by
  // evidenceCount desc (strongest-signal first), mirroring the daily-digest evidenceCount-
  // desc ordering precedent. Then load each event's title + summary (latest revision +
  // latest ExplanationVersion overlay — same overlay rule deep-read uses). The adapter
  // receives title + summary per event so the briefing is grounded in the evidence
  // timeline (NFR-2).
  const topEligible = rankAndBound(eligible, TREND_BRIEFING_MAX_EVENTS);
  const eventsForAdapter = await loadEventContext(prisma, topEligible);

  // 4. Call the adapter with the coverageDate + the day's event context.
  const raw = await adapter.generateTrendBriefing({
    coverageDate,
    events: eventsForAdapter,
  });
  if (raw === null) return null;

  // 5. Validate + normalize the briefing (non-empty, ≤200 字, guardrail). Throw on any
  // violation (fail-fast, never silently truncate). The worker's try/catch isolates the
  // throw so one bad briefing stays at null without aborting the whole daily-digest job.
  // validateTrendBriefing returns the TRIMMED briefing so the stored row (and the
  // projected text) never carries leading/trailing whitespace.
  const briefing = validateTrendBriefing(raw);

  // basedOnHotEventIds is the data-only link to the day's events (NO FK — digest-module
  // invariant). Carries the FULL eligible set (not just the top-N bounded adapter input)
  // so the audit records every event the briefing was derived from, even if the adapter
  // only saw the top-N strongest signals.
  const basedOnHotEventIds = eligible.map((e) => e.hotEventId);

  // 6. APPEND a new trend_briefings row (source="ai"). Never update or delete prior rows
  // (AD-5). modelId + promptVersion are carried verbatim from the adapter so the audit
  // chain records which provider + prompt produced each row (NFR-7). basedOnHotEventIds
  // is stored as a Json string[] via a cast to Prisma.InputJsonValue (Prisma's Json
  // envelope does not infer the element type; the cast is the documented boundary — same
  // role as in digest-service.ts / theme-service.ts).
  const created = await prisma.trendBriefing.create({
    data: {
      id: newTraceId(),
      coverageDate,
      briefing,
      basedOnHotEventIds:
        basedOnHotEventIds as unknown as Prisma.InputJsonValue,
      source: ExplanationSource.Ai,
      modelId: raw.modelId,
      promptVersion: raw.promptVersion,
      traceId,
    },
    select: {
      id: true,
      coverageDate: true,
      briefing: true,
      basedOnHotEventIds: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  return {
    trendBriefingId: created.id,
    coverageDate: created.coverageDate,
    briefing: created.briefing,
    basedOnHotEventIds: created.basedOnHotEventIds as unknown as string[],
    source: created.source,
    modelId: created.modelId,
    promptVersion: created.promptVersion,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest trend_briefings row for a coverageDate (createdAt desc, id desc
 * tiebreaker — UUIDv7 ids embed a monotonic timestamp so two briefings sharing the same
 * createdAt millisecond resolve deterministically to the newer one), or null if none exist.
 * publish-orchestrator's trend-briefing projection (refreshPublishedTrendBriefing) reads
 * the latest at projection time; this read helper is exposed for verify/seed + operator
 * audit.
 */
export interface TrendBriefingRecord {
  id: string;
  coverageDate: Date;
  briefing: string;
  basedOnHotEventIds: string[];
  source: string;
  modelId: string;
  promptVersion: string;
  createdAt: Date;
}

export async function getLatestTrendBriefing(
  options: {
    prisma: PrismaClient;
    traceId: string;
    coverageDate: Date;
  },
): Promise<TrendBriefingRecord | null> {
  const { prisma, coverageDate } = options;

  const latest = await prisma.trendBriefing.findFirst({
    where: { coverageDate },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      coverageDate: true,
      briefing: true,
      basedOnHotEventIds: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    coverageDate: latest.coverageDate,
    briefing: latest.briefing,
    basedOnHotEventIds: latest.basedOnHotEventIds as unknown as string[],
    source: latest.source,
    modelId: latest.modelId,
    promptVersion: latest.promptVersion,
    createdAt: latest.createdAt,
  };
}

// --- deterministic helpers ----------------------------------------------------

/**
 * Rank the eligible events by evidenceCount DESC (strongest signal first) with a
 * hotEventId DESC tiebreaker for stable ordering, then take the top N. Mirrors the daily-
 * digest assembleEntries sort. Pure function (same input → identical output).
 */
function rankAndBound(
  events: PublishedHotEventSummary[],
  limit: number,
): PublishedHotEventSummary[] {
  const ranked = [...events].sort((a, b) => {
    const byCount = b.evidenceCount - a.evidenceCount;
    if (byCount !== 0) return byCount;
    return a.hotEventId < b.hotEventId ? 1 : a.hotEventId > b.hotEventId ? -1 : 0;
  });
  return ranked.slice(0, limit);
}

/**
 * Load each event's title + summary (latest revision title overlay + latest
 * ExplanationVersion summary overlay — same overlay rule deep-read uses). Returns one
 * entry per event in the same order. Events missing a revision fall back to the baseline
 * HotEvent.title; events missing an ExplanationVersion fall back to "" (empty summary).
 *
 * One prisma.findUnique per event (V1 scale is tiny — the day's eligible set is small and
 * bounded by TREND_BRIEFING_MAX_EVENTS). A future batched read is a one-line change if
 * scale demands it.
 */
async function loadEventContext(
  prisma: PrismaClient,
  events: PublishedHotEventSummary[],
): Promise<{ hotEventId: string; title: string; summary: string }[]> {
  const out: { hotEventId: string; title: string; summary: string }[] = [];
  for (const e of events) {
    const event = await prisma.hotEvent.findUnique({
      where: { id: e.hotEventId },
      select: {
        id: true,
        title: true,
        revisions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { title: true },
        },
        explanationVersions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { summary: true },
        },
      },
    });
    // A published event should always exist (it has a published_hot_events row); guard
    // anyway so a takedown race never crashes the briefing generation.
    if (event === null) {
      out.push({ hotEventId: e.hotEventId, title: e.title, summary: "" });
      continue;
    }
    const latestRevision = event.revisions[0] ?? null;
    const effectiveTitle =
      latestRevision !== null ? latestRevision.title : event.title;
    const latestExplanation = event.explanationVersions[0] ?? null;
    const effectiveSummary =
      latestExplanation !== null ? latestExplanation.summary : "";
    out.push({
      hotEventId: event.id,
      title: effectiveTitle,
      summary: effectiveSummary,
    });
  }
  return out;
}

/**
 * Validate + normalize an adapter-returned trend briefing: non-empty, ≤
 * TREND_BRIEFING_MAX_LENGTH (200 字), and passes the 6-class wording guardrail. Throw on
 * any violation (fail-fast). Returns the TRIMMED briefing so the caller stores the
 * normalized value. Pure function (same input → identical result/throw), testable without
 * DB.
 *
 * Length is measured in Unicode CODEPOINTS (`[...s].length`) — the right unit for the CJK
 * "字" contract — NOT UTF-16 code units (`s.length`), which double-count surrogate pairs
 * (emoji etc.) and would drift the cap. Whitespace is trimmed once up front so it neither
 * counts toward the cap nor reaches the /daily page. Mirrors 5.1 validateReason's + 5.2
 * validateSegment's trim + codepoint approach, applied to the single briefing paragraph.
 *
 * The 6-class guardrail (passesRecommendationGuardrail) is REUSED from reason-service —
 * the constant is named "recommendation..." but carries the generic PRD §10 six classes
 * (epic AC applies to all AI content). 5.2 deep-read reuses it per-segment; 5.3 reuses it
 * for the briefing paragraph.
 */
export function validateTrendBriefing(result: LlmTrendBriefingResult): string {
  // Provenance must be present (NFR-7 audit). modelId + promptVersion are the version-
  // tracing pair; an empty value would break the audit chain. Checked here so a throw
  // lands in the same fail-fast path as the briefing checks (a throw on provenance never
  // reaches the create() call).
  if (result.modelId.trim() === "" || result.promptVersion.trim() === "") {
    throw new Error(
      "[trend-briefing] adapter returned an empty modelId or promptVersion; NFR-7 requires both for audit tracing",
    );
  }
  // Non-empty (guard against a non-string slipping through the type boundary).
  if (
    typeof result.briefing !== "string" ||
    result.briefing.trim() === ""
  ) {
    throw new Error(
      "[trend-briefing] adapter returned an empty briefing; AC requires a non-empty ≤200 字 briefing",
    );
  }
  const trimmed = result.briefing.trim();
  // ≤200 字 (codepoints — the right measure for CJK 字).
  const codepoints = [...trimmed].length;
  if (codepoints > TREND_BRIEFING_MAX_LENGTH) {
    throw new Error(
      `[trend-briefing] adapter returned a briefing of ${codepoints} 字 (> ${TREND_BRIEFING_MAX_LENGTH}); AC requires ≤${TREND_BRIEFING_MAX_LENGTH} 字`,
    );
  }
  // 6-class wording guardrail (PRD §10), evaluated on the trimmed value. Reuses the
  // generic guardrail from reason-service (the name says "recommendation" but the six
  // classes are generic — epic AC applies to all AI content).
  if (!passesRecommendationGuardrail(trimmed)) {
    throw new Error(
      "[trend-briefing] adapter returned a briefing containing a forbidden phrase (action / return-prediction / manipulation-frame / recommendation-strength / timing-advice / over-certainty); PRD §10 forbids these",
    );
  }
  return trimmed;
}
