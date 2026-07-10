/**
 * explanation domain types — Story 1.8.
 *
 * The explanation module owns ExplanationVersion (AD-5 append-only) and the
 * deterministic three-partition derivation (V1 source="template"). It never
 * writes hot_events, evidence_records, or published_* tables (publish-
 * orchestrator owns the public projections; this module only appends
 * explanation_versions and lets publish-orchestrator read the latest at
 * projection time).
 *
 * The three partitions map directly to the epic's "detail page three blocks":
 *   - summary        → 发生了什么 (what happened)
 *   - whyItMatters   → 为什么重要 (why it matters)
 *   - uncertainties  → 当前仍不确定什么 (what remains uncertain)
 *
 * NFR: the deterministic derivation NEVER fabricates facts. summary is title +
 * latest record summary; whyItMatters is an objective statement of source count
 * / coverage span; uncertainties calls out data gaps (missing summary / missing
 * url / missing_fields records). No market implications, no stock-specific
 * judgment, no investment advice wording.
 */

import type { PrismaClient } from "../../../generated/client.js";

/**
 * The provenance of an explanation version. Stored on every ExplanationVersion
 * row so the operator audit chain can tell which version came from which source
 * (AD-5 "which version is from AI/human"). The public read model carries this
 * through as `explanationSource` but the public surface shows only the uniform
 * `<AiLabel>` (epic: uniform, identical on public and operator).
 *
 *   - template: V1 deterministic derivation from real evidence (this story).
 *   - ai:       a real LLM provider (deferred — not wired in 1.8).
 *   - human:    an operator-authored revision (1.9 operator revision UI).
 */
export const ExplanationSource = {
  Template: "template",
  Ai: "ai",
  Human: "human",
} as const;

export type ExplanationSource = (typeof ExplanationSource)[keyof typeof ExplanationSource];

/**
 * The three explanation partitions. Each is a non-empty string (the derivation
 * never produces an empty partition when there is evidence; when there is no
 * evidence, generateExplanation returns null and writes nothing — never an
 * empty version). All three are plain text derived from real evidence fields.
 */
export interface ExplanationPartitions {
  /** 发生了什么 — title + latest record's summary. */
  summary: string;
  /** 为什么重要 — objective statement of source count / coverage span. */
  whyItMatters: string;
  /** 当前仍不确定什么 — data gaps (missing summary / url / missing_fields). */
  uncertainties: string;
}

/**
 * Options for generateExplanation. `{ prisma, traceId, hotEventId }` mirrors
 * the established command pattern (clusterEvents, decideReview). The derivation
 * reads the HotEvent + its member evidence_records + their evidence_sources to
 * derive the partitions deterministically, then APPENDS one ExplanationVersion
 * row (source="template"). Returns null when the event has no member evidence
 * (no evidence → no honest derivation → no version written).
 */
export interface GenerateExplanationOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * The result of a successful generation: the newly-appended version's id +
 * partitions + provenance + createdAt. Callers (publish-orchestrator projection,
 * verify/seed) consume the partitions directly. The id is returned so the
 * audit chain can link back to the exact version.
 */
export interface GenerateExplanationResult extends ExplanationPartitions {
  explanationVersionId: string;
  hotEventId: string;
  source: ExplanationSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestExplanation — returns the most recent ExplanationVersion
 * for an event (createdAt desc first) or null if none exist. publish-
 * orchestrator uses this at projection time to surface the current version.
 */
export interface GetLatestExplanationOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * One explanation version row projected for read. Mirrors the ExplanationVersion
 * columns the public projection + operator audit need (no write paths here).
 */
export interface ExplanationVersionRecord extends ExplanationPartitions {
  id: string;
  hotEventId: string;
  source: ExplanationSource;
  createdAt: Date;
}

// --- Story 1.9: operator-authored explanation revision -----------------------

/**
 * Options for saveExplanation — the operator-authored explanation write-point.
 * The caller passes the three partitions verbatim (operator hand-typed text;
 * NOT LLM-generated — real LLM is deferred, see generateExplanation). `source`
 * is required: V1 callers pass `ExplanationSource.Human` so the provenance is
 * recorded (the public read model then DROPS the uniform <AiLabel> for human-
 * sourced partitions — AC3 + 1.8 defer, gated by `source !== "human"`).
 *
 * saveExplanation appends one ExplanationVersion row ONLY when the three
 * partitions differ from the latest version (change detection: no dirty
 * version, no spurious source flip). A no-op submit (same text) writes nothing.
 */
export interface SaveExplanationOptions extends ExplanationPartitions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  source: ExplanationSource;
}

/**
 * Result of saveExplanation. `appended: true` + `explanationVersionId` when a
 * new ExplanationVersion row was appended (the three partitions changed vs the
 * latest version). `appended: false` on no-op (no change — no dirty version, no
 * spurious source flip). `notFound: true` when the event does not exist.
 */
export interface SaveExplanationResult {
  appended: boolean;
  explanationVersionId?: string;
  notFound?: boolean;
}
