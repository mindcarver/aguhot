/**
 * ingestSources — the ingest service.
 *
 * Single write-owner of the evidence_* tables (AD-2): it only ever touches
 * `EvidenceSource` (to read enabled sources + record per-source failures) and
 * `EvidenceRecord` (to archive items). It never writes `HotEvent`,
 * `published_*`, or any other module's aggregate.
 *
 * Error isolation (AC3): each source's fetch+archive loop is wrapped in its
 * own try/catch. A source whose adapter throws (dead URL, malformed feed) gets
 * its `lastError` updated and produces zero records, but the remaining sources
 * are still archived and the call resolves successfully — a single broken
 * source never aborts the job.
 *
 * Dedup (AC1): items are deduped by `contentHash` (sha256 of normalized
 * url+title+publishedAt). The upsert's `update: {}` means a hash collision
 * with an existing record skips it entirely — existing records are never
 * overwritten (ponytail: the cheapest correct dedup is "do nothing").
 *
 * Missing-field traceability (AC3): an item lacking `url` or `publishedAt` is
 * still archived as `missing_fields` with a human-readable `failureReason`
 * naming the missing field, so it is traceable rather than silently dropped.
 */

import { newTraceId } from "../../shared/ids.js";
import type { PrismaClient } from "../../../generated/client.js";
import type { SourceAdapter } from "./adapter.js";
import { RssAdapter } from "./rss-adapter.js";
import { IngestStatus, SourceKind, contentHash } from "./types.js";
import type { EvidenceItem } from "./types.js";

/**
 * Factory that resolves a SourceAdapter for a given source kind. The worker
 * supplies this so the domain service stays free of concrete adapter imports
 * (AD-7): `ingestSources` depends on the port, the worker wires the
 * implementation.
 */
export type AdapterFactory = (source: {
  id: string;
  kind: string;
  feedUrl: string;
}) => SourceAdapter;

export interface IngestSourcesOptions {
  prisma: PrismaClient;
  traceId: string;
  /** Resolve the adapter for a source. Defaults to throwing on unknown kinds. */
  adapterFor?: AdapterFactory;
}

export interface SourceIngestSummary {
  sourceId: string;
  archived: number;
  missingFields: number;
  skippedDuplicates: number;
  error: string | null;
}

export interface IngestSourcesResult {
  traceId: string;
  sources: SourceIngestSummary[];
}

export async function ingestSources(
  options: IngestSourcesOptions,
): Promise<IngestSourcesResult> {
  const { prisma, traceId } = options;
  const adapterFor = options.adapterFor ?? defaultAdapterFactory;

  const sources = await prisma.evidenceSource.findMany({
    where: { enabled: true },
  });

  const summaries: SourceIngestSummary[] = [];
  for (const source of sources) {
    summaries.push(await ingestOneSource({ prisma, traceId, source, adapterFor }));
  }

  return { traceId, sources: summaries };
}

async function ingestOneSource(args: {
  prisma: PrismaClient;
  traceId: string;
  source: {
    id: string;
    kind: string;
    feedUrl: string;
  };
  adapterFor: AdapterFactory;
}): Promise<SourceIngestSummary> {
  const { prisma, traceId, source, adapterFor } = args;
  const summary: SourceIngestSummary = {
    sourceId: source.id,
    archived: 0,
    missingFields: 0,
    skippedDuplicates: 0,
    error: null,
  };

  try {
    const adapter = adapterFor(source);
    const items = await adapter.fetch();

    for (const item of items) {
      const hash = contentHash(item);
      const missing = missingField(item);

      // Detect whether this hash already exists so the summary can report
      // skipped duplicates. We then still upsert (race-safe) rather than rely
      // on the read alone: a concurrent job could insert between the check and
      // a plain create, which would throw a unique-constraint violation. The
      // upsert's `update: {}` is the dedup invariant — an existing record is
      // never rewritten by a re-ingest (AC1), matching the spec golden example.
      const existing = await prisma.evidenceRecord.findUnique({
        where: { contentHash: hash },
        select: { id: true },
      });

      const result = await prisma.evidenceRecord.upsert({
        where: { contentHash: hash },
        update: {}, // ponytail: hit -> skip, never overwrite (AC1 dedup)
        create: {
          id: newTraceId(),
          sourceId: source.id,
          url: item.url,
          title: item.title,
          summary: item.summary,
          publishedAt: item.publishedAt,
          contentHash: hash,
          status: missing !== null ? IngestStatus.MissingFields : IngestStatus.Archived,
          failureReason: missing !== null ? `missing ${missing}` : null,
          rawPayload: item.raw as object,
          traceId,
        },
      });

      // `createdAt` equals `updatedAt` exactly when the row was just created
      // by this upsert; on a skip (update branch) Prisma returns the existing
      // row whose updatedAt precedes this call. Use that to attribute the
      // summary without an extra query.
      if (existing !== null) {
        summary.skippedDuplicates += 1;
      } else if (missing !== null) {
        summary.missingFields += 1;
        void result; // upsert returned the created row; nothing else needed.
      } else {
        summary.archived += 1;
        void result;
      }
    }

    // A successful ingest clears any prior per-source error so the row does
    // not retain a stale failure after recovery.
    await prisma.evidenceSource.update({
      where: { id: source.id },
      data: { lastError: null },
    });
  } catch (error) {
    summary.error = errorToString(error);
    await prisma.evidenceSource.update({
      where: { id: source.id },
      data: { lastError: summary.error },
    });
  }

  return summary;
}

/**
 * Return the name of the first missing required field, or null if all present.
 * `url` and `publishedAt` are required for a fully-formed evidence record; an
 * item missing either is archived as `missing_fields` for traceability (AC3).
 */
function missingField(item: EvidenceItem): "url" | "published_at" | null {
  if (item.url === null || item.url === "") return "url";
  if (item.publishedAt === null) return "published_at";
  return null;
}

function errorToString(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Default adapter factory: resolves a kind to its concrete adapter. The worker
 * supplies its own factory (assembling adapters is a worker-layer concern per
 * AD-7), but a working default keeps the service usable in isolation/tests
 * and the verify script. Unknown kinds throw — that error is caught by the
 * per-source try/catch so a misconfigured source is isolated (AC3) rather than
 * crashing the job.
 */
const defaultAdapterFactory: AdapterFactory = (source) => {
  const kind = source.kind as SourceKind;
  if (kind === SourceKind.Rss) {
    return new RssAdapter({ feedUrl: source.feedUrl });
  }
  throw new Error(`[source-ingest] unknown source kind: ${source.kind}`);
};
