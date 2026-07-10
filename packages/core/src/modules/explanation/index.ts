/**
 * explanation module barrel — Story 1.8.
 *
 * Owns the ExplanationVersion table (AD-5 append-only). Exposes the
 * deterministic three-partition generator + the latest-version read query.
 * The Prisma client lives one level up and is re-exported from the package
 * barrel.
 *
 * This module never writes hot_events, evidence_records, or published_* tables.
 * It only appends explanation_versions; publish-orchestrator reads the latest
 * version at projection time and writes the public read models.
 */

export { generateExplanation, getLatestExplanation, derivePartitions, saveExplanation } from "./explain-service.js";
export { ExplanationSource } from "./types.js";
export type {
  ExplanationSource as ExplanationSourceType,
  ExplanationPartitions,
  GenerateExplanationOptions,
  GenerateExplanationResult,
  GetLatestExplanationOptions,
  ExplanationVersionRecord,
  SaveExplanationOptions,
  SaveExplanationResult,
} from "./types.js";
