/**
 * Source-ingest domain types: status/kind unions (no TS enum, per repo
 * erasableSyntaxOnly convention), the normalized evidence item shape adapters
 * produce, and the content-hash used for deduplication.
 *
 * Status/kind are stored as String columns with TS union types (not Prisma
 * enum) to avoid enum friction with the Prisma 7 generator and to keep the
 * erasableSyntaxOnly invariant (no TS enum constructs).
 */

import { createHash } from "node:crypto";

/**
 * The lifecycle status of an archived evidence record.
 *
 * - `archived`: a fully-formed record (url + publishedAt present).
 * - `missingFields`: the item lacked a required field (url or publishedAt);
 *   it is still archived for traceability, with `failureReason` naming the
 *   missing field. Source-level failures (adapter threw) are recorded on the
 *   `EvidenceSource.lastError` row instead — they produce no record, so there
 *   is no `failed` record status.
 */
export const IngestStatus = {
  Archived: "archived",
  MissingFields: "missing_fields",
} as const;

export type IngestStatus = (typeof IngestStatus)[keyof typeof IngestStatus];

/**
 * The kind of evidence source. Selects which SourceAdapter the worker resolves
 * at runtime (AD-7). New kinds are added here + a new adapter implementation;
 * `ingestSources` itself never changes.
 */
export const SourceKind = {
  Rss: "rss",
} as const;

export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

/**
 * A normalized evidence item produced by a SourceAdapter. The ingest service
 * does not know the original wire format (RSS XML, API JSON, ...) — it only
 * sees this shape, so swapping sources means swapping adapters (AD-7).
 *
 * `url` and `publishedAt` are optional on the item: when missing the record is
 * archived as `missing_fields` rather than dropped (AC3 traceability).
 * `raw` carries the original parsed payload for provenance.
 */
export interface EvidenceItem {
  url: string | null;
  title: string | null;
  summary: string | null;
  publishedAt: Date | null;
  raw: unknown;
}

/**
 * Compute the deterministic content hash for an evidence item.
 *
 * Material: normalized url + title + publishedAt, joined by NUL and sha256'd.
 * `url`/`title` are trimmed and lowercased; `publishedAt` is its ISO-8601
 * string (or empty when null). Two items that agree on these three fields
 * produce the same hash and are treated as duplicates — the upsert in
 * ingestSources skips on collision so the existing record is never overwritten
 * (AC1 dedup, ponytail: update: {}).
 *
 * Note: the date is hashed at full ISO precision (millisecond-aware). RSS
 * pubDate is typically second-precision and stable across re-publishes, so this
 * is sufficient for AC1 dedup. Broader cosmetic normalization (trailing-slash
 * collapse, sub-second truncation) is intentionally not applied — add a unit
 * test pinning that contract if a future source makes it required.
 */
export function contentHash(item: EvidenceItem): string {
  const url = normalizeText(item.url);
  const title = normalizeText(item.title);
  const publishedAt = item.publishedAt ? item.publishedAt.toISOString() : "";
  const material = `${url}\u{0000}${title}\u{0000}${publishedAt}`;
  return createHash("sha256").update(material).digest("hex");
}

function normalizeText(value: string | null): string {
  if (value === null) return "";
  return value.trim().toLowerCase();
}
