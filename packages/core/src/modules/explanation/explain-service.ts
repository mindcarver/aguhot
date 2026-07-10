/**
 * explain-service — deterministic three-partition explanation generation.
 *
 * Story 1.8. This module owns the ExplanationVersion table (AD-5 append-only).
 * It derives the three explanation partitions DETERMINISTICALLY from real
 * evidence — no external LLM, no third-party SDK, no fabricated facts (NFR:
 * never fake data; no investment-advice wording). V1 `source` is "template";
 * real LLM + the LLMAdapter port are deferred (ponytail: do not pre-build a
 * port for a single deterministic implementation with no SDK).
 *
 *   - generateExplanation: read HotEvent + member evidence_records + sources →
 *     derive partitions → APPEND one ExplanationVersion (never update/delete
 *     prior rows — AD-5). Returns null when the event has no member evidence
 *     (no honest derivation possible; never writes an empty version).
 *   - getLatestExplanation: createdAt desc first row, or null. publish-
 *     orchestrator reads this at projection time.
 *
 * This module never writes published_* (publish-orchestrator owns those
 * projections) and never writes hot_events/evidence_records (event-assembly /
 * source-ingest own those). It only appends explanation_versions.
 *
 * The derivation is pure logic (no BullMQ, no SDK), so verify/seed scripts can
 * call it directly without Redis — same convention as clusterEvents (verify:
 * cluster calls clusterEvents directly). The BullMQ `explain` worker (apps/
 * worker) is the prod-runtime carrier (AD-4) and calls this function via a
 * dynamic import.
 */

import { newTraceId } from "../../shared/ids.js";
import { ExplanationSource } from "./types.js";
import type {
  GenerateExplanationOptions,
  GenerateExplanationResult,
  GetLatestExplanationOptions,
  ExplanationPartitions,
  ExplanationVersionRecord,
  SaveExplanationOptions,
  SaveExplanationResult,
} from "./types.js";

/**
 * Generate the three explanation partitions deterministically from a HotEvent's
 * member evidence records, then APPEND one ExplanationVersion row (source=
 * "template"). Returns null and writes nothing when the event has no member
 * evidence (no honest derivation; never an empty version).
 *
 * Determinism: the same input evidence set produces byte-identical partitions
 * (verify-explain asserts this by calling twice and comparing). The derivation
 * is pure string composition over evidence fields — no randomness, no clocks
 * inside the partition text (createdAt is on the row, not in the text).
 *
 * Append-only (AD-5): every call inserts a NEW row. Prior rows are never
 * updated or deleted — the full version chain is the audit history. publish-
 * orchestrator projects the LATEST row (createdAt desc first) into the public
 * read model.
 */
export async function generateExplanation(
  options: GenerateExplanationOptions,
): Promise<GenerateExplanationResult | null> {
  const { prisma, traceId, hotEventId } = options;

  // Load the event + its member evidence records (via the link table) + the
  // source name for each. Order by publishedAt asc so the "latest" record is
  // deterministic (last non-null publishedAt; nulls sort first in asc so the
  // tail holds the latest known time).
  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
    select: {
      id: true,
      title: true,
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              id: true,
              title: true,
              summary: true,
              url: true,
              publishedAt: true,
              status: true,
              source: { select: { name: true } },
            },
          },
        },
        orderBy: { evidenceRecord: { publishedAt: "asc" } },
      },
    },
  });

  // No event or no member evidence → no honest derivation. Return null, write
  // nothing. Never fabricate an explanation for an evidence-less event.
  if (event === null) return null;
  if (event.evidence.length === 0) return null;

  const records = event.evidence.map((link) => ({
    id: link.evidenceRecord.id,
    sourceName: link.evidenceRecord.source.name,
    title: link.evidenceRecord.title,
    summary: link.evidenceRecord.summary,
    url: link.evidenceRecord.url,
    publishedAt: link.evidenceRecord.publishedAt,
    status: link.evidenceRecord.status,
  }));

  const partitions = derivePartitions(event.title, records);

  // APPEND a new version row (source="template"). Never update or delete prior
  // rows (AD-5). Shared append helper so generateExplanation and saveExplanation
  // use the identical row shape + id assignment.
  const created = await appendExplanationVersion({
    prisma,
    traceId,
    hotEventId,
    partitions,
    source: ExplanationSource.Template,
  });

  return {
    explanationVersionId: created.id,
    hotEventId,
    summary: created.summary,
    whyItMatters: created.whyItMatters,
    uncertainties: created.uncertainties,
    source: created.source,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Save an operator-authored explanation revision (Story 1.9). Appends one
 * ExplanationVersion row (source passed by caller — V1 callers pass "human")
 * ONLY when the three partitions differ from the latest version. No change →
 * no-op (no dirty version, no spurious source flip).
 *
 * This is the explanation write-point for operator revisions (1.8 deferred the
 * "human" write path to 1.9; the ExplanationSource union reserved "human"). It
 * only writes explanation_versions; it never writes hot_events, published_*,
 * or hot_event_revisions. publish-orchestrator projects the latest version on
 * republish; review-workflow computes the pending diff for the operator.
 *
 * Returns { appended: false, notFound: true } when the event does not exist,
 * { appended: false } on no-change, { appended: true, explanationVersionId } on
 * append.
 */
export async function saveExplanation(
  options: SaveExplanationOptions,
): Promise<SaveExplanationResult> {
  const { prisma, traceId, hotEventId, summary, whyItMatters, uncertainties, source } = options;

  // Read the event (must exist) + the latest version for change detection.
  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
    select: {
      id: true,
      explanationVersions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { summary: true, whyItMatters: true, uncertainties: true },
      },
    },
  });

  if (event === null) {
    return { appended: false, notFound: true };
  }

  // Change detection: append ONLY when any partition differs from the latest
  // version. Pairwise string comparison (trim-then-compare so a trailing-space-
  // only edit is a no-op, matching how reviseHotEvent trims its inputs). When
  // there is no prior version, any non-empty input is a change.
  const latest = event.explanationVersions[0] ?? null;
  const summaryChanged = latest === null || summary.trim() !== latest.summary.trim();
  const whyChanged = latest === null || whyItMatters.trim() !== latest.whyItMatters.trim();
  const uncChanged = latest === null || uncertainties.trim() !== latest.uncertainties.trim();
  if (!summaryChanged && !whyChanged && !uncChanged) {
    return { appended: false };
  }

  const created = await appendExplanationVersion({
    prisma,
    traceId,
    hotEventId,
    partitions: {
      summary: summary.trim(),
      whyItMatters: whyItMatters.trim(),
      uncertainties: uncertainties.trim(),
    },
    source,
  });

  return { appended: true, explanationVersionId: created.id };
}

