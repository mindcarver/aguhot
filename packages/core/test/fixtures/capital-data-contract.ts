import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "../../src/modules/capital-environment/types.js";
import type { CapitalDataRecord } from "../../src/modules/capital-environment/types.js";

const source = {
  id: "fixture-fred",
  name: "Fixture public source",
  dataset: "fixture rates",
  documentationUrl: null,
};

const record = (
  overrides: Partial<CapitalDataRecord> & Pick<CapitalDataRecord, "id" | "metricKey" | "revision" | "availability">,
): CapitalDataRecord => {
  const { id, metricKey, ...rest } = overrides;
  return {
    id,
    metricKey,
    market: CapitalMarket.UnitedStates,
    dimension: CapitalDimension.Liquidity,
    value: 4.5,
    unit: "percent",
    observedAt: "2024-01-01T00:00:00.000Z",
    publishedAt: "2024-01-02T00:00:00.000Z",
    asOf: "2024-01-02T00:00:00.000Z",
    source,
    processingVersion: "contract-v1",
    statusReason: null,
    ...rest,
  };
};

export const CAPITAL_DATA_FIXTURE: readonly CapitalDataRecord[] = [
  record({
    id: "rates-r1",
    metricKey: "policy-rate",
    revision: 1,
    availability: CapitalAvailability.Available,
    value: 4.5,
    publishedAt: "2024-01-02T00:00:00.000Z",
    asOf: "2024-01-02T00:00:00.000Z",
  }),
  record({
    id: "rates-r2",
    metricKey: "policy-rate",
    revision: 2,
    availability: CapitalAvailability.Available,
    value: 4.25,
    publishedAt: "2024-04-02T00:00:00.000Z",
    asOf: "2024-04-02T00:00:00.000Z",
  }),
  record({
    id: "late-published",
    metricKey: "late-release",
    revision: 1,
    availability: CapitalAvailability.Available,
    value: 99,
    publishedAt: "2024-06-01T00:00:00.000Z",
    asOf: "2024-06-01T00:00:00.000Z",
  }),
  record({
    id: "missing-original",
    metricKey: "missing-original",
    revision: 2,
    availability: CapitalAvailability.Available,
    value: 8,
    publishedAt: "2024-05-01T00:00:00.000Z",
    asOf: "2024-05-01T00:00:00.000Z",
  }),
  record({
    id: "gapped-r1",
    metricKey: "gapped-revision",
    revision: 1,
    availability: CapitalAvailability.Available,
    value: 5,
    publishedAt: "2024-04-01T00:00:00.000Z",
    asOf: "2024-04-01T00:00:00.000Z",
  }),
  record({
    id: "gapped-r3",
    metricKey: "gapped-revision",
    revision: 3,
    availability: CapitalAvailability.Available,
    value: 7,
    publishedAt: "2024-05-02T00:00:00.000Z",
    asOf: "2024-05-02T00:00:00.000Z",
  }),
  record({
    id: "empty-result",
    metricKey: "empty-result",
    revision: 1,
    availability: CapitalAvailability.Unknown,
    value: null,
    publishedAt: null,
    asOf: "2024-03-01T00:00:00.000Z",
    statusReason: "source returned no rows",
  }),
  record({
    id: "source-failed",
    metricKey: "source-failed",
    revision: 1,
    availability: CapitalAvailability.Failed,
    value: null,
    publishedAt: null,
    asOf: "2024-03-02T00:00:00.000Z",
    statusReason: "source timeout",
  }),
  record({
    id: "pending-review",
    metricKey: "schema-changed",
    revision: 1,
    availability: CapitalAvailability.PendingReview,
    value: null,
    publishedAt: null,
    asOf: "2024-03-03T00:00:00.000Z",
    statusReason: "provider field changed",
  }),
];
