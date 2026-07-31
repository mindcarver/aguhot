/**
 * Shared contract for capital-environment observations.
 *
 * This module is deliberately persistence-agnostic. Ingestion adapters can
 * save these records in their own store, while replay code can apply the same
 * point-in-time rules to every market and frequency.
 */

export const CapitalMarket = {
  Global: "global",
  UnitedStates: "us",
  China: "cn",
  Korea: "kr",
} as const;

export type CapitalMarket = (typeof CapitalMarket)[keyof typeof CapitalMarket];

export const CapitalDimension = {
  Growth: "growth",
  Inflation: "inflation",
  Liquidity: "liquidity",
  FundingPrice: "funding_price",
  RiskCredit: "risk_credit",
  MarketBreadth: "market_breadth",
  InstitutionalPositioning: "institutional_positioning",
} as const;

export type CapitalDimension =
  (typeof CapitalDimension)[keyof typeof CapitalDimension];

/**
 * A record with one of these statuses is never rendered as a confirmed value.
 * In particular, `unknown` and `failed` are not zero-valued observations.
 */
export const CapitalAvailability = {
  Available: "available",
  Partial: "partial",
  Unknown: "unknown",
  Failed: "failed",
  PendingReview: "pending_review",
  IncompleteReconstruction: "incomplete_reconstruction",
} as const;

export type CapitalAvailability =
  (typeof CapitalAvailability)[keyof typeof CapitalAvailability];

export const CapitalFrequency = {
  Daily: "daily",
  ReleaseDefined: "release_defined",
  Quarterly: "quarterly",
  Unknown: "unknown",
} as const;

export type CapitalFrequency =
  (typeof CapitalFrequency)[keyof typeof CapitalFrequency];

export const SourceReadiness = {
  Available: "available",
  Partial: "partial",
  Planned: "planned",
} as const;

export type SourceReadiness =
  (typeof SourceReadiness)[keyof typeof SourceReadiness];

/**
 * Readiness of one market/dimension metric in the source-field catalog.
 *
 * This is intentionally separate from `CapitalAvailability`: a catalog entry
 * can be planned before any observation exists, while a data record uses
 * unknown/failed/pending_review to describe a concrete collection attempt.
 */
export const CapitalCatalogStatus = {
  Confirmed: "confirmed",
  Partial: "partial",
  Planned: "planned",
  Unavailable: "unavailable",
} as const;

export type CapitalCatalogStatus =
  (typeof CapitalCatalogStatus)[keyof typeof CapitalCatalogStatus];

export const CapitalRevisionCapability = {
  AppendOnly: "append_only",
  ProviderVintage: "provider_vintage",
  ObservationOnly: "observation_only",
  Unknown: "unknown",
  None: "none",
} as const;

export type CapitalRevisionCapability =
  (typeof CapitalRevisionCapability)[keyof typeof CapitalRevisionCapability];

export const PublicationDateCapability = {
  Explicit: "explicit",
  RealtimeVintage: "realtime_vintage",
  ObservationOnly: "observation_only",
  Unknown: "unknown",
} as const;

export type PublicationDateCapability =
  (typeof PublicationDateCapability)[keyof typeof PublicationDateCapability];

export interface CapitalSourceReference {
  id: string;
  name: string;
  dataset: string;
  documentationUrl: string | null;
}
/**
 * One append-only observation or honest non-value status.
 *
 * `asOf` is the source snapshot's effective timestamp. For a failed or
 * unknown record, it is the time at which that absence was observed and is
 * used as the visibility fallback when `publishedAt` is unavailable. For a
 * numeric record, historical visibility is governed by `publishedAt`.
 */
export interface CapitalDataRecord {
  id: string;
  metricKey: string;
  market: CapitalMarket;
  dimension: CapitalDimension;
  value: number | null;
  unit: string | null;
  observedAt: string;
  publishedAt: string | null;
  asOf: string;
  source: CapitalSourceReference;
  processingVersion: string;
  availability: CapitalAvailability;
  statusReason: string | null;
  revision: number;
}

export interface CapitalSourceBaseline {
  id: string;
  market: CapitalMarket;
  provider: string;
  dataset: string;
  frequency: CapitalFrequency;
  historicalCoverage: {
    start: string | null;
    end: string | null;
    note: string;
  };
  publicationDateCapability: PublicationDateCapability;
  snapshotCapability: boolean;
  readiness: SourceReadiness;
  documentationUrl: string | null;
  notes: string;
}

/**
 * The field-level source contract for a catalog metric. Null fields are
 * deliberate: an observation-only source cannot satisfy a publication-date
 * rule, and an unavailable metric has no verified provider field to claim.
 */
