import type { PrismaClient } from "../../../generated/client.js";
import { mapAshareObservation } from "./ashare-observation-adapter.js";
import { getCapitalMetricCatalogEntry } from "./metric-catalog.js";
import { appendCapitalDataRecord } from "./record-repository.js";
import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
  PublicationDateCapability,
} from "./types.js";
import type {
  AshareObservationInput,
  AshareObservationKind,
  AshareObservationMappingResult,
} from "./ashare-observation-adapter.js";
import type {
  CapitalDataRecord,
  CapitalAvailability as CapitalAvailabilityType,
  CapitalMetricSourceFieldMapping,
} from "./types.js";
import type { CapitalMetricMappingObservation } from "./metric-catalog.js";

export const ASHARE_CAPITAL_PROCESSING_VERSION = "capital-environment-ashare-v1";

export interface SyncAshareCapitalEnvironmentRecordsOptions {
  processingVersion?: string;
  traceId?: string;
  mappingOverrides?: Partial<Record<AshareObservationKind, CapitalMetricMappingObservation>>;
}

export interface SyncAshareCapitalEnvironmentRecordsResult {
  scanned: Record<AshareObservationKind, number>;
  availability: Record<CapitalAvailabilityType, number>;
  inserted: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failedSources: AshareObservationKind[];
}

type SidecarObservation = {
  id: string;
  tradeDate: Date;
  ingestedAt: Date;
  traceId: string | null;
};

// These describe the verified upstream fields represented by the normalized
// sidecar. They intentionally do not read from the catalog, so a catalog or
// adapter drift reaches the pending-review path instead of comparing a value
// to itself.
const ASHARE_SIDECAR_MAPPINGS: Record<AshareObservationKind, CapitalMetricMappingObservation> = {
  breadth: {
    sourceId: "cn-akshare-breadth",
    dataset: "A-share breadth and turnover summaries",
    valueField: null,
    valueFields: ["上涨家数", "下跌家数"],
    valueTransform: "independent_scalar_fields",
    rawUnit: null,
    observedAtField: "交易日期",
    publishedAtField: null,
    unitField: null,
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
  },
  index: {
    sourceId: "cn-akshare-index-sector",
    dataset: "A-share index and申万一级行业 daily bars",
    valueField: "收盘",
    valueFields: ["收盘"],
    valueTransform: "identity",
    rawUnit: null,
    observedAtField: "日期",
    publishedAtField: null,
    unitField: null,
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
  },
  sector: {
    sourceId: "cn-akshare-index-sector",
    dataset: "A-share index and申万一级行业 daily bars",
    valueField: "收盘",
    valueFields: ["收盘"],
    valueTransform: "identity",
    rawUnit: null,
    observedAtField: "日期",
    publishedAtField: null,
    unitField: null,
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
  },
};

function emptyAvailability(): Record<CapitalAvailabilityType, number> {
  return {
    [CapitalAvailability.Available]: 0,
    [CapitalAvailability.Partial]: 0,
    [CapitalAvailability.Unknown]: 0,
    [CapitalAvailability.Failed]: 0,
    [CapitalAvailability.PendingReview]: 0,
    [CapitalAvailability.IncompleteReconstruction]: 0,
  };
}

function sourceMappingFor(kind: AshareObservationKind): CapitalMetricSourceFieldMapping {
  const entry = getCapitalMetricCatalogEntry("cn-market-breadth");
  if (entry === undefined || entry.sourceFieldMapping === null) {
    throw new Error("cn-market-breadth catalog mapping is required for A-share observations");
  }
  const sourceMapping =
    kind === "breadth" ? entry.sourceFieldMapping : entry.relatedSourceFieldMappings[0];
  if (sourceMapping === undefined) {
    throw new Error(`cn-market-breadth related mapping is required for A-share ${kind}`);
  }
  return sourceMapping;
}

function mappingFor(
  kind: AshareObservationKind,
  mappingOverrides: SyncAshareCapitalEnvironmentRecordsOptions["mappingOverrides"],
): CapitalMetricMappingObservation {
  return mappingOverrides?.[kind] ?? ASHARE_SIDECAR_MAPPINGS[kind];
}

function inputFor(
  kind: AshareObservationKind,
  row: SidecarObservation,
  value: number | null,
  processingVersion: string,
  mappingOverrides: SyncAshareCapitalEnvironmentRecordsOptions["mappingOverrides"],
): AshareObservationInput {
  return {
    kind,
    id: `capital-environment-${kind}-${row.id}-${processingVersion}`,
    value,
    observedAt: row.tradeDate.toISOString(),
    publishedAt: null,
    // AkShare does not expose provider publication time here. The sidecar
    // capture time is the earliest point at which this source snapshot was
    // available to AGUHOT; availability remains unknown, never confirmed.
    asOf: row.ingestedAt.toISOString(),
    revision: 1,
    processingVersion,
    mapping: mappingFor(kind, mappingOverrides),
  };
}

