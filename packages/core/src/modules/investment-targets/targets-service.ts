/**
 * targets-service — generate the candidate pool (investment_targets) for a HotEvent
 * from a TargetsAdapter's output and append a row, AND append the byproduct
 * 影响面/受益方/风险点 deep-read segments to deep_reads so the EXISTING detail-page
 * deep-read block surfaces the skill's output (no new deep-read UI).
 *
 * One agent run of the ashare-news-investment-targets skill produces both the
 * candidate pool and the three-segment deep read atomically (the skill's传导链
 * naturally yields both). This service persists both in one call.
 *
 * Owns investment_targets (AD-5 append-only). The deep_reads append reuses the
 * explanation module's table — the investment-targets agent path is the de-facto
 * deep-read producer for events it covers; the sibling deep-read worker stays
 * dormant (V1 prod resolves no adapter) and its `deepReads:{none:{}}` candidate
 * query naturally skips events this path already filled. publish-orchestrator
 * remains the SOLE writer of both public projections (published_hot_event_
 * investment_targets + published_hot_event_deep_reads, AD-2/AD-3); this module
 * only appends source rows + the worker triggers the projection refresh.
 *
 * Honest degradation (NFR-2): no adapter / no event / no evidence → returns null,
 * writes nothing. Never fabricates a candidate pool.
 *
 * Fail-fast validation: every candidate field + every deep-read segment is
 * validated; a violation THROWS (the worker's per-event try/catch isolates it so
 * one event stays at null without aborting the batch). Never silently truncates.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import {
  DEEP_READ_SEGMENT_MAX_LENGTH,
  ExplanationSource,
  passesRecommendationGuardrail,
} from "../explanation/index.js";
import { TargetTier } from "./types.js";
import type {
  GenerateInvestmentTargetsOptions,
  GenerateInvestmentTargetsResult,
  InvestmentTargetRecord,
  LlmTargetsResult,
  TargetCandidate,
  TargetScores,
  TargetTier as TargetTierType,
} from "./types.js";

/** Score ceilings per the skill's 70-point降级口径 (30 realtime points unscorable). */
const SCORE_MAX = {
  newsStrength: 20,
  linkStrength: 20,
  expectationGap: 15,
  earningsElasticity: 15,
} as const satisfies Record<keyof TargetScores, number>;

const VALID_TIERS: ReadonlySet<TargetTierType> = new Set(Object.values(TargetTier));

/**
 * Generate the candidate pool + deep-read byproduct for one HotEvent, then APPEND
 * an investment_targets row AND a deep_reads row (source="ai"). Returns null and
 * writes nothing when adapter is undefined, the event is missing, or the event
 * has no member evidence (no honest derivation — NFR-2).
 */
