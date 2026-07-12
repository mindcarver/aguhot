/**
 * reason-service — generate the ≤40 字 AI 解读 (recommendation reason) for a
 * HotEvent from an LLMAdapter's output and append a recommendation_reasons row
 * (AD-5 append-only).
 *
 * Story 5.1. This module owns the recommendation_reasons table (AD-2/AD-5
 * append-only). It derives a one-line reason for one hot event from:
 *   1. the event's title + summary (the same context the timeline card renders);
 *   2. an LLMAdapter's output (a one-line reason + its provenance).
 *
 *   - generateRecommendationReason: load HotEvent (missing → null) → read
 *     adapter reason → validate (non-empty, ≤40 字, passesRecommendationGuardrail;
 *     throw on violation — fail-fast, never silently truncate) → APPEND one
 *     recommendation_reasons row (source="ai"). Returns null when the adapter is
 *     missing (V1 prod: recommendation-reason worker resolves none), the event is
 *     missing, or the event has no member evidence (no honest derivation; never
 *     writes a fabricated reason).
 *
 * This module NEVER writes published_timeline_entries (publish-orchestrator owns
 * that projection — the sole writer of its recommendation_reason column, AD-2/
 * AD-3b). It only appends recommendation_reasons; publish-orchestrator reads the
 * latest at projection time (projectTimelineFields derives the column from the
 * latest row). The worker triggers that projection by calling the existing
 * refreshPublishedTimelineForEvent after a successful append.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed
 * scripts can call it directly without Redis — same convention as
 * generateExplanation / generateDailyDigest. The recommendation-reason worker
 * calls this with adapter = undefined in V1 prod (procurement deferred) → honest
 * degradation.
 *
 * NFR-3/NFR-7/SM-7: every appended row carries source="ai" + modelId +
 * promptVersion + createdAt for audit + version tracing. The 6-class wording
 * guardrail (passesRecommendationGuardrail) is enforced at write time so a
 * forbidden phrase can never reach the card surface.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { ExplanationSource } from "./types.js";
import type {
  GenerateRecommendationReasonOptions,
  GenerateRecommendationReasonResult,
  LlmReasonResult,
  RecommendationReasonRecord,
} from "./types.js";

/**
 * The max reason length in codepoints (字). PRD §10 + epic-5-context cap the
 * card-surface AI 解读 at one line ≤40 字. Checked at write time so an
 * over-length adapter output can never reach the card.
 */
export const RECOMMENDATION_REASON_MAX_LENGTH = 40;

/**
 * The six forbidden phrase classes for AI 解读 (PRD §10). Carried as a
 * POSITIVELY-ENUMERABLE constant (not a free-text rule) so the guardrail is a
 * simple substring check — fail-fast at write time, no fuzzy matching, no
 * silent rewrite. A hit on ANY phrase in ANY class rejects the reason (throws
 * at the generator; the worker's per-event try/catch isolates it so that one
 * event stays at null without aborting the batch).
 *
 * The six classes (mirrors epic-5-context 措辞黑名单 + spec Design Notes):
 *   - ACTION (动作类):        buy/sell/position-sizing verbs.
 *   - RETURN_PREDICTION (收益预测类): guaranteed-direction / multiplier claims.
 *   - MANIPULATION_FRAME (操纵框架类): "main force / dealer / washing / shipping"
 *     framing that implies an unseen actor controlling price.
 *   - RECOMMENDATION_STRENGTH (推荐强度类): strong-recommend / first-pick / must-buy.
 *   - TIMING_ADVICE (时点建议类): pick-the-bottom / escape-the-top / target-price /
 *     stop-loss — actionable entry/exit/level cues.
 *   - OVER_CERTAINTY (过度确定类): "will definitely / certain / inevitable".
 *
 * The list is conservative (common terms in each class). A real provider may
 * emit synonyms outside this list; the guardrail is the LAST line of defense,
 * not the only one — prompt engineering + operator review (SM-6) carry the
 * larger share. Extending this list is a one-line edit when new forbidden terms
 * surface in review.
 */
