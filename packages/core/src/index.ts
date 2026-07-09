/**
 * @aguhot/core — AGUHOT domain modules, contracts, and shared kernel.
 *
 * Story 1.4 introduces the `source-ingest` module (evidence source ingest &
 * archive) plus the shared id helpers and the Prisma client singleton. Later
 * stories add event-assembly, publish-orchestrator, review-workflow, etc. under
 * this package, per ARCHITECTURE-SPINE.md Structural Seed.
 *
 * The public web app does NOT import this package: it must stay
 * DATABASE_URL-free (AD-3/AD-6). Only the worker runtime and (future)
 * operator flows consume these exports.
 */

// Shared kernel.
export { uuidv7, newTraceId } from "./shared/ids.js";

// Prisma client singleton (worker-only; never imported by the web app).
export { getPrisma, resetPrisma } from "./db.js";

// source-ingest module.
export type { SourceAdapter } from "./modules/source-ingest/adapter.js";
export { RssAdapter } from "./modules/source-ingest/rss-adapter.js";
export type { RssAdapterOptions } from "./modules/source-ingest/rss-adapter.js";
export { ingestSources } from "./modules/source-ingest/ingest-service.js";
export type {
  AdapterFactory,
  IngestSourcesOptions,
  IngestSourcesResult,
  SourceIngestSummary,
} from "./modules/source-ingest/ingest-service.js";
export { IngestStatus, SourceKind, contentHash } from "./modules/source-ingest/types.js";
export type {
  EvidenceItem,
  IngestStatus as IngestStatusType,
  SourceKind as SourceKindType,
} from "./modules/source-ingest/types.js";
