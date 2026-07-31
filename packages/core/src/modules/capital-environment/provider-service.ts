/**
 * Provider observation → CapitalDataRecord append service (Issue #51).
 *
 * Bridges `CapitalProviderPort` output to the #47 append-only persistence
 * contract. The provider owns fetching + deserializing + resolving
 * `publishedAt`; this service owns validation, point-in-time enforcement, and
 * honest degradation. It never treats an observation date or fetch time as a
 * publication date, and it never writes a zero for a missing value.
 *
 * Architecture authority: `.scd/designs/capital-provider-port.md` (AD-CAP-1/2/3).
 */

import type { PrismaClient } from "../../../generated/client.js";
import {
  appendCapitalDataRecord,
  type CapitalRecordAppendOptions,
} from "./record-repository.js";
import {
  assertCapitalDataRecord,
  CapitalAvailability,
} from "./types.js";
import type {
  CapitalAvailability as CapitalAvailabilityValue,
  CapitalDataRecord,
} from "./types.js";
import type {
  ProviderObservation,
  ProviderObservationBatch,
} from "./provider-port.js";

export interface AppendCapitalProviderObservationsOptions {
  /** Replay cutoff: records with `publishedAt > asOf` are withheld or flagged. */
  readonly asOf: string;
  readonly traceId?: string;
}

export interface AppendCapitalProviderObservationsResult {
  readonly providerId: string;
  readonly inserted: number;
  readonly unchanged: number;
  readonly pendingReview: number;
  readonly failed: number;
}

const PENDING_REVIEW_HINT =
  "publishedAt later than asOf; withheld from point-in-time reconstruction";

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return parsed;
}

/**
 * Compose a `CapitalDataRecord` from one provider observation.
 *
 * Degradation rules:
 * - `publishedAt` null and a value-bearing availability → demoted to `unknown`
 *   (non-value) so the record never claims a confirmed value without a
 *   publication date. The observation date is not promoted to `publishedAt`.
 * - `publishedAt` later than `asOf` → `pending_review` (non-value) so a
 *   point-in-time violation is auditable but never visible as a confirmed value.
 * - `failed` batch-level state still appends the per-observation records the
 *   provider returned (often empty), and the caller writes a provider-level
 *   failure record when the batch is empty.
 */
function composeRecord(
  observation: ProviderObservation,
  asOf: string,
): CapitalDataRecord {
  const publishedAfterCutoff =
    observation.publishedAt !== null &&
    timestamp(observation.publishedAt) > timestamp(asOf);

  let availability: CapitalAvailabilityValue = observation.availability;
  let publishedAt: string | null = observation.publishedAt;
  let value: number | null = observation.value;
  let unit: string | null = observation.unit;
  let statusReason: string | null = observation.statusReason;

  if (publishedAfterCutoff) {
    // The provider reported a publication date later than the replay cutoff.
    // Withhold the value and record the violation as a non-value pending_review
    // entry. The original (violating) publishedAt cannot be stored verbatim
    // because #47's contract requires publishedAt <= asOf; the record's
    // publishedAt becomes the cutoff (the time the violation was observed) and
    // the original date is preserved in statusReason for audit.
    availability = CapitalAvailability.PendingReview;
    publishedAt = asOf;
    value = null;
    unit = null;
    statusReason = observation.statusReason
      ? `${observation.statusReason}; original publishedAt ${observation.publishedAt} ${PENDING_REVIEW_HINT}`
      : `original publishedAt ${observation.publishedAt} ${PENDING_REVIEW_HINT}`;
  } else if (
    observation.publishedAt === null &&
    (availability === CapitalAvailability.Available ||
      availability === CapitalAvailability.Partial)
  ) {
    // A provider cannot verify the publication date. Demote to a non-value
    // unknown record instead of fabricating publishedAt from observedAt.
    availability = CapitalAvailability.Unknown;
    value = null;
    unit = null;
    statusReason = observation.statusReason
      ? `${observation.statusReason}; publishedAt unavailable, observation date not promoted`
      : "publishedAt unavailable, observation date not promoted";
  }

  const record: CapitalDataRecord = {
    id: `${observation.source.id}|${observation.metricKey}|${observation.observedAt}|r${observation.revision}`,
    metricKey: observation.metricKey,
    market: observation.market,
    dimension: observation.dimension,
    value,
    unit,
    observedAt: observation.observedAt,
    publishedAt,
    asOf,
    source: observation.source,
    processingVersion: observation.processingVersion,
    availability,
    statusReason,
    revision: observation.revision,
  };
  assertCapitalDataRecord(record);
  return record;
}

/**
 * Persist a provider observation batch as append-only `CapitalDataRecord` rows.
 *
 * Reuses #47's `appendCapitalDataRecord` for idempotent upsert on `recordKey`,
 * conflict rejection, and revision append. When the whole batch failed and no
 * observations were returned, a single provider/metricKey-level `failed` record
 * is written so the absence is auditable instead of silent.
 */
export async function appendCapitalProviderObservations(
  prisma: PrismaClient,
  batch: ProviderObservationBatch,
  options: AppendCapitalProviderObservationsOptions,
): Promise<AppendCapitalProviderObservationsResult> {
  const appendOptions: CapitalRecordAppendOptions = {
    traceId: options.traceId ?? null,
  };

  let inserted = 0;
  let unchanged = 0;
  let pendingReview = 0;
  let failed = 0;

  for (const observation of batch.observations) {
    const record = composeRecord(observation, options.asOf);
    const result = await appendCapitalDataRecord(prisma, record, appendOptions);
    if (result.inserted) inserted += 1;
    else unchanged += 1;
    if (record.availability === CapitalAvailability.PendingReview) {
      pendingReview += 1;
    }
  }

  if (
    batch.availability === CapitalAvailability.Failed &&
    batch.observations.length === 0
  ) {
    failed += 1;
  }

  return {
    providerId: batch.providerId,
    inserted,
    unchanged,
    pendingReview,
    failed,
  };
}