export const RECOMMENDATION_FORBIDDEN_PHRASES = {
  ACTION: [
    "买入",
    "卖出",
    "建仓",
    "加仓",
    "减仓",
    "清仓",
    "持仓",
    "增持",
    "减持",
    "建议买",
    "建议卖",
  ],
  RETURN_PREDICTION: [
    "必涨",
    "必跌",
    "翻倍",
    "翻番",
    "暴涨",
    "暴跌",
    "涨停",
    "跌停",
    "大涨",
    "大跌",
  ],
  MANIPULATION_FRAME: [
    "主力",
    "庄家",
    "洗盘",
    "拉升",
    "出货",
    "诱多",
  ],
  RECOMMENDATION_STRENGTH: [
    "强烈推荐",
    "首推",
    "首选",
    "必买",
  ],
  TIMING_ADVICE: [
    "抄底",
    "逃顶",
    "目标价",
    "止损位",
  ],
  OVER_CERTAINTY: [
    "必将",
    "一定",
    "必然",
    "肯定",
  ],
} as const;

/**
 * The flattened list of every forbidden phrase across all six classes. Used by
 * passesRecommendationGuardrail's substring check. Computed once at module load
 * (the constant above is frozen, so the flatten is stable).
 */
const ALL_FORBIDDEN_PHRASES: readonly string[] = Object.values(
  RECOMMENDATION_FORBIDDEN_PHRASES,
).flat();

/**
 * Pure function: returns true iff the text is free of every forbidden phrase
 * across all six classes (PRD §10). Same input → identical output (deterministic,
 * testable without DB). Mirrors digest-service's noInvestAdvice shape — the
 * guardrail is a positively-enumerable substring check, fail-fast at write time.
 *
 * `text.includes(phrase)` is the right check for CJK: a forbidden phrase like
 * "买入" appearing anywhere in the reason (even as a substring of a longer
 * token) is still a forbidden phrase. There is no word-boundary concept for CJK;
 * substring is both necessary and sufficient.
 */