export interface CapitalMetricSourceFieldMapping {
  sourceId: string;
  provider: string;
  dataset: string;
  valueField: string | null;
  valueFields: readonly string[];
  valueTransform: string;
  rawUnit: string | null;
  observedAtField: string | null;
  publishedAtField: string | null;
  unitField: string | null;
  publicationDateCapability: PublicationDateCapability;
  evidenceUrl: string | null;
  notes: string;
}

export interface CapitalMetricHistoricalCoverage {
  start: string | null;
  end: string | null;
  note: string;
}

/**
 * Stable, source-aware metadata for one metric used by the capital dashboard.
 * The `metricKey`, market and dimension are also the corresponding fields on
 * `CapitalDataRecord`, so adapters can map observations without inventing a
 * second identity or silently changing source semantics.
 */
export interface CapitalMetricCatalogEntry {
  metricKey: string;
  market: CapitalMarket;
  dimension: CapitalDimension;
  label: string;
  status: CapitalCatalogStatus;
  sourceFieldMapping: CapitalMetricSourceFieldMapping | null;
  relatedSourceFieldMappings: readonly CapitalMetricSourceFieldMapping[];
  unit: string | null;
  frequency: CapitalFrequency;
  timezone: string;
  observedAtRule: string;
  publishedAtRule: string;
  historicalCoverage: CapitalMetricHistoricalCoverage;
  revisionCapability: CapitalRevisionCapability;
  snapshotCapability: boolean;
  evidenceUrl: string | null;
  degradationReason: string | null;
}

const NON_VALUE_AVAILABILITIES = new Set<CapitalAvailability>([
  CapitalAvailability.Unknown,
  CapitalAvailability.Failed,
  CapitalAvailability.PendingReview,
  CapitalAvailability.IncompleteReconstruction,
]);

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

function isCapitalMarket(value: string): value is CapitalMarket {
  return (Object.values(CapitalMarket) as readonly string[]).includes(value);
}

function isCapitalDimension(value: string): value is CapitalDimension {
  return (Object.values(CapitalDimension) as readonly string[]).includes(value);
}

function isCapitalAvailability(value: string): value is CapitalAvailability {
  return (Object.values(CapitalAvailability) as readonly string[]).includes(value);
}

/**
 * Return all contract violations without mutating or normalizing the record.
 * Callers can use this before persistence to reject malformed source output.
 */
export function validateCapitalDataRecord(
  record: CapitalDataRecord,
): string[] {
  const errors: string[] = [];
  if (!record.id.trim()) errors.push("id is required");
  if (!record.metricKey.trim()) errors.push("metricKey is required");
  if (!isCapitalMarket(record.market)) errors.push("market is not a supported capital market");
  if (!isCapitalDimension(record.dimension)) errors.push("dimension is not a supported capital dimension");
  if (!isCapitalAvailability(record.availability)) {
    errors.push("availability is not a supported capital availability");
  }
  if (!isIsoTimestamp(record.observedAt)) errors.push("observedAt must be an ISO timestamp");
  if (!isIsoTimestamp(record.asOf)) errors.push("asOf must be an ISO timestamp");
  if (record.publishedAt !== null && !isIsoTimestamp(record.publishedAt)) {
    errors.push("publishedAt must be an ISO timestamp or null");
  }
  if (
    record.publishedAt !== null &&
    isIsoTimestamp(record.publishedAt) &&
    isIsoTimestamp(record.asOf) &&
    Date.parse(record.publishedAt) > Date.parse(record.asOf)
  ) {
    errors.push("publishedAt must not be later than asOf");
  }
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    errors.push("revision must be a positive integer");
  }
  if (record.value !== null && !Number.isFinite(record.value)) {
    errors.push("value must be finite or null");
  }
  if (
    record.availability === CapitalAvailability.Available ||
    record.availability === CapitalAvailability.Partial
  ) {
    if (record.value === null) errors.push("available records require a value");
    if (!record.unit?.trim()) errors.push("available records require a unit");
    if (record.publishedAt === null) {
      errors.push("available records require publishedAt");
    }
  }
  if (NON_VALUE_AVAILABILITIES.has(record.availability)) {
    if (record.value !== null) errors.push("non-value statuses must not carry a value");
    if (!record.statusReason?.trim()) {
      errors.push("non-value statuses require statusReason");
    }
  }
  if (!record.source.id.trim()) errors.push("source.id is required");
  if (!record.source.name.trim()) errors.push("source.name is required");
  if (!record.source.dataset.trim()) errors.push("source.dataset is required");
  if (!record.processingVersion.trim()) errors.push("processingVersion is required");
  return errors;
}

export function assertCapitalDataRecord(record: CapitalDataRecord): void {
  const errors = validateCapitalDataRecord(record);
  if (errors.length > 0) {
    throw new Error(`Invalid capital data record ${record.id}: ${errors.join("; ")}`);
  }
}