function pendingReviewRecord(
  input: AshareObservationInput,
  mapped: AshareObservationMappingResult,
): CapitalDataRecord {
  const expected = sourceMappingFor(input.kind);
  const sourceMatches = expected.sourceId === input.mapping.sourceId;
  const datasetMatches = sourceMatches && expected.dataset === input.mapping.dataset;
  return {
    id: input.id,
    metricKey: "cn-market-breadth",
    market: CapitalMarket.China,
    dimension: CapitalDimension.MarketBreadth,
    value: null,
    unit: null,
    observedAt: input.observedAt,
    publishedAt: null,
    asOf: input.asOf,
    source: {
      id: input.mapping.sourceId,
      name: sourceMatches ? expected.provider : input.mapping.sourceId,
      dataset: `${input.mapping.dataset} (${input.kind} sidecar)`,
      documentationUrl: datasetMatches ? expected.evidenceUrl : null,
    },
    processingVersion: input.processingVersion,
    availability: CapitalAvailability.PendingReview,
    statusReason: mapped.statusReason,
    revision: input.revision,
  };
}

function markFailedSource(
  result: SyncAshareCapitalEnvironmentRecordsResult,
  kind: AshareObservationKind,
): void {
  result.failed++;
  if (!result.failedSources.includes(kind)) result.failedSources.push(kind);
}

function sourceStatusObservedAt(asOf: string): string {
  return `${asOf.slice(0, 10)}T00:00:00.000Z`;
}

function sourceStatusRecord(
  kind: AshareObservationKind,
  availability: CapitalAvailabilityType,
  statusReason: string,
  processingVersion: string,
  asOf: string,
): CapitalDataRecord {
  const source = sourceMappingFor(kind);
  const observedAt = sourceStatusObservedAt(asOf);
  return {
    id: `capital-environment-${kind}-${availability}-${processingVersion}-${observedAt.slice(0, 10)}`,
    metricKey: "cn-market-breadth",
    market: CapitalMarket.China,
    dimension: CapitalDimension.MarketBreadth,
    value: null,
    unit: null,
    observedAt,
    publishedAt: null,
    asOf,
    source: {
      id: source.sourceId,
      name: source.provider,
      dataset: `${source.dataset} (${kind} sidecar)`,
      documentationUrl: source.evidenceUrl,
    },
    processingVersion,
    availability,
    statusReason,
    revision: 1,
  };
}

async function persistSourceReadFailure(
  prisma: PrismaClient,
  kind: AshareObservationKind,
  processingVersion: string,
  result: SyncAshareCapitalEnvironmentRecordsResult,
  traceId: string | undefined,
): Promise<void> {
  markFailedSource(result, kind);
  const asOf = new Date().toISOString();
  try {
    const appended = await appendCapitalDataRecord(
      prisma,
      sourceStatusRecord(
        kind,
        CapitalAvailability.Failed,
        `A 股 ${kind} sidecar read failed; see worker logs for error details.`,
        processingVersion,
        asOf,
      ),
      { traceId },
    );
    result.availability[CapitalAvailability.Failed]++;
    if (appended.inserted) result.inserted++;
    else result.unchanged++;
  } catch (persistError) {
    console.warn(
      `[capital-environment] failed to persist ${kind} source failure: ${(persistError as Error).message}`,
    );
    throw persistError;
  }
}

async function persistEmptySource(
  prisma: PrismaClient,
  kind: AshareObservationKind,
  processingVersion: string,
  result: SyncAshareCapitalEnvironmentRecordsResult,
  traceId: string | undefined,
): Promise<void> {
  const asOf = new Date().toISOString();
  try {
    const appended = await appendCapitalDataRecord(
      prisma,
      sourceStatusRecord(
        kind,
        CapitalAvailability.Unknown,
        `A 股 ${kind} sidecar returned no rows; no value was inferred.`,
        processingVersion,
        asOf,
      ),
      { traceId },
    );
    result.availability[CapitalAvailability.Unknown]++;
    if (appended.inserted) result.inserted++;
    else result.unchanged++;
  } catch (error) {
    console.warn(
      `[capital-environment] failed to persist ${kind} empty-source status: ${(error as Error).message}`,
    );
    throw error;
  }
}

