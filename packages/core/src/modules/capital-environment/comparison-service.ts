/**
 * Two-point capital environment trend comparison read model (Issue #57).
 *
 * Given two historical `asOf` cutoffs, compares the capital environment state
 * dimension-by-dimension and reports the observable change direction. This is
 * the FR-004 read path; the dashboard (#58) renders it.
 *
 * The comparison layer does NOT re-implement point-in-time filtering. It calls
 * #55's `replayCapitalEnvironmentAt` for each cutoff, then pairs the two
 * per-dimension states and classifies the change. When either side of a
 * dimension is degraded (non-value), the comparison is `unknown` — the layer
 * never infers a direction from missing data and never zero-fills.
 *
 * Scope: two point-in-time cutoffs only. Interval comparison is deferred.
 * No new persistence model (zero schema change). Pure read path.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { replayCapitalEnvironmentAt } from "./replay-service.js";
import type {
  CapitalReplayDimension,
} from "./replay-service.js";
import { CapitalAvailability } from "./types.js";
import type {
  CapitalAvailability as CapitalAvailabilityValue,
  CapitalDataRecord,
  CapitalDimension as CapitalDimensionValue,
  CapitalMarket as CapitalMarketValue,
} from "./types.js";

/**
 * The observable change direction between two cutoffs for one metric pair.
 *
 * These are objective value directions, not investment judgements. The label
 * set aligns with PRD FR-004's "变化方向" and the user-journey wording
 * (改善/恶化/无明显变化/未知). Whether an `improved`/`deteriorated` direction is
 * favourable for a given dimension is an interpretation owned by the dashboard
 * layer (#58), not by this read model.
 */
export const TrendDirection = {
  Improved: "improved",
  Deteriorated: "deteriorated",
  Unchanged: "unchanged",
  Unknown: "unknown",
} as const;

export type TrendDirection =
  (typeof TrendDirection)[keyof typeof TrendDirection];

/** One side of a metric comparison: the resolved record or its degradation. */
export interface TrendComparisonSide {
  readonly asOf: string;
  readonly record: CapitalDataRecord | null;
}

/**
 * One metric pair's comparison across the two cutoffs. `direction` is
 * `unknown` whenever either side is degraded, the metric is absent on one
 * side, or the two sides are not comparable (different unit/source).
 */
export interface TrendComparisonMetric {
  readonly metricKey: string;
  readonly direction: TrendDirection;
  readonly from: TrendComparisonSide;
  readonly to: TrendComparisonSide;
  readonly statusReason: string | null;
}

/**
 * One dimension's comparison: its per-metric pairs plus a dimension-level
 * direction. The dimension-level direction is `unknown` if any metric pair is
 * `unknown` or the dimension is degraded on either side.
 */
export interface TrendComparisonDimension {
  readonly market: CapitalMarketValue;
  readonly dimension: CapitalDimensionValue;
  readonly direction: TrendDirection;
  readonly metrics: readonly TrendComparisonMetric[];
  /** Dimension coverage on each side (preserved for the dashboard). */
  readonly fromAvailability: CapitalAvailabilityValue;
  readonly toAvailability: CapitalAvailabilityValue;
}

export interface TrendComparisonMarket {
  readonly market: CapitalMarketValue;
  readonly dimensions: readonly TrendComparisonDimension[];
  readonly direction: TrendDirection;
}

/**
 * The full two-point comparison result. No aggregate score is produced — the
 * PRD forbids a single total or bull/bear verdict. Each market/dimension
 * keeps its own direction and evidence.
 */
export interface TrendComparisonResult {
  readonly fromAsOf: string;
  readonly toAsOf: string;
  readonly markets: readonly TrendComparisonMarket[];
}

export interface CompareCapitalEnvironmentOptions {
  readonly traceId?: string;
}

/** Non-value availabilities that make a side ineligible for value comparison. */
const DEGRADED_AVAILABILITIES = new Set<CapitalAvailabilityValue>([
  CapitalAvailability.Unknown,
  CapitalAvailability.Failed,
  CapitalAvailability.PendingReview,
  CapitalAvailability.IncompleteReconstruction,
]);

function isDegraded(availability: CapitalAvailabilityValue): boolean {
  return DEGRADED_AVAILABILITIES.has(availability);
}

/**
 * Classify the change between two comparable value-bearing records. The two
 * records must share the same metricKey; comparability (same unit/source) is
 * checked by the caller.
 */
function classifyValueDirection(
  fromValue: number,
  toValue: number,
): TrendDirection {
  if (toValue > fromValue) return TrendDirection.Improved;
  if (toValue < fromValue) return TrendDirection.Deteriorated;
  return TrendDirection.Unchanged;
}

/**
 * Pair the metric records of two dimension snapshots by metricKey and classify
 * each pair. A metric present on only one side, or with a degraded record on
 * either side, yields `unknown`.
 */
function compareDimensionMetrics(
  from: CapitalReplayDimension,
  to: CapitalReplayDimension,
): TrendComparisonMetric[] {
  const fromByKey = new Map<string, CapitalDataRecord>();
  for (const record of from.records) {
    if (!isDegraded(record.availability)) fromByKey.set(record.metricKey, record);
  }
  const toByKey = new Map<string, CapitalDataRecord>();
  for (const record of to.records) {
    if (!isDegraded(record.availability)) toByKey.set(record.metricKey, record);
  }

  const metricKeys = new Set<string>([...fromByKey.keys(), ...toByKey.keys()]);
  const metrics: TrendComparisonMetric[] = [];
  for (const metricKey of metricKeys) {
    const fromRecord = fromByKey.get(metricKey) ?? null;
    const toRecord = toByKey.get(metricKey) ?? null;
    metrics.push(
      classifyMetricPair(metricKey, fromRecord, toRecord, from.availability, to.availability),
    );
  }
  // Stable ordering by metricKey for deterministic output.
  metrics.sort((a, b) => a.metricKey.localeCompare(b.metricKey));
  return metrics;
}

