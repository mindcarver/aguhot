/**
 * Deterministic acceptance checks for Issue #43.
 *
 * Run with: pnpm --filter @aguhot/core verify:capital-source-field-catalog
 */

import {
  CAPITAL_METRIC_CATALOG,
  CapitalAvailability,
  CapitalCatalogStatus,
  CapitalDimension,
  CapitalMarket,
  PublicationDateCapability,
  capitalMetricRecordMetadata,
  catalogStatusToAvailability,
  evaluateCapitalMetricMapping,
  getCapitalMetricCatalogEntry,
  listCapitalMetricCatalog,
  mapCapitalMetricObservationToRecord,
  validateCapitalMetricCatalogEntry,
} from "./index.js";
import { CAPITAL_METRIC_CATALOG_EXPECTED_KEYS } from "../../../test/fixtures/capital-source-field-catalog.js";
import { CAPITAL_DATA_FIXTURE } from "../../../test/fixtures/capital-data-contract.js";
import { CAPITAL_PARTIAL_BREADTH_OBSERVATION } from "../../../test/fixtures/capital-source-field-record.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];
const dimensions = Object.values(CapitalDimension);
const markets = Object.values(CapitalMarket);
const allowedStatuses = new Set(Object.values(CapitalCatalogStatus));

const allKeys = CAPITAL_METRIC_CATALOG.map((entry) => entry.metricKey);
assertions.push({
  name: "A1 has one stable metric key for every market/dimension pair",
  ok:
    CAPITAL_METRIC_CATALOG.length === markets.length * dimensions.length &&
    new Set(allKeys).size === allKeys.length &&
    JSON.stringify(allKeys) === JSON.stringify(CAPITAL_METRIC_CATALOG_EXPECTED_KEYS) &&
    markets.every((market) =>
      dimensions.every(
        (dimension) =>
          CAPITAL_METRIC_CATALOG.filter(
            (entry) => entry.market === market && entry.dimension === dimension,
          ).length === 1,
      ),
    ) &&
    CAPITAL_METRIC_CATALOG.every((entry) => allowedStatuses.has(entry.status)),
  detail: JSON.stringify({
    count: CAPITAL_METRIC_CATALOG.length,
    markets: markets.length,
    dimensions: dimensions.length,
  }),
});

const entryErrors = CAPITAL_METRIC_CATALOG.flatMap((entry) =>
  validateCapitalMetricCatalogEntry(entry).map(
    (error) => `${entry.metricKey}: ${error}`,
  ),
);
assertions.push({
  name: "A2 every entry carries source-field, unit, cadence, time rules, history, revision, snapshot and evidence shape",
  ok:
    entryErrors.length === 0 &&
    CAPITAL_METRIC_CATALOG.every(
      (entry) =>
        entry.frequency !== undefined &&
        entry.timezone.length > 0 &&
        entry.observedAtRule.length > 0 &&
        entry.publishedAtRule.length > 0 &&
        entry.historicalCoverage.note.length > 0 &&
        entry.revisionCapability.length > 0 &&
        typeof entry.snapshotCapability === "boolean" &&
        (entry.status === CapitalCatalogStatus.Unavailable
          ? entry.sourceFieldMapping === null
          : entry.sourceFieldMapping !== null),
    ),
  detail: JSON.stringify(entryErrors),
});

const cnBreadth = getCapitalMetricCatalogEntry("cn-market-breadth");
const cnBreadthMapping = cnBreadth?.sourceFieldMapping;
const usGrowth = getCapitalMetricCatalogEntry("us-growth");
const usGrowthMapping = usGrowth?.sourceFieldMapping;
const krBreadth = getCapitalMetricCatalogEntry("kr-market-breadth");
const krBreadthMapping = krBreadth?.sourceFieldMapping;
const cnBreadthRecordMetadata =
  cnBreadth === undefined ? undefined : capitalMetricRecordMetadata(cnBreadth);
const partialRecord =
  cnBreadth === undefined
    ? undefined
    : mapCapitalMetricObservationToRecord(
        cnBreadth,
        CAPITAL_PARTIAL_BREADTH_OBSERVATION,
      );
const plannedMetric = getCapitalMetricCatalogEntry("us-growth");
let plannedProjectionRejected = false;
if (plannedMetric !== undefined) {
  try {
    capitalMetricRecordMetadata(plannedMetric);
  } catch {
    plannedProjectionRejected = true;
  }
}
assertions.push({
  name: "A3 catalog metadata maps directly to CapitalDataRecord identity fields",
  ok:
    cnBreadth !== undefined &&
    cnBreadth.metricKey === "cn-market-breadth" &&
    cnBreadth.market === CapitalMarket.China &&
    cnBreadth.dimension === CapitalDimension.MarketBreadth &&
    cnBreadth.unit === "count" &&
    cnBreadthMapping?.sourceId === "cn-akshare-breadth" &&
    cnBreadthMapping.dataset.length > 0 &&
    cnBreadth.relatedSourceFieldMappings.length === 1 &&
    cnBreadth.relatedSourceFieldMappings[0]?.sourceId === "cn-akshare-index-sector" &&
    cnBreadthRecordMetadata?.metricKey === cnBreadth.metricKey &&
    cnBreadthRecordMetadata.source.id === cnBreadthMapping.sourceId &&
    cnBreadthRecordMetadata.source.dataset === cnBreadthMapping.dataset &&
    partialRecord?.availability === CapitalAvailability.Unknown &&
    partialRecord.value === null &&
    partialRecord.unit === null &&
    partialRecord.statusReason?.includes("published_at") === true &&
    plannedProjectionRejected &&
    usGrowthMapping?.valueTransform === "year_over_year_percent" &&
    usGrowthMapping.rawUnit === "billions of chained 2017 dollars" &&
    usGrowthMapping.publishedAtField === null &&
    usGrowthMapping.notes.includes("realtime_start") &&
    krBreadthMapping?.valueField === null &&
    JSON.stringify(krBreadthMapping.valueFields) ===
      JSON.stringify(["advancing_issues", "declining_issues"]) &&
    krBreadthMapping.valueTransform === "independent_scalar_fields",
  detail: JSON.stringify({
    metricKey: cnBreadth?.metricKey,
    source: cnBreadthMapping?.sourceId,
  }),
});