export async function generateInvestmentTargets(
  options: GenerateInvestmentTargetsOptions,
): Promise<GenerateInvestmentTargetsResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // 1. No adapter → honest degradation.
  if (adapter === undefined) return null;

  // 2. Load HotEvent + confirm member evidence (mirrors generateDeepRead). The
  // effective title + summary + member evidence are the agent's grounding.
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

  if (event === null) return null;
  if (event.evidence.length === 0) return null;

  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const latestExplanation = event.explanationVersions[0] ?? null;
  const effectiveSummary = latestExplanation !== null ? latestExplanation.summary : "";

  const evidence = event.evidence.map((link) => ({
    sourceName: link.evidenceRecord.source.name,
    summary: link.evidenceRecord.summary ?? "",
    publishedAt: link.evidenceRecord.publishedAt,
  }));

  // 3. Call the adapter.
  const raw = await adapter.generateInvestmentTargets({
    hotEventId,
    title: effectiveTitle,
    summary: effectiveSummary,
    evidence,
  });
  if (raw === null) return null;

  // 4. Validate (throws on any violation — fail-fast).
  const validated = validateTargets(raw);

  // 5. APPEND investment_targets (AD-5). candidates stored as Json.
  const created = await prisma.investmentTarget.create({
    data: {
      id: newTraceId(),
      hotEventId,
      newsConclusion: validated.newsConclusion,
      transmissionPath: validated.transmissionPath,
      candidates: validated.candidates as unknown as Parameters<
        typeof prisma.investmentTarget.create>[0]["data"]["candidates"],
      downgradeNote: validated.downgradeNote,
      source: ExplanationSource.Ai,
      modelId: raw.modelId,
      promptVersion: raw.promptVersion,
      traceId,
    },
    select: {
      id: true,
      hotEventId: true,
      newsConclusion: true,
      transmissionPath: true,
      candidates: true,
      downgradeNote: true,
      source: true,
      modelId: true,
      promptVersion: true,
      createdAt: true,
    },
  });

  // 6. APPEND the deep-read byproduct to deep_reads (only when it validated — a
  // guardrail/length failure drops the byproduct but keeps the candidate pool).
  if (validated.deepRead !== null) {
    await prisma.deepRead.create({
      data: {
        id: newTraceId(),
        hotEventId,
        impactSurface: validated.deepRead.impactSurface,
        beneficiaries: validated.deepRead.beneficiaries,
        riskPoints: validated.deepRead.riskPoints,
        source: ExplanationSource.Ai,
        modelId: raw.modelId,
        promptVersion: raw.promptVersion,
        traceId,
      },
    });
  }

  return {
    investmentTargetId: created.id,
    hotEventId: created.hotEventId,
    newsConclusion: created.newsConclusion,
    transmissionPath: created.transmissionPath,
    candidates: created.candidates as unknown as TargetCandidate[],
    downgradeNote: created.downgradeNote,
    source: created.source,
    modelId: created.modelId,
    promptVersion: created.promptVersion,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest investment_targets row for an event (createdAt desc, id desc),
 * or null if none exist. Exposed for verify/seed + audit.
 */
export async function getLatestInvestmentTargets(
  options: { prisma: PrismaClient; traceId: string; hotEventId: string },
): Promise<InvestmentTargetRecord | null> {
  const { prisma, hotEventId } = options;
  const latest = await prisma.investmentTarget.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      newsConclusion: true,
      transmissionPath: true,
      candidates: true,
      downgradeNote: true,
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
    newsConclusion: latest.newsConclusion,
    transmissionPath: latest.transmissionPath,
    candidates: latest.candidates as unknown as TargetCandidate[],
    downgradeNote: latest.downgradeNote,
    source: latest.source,
    modelId: latest.modelId,
    promptVersion: latest.promptVersion,
    createdAt: latest.createdAt,
  };
}

// --- validation ---------------------------------------------------------------

interface ValidatedTargets {
  newsConclusion: string;
  transmissionPath: string;
  candidates: TargetCandidate[];
  /** Null when a segment failed the guardrail/length check — the deep_reads
   * byproduct is dropped but the candidate pool (the primary artifact) is still
   * written. Decoupled so an over-eager agent segment never costs the whole run. */
  deepRead: { impactSurface: string; beneficiaries: string; riskPoints: string } | null;
  downgradeNote: string;
}

/**
 * Validate + normalize an adapter-returned pool. Throws on any violation (fail-
 * fast). Provenance (modelId + promptVersion) must be non-empty (NFR-7). Scores
 * are clamped to their ceilings so an over-enthusiastic agent cannot inflate.
 * Deep-read segments reuse the explanation guardrail + ≤120 字 cap.
 */
