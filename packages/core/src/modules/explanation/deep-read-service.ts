/**
 * deep-read-service — generate the three-segment 影响面/受益方/风险点 AI 深读 (deep
 * read) for a HotEvent's detail page from an LLMAdapter's output and append a
 * deep_reads row (AD-5 append-only).
 *
 * Story 5.2. This module owns the deep_reads table (AD-2/AD-5 append-only). It
 * derives a three-segment deep read for one hot event from:
 *   1. the event's title + summary + member evidence records (the same grounding the
 *      detail page renders — NFR-2: AI content must not fabricate sourceless
 *      conclusions);
 *   2. an LLMAdapter's deep-read output (three segments + its provenance).
 *
 *   - generateDeepRead: load HotEvent (missing → null) → confirm member evidence
 *     (no evidence → null, no honest derivation) → read adapter deep read → validate
 *     (each segment non-empty, ≤ DEEP_READ_SEGMENT_MAX_LENGTH (120 字),
 *     passesRecommendationGuardrail; throw on violation — fail-fast, never silently
 *     truncate) → APPEND one deep_reads row (source="ai"). Returns null when the
 *     adapter is missing (V1 prod: deep-read worker resolves none), the event is
 *     missing, or the event has no member evidence.
 *
 * This module NEVER writes published_hot_event_deep_reads (publish-orchestrator owns
 * that projection — the sole writer of it, AD-2/AD-3). It only appends deep_reads;
 * publish-orchestrator reads the latest at projection time (projectDeepRead derives
 * the projection from the latest row). The worker triggers that projection by calling
 * the existing refreshPublishedReadModel after a successful append.
 *
 * The 6-class wording guardrail (passesRecommendationGuardrail) is REUSED from 5.1's
 * reason-service unchanged. The constant is named "recommendation..." but carries the
 * generic PRD §10 six classes (the epic AC applies to ALL AI content, not just card
 * reasons). Renaming would churn 5.1 for no behavioral gain; 5.3 can lift it to a
 * shared location if needed. Each of the three segments is checked against the same
 * guardrail.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed
 * scripts can call it directly without Redis — same convention as
 * generateRecommendationReason / generateExplanation / generateDailyDigest. The
 * deep-read worker calls this with adapter = undefined in V1 prod (procurement
 * deferred) → honest degradation.
 *
 * NFR-2/NFR-3/NFR-7: every appended row carries source="ai" + modelId +
 * promptVersion + createdAt for audit + version tracing. The 6-class wording
 * guardrail is enforced at write time on each segment so a forbidden phrase can never
 * reach the detail page.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { passesRecommendationGuardrail } from "./reason-service.js";
import { ExplanationSource } from "./types.js";
import type {
  DeepReadRecord,
  GenerateDeepReadOptions,
  GenerateDeepReadResult,
  LlmDeepReadResult,
} from "./types.js";

/**
 * The max length of EACH deep-read segment (影响面 / 受益方 / 风险点) in codepoints
 * (字). PRD SM-C3 says "深读有上限" without giving a number; 120 字/段 is the story-time
 * default (a one-line edit to adjust). Checked at write time on each segment so an
 * over-length adapter output can never reach the detail page. Mirrors 5.1's
 * RECOMMENDATION_REASON_MAX_LENGTH (40 字) precedent but per-segment for the three-
 * partition shape.
 */
export const DEEP_READ_SEGMENT_MAX_LENGTH = 120;

/**
 * Generate the three-segment AI 深读 for a HotEvent from the adapter's output, then
 * APPEND one deep_reads row (source="ai"). Returns null and writes nothing when:
 *   - adapter is undefined (V1 prod: deep-read worker resolves none), OR
 *   - the HotEvent does not exist, OR
 *   - the HotEvent has no member evidence (no honest derivation; never a fabricated
 *     deep read — NFR-2).
 *
 * Honest degradation (NFR: never fake data): no adapter / no event / no evidence →
 * no deep read → the detail page renders the "AI 深读生成中。" degraded state. Never
 * fabricates a deep read from nothing.
 *
 * Fail-fast validation: every adapter-returned segment MUST be non-empty AND ≤120 字
 * AND free of the six forbidden phrase classes. A segment violating any of these is
 * rejected — generateDeepRead THROWS (the worker's per-event try/catch isolates it so
 * that one event stays at null without aborting the batch). It never silently
 * truncates/rewrites a segment, because that would make the NFR "never advisory /
 * never over-certain" decorative.
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are never
 * updated or deleted — the full deep-read history for an event is the version series.
 * publish-orchestrator projects the LATEST row (createdAt desc, id desc tiebreaker)
 * into published_hot_event_deep_reads.
 */