/**
 * Private append helper — inserts one ExplanationVersion row and returns it.
 * Shared by generateExplanation (source="template") and saveExplanation (source
 * passed by caller, V1 "human"). Never updates or deletes prior rows (AD-5).
 */
async function appendExplanationVersion(args: {
  prisma: import("../../../generated/client.js").PrismaClient;
  traceId: string;
  hotEventId: string;
  partitions: ExplanationPartitions;
  source: ExplanationSource;
}): Promise<{
  id: string;
  summary: string;
  whyItMatters: string;
  uncertainties: string;
  source: ExplanationSource;
  createdAt: Date;
}> {
  const { prisma, traceId, hotEventId, partitions, source } = args;
  const created = await prisma.explanationVersion.create({
    data: {
      id: newTraceId(),
      hotEventId,
      summary: partitions.summary,
      whyItMatters: partitions.whyItMatters,
      uncertainties: partitions.uncertainties,
      source,
      traceId,
    },
    select: {
      id: true,
      summary: true,
      whyItMatters: true,
      uncertainties: true,
      source: true,
      createdAt: true,
    },
  });
  return {
    id: created.id,
    summary: created.summary,
    whyItMatters: created.whyItMatters,
    uncertainties: created.uncertainties,
    source: created.source as ExplanationSource,
    createdAt: created.createdAt,
  };
}

/**
 * Return the latest ExplanationVersion for an event (createdAt desc first), or
 * null if none exist. publish-orchestrator uses this at projection time to
 * surface the current version into the public read model.
 */
export async function getLatestExplanation(
  options: GetLatestExplanationOptions,
): Promise<ExplanationVersionRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.explanationVersion.findFirst({
    where: { hotEventId },
    // createdAt desc, then id desc as a deterministic tiebreaker: UUIDv7 ids
    // embed a monotonic timestamp, so for two versions sharing the same
    // createdAt millisecond the newer id wins deterministically (Postgres
    // TIMESTAMP(3) can tie on fast back-to-back appends).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      summary: true,
      whyItMatters: true,
      uncertainties: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    hotEventId: latest.hotEventId,
    summary: latest.summary,
    whyItMatters: latest.whyItMatters,
    uncertainties: latest.uncertainties,
    source: latest.source as ExplanationSource,
    createdAt: latest.createdAt,
  };
}

// --- deterministic derivation -----------------------------------------------

/**
 * The evidence shape the derivation consumes. Extracted from the query so the
 * derivation is a pure function of (title, records) — testable without a DB.
 */
interface DeriveRecord {
  id: string;
  sourceName: string;
  title: string | null;
  summary: string | null;
  url: string | null;
  publishedAt: Date | null;
  status: string;
}