function validateTargets(result: LlmTargetsResult): ValidatedTargets {
  if (result.modelId.trim() === "" || result.promptVersion.trim() === "") {
    throw new Error(
      "[investment-targets] adapter returned an empty modelId or promptVersion; NFR-7 requires both for audit tracing",
    );
  }
  const newsConclusion = requireNonEmpty(result.newsConclusion, "newsConclusion");
  const transmissionPath = requireNonEmpty(result.transmissionPath, "transmissionPath");
  const downgradeNote = requireNonEmpty(result.downgradeNote, "downgradeNote");
  const candidates = (Array.isArray(result.candidates) ? result.candidates : []).map((c, i) =>
    validateCandidate(c, i),
  );
  // deepRead is a BYPRODUCT. Tolerate a guardrail/length failure here: drop the
  // deep read (skip the deep_reads append) rather than throwing away the whole run
  // (the candidate pool is the primary artifact). All three segments must pass for
  // the deep_reads row (which requires all three); one bad segment → deepRead null.
  let deepRead: ValidatedTargets["deepRead"] = null;
  try {
    deepRead = {
      impactSurface: validateSegment(result.deepRead.impactSurface, "impactSurface"),
      beneficiaries: validateSegment(result.deepRead.beneficiaries, "beneficiaries"),
      riskPoints: validateSegment(result.deepRead.riskPoints, "riskPoints"),
    };
  } catch (error) {
    console.warn(
      `[investment-targets] deepRead byproduct dropped for ${result.modelId}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return {
    newsConclusion,
    transmissionPath,
    downgradeNote,
    candidates,
    deepRead,
  };
}

function validateCandidate(raw: TargetCandidate, index: number): TargetCandidate {
  const label = `candidates[${index}]`;
  const name = requireNonEmpty(raw.name, `${label}.name`);
  const benefitLogic = requireNonEmpty(raw.benefitLogic, `${label}.benefitLogic`);
  const evidenceChain = requireNonEmpty(raw.evidenceChain, `${label}.evidenceChain`);
  if (!VALID_TIERS.has(raw.tier)) {
    throw new Error(`[investment-targets] ${label}.tier "${raw.tier}" is not a valid TargetTier`);
  }
  const scores = clampScores(raw.scores);
  const toVerify = Array.isArray(raw.toVerify) ? raw.toVerify.filter((s) => typeof s === "string") : [];
  // code may be null (待核验); a non-null code is trimmed. codeVerified defaults false.
  const code = typeof raw.code === "string" && raw.code.trim() !== "" ? raw.code.trim() : null;
  return {
    name,
    code,
    codeVerified: raw.codeVerified === true,
    tier: raw.tier,
    benefitLogic,
    scores,
    toVerify,
    evidenceChain,
  };
}

function clampScores(raw: TargetScores): TargetScores {
  const num = (v: unknown, max: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
  };
  return {
    newsStrength: num(raw.newsStrength, SCORE_MAX.newsStrength),
    linkStrength: num(raw.linkStrength, SCORE_MAX.linkStrength),
    expectationGap: num(raw.expectationGap, SCORE_MAX.expectationGap),
    earningsElasticity: num(raw.earningsElasticity, SCORE_MAX.earningsElasticity),
  };
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[investment-targets] adapter returned an empty ${label}`);
  }
  return value.trim();
}

/**
 * Validate one deep-read segment: non-empty, ≤ DEEP_READ_SEGMENT_MAX_LENGTH 字
 * (codepoints), passes the 6-class guardrail. Returns the TRIMMED segment. Mirrors
 * explanation/deep-read-service.validateSegment (not exported there, so inlined).
 */
function validateSegment(segment: string, label: string): string {
  if (typeof segment !== "string" || segment.trim() === "") {
    throw new Error(`[investment-targets] adapter returned an empty deepRead.${label} segment`);
  }
  const trimmed = segment.trim();
  const codepoints = [...trimmed].length;
  if (codepoints > DEEP_READ_SEGMENT_MAX_LENGTH) {
    throw new Error(
      `[investment-targets] deepRead.${label} is ${codepoints} 字 (> ${DEEP_READ_SEGMENT_MAX_LENGTH})`,
    );
  }
  if (!passesRecommendationGuardrail(trimmed)) {
    throw new Error(
      `[investment-targets] deepRead.${label} contains a forbidden phrase (PRD §10)`,
    );
  }
  return trimmed;
}