export function passesRecommendationGuardrail(text: string): boolean {
  return !ALL_FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * Generate the ≤40 字 AI 解读 for a HotEvent from the adapter's output, then
 * APPEND one recommendation_reasons row (source="ai"). Returns null and writes
 * nothing when:
 *   - adapter is undefined (V1 prod: recommendation-reason worker resolves
 *     none), OR
 *   - the HotEvent does not exist, OR
 *   - the HotEvent has no member evidence (no honest derivation; never a
 *     fabricated reason).
 *
 * Honest degradation (NFR: never fake data): no adapter / no event / no evidence
 * → no reason → the timeline card renders NO AI 解读 slot (the 4.2 card renders
 * the slot only when recommendation_reason is non-null). Never fabricates a
 * reason from nothing.
 *
 * Fail-fast validation: every adapter-returned reason MUST be non-empty AND
 * ≤40 字 AND free of the six forbidden phrase classes. A reason violating any of
 * these is rejected — generateRecommendationReason THROWS (the worker's
 * per-event try/catch isolates it so that one event stays at null without
 * aborting the batch). It never silently truncates/rewrites a reason, because
 * that would make the NFR "never advisory / never over-certain" decorative.
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are
 * never updated or deleted — the full reason history for an event is the version
 * series. publish-orchestrator projects the LATEST row (createdAt desc, id desc
 * tiebreaker) into published_timeline_entries.recommendation_reason.
 */
export async function generateRecommendationReason(
  options: GenerateRecommendationReasonOptions,
): Promise<GenerateRecommendationReasonResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // 1. No adapter → honest degradation (V1 prod: recommendation-reason worker
  // resolves none). Never fabricate.
  if (adapter === undefined) return null;

  // 2. Load the HotEvent + confirm it has member evidence (no honest derivation
  // for an evidence-less event — mirrors generateExplanation's guard). The
  // title + summary context passed to the adapter is read from the latest
  // revision + latest ExplanationVersion so the reason is grounded in what the
  // card actually renders.
  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
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
      evidence: { select: { evidenceRecordId: true } },
    },
  });

  // Missing event → no honest derivation.
  if (event === null) return null;
  // No member evidence → no honest derivation (mirrors generateExplanation).
  if (event.evidence.length === 0) return null;

  // Effective title + summary (same overlay rule as publish-orchestrator's
  // timeline projection): latest revision title ?? baseline title; latest
  // ExplanationVersion summary ?? "".
  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const latestExplanation = event.explanationVersions[0] ?? null;
  const effectiveSummary = latestExplanation !== null ? latestExplanation.summary : "";

  // 3. Call the adapter with the event context.
  const raw = await adapter.generateReason({
    hotEventId,
    title: effectiveTitle,
    summary: effectiveSummary,
  });
  if (raw === null) return null;

  // 4. Validate + normalize the result (non-empty, ≤40 字, guardrail). Throw on
  // any violation (fail-fast, never silently truncate). The worker's per-event
  // try/catch isolates the throw so one bad event stays at null without aborting
  // the batch. validateReason returns the TRIMMED reason so the stored row (and
  // the projected card text) never carries leading/trailing whitespace.
  const reason = validateReason(raw);

  // 5. APPEND a new reason row (source="ai"). Never update or delete prior rows
  // (AD-5). modelId + promptVersion are carried verbatim from the adapter so the
  // audit chain records which provider + prompt produced each row (NFR-7).
  const created = await prisma.recommendationReason.create({
    data: {
      id: newTraceId(),
      hotEventId,
      reason,
      source: ExplanationSource.Ai,
      modelId: raw.modelId,
      promptVersion: raw.promptVersion,
      traceId,
    },
    select: {
      id: true,
      hotEventId: true,
      reason: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  return {
    recommendationReasonId: created.id,
    hotEventId: created.hotEventId,
    reason: created.reason,
    source: created.source as GenerateRecommendationReasonResult["source"],
    modelId: created.modelId,
    promptVersion: created.promptVersion,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest recommendation_reasons row for an event (createdAt desc, id
 * desc tiebreaker — UUIDv7 ids embed a monotonic timestamp so two reasons
 * sharing the same createdAt millisecond resolve deterministically to the newer
 * one), or null if none exist. publish-orchestrator's timeline projection reads
 * the latest at projection time; this read helper is exposed for verify/seed +
 * operator audit.
 */
export async function getLatestRecommendationReason(
  options: {
    prisma: PrismaClient;
    traceId: string;
    hotEventId: string;
  },
): Promise<RecommendationReasonRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.recommendationReason.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      reason: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    hotEventId: latest.hotEventId,
    reason: latest.reason,
    source: latest.source as RecommendationReasonRecord["source"],
    modelId: latest.modelId,
    promptVersion: latest.promptVersion,
    createdAt: latest.createdAt,
  };
}

// --- validation ---------------------------------------------------------------

/**
 * Validate + normalize an adapter-returned reason: non-empty, ≤40 字, and
 * passes the 6-class wording guardrail. Throw on any violation (fail-fast).
 * Returns the TRIMMED reason so callers store the normalized value. Pure
 * function (same input → identical result/throw), testable without DB.
 *
 * Length is measured in Unicode CODEPOINTS (`[...str].length`) — the right unit
 * for the CJK "字" contract — NOT UTF-16 code units (`str.length`), which
 * double-count surrogate pairs (emoji etc.) and would drift the cap. Whitespace
 * is trimmed once up front so it neither counts toward the cap nor reaches the
 * card.
 */
function validateReason(result: LlmReasonResult): string {
  // Non-empty (guard against a non-string slipping through the type boundary).
  if (
    typeof result.reason !== "string" ||
    result.reason.trim() === ""
  ) {
    throw new Error(
      "[reason] adapter returned an empty reason; AC requires a non-empty ≤40 字 reason",
    );
  }
  const reason = result.reason.trim();
  // ≤40 字 (codepoints — the right measure for CJK 字).
  const codepoints = [...reason].length;
  if (codepoints > RECOMMENDATION_REASON_MAX_LENGTH) {
    throw new Error(
      `[reason] adapter returned a reason of ${codepoints} 字 (> ${RECOMMENDATION_REASON_MAX_LENGTH}); AC requires ≤40 字`,
    );
  }
  // 6-class wording guardrail (PRD §10), evaluated on the trimmed value.
  if (!passesRecommendationGuardrail(reason)) {
    throw new Error(
      "[reason] adapter returned a reason containing a forbidden phrase (action / return-prediction / manipulation-frame / recommendation-strength / timing-advice / over-certainty); PRD §10 forbids these",
    );
  }
  // Provenance must be present (NFR-7 audit). modelId + promptVersion are the
  // version-tracing pair; an empty value would break the audit chain.
  if (result.modelId.trim() === "" || result.promptVersion.trim() === "") {
    throw new Error(
      "[reason] adapter returned an empty modelId or promptVersion; NFR-7 requires both for audit tracing",
    );
  }
  return reason;
}