const nonValueStatuses = CAPITAL_METRIC_CATALOG.filter(
  (entry) =>
    catalogStatusToAvailability(entry.status) === CapitalAvailability.Unknown,
);
const degradedRecords = CAPITAL_DATA_FIXTURE.filter((record) =>
  ["empty-result", "source-failed", "schema-changed"].includes(record.metricKey),
);
assertions.push({
  name: "A4 planned/unavailable and concrete unknown/failed/pending states never become zero-valued available",
  ok:
    nonValueStatuses.length > 0 &&
    nonValueStatuses.every(
      (entry) =>
        catalogStatusToAvailability(entry.status) !== CapitalAvailability.Available &&
        entry.degradationReason !== null,
    ) &&
    catalogStatusToAvailability(CapitalCatalogStatus.Partial) ===
      CapitalAvailability.Partial &&
    degradedRecords.length === 3 &&
    degradedRecords.every(
      (record) =>
        record.value === null &&
        record.availability !== CapitalAvailability.Available,
    ),
  detail: JSON.stringify({
    catalog: nonValueStatuses.map((entry) => [entry.metricKey, entry.status]),
    records: degradedRecords.map((record) => [record.metricKey, record.availability]),
  }),
});

const unchangedMapping = cnBreadthMapping === null || cnBreadthMapping === undefined
  ? null
  : {
      sourceId: cnBreadthMapping.sourceId,
      dataset: cnBreadthMapping.dataset,
      valueField: cnBreadthMapping.valueField,
      valueFields: [...cnBreadthMapping.valueFields],
      valueTransform: cnBreadthMapping.valueTransform,
      rawUnit: cnBreadthMapping.rawUnit,
      observedAtField: cnBreadthMapping.observedAtField,
      publishedAtField: cnBreadthMapping.publishedAtField,
      unitField: cnBreadthMapping.unitField,
      publicationDateCapability: cnBreadthMapping.publicationDateCapability,
    };
const changedMapping = unchangedMapping === null
  ? null
  : { ...unchangedMapping, rawUnit: "changed-provider-unit" };
const changedCapability = unchangedMapping === null
  ? null
  : {
      ...unchangedMapping,
      publicationDateCapability: PublicationDateCapability.Explicit,
    };
assertions.push({
  name: "A5 source or field drift enters pending_review instead of silently upgrading",
  ok:
    cnBreadth !== undefined &&
    unchangedMapping !== null &&
    changedMapping !== null &&
    evaluateCapitalMetricMapping(cnBreadth, unchangedMapping) ===
      CapitalAvailability.Partial &&
    evaluateCapitalMetricMapping(cnBreadth, changedMapping) ===
      CapitalAvailability.PendingReview &&
    changedCapability !== null &&
    evaluateCapitalMetricMapping(cnBreadth, changedCapability) ===
      CapitalAvailability.PendingReview &&
    evaluateCapitalMetricMapping(
      CAPITAL_METRIC_CATALOG.find((entry) => entry.metricKey === "global-market-breadth")!,
      {
        sourceId: "unexpected-source",
        dataset: "unexpected-dataset",
        valueField: null,
        valueFields: [],
        valueTransform: "identity",
        rawUnit: null,
        observedAtField: null,
        publishedAtField: null,
        unitField: null,
        publicationDateCapability: "unknown",
      },
    ) === CapitalAvailability.PendingReview,
  detail: JSON.stringify({ unchangedMapping, changedMapping, changedCapability }),
});

const firstRead = listCapitalMetricCatalog();
const secondRead = listCapitalMetricCatalog();
const mutableRead = listCapitalMetricCatalog(CapitalMarket.China);
const mutableBefore = JSON.stringify(CAPITAL_METRIC_CATALOG);
if (mutableRead[0] !== undefined) {
  mutableRead[0].label = "mutated local copy";
  if (mutableRead[0].sourceFieldMapping !== null) {
    mutableRead[0].sourceFieldMapping.valueField = "mutated local field";
  }
}
assertions.push({
  name: "A6 repeated reads are deterministic and returned objects cannot mutate the catalog",
  ok:
    JSON.stringify(firstRead) === JSON.stringify(secondRead) &&
    JSON.stringify(CAPITAL_METRIC_CATALOG) === mutableBefore,
  detail: JSON.stringify({
    firstLength: firstRead.length,
    secondLength: secondRead.length,
  }),
});

const failed = assertions.filter((assertion) => !assertion.ok);
for (const assertion of assertions) {
  console.log(
    `${assertion.ok ? "PASS" : "FAIL"} ${assertion.name}${assertion.detail ? ` — ${assertion.detail}` : ""}`,
  );
}
if (failed.length > 0) {
  console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed.`);
  process.exit(1);
}
console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
