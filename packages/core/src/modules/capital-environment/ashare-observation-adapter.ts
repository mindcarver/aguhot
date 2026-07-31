import { assertCapitalDataRecord, CapitalAvailability } from "./types.js";
import {
  evaluateCapitalMetricMapping,
  getCapitalMetricCatalogEntry,
  mapCapitalMetricObservationToRecord,
} from "./metric-catalog.js";
import type {
  CapitalDataRecord,
  CapitalMetricCatalogEntry,
  CapitalSourceReference,
} from "./types.js";
import type { CapitalMetricMappingObservation } from "./metric-catalog.js";

export type AshareObservationKind = "breadth" | "index" | "sector";

export interface AshareObservationInput {
  kind: AshareObservationKind;
  id: string;
  value: number | null;
  observedAt: string;
  publishedAt: string | null;
  asOf: string;
  revision: number;
  processingVersion: string;
  mapping: CapitalMetricMappingObservation;
  statusReason?: string | null;
}

export interface AshareObservationMappingResult {
  kind: AshareObservationKind;
  availability: CapitalAvailability;
  statusReason: string;
  record: CapitalDataRecord | null;
}

const CAPITAL_METRIC_KEY = "cn-market-breadth";

function entryWithMapping(
  entry: CapitalMetricCatalogEntry,
  mapping: CapitalMetricCatalogEntry["sourceFieldMapping"],
): CapitalMetricCatalogEntry {
  return { ...entry, sourceFieldMapping: mapping };
}

function observedPendingSource(
  expected: CapitalMetricCatalogEntry["sourceFieldMapping"],
  observed: CapitalMetricMappingObservation,
): CapitalSourceReference {
  const sameSource = expected !== null && expected.sourceId === observed.sourceId;
  const sameDataset = sameSource && expected.dataset === observed.dataset;
  return {
    id: observed.sourceId,
    name: sameSource ? expected!.provider : observed.sourceId,
    dataset: observed.dataset,
    documentationUrl: sameDataset ? expected!.evidenceUrl : null,
  };
}

/**
 * Map one normalized sidecar observation without inventing a new metric.
 * The breadth entry is the only canonical A-share metric in #43. Index and
 * sector rows are related source evidence, so they are validated against the
 * related mapping but are not promoted into a new scalar metric record.
 */
export function mapAshareObservation(
  input: AshareObservationInput,
): AshareObservationMappingResult {
  const entry = getCapitalMetricCatalogEntry(CAPITAL_METRIC_KEY);
  if (entry === undefined || entry.sourceFieldMapping === null) {
    throw new Error(`Missing canonical capital metric: ${CAPITAL_METRIC_KEY}`);
  }

  const mapping = input.kind === "breadth"
    ? entry.sourceFieldMapping.sourceId === input.mapping.sourceId
      ? entry.sourceFieldMapping
      : null
    : entry.relatedSourceFieldMappings.find(
        (candidate) => candidate.sourceId === input.mapping.sourceId,
      );
  if (mapping === undefined || mapping === null) {
    return {
      kind: input.kind,
      availability: CapitalAvailability.PendingReview,
      statusReason:
        input.statusReason ??
        `A 股 ${input.kind} source mapping 未在目录中登记，等待复核：${input.mapping.sourceId}/${input.mapping.dataset}`,
      record: null,
    };
  }

  const mappingStatus = evaluateCapitalMetricMapping(
    entryWithMapping(entry, mapping),
    input.mapping,
  );
  if (input.kind !== "breadth") {
    return {
      kind: input.kind,
      availability:
        mappingStatus === CapitalAvailability.PendingReview
          ? CapitalAvailability.PendingReview
          : CapitalAvailability.Unknown,
      statusReason:
        input.statusReason ??
          (mappingStatus === CapitalAvailability.PendingReview
            ? "A 股 related source mapping 与目录不一致，等待复核。"
            : "A 股 related mapping 尚未定义独立 scalar metric；保留为来源观察，不生成新 metricKey。"),
      record: null,
    };
  }

  const record = mapCapitalMetricObservationToRecord(entry, {
    id: input.id,
    value: input.value,
    observedAt: input.observedAt,
    publishedAt: input.publishedAt,
    asOf: input.asOf,
    processingVersion: input.processingVersion,
    revision: input.revision,
    statusReason: input.statusReason,
  });
  if (mappingStatus === CapitalAvailability.PendingReview) {
    const pending: CapitalDataRecord = {
      ...record,
      source: observedPendingSource(entry.sourceFieldMapping, input.mapping),
      value: null,
      unit: null,
      availability: CapitalAvailability.PendingReview,
      statusReason:
        input.statusReason ?? "A 股 breadth source mapping 与目录不一致，等待复核。",
    };
    assertCapitalDataRecord(pending);
    return {
      kind: input.kind,
      availability: pending.availability,
      statusReason: pending.statusReason!,
      record: pending,
    };
  }

  return {
    kind: input.kind,
    availability: record.availability,
    statusReason: record.statusReason ?? "",
    record,
  };
}
