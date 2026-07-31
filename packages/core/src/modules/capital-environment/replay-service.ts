/**
 * Single-date capital environment point-in-time replay read model (Issue #55).
 *
 * Given a historical `asOf` date, assembles what a user could have seen that
 * day across all markets and dimensions, using only records whose
 * `publishedAt <= asOf`. This is the base read path for the dashboard and for
 * the later trend-comparison node (FR-004, deferred).
 *
 * The replay layer does NOT re-implement point-in-time filtering. It consumes
 * #47's `listCapitalDataRecordsAt` and #48's `listFundConcentrationSnapshotsAt`,
 * which already enforce `publishedAt <= asOf`, revision-gap degradation, and
 * vintage selection. The replay layer only groups, degrades-missing dimensions,
 * and aggregates coverage.
 *
 * No new persistence model (zero schema change). Pure read path.
 */

import type { PrismaClient } from "../../../generated/client.js";
import { listCapitalDataRecordsAt } from "./record-repository.js";
import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "./types.js";
import type {
  CapitalAvailability as CapitalAvailabilityValue,
  CapitalDataRecord,
  CapitalDimension as CapitalDimensionValue,
  CapitalMarket as CapitalMarketValue,
} from "./types.js";
import { listFundConcentrationSnapshotsAt } from "../fund-concentration/snapshot-repository.js";
import type { FundConcentrationSnapshot } from "../fund-concentration/types.js";

const ALL_MARKETS: readonly CapitalMarketValue[] = [
  CapitalMarket.Global,
  CapitalMarket.UnitedStates,
  CapitalMarket.China,
  CapitalMarket.Korea,
] as const;

const ALL_DIMENSIONS: readonly CapitalDimensionValue[] = [
  CapitalDimension.Growth,
  CapitalDimension.Inflation,
  CapitalDimension.Liquidity,
  CapitalDimension.FundingPrice,
  CapitalDimension.RiskCredit,
  CapitalDimension.MarketBreadth,
  CapitalDimension.InstitutionalPositioning,
] as const;

/**
 * One dimension's visible state at the replay cutoff. Either carries the
 * resolved metric records (with their provenance) or an explicit degradation
 * when nothing was visible. A dimension is never omitted and never zero-filled.
 */
export interface CapitalReplayDimension {
  readonly market: CapitalMarketValue;
  readonly dimension: CapitalDimensionValue;
  /** Resolved records visible at asOf, or empty when degraded. */
  readonly records: readonly CapitalDataRecord[];
  /** Coarse coverage for this market/dimension cell. */
  readonly availability: CapitalAvailabilityValue;
  readonly statusReason: string | null;
}

/**
 * One market's replay state: its seven dimensions plus an aggregated coverage
 * flag. `partial` means at least one dimension is degraded.
 */
export interface CapitalReplayMarket {
  readonly market: CapitalMarketValue;
  readonly dimensions: readonly CapitalReplayDimension[];
  readonly availability: CapitalAvailabilityValue;
}

/**
 * The full single-date replay result. `availability` is the cross-market
 * aggregate: `partial` when any market has a degraded dimension, `unknown`
 * only when every market is entirely unknown.
 */
export interface CapitalReplayResult {
  readonly asOf: string;
  readonly markets: readonly CapitalReplayMarket[];
  readonly availability: CapitalAvailabilityValue;
  /** Fund concentration snapshots visible at asOf (CN institutional positioning). */
  readonly fundConcentrationSnapshots: readonly FundConcentrationSnapshot[];
}

export interface ReplayCapitalEnvironmentOptions {
  /** Caller trace id (forwarded to logs/metrics). */
  readonly traceId?: string;
}

/**
 * Non-value availabilities that signal degradation rather than a confirmed
 * value. A dimension whose latest visible record carries one of these (e.g.
 * `incomplete_reconstruction` from a revision gap) is still surfaced honestly
 * rather than hidden or zero-filled.
 */
