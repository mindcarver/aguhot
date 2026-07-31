import type { Prisma, PrismaClient } from "../../../generated/client.js";
import { assertCapitalDataRecord, CapitalAvailability } from "./types.js";
import { capitalRecordKey, selectCapitalRecordsAt } from "./point-in-time.js";
import type { CapitalDataRecord } from "./types.js";

export interface CapitalRecordAppendResult {
  inserted: boolean;
  recordKey: string;
}

export interface CapitalRecordAppendOptions {
  traceId?: string | null;
}

export interface CapitalRecordListOptions {
  metricKey?: string;
  market?: string;
}

export class CapitalRecordConflictError extends Error {
  constructor(recordKey: string) {
    super(`Capital environment record key already contains different data: ${recordKey}`);
    this.name = "CapitalRecordConflictError";
  }
}

type CapitalRecordRow = Awaited<
  ReturnType<PrismaClient["capitalEnvironmentRecord"]["findMany"]>
>[number];

function date(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid capital record timestamp: ${value}`);
  }
  return parsed;
}

function optionalDate(value: string | null): Date | null {
  return value === null ? null : date(value);
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function decimalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    return value.toNumber();
  }
  return Number(value);
}

function sameRecord(
  row: CapitalRecordRow,
  record: CapitalDataRecord,
): boolean {
  return (
    row.recordKey === capitalRecordKey(record) &&
    row.metricKey === record.metricKey &&
    row.market === record.market &&
    row.dimension === record.dimension &&
    decimalNumber(row.value) === record.value &&
    row.unit === record.unit &&
    iso(row.observedAt) === date(record.observedAt).toISOString() &&
    iso(row.publishedAt) === iso(optionalDate(record.publishedAt)) &&
    (row.availability === CapitalAvailability.Unknown || row.availability === CapitalAvailability.Failed
      ? true
      : iso(row.asOf) === date(record.asOf).toISOString()) &&
    row.sourceId === record.source.id &&
    row.sourceName === record.source.name &&
    row.sourceDataset === record.source.dataset &&
    row.sourceDocumentationUrl === record.source.documentationUrl &&
    row.processingVersion === record.processingVersion &&
    row.availability === record.availability &&
    row.statusReason === record.statusReason &&
    row.revision === record.revision
  );
}

function toRowData(
  record: CapitalDataRecord,
  traceId: string | null,
): Prisma.CapitalEnvironmentRecordCreateInput {
  return {
    id: record.id,
    recordKey: capitalRecordKey(record),
    metricKey: record.metricKey,
    market: record.market,
    dimension: record.dimension,
    value: record.value,
    unit: record.unit,
    observedAt: date(record.observedAt),
    publishedAt: optionalDate(record.publishedAt),
    asOf: date(record.asOf),
    sourceId: record.source.id,
    sourceName: record.source.name,
    sourceDataset: record.source.dataset,
    sourceDocumentationUrl: record.source.documentationUrl,
    processingVersion: record.processingVersion,
    availability: record.availability,
    statusReason: record.statusReason,
    revision: record.revision,
    traceId,
  };
}

function fromRow(row: CapitalRecordRow): CapitalDataRecord {
  const record: CapitalDataRecord = {
    id: row.id,
    metricKey: row.metricKey,
    market: row.market as CapitalDataRecord["market"],
    dimension: row.dimension as CapitalDataRecord["dimension"],
    value: decimalNumber(row.value),
    unit: row.unit,
    observedAt: row.observedAt.toISOString(),
    publishedAt: iso(row.publishedAt),
    asOf: row.asOf.toISOString(),
    source: {
      id: row.sourceId,
      name: row.sourceName,
      dataset: row.sourceDataset,
      documentationUrl: row.sourceDocumentationUrl,
    },
    processingVersion: row.processingVersion,
    availability: row.availability as CapitalDataRecord["availability"],
    statusReason: row.statusReason,
    revision: row.revision,
  };
  assertCapitalDataRecord(record);
  return record;
}

/** Append one validated record without overwriting a prior revision. */
export async function appendCapitalDataRecord(
  prisma: PrismaClient,
  record: CapitalDataRecord,
  options: CapitalRecordAppendOptions = {},
): Promise<CapitalRecordAppendResult> {
  assertCapitalDataRecord(record);
  const traceId = options.traceId ?? null;
  const recordKey = capitalRecordKey(record);
  const existing = await prisma.capitalEnvironmentRecord.findUnique({
    where: { recordKey },
  });
  if (existing !== null) {
    if (!sameRecord(existing, record)) throw new CapitalRecordConflictError(recordKey);
    return { inserted: false, recordKey };
  }

  try {
    await prisma.capitalEnvironmentRecord.create({ data: toRowData(record, traceId) });
    return { inserted: true, recordKey };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const raced = await prisma.capitalEnvironmentRecord.findUnique({
      where: { recordKey },
    });
    if (raced === null) throw error;
    if (!sameRecord(raced, record)) throw new CapitalRecordConflictError(recordKey);
    return { inserted: false, recordKey };
  }
}

/** Read persisted records and apply the shared point-in-time reconstruction rule. */
export async function listCapitalDataRecordsAt(
  prisma: PrismaClient,
  asOf: string,
  options: CapitalRecordListOptions = {},
): Promise<CapitalDataRecord[]> {
  const cutoff = date(asOf);
  const rows = await prisma.capitalEnvironmentRecord.findMany({
    where: {
      ...(options.metricKey === undefined ? {} : { metricKey: options.metricKey }),
      ...(options.market === undefined ? {} : { market: options.market }),
      OR: [
        { publishedAt: { lte: cutoff } },
        { publishedAt: null, asOf: { lte: cutoff } },
      ],
    },
    orderBy: [{ observedAt: "asc" }, { revision: "asc" }],
  });
  return selectCapitalRecordsAt(rows.map(fromRow), asOf);
}