/**
 * Derive the three partitions deterministically. Pure function: same (title,
 * records) → identical strings. No clocks, no randomness inside the text.
 *
 *   - summary (发生了什么): the event title, followed by the latest record's
 *     summary (if any). Title is always present (HotEvent.title is non-null).
 *   - whyItMatters (为什么重要): an OBJECTIVE statement of source count and the
 *     coverage span (time between earliest and latest publishedAt). No market
 *     implications, no stock judgment — just "N 条来源覆盖，跨度 X".
 *   - uncertainties (当前仍不确定什么): data gaps — count of records missing a
 *     summary, missing a url, or archived with status="missing_fields". Plus a
 *     conservative uncertainty statement. Never invents a gap that isn't there.
 *
 * NFR: no buy/sell/target-price/position wording anywhere (this is not
 * investment advice). The text stays in the descriptive/uncertainty register.
 */
export function derivePartitions(
  title: string,
  records: DeriveRecord[],
): ExplanationPartitions {
  const summary = deriveSummary(title, records);
  const whyItMatters = deriveWhyItMatters(records);
  const uncertainties = deriveUncertainties(records);
  return { summary, whyItMatters, uncertainties };
}

/**
 * 发生了什么: the title plus the latest record's summary. The latest record is
 * the one with the greatest non-null publishedAt (records arrive in publishedAt
 * asc order, so the latest is the last non-null one). If the latest record has
 * no summary, fall back to the title alone — never fabricate a description.
 */
function deriveSummary(title: string, records: DeriveRecord[]): string {
  // Records are in publishedAt asc; the latest non-null publishedAt is the tail.
  // If all publishedAt are null, fall back to the last record (stable pick).
  let latestIdx = -1;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.publishedAt !== null) {
      latestIdx = i;
      break;
    }
  }
  if (latestIdx === -1) latestIdx = records.length - 1;

  const latestSummary = records[latestIdx]!.summary;
  if (latestSummary !== null && latestSummary.trim() !== "") {
    return `${title}：${latestSummary.trim()}`;
  }
  return title;
}

/**
 * 为什么重要: an objective statement of source count and coverage span. Count
 * distinct source names (not raw record count) so the statement reflects
 * multi-source coverage honestly. The span is the time between the earliest and
 * latest non-null publishedAt; if only one record has a time, the span is
 * omitted (not "0 days" which would mislead).
 */
function deriveWhyItMatters(records: DeriveRecord[]): string {
  const distinctSources = new Set(records.map((r) => r.sourceName));
  const sourceCount = distinctSources.size;
  const recordCount = records.length;

  const times = records
    .map((r) => r.publishedAt)
    .filter((t): t is Date => t !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (times.length >= 2) {
    const earliest = times[0]!;
    const latest = times[times.length - 1]!;
    const spanDays = Math.round(
      (latest.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (spanDays > 0) {
      return `该事件由 ${sourceCount} 个来源、共 ${recordCount} 条记录覆盖，时间跨度约 ${spanDays} 天。多源覆盖提高了事件的可信度，但读者仍应对照下方原始来源核验。`;
    }
  }
  return `该事件由 ${sourceCount} 个来源、共 ${recordCount} 条记录覆盖。读者应对照下方原始来源核验细节。`;
}

/**
 * 当前仍不确定什么: data gaps derived from the evidence set. Counts records
 * that are missing a summary, missing a url, or archived with status=
 * "missing_fields". Produces a conservative statement listing only the gaps
 * that actually exist. If there are no gaps, states that the evidence set is
 * internally complete while noting that completeness does not equal correctness.
 */
function deriveUncertainties(records: DeriveRecord[]): string {
  const missingSummary = records.filter(
    (r) => r.summary === null || r.summary.trim() === "",
  ).length;
  const missingUrl = records.filter(
    (r) => r.url === null || r.url.trim() === "",
  ).length;
  const missingFields = records.filter((r) => r.status === "missing_fields").length;

  const gaps: string[] = [];
  if (missingSummary > 0) {
    gaps.push(`${missingSummary} 条记录缺少摘要`);
  }
  if (missingUrl > 0) {
    gaps.push(`${missingUrl} 条记录缺少原始链接`);
  }
  if (missingFields > 0) {
    gaps.push(`${missingFields} 条记录在采集时存在字段缺失`);
  }

  if (gaps.length === 0) {
    return "当前证据集在结构上完整（各记录均含摘要与原始链接）。结构完整不代表事实无误，后续若有新增来源或更正，解释可能随之更新。";
  }

  return `当前仍存在以下数据缺口：${gaps.join("；")}。这些缺口可能影响事件全貌的呈现，读者应注意相关记录的信息密度较低。后续若有新增来源或更正，解释可能随之更新。`;
}