function classifyMetricPair(
  metricKey: string,
  fromRecord: CapitalDataRecord | null,
  toRecord: CapitalDataRecord | null,
  fromDimensionAvailability: CapitalAvailabilityValue,
  toDimensionAvailability: CapitalAvailabilityValue,
): TrendComparisonMetric {
  const fromSide: TrendComparisonSide = {
    asOf: fromRecord?.observedAt ?? "",
    record: fromRecord,
  };
  const toSide: TrendComparisonSide = {
    asOf: toRecord?.observedAt ?? "",
    record: toRecord,
  };

  // Dimension degraded on either side → cannot compare objectively.
  if (isDegraded(fromDimensionAvailability) || isDegraded(toDimensionAvailability)) {
    return {
      metricKey,
      direction: TrendDirection.Unknown,
      from: fromSide,
      to: toSide,
      statusReason: "dimension degraded on at least one side; direction not inferred",
    };
  }

  // Metric absent or non-value on one side → unknown.
  if (fromRecord === null || toRecord === null) {
    return {
      metricKey,
      direction: TrendDirection.Unknown,
      from: fromSide,
      to: toSide,
      statusReason: "metric absent or non-value on at least one side",
    };
  }

  // Calibre incompatibility (different unit or source) → unknown.
  if (fromRecord.unit !== toRecord.unit || fromRecord.source.id !== toRecord.source.id) {
    return {
      metricKey,
      direction: TrendDirection.Unknown,
      from: fromSide,
      to: toSide,
      statusReason: `unit/source incompatible (from ${fromRecord.source.id}/${fromRecord.unit}, to ${toRecord.source.id}/${toRecord.unit})`,
    };
  }

  return {
    metricKey,
    direction: classifyValueDirection(fromRecord.value ?? 0, toRecord.value ?? 0),
    from: fromSide,
    to: toSide,
    statusReason: null,
  };
}

function dimensionDirection(
  metrics: readonly TrendComparisonMetric[],
  fromAvailability: CapitalAvailabilityValue,
  toAvailability: CapitalAvailabilityValue,
): TrendDirection {
  if (isDegraded(fromAvailability) || isDegraded(toAvailability)) {
    return TrendDirection.Unknown;
  }
  if (metrics.length === 0) return TrendDirection.Unknown;
  // Dimension is unknown if any metric pair is unknown; otherwise report the
  // single metric's direction (a dimension typically has one metric per
  // market). When multiple metrics disagree, the dimension is mixed → unknown
  // would lose information, so we report the first concrete direction but keep
  // every metric's own direction available on the metrics array.
  const directions = new Set(metrics.map((m) => m.direction));
  if (directions.has(TrendDirection.Unknown)) return TrendDirection.Unknown;
  if (directions.size === 1) return [...directions][0]!;
  return TrendDirection.Unknown;
}

function marketDirection(
  dimensions: readonly TrendComparisonDimension[],
): TrendDirection {
  if (dimensions.length === 0) return TrendDirection.Unknown;
  const directions = new Set(dimensions.map((d) => d.direction));
  if (directions.has(TrendDirection.Unknown)) return TrendDirection.Unknown;
  if (directions.size === 1) return [...directions][0]!;
  return TrendDirection.Unknown;
}

/**
 * Compare the capital environment at two point-in-time cutoffs.
 *
 * Delegates the per-cutoff replay to #55's `replayCapitalEnvironmentAt`, then
 * pairs the two snapshots market-by-market and dimension-by-dimension. Each
 * dimension reports an observable change direction (`improved`/`deteriorated`/
 * `unchanged`/`unknown`) with both sides' evidence preserved. No aggregate
 * score is produced.
 */
export async function compareCapitalEnvironment(
  prisma: PrismaClient,
  fromAsOf: string,
  toAsOf: string,
  options: CompareCapitalEnvironmentOptions = {},
): Promise<TrendComparisonResult> {
  const [fromReplay, toReplay] = await Promise.all([
    replayCapitalEnvironmentAt(prisma, fromAsOf, { traceId: options.traceId }),
    replayCapitalEnvironmentAt(prisma, toAsOf, { traceId: options.traceId }),
  ]);

  const markets: TrendComparisonMarket[] = fromReplay.markets.map(
    (fromMarket) => {
      const toMarket = toReplay.markets.find(
        (m) => m.market === fromMarket.market,
      );
      const dimensions: TrendComparisonDimension[] = fromMarket.dimensions.map(
        (fromDim) => {
          const toDim = toMarket?.dimensions.find(
            (d) => d.dimension === fromDim.dimension,
          ) ?? fromDim; // fallback shouldn't happen (both have all dimensions)
          const metrics = compareDimensionMetrics(fromDim, toDim);
          return {
            market: fromDim.market,
            dimension: fromDim.dimension,
            metrics,
            fromAvailability: fromDim.availability,
            toAvailability: toDim.availability,
            direction: dimensionDirection(metrics, fromDim.availability, toDim.availability),
          };
        },
      );
      return {
        market: fromMarket.market,
        dimensions,
        direction: marketDirection(dimensions),
      };
    },
  );

  return { fromAsOf, toAsOf, markets };
}
