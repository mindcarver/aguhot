/**
 * Deterministic snapshot key for `capital_provider_snapshots` (Issue #67).
 *
 * One provider's observation of one metric for one observed period is captured
 * ONCE — the key's uniqueness enforces the "first occurrence" idempotency that
 * locks `firstCapturedAt` (the publishedAt source per AD-SNAP-1). A later poll
 * finding the same period produces the same key → insert fails (P2002) → the
 * poller treats it as already-captured and skips.
 *
 * The key includes the processing version so a transformation change does not
 * silently merge into an earlier capture. It deliberately excludes
 * `firstCapturedAt`: the capture timestamp is the VALUE we lock, not part of
 * the identity that determines whether a new capture is the same observation.
 */

export interface CapitalSnapshotKeyInput {
  readonly providerId: string;
  readonly metricKey: string;
  readonly market: string;
  readonly dimension: string;
  readonly observedAt: string;
  readonly processingVersion: string;
}

function canonicalTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return new Date(parsed).toISOString();
}

/**
 * Build the stable snapshot key from provider/metric/period identity.
 * Deterministic: the same inputs always yield the same key.
 */
export function capitalSnapshotKey(input: CapitalSnapshotKeyInput): string {
  return [
    input.providerId,
    input.metricKey,
    input.market,
    input.dimension,
    canonicalTimestamp(input.observedAt),
    input.processingVersion,
  ].join("|");
}