export async function generateDeepRead(
  options: GenerateDeepReadOptions,
): Promise<GenerateDeepReadResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // 1. No adapter → honest degradation (V1 prod: deep-read worker resolves none).
  // Never fabricate.
  if (adapter === undefined) return null;

  // 2. Load the HotEvent + confirm it has member evidence (no honest derivation for
  // an evidence-less event — mirrors generateExplanation's + 5.1's guard). The title
  // + summary context passed to the adapter is read from the latest revision +
  // latest ExplanationVersion (same overlay rule as publish-orchestrator's timeline
  // projection); the member evidence records (sourceName + summary + publishedAt) are
  // passed as grounding so the adapter's three segments stay consistent with the
  // evidence timeline (NFR-2).
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
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              source: { select: { name: true } },
              summary: true,
              publishedAt: true,
            },
          },
        },
      },
    },
  });

  // Missing event → no honest derivation.
  if (event === null) return null;
  // No member evidence → no honest derivation (mirrors generateExplanation / 5.1).
  if (event.evidence.length === 0) return null;

  // Effective title + summary (same overlay rule as publish-orchestrator's timeline
  // projection): latest revision title ?? baseline title; latest ExplanationVersion
  // summary ?? "".
  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const latestExplanation = event.explanationVersions[0] ?? null;
  const effectiveSummary = latestExplanation !== null ? latestExplanation.summary : "";

  // Evidence grounding passed to the adapter: one entry per member record, mirroring
  // the shape publish-orchestrator projects into published_hot_event_evidence
  // (sourceName / summary / publishedAt). NFR-2: the adapter's three segments must
  // stay consistent with this timeline, not fabricate sourceless conclusions.
  const evidence = event.evidence.map((link) => ({
    sourceName: link.evidenceRecord.source.name,
    summary: link.evidenceRecord.summary ?? "",
    publishedAt: link.evidenceRecord.publishedAt,
  }));

  // 3. Call the adapter with the event context + evidence grounding.
  const raw = await adapter.generateDeepRead({
    hotEventId,
    title: effectiveTitle,
    summary: effectiveSummary,
    evidence,
  });
  if (raw === null) return null;

  // 4. Validate + normalize each segment (non-empty, ≤120 字, guardrail). Throw on
  // any violation (fail-fast, never silently truncate). The worker's per-event
  // try/catch isolates the throw so one bad event stays at null without aborting the
  // batch. validateDeepRead returns the THREE TRIMMED segments so the stored row
  // (and the projected detail text) never carries leading/trailing whitespace.
  const validated = validateDeepRead(raw);

  // 5. APPEND a new deep_reads row (source="ai"). Never update or delete prior rows
  // (AD-5). modelId + promptVersion are carried verbatim from the adapter so the
  // audit chain records which provider + prompt produced each row (NFR-7).
  const created = await prisma.deepRead.create({
    data: {
      id: newTraceId(),
      hotEventId,
      impactSurface: validated.impactSurface,
      beneficiaries: validated.beneficiaries,
      riskPoints: validated.riskPoints,
      source: ExplanationSource.Ai,
      modelId: raw.modelId,
      promptVersion: raw.promptVersion,
      traceId,
    },
    select: {
      id: true,
      hotEventId: true,
      impactSurface: true,
      beneficiaries: true,
      riskPoints: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  return {
    deepReadId: created.id,
    hotEventId: created.hotEventId,
    impactSurface: created.impactSurface,
    beneficiaries: created.beneficiaries,
    riskPoints: created.riskPoints,
    source: created.source as GenerateDeepReadResult["source"],
    modelId: created.modelId,
    promptVersion: created.promptVersion,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest deep_reads row for an event (createdAt desc, id desc tiebreaker
 * — UUIDv7 ids embed a monotonic timestamp so two reads sharing the same createdAt
 * millisecond resolve deterministically to the newer one), or null if none exist.
 * publish-orchestrator's deep-read projection (projectDeepRead) reads the latest at
 * projection time; this read helper is exposed for verify/seed + operator audit.
 */
export async function getLatestDeepRead(
  options: {
    prisma: PrismaClient;
    traceId: string;
    hotEventId: string;
  },
): Promise<DeepReadRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.deepRead.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      impactSurface: true,
      beneficiaries: true,
      riskPoints: true,
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
    impactSurface: latest.impactSurface,
    beneficiaries: latest.beneficiaries,
    riskPoints: latest.riskPoints,
    source: latest.source as DeepReadRecord["source"],
    modelId: latest.modelId,
    promptVersion: latest.promptVersion,
    createdAt: latest.createdAt,
  };
}

// --- validation ---------------------------------------------------------------

/**
 * The three validated + normalized segments. Each is the TRIMMED value of the
 * corresponding adapter-returned segment (so callers store the normalized value).
 */
interface ValidatedDeepRead {
  impactSurface: string;
  beneficiaries: string;
  riskPoints: string;
}

/**
 * Validate + normalize an adapter-returned deep read: each of the three segments
 * non-empty, ≤ DEEP_READ_SEGMENT_MAX_LENGTH (120 字), and passes the 6-class wording
 * guardrail. Throw on any violation (fail-fast). Returns the THREE TRIMMED segments
 * so callers store the normalized values. Pure function (same input → identical
 * result/throw), testable without DB.
 *
 * Length is measured in Unicode CODEPOINTS (`[...s].length`) — the right unit for the
 * CJK "字" contract — NOT UTF-16 code units (`s.length`), which double-count surrogate
 * pairs (emoji etc.) and would drift the cap. Whitespace is trimmed once up front per
 * segment so it neither counts toward the cap nor reaches the detail page. Mirrors 5.1
 * validateReason's trim + codepoint approach, applied per-segment.
 *
 * The 6-class guardrail (passesRecommendationGuardrail) is REUSED from reason-service
 * — the constant is named "recommendation..." but carries the generic PRD §10 six
 * classes (epic AC applies to all AI content). Each of the three segments is checked
 * independently.
 */
function validateDeepRead(result: LlmDeepReadResult): ValidatedDeepRead {
  // Provenance must be present (NFR-7 audit). modelId + promptVersion are the
  // version-tracing pair; an empty value would break the audit chain. Checked here
  // so a throw lands in the same fail-fast path as the segment checks (a throw on
  // provenance never reaches the create() call).
  if (result.modelId.trim() === "" || result.promptVersion.trim() === "") {
    throw new Error(
      "[deep-read] adapter returned an empty modelId or promptVersion; NFR-7 requires both for audit tracing",
    );
  }
  return {
    impactSurface: validateSegment(result.impactSurface, "impactSurface"),
    beneficiaries: validateSegment(result.beneficiaries, "beneficiaries"),
    riskPoints: validateSegment(result.riskPoints, "riskPoints"),
  };
}

/**
 * Validate one deep-read segment: non-empty, ≤120 字 (codepoints), passes the 6-class
 * wording guardrail. Returns the TRIMMED segment. Throws on any violation (fail-fast).
 * Pure helper, testable without DB. Mirrors 5.1 validateReason's single-segment
 * checks; deep-read-service calls it three times (once per segment).
 */
function validateSegment(segment: string, label: string): string {
  // Non-empty (guard against a non-string slipping through the type boundary).
  if (typeof segment !== "string" || segment.trim() === "") {
    throw new Error(
      `[deep-read] adapter returned an empty ${label} segment; AC requires three non-empty ≤120 字 segments`,
    );
  }
  const trimmed = segment.trim();
  // ≤120 字 (codepoints — the right measure for CJK 字).
  const codepoints = [...trimmed].length;
  if (codepoints > DEEP_READ_SEGMENT_MAX_LENGTH) {
    throw new Error(
      `[deep-read] adapter returned a ${label} segment of ${codepoints} 字 (> ${DEEP_READ_SEGMENT_MAX_LENGTH}); AC requires ≤${DEEP_READ_SEGMENT_MAX_LENGTH} 字 per segment`,
    );
  }
  // 6-class wording guardrail (PRD §10), evaluated on the trimmed value. Reuses the
  // generic guardrail from reason-service (the name says "recommendation" but the six
  // classes are generic — epic AC applies to all AI content).
  if (!passesRecommendationGuardrail(trimmed)) {
    throw new Error(
      `[deep-read] adapter returned a ${label} segment containing a forbidden phrase (action / return-prediction / manipulation-frame / recommendation-strength / timing-advice / over-certainty); PRD §10 forbids these`,
    );
  }
  return trimmed;
}
