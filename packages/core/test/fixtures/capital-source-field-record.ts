import type { CapitalMetricObservationInput } from "../../src/modules/capital-environment/metric-catalog.js";

/**
 * A deterministic raw observation for the existing AkShare breadth sidecar.
 * It intentionally has no provider publication timestamp; the catalog mapper
 * must preserve the observation as an unknown non-value record.
 */
export const CAPITAL_PARTIAL_BREADTH_OBSERVATION: CapitalMetricObservationInput = {
  id: "catalog-cn-breadth-partial",
  value: 123,
  observedAt: "2024-01-02T00:00:00.000Z",
  publishedAt: null,
  asOf: "2024-01-03T00:00:00.000Z",
  processingVersion: "catalog-v1",
  revision: 1,
};