async function persistMappedObservation(
  prisma: PrismaClient,
  row: SidecarObservation,
  input: AshareObservationInput,
  result: SyncAshareCapitalEnvironmentRecordsResult,
  traceId: string | undefined,
): Promise<void> {
  let mapped: AshareObservationMappingResult;
  try {
    mapped = mapAshareObservation(input);
  } catch (error) {
    markFailedSource(result, input.kind);
    console.warn(
      `[capital-environment] skip ${input.kind} ${row.id}: mapping failed: ${(error as Error).message}`,
    );
    throw error;
  }
  result.availability[mapped.availability]++;
  const record =
    mapped.availability === CapitalAvailability.PendingReview
      ? pendingReviewRecord(input, mapped)
      : mapped.record;
  if (record === null) {
    result.skipped++;
    return;
  }

  try {
    const appended = await appendCapitalDataRecord(
      prisma,
      {
        ...record,
        id: `${record.id}-${mapped.availability}`,
      },
      {
        traceId: traceId ?? row.traceId ?? undefined,
      },
    );
    if (appended.inserted) result.inserted++;
    else result.unchanged++;
  } catch (error) {
    markFailedSource(result, input.kind);
    console.warn(
      `[capital-environment] skip ${input.kind} ${row.id}: persistence failed: ${(error as Error).message}`,
    );
    throw error;
  }
}

/**
 * Read the three existing A-share sidecar tables and reconcile their catalog
 * mappings into append-only capital-environment records. Index and sector rows
 * are retained as explicitly non-promoted source mappings until a separate
 * scalar metric contract is approved; only the catalog's breadth metric can
 * create a capital record today.
 */
export async function syncAshareCapitalEnvironmentRecords(
  prisma: PrismaClient,
  options: SyncAshareCapitalEnvironmentRecordsOptions = {},
): Promise<SyncAshareCapitalEnvironmentRecordsResult> {
  const processingVersion = options.processingVersion ?? ASHARE_CAPITAL_PROCESSING_VERSION;
  const result: SyncAshareCapitalEnvironmentRecordsResult = {
    scanned: { index: 0, sector: 0, breadth: 0 },
    availability: emptyAvailability(),
    inserted: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    failedSources: [],
  };
  const readSource = async <T>(
    kind: AshareObservationKind,
    read: () => Promise<T[]>,
  ): Promise<T[] | null> => {
    try {
      return await read();
    } catch (error) {
      const readError = error as Error;
      await persistSourceReadFailure(
        prisma,
        kind,
        processingVersion,
        result,
        options.traceId,
      );
      console.warn(`[capital-environment] skip ${kind} source: read failed: ${readError.message}`);
      return null;
    }
  };
  const [indexRead, sectorRead, breadthRead] = await Promise.all([
    readSource("index", () =>
      prisma.indexDailyBar.findMany({
        select: { id: true, tradeDate: true, close: true, ingestedAt: true, traceId: true },
        orderBy: [{ tradeDate: "asc" }, { indexCode: "asc" }],
      }),
    ),
    readSource("sector", () =>
      prisma.sectorDailyBar.findMany({
        select: { id: true, tradeDate: true, close: true, ingestedAt: true, traceId: true },
        orderBy: [{ tradeDate: "asc" }, { sectorCode: "asc" }],
      }),
    ),
    readSource("breadth", () =>
      prisma.marketBreadthDaily.findMany({
        select: { id: true, tradeDate: true, advancingCount: true, ingestedAt: true, traceId: true },
        orderBy: { tradeDate: "asc" },
      }),
    ),
  ]);

  const indexRows = indexRead ?? [];
  const sectorRows = sectorRead ?? [];
  const breadthRows = breadthRead ?? [];
  if (indexRead !== null && indexRows.length === 0) {
    await persistEmptySource(prisma, "index", processingVersion, result, options.traceId);
  }
  if (sectorRead !== null && sectorRows.length === 0) {
    await persistEmptySource(prisma, "sector", processingVersion, result, options.traceId);
  }
  if (breadthRead !== null && breadthRows.length === 0) {
    await persistEmptySource(prisma, "breadth", processingVersion, result, options.traceId);
  }

  for (const row of indexRows) {
    result.scanned.index++;
    await persistMappedObservation(
      prisma,
      row,
      inputFor("index", row, Number(row.close), processingVersion, options.mappingOverrides),
      result,
      options.traceId,
    );
  }
  for (const row of sectorRows) {
    result.scanned.sector++;
    await persistMappedObservation(
      prisma,
      row,
      inputFor("sector", row, Number(row.close), processingVersion, options.mappingOverrides),
      result,
      options.traceId,
    );
  }
  for (const row of breadthRows) {
    result.scanned.breadth++;
    await persistMappedObservation(
      prisma,
      row,
      inputFor("breadth", row, row.advancingCount, processingVersion, options.mappingOverrides),
      result,
      options.traceId,
    );
  }
  return result;
}
