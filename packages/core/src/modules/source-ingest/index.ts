/**
 * source-ingest module barrel.
 *
 * The single write-owner of evidence_* tables (AD-2). Exports the ingest
 * service, the SourceAdapter port, the RssAdapter implementation, and the
 * status/kind/item types. The Prisma client and the shared id helpers live one
 * level up and are re-exported from the package barrel.
 */

export type { SourceAdapter } from "./adapter.js";
export { RssAdapter } from "./rss-adapter.js";
export type { RssAdapterOptions } from "./rss-adapter.js";
export {
  ingestSources,
} from "./ingest-service.js";
export type {
  AdapterFactory,
  IngestSourcesOptions,
  IngestSourcesResult,
  SourceIngestSummary,
} from "./ingest-service.js";
export { IngestStatus, SourceKind, contentHash } from "./types.js";
export type { EvidenceItem, IngestStatus as IngestStatusType, SourceKind as SourceKindType } from "./types.js";
