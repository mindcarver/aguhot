/**
 * Capital environment external-provider port (AD-7).
 *
 * Every external official source (FRED/NBS/ECOS/KRX, and future official fund
 * disclosure) enters the capital-environment pipeline through this interface.
 * Domain modules never import a third-party SDK; switching or adding a provider
 * happens only at the adapter layer and the worker assembly layer.
 *
 * The port returns already-deserialized, domain-normalized observations — not a
 * wire format and not an SDK response object. Each `ProviderObservation` must
 * carry either a verifiable `publishedAt` or an explicit degradation state;
 * the caller (`appendCapitalProviderObservations`) builds `CapitalDataRecord`
 * values from these and never treats an observation date or fetch time as a
 * publication date.
 *
 * Architecture authority: `.scd/designs/capital-provider-port.md` (status:
 * ready, decisions AD-CAP-1/AD-CAP-2/AD-CAP-3).
 */

import type {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
  CapitalSourceReference,
} from "./types.js";

/**
 * One external capital-environment provider. A single method returns a batch so
 * a provider can express partial success across several metrics in one call
 * (AD-CAP-3). The port is intentionally persistence-free: it only fetches and
 * deserializes; validation and append-only persistence happen downstream.
 */
export interface CapitalProviderPort {
  readonly providerId: string;
  fetchObservations(
    request: CapitalProviderRequest,
  ): Promise<ProviderObservationBatch>;
}

/** The observation window and trace context for one provider fetch. */
export interface CapitalProviderRequest {
  /** Inclusive lower bound of the observation dates to cover. */
  readonly observedFrom: string;
  /** Inclusive upper bound of the observation dates to cover. */
  readonly observedTo: string;
  /** The caller's trace id, forwarded to provider logs/metrics. */
  readonly traceId: string;
}

/**
 * The result of one provider fetch. `availability` is the batch-level state:
 * `partial` when some metrics succeeded and others did not, `failed` when the
 * whole fetch failed. Per-observation degradation is carried on each
 * `ProviderObservation`.
 */
export interface ProviderObservationBatch {
  readonly providerId: string;
  readonly observations: readonly ProviderObservation[];
  readonly availability: CapitalAvailability;
  readonly statusReason: string | null;
}

/**
 * One normalized observation from an external provider, ready to be composed
 * into a `CapitalDataRecord`. `publishedAt` is the verifiable publication
 * timestamp (e.g. FRED release date). When a provider cannot verify it,
 * `publishedAt` is `null` and the downstream service degrades the record to an
 * honest non-value status rather than fabricating a publication date.
 */
export interface ProviderObservation {
  /** Aligns with the #43 catalog metricKey, e.g. "us.growth.gdp_real_yoy". */
  readonly metricKey: string;
  readonly market: CapitalMarket;
  readonly dimension: CapitalDimension;
  readonly value: number | null;
  readonly unit: string | null;
  readonly observedAt: string;
  /**
   * The date/time the data became public. Must satisfy `publishedAt <= asOf`
   * (enforced downstream). `null` is a legitimate "unverifiable publication
   * date" signal, never a substitute for the observation date.
   */
  readonly publishedAt: string | null;
  /** The origin (id/name/dataset/documentationUrl). */
  readonly source: CapitalSourceReference;
  /** The provider-reported processing version, used for revision append. */
  readonly processingVersion: string;
  readonly availability: CapitalAvailability;
  readonly statusReason: string | null;
  readonly revision: number;
}