const DEGRADED_AVAILABILITIES = new Set<CapitalAvailabilityValue>([
  CapitalAvailability.Unknown,
  CapitalAvailability.Failed,
  CapitalAvailability.PendingReview,
  CapitalAvailability.IncompleteReconstruction,
]);

function dimensionAvailability(
  records: readonly CapitalDataRecord[],
): { availability: CapitalAvailabilityValue; statusReason: string | null } {
  if (records.length === 0) {
    return {
      availability: CapitalAvailability.Unknown,
      statusReason: "no point-in-time visible record for this market/dimension at asOf",
    };
  }
  // If every visible record is a non-value degradation, the dimension is
  // degraded at this cutoff. If at least one carries a value, the dimension is
  // available (individual record-level degradation is preserved on each record).
  const allDegraded = records.every(
    (record) =>
      record.availability !== undefined &&
      DEGRADED_AVAILABILITIES.has(record.availability),
  );
  if (allDegraded) {
    const worst = records[records.length - 1]!;
    return {
      availability: worst.availability,
      statusReason: worst.statusReason ?? "all visible records are non-value degradations",
    };
  }
  return { availability: CapitalAvailability.Available, statusReason: null };
}

function marketAvailability(
  dimensions: readonly CapitalReplayDimension[],
): CapitalAvailabilityValue {
  const degraded = dimensions.filter(
    (d) =>
      d.availability !== CapitalAvailability.Available &&
      d.availability !== CapitalAvailability.Partial,
  );
  if (degraded.length === 0) return CapitalAvailability.Available;
  if (degraded.length === dimensions.length) return CapitalAvailability.Unknown;
  return CapitalAvailability.Partial;
}

function overallAvailability(
  markets: readonly CapitalReplayMarket[],
): CapitalAvailabilityValue {
  const degraded = markets.filter(
    (m) =>
      m.availability !== CapitalAvailability.Available &&
      m.availability !== CapitalAvailability.Partial,
  );
  if (degraded.length === 0) return CapitalAvailability.Available;
  if (degraded.length === markets.length) return CapitalAvailability.Unknown;
  return CapitalAvailability.Partial;
}

/**
 * Replay the capital environment at a single historical date.
 *
 * Reads are delegated to #47 (`listCapitalDataRecordsAt`) and #48
 * (`listFundConcentrationSnapshotsAt`), which enforce the point-in-time
 * `publishedAt <= asOf` rule, revision-gap degradation, and vintage selection.
 * This function groups the results into market/dimension cells and fills any
 * empty cell with an explicit degradation rather than omitting it.
 */
export async function replayCapitalEnvironmentAt(
  prisma: PrismaClient,
  asOf: string,
  _options: ReplayCapitalEnvironmentOptions = {},
): Promise<CapitalReplayResult> {
  // Read all point-in-time-visible capital records and fund snapshots once.
  const [allRecords, fundSnapshots] = await Promise.all([
    listCapitalDataRecordsAt(prisma, asOf),
    listFundConcentrationSnapshotsAt(prisma, asOf),
  ]);

  const recordsByKey = new Map<string, CapitalDataRecord[]>();
  for (const record of allRecords) {
    const key = `${record.market}|${record.dimension}`;
    const bucket = recordsByKey.get(key);
    if (bucket) bucket.push(record);
    else recordsByKey.set(key, [record]);
  }

  const markets: CapitalReplayMarket[] = ALL_MARKETS.map((market) => {
    const dimensions: CapitalReplayDimension[] = ALL_DIMENSIONS.map((dimension) => {
      const records = recordsByKey.get(`${market}|${dimension}`) ?? [];
      const { availability, statusReason } = dimensionAvailability(records);
      return { market, dimension, records, availability, statusReason };
    });
    return { market, dimensions, availability: marketAvailability(dimensions) };
  });

  return {
    asOf,
    markets,
    availability: overallAvailability(markets),
    fundConcentrationSnapshots: fundSnapshots,
  };
}

// Re-export the fund snapshot type used by the replay result for consumers.
export type { FundConcentrationSnapshot } from "../fund-concentration/types.js";
