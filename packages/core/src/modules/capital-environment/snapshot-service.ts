/**
 * Snapshot → ProviderObservationBatch conversion service (Issue #68).
 *
 * Converts captured `CapitalProviderSnapshotRow`s into the
 * `ProviderObservationBatch` shape that `appendCapitalProviderObservations`
 * consumes. The key mapping is AD-SNAP-1: `publishedAt = firstCapturedAt`
 * (AGUHOT's first capture time — auditable, conservative — never the official
 * release moment, which these providers do not expose).
 *
 * The raw payload is provider-specific, so value/unit/source extraction is
 * injected via `SnapshotValueExtractor`. This keeps the conversion service
 * independent of any single provider's wire format; each adapter (#69 NBS,
 * future ECOS/KRX) supplies its own extractor.
 *
 * Architecture authority: `.scd/designs/capital-snapshot-store.md` (AD-SNAP-1).
 */

import { CapitalAvailability } from "./types.js";
import type { CapitalSourceReference } from "./types.js";
import type {
  CapitalProviderSnapshotRow,
} from "./snapshot-repository.js";
import type {
  ProviderObservation,
  ProviderObservationBatch,
} from "./provider-port.js";

/**
 * Extracts a value/unit/source triple from one snapshot's raw payload. Each
 * provider adapter implements this against its own wire format. Returning
 * `{ value: null }` signals the payload could not be parsed → the observation
 * degrades to `unknown` (non-value) per FR-008.
 */
export interface SnapshotValueExtractor {
  (
    snapshot: CapitalProviderSnapshotRow,
  ): {
    value: number | null;
    unit: string | null;
    source: CapitalSourceReference;
  };
}

export interface SnapshotsToBatchOptions {
  readonly providerId: string;
  readonly extractor: SnapshotValueExtractor;
  /** Processing version stamp carried on each observation. */
  readonly processingVersion: string;
  /** Optional unit override (defaults to the extractor's unit). */
  readonly unit?: string;
}

/**
 * Status reason stamped on every snapshot-derived observation. Makes the
 * AD-SNAP-1 publishedAt semantics explicit in the audit trail so the dashboard
 * evidence drill-down honestly distinguishes capture time from official release.
 */
const CAPTURE_TIME_STATUS_REASON =
  "publishedAt = AGUHOT 采集时间（非官方发布时刻）；原始 payload 见 snapshot";

/**
 * Convert captured snapshots into a `ProviderObservationBatch`.
 *
 * Each observation carries:
 * - `publishedAt = firstCapturedAt` (AD-SNAP-1)
 * - `statusReason` explicitly labeling the capture-time semantics
 * - `value/unit/source` from the injected extractor (null value → unknown)
 *
 * The batch is `available` when at least one observation has a value, `partial`
 * when some are null, and `failed` when all are null.
 */
export function snapshotsToProviderBatch(
  snapshots: readonly CapitalProviderSnapshotRow[],
  options: SnapshotsToBatchOptions,
): ProviderObservationBatch {
  const observations: ProviderObservation[] = snapshots.map((snapshot) => {
    const extracted = options.extractor(snapshot);
    const hasValue = extracted.value !== null;
    return {
      metricKey: snapshot.metricKey,
      market: snapshot.market as ProviderObservation["market"],
      dimension: snapshot.dimension as ProviderObservation["dimension"],
      value: hasValue ? extracted.value : null,
      unit: hasValue ? (options.unit ?? extracted.unit) : null,
      observedAt: snapshot.observedAt,
      publishedAt: snapshot.firstCapturedAt,
      source: extracted.source,
      processingVersion: options.processingVersion,
      availability: hasValue
        ? CapitalAvailability.Available
        : CapitalAvailability.Unknown,
      statusReason: CAPTURE_TIME_STATUS_REASON,
      revision: 1,
    };
  });

  const withValue = observations.filter((o) => o.value !== null).length;
  const availability: CapitalAvailability =
    observations.length === 0
      ? CapitalAvailability.Failed
      : withValue === observations.length
        ? CapitalAvailability.Available
        : CapitalAvailability.Partial;

  return {
    providerId: options.providerId,
    observations,
    availability,
    statusReason:
      observations.length === 0
        ? "no snapshots captured"
        : null,
  };
}
