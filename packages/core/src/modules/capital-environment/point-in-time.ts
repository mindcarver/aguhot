import {
  assertCapitalDataRecord,
  CapitalAvailability,
} from "./types.js";
import type { CapitalDataRecord } from "./types.js";

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return parsed;
}
/**
 * Stable identity for one metric vintage before processing revisions.
 * Different providers are intentionally kept separate: switching a provider
 * must not silently turn into a revision of the old provider's history.
 */
export function capitalRecordIdentity(record: CapitalDataRecord): string {
  return [
    record.source.id,
    record.source.dataset,
    record.market,
    record.dimension,
    record.metricKey,
    record.observedAt,
  ].join("|");
}

/**
 * Deterministic record key used by fixture checks and idempotent persistence.
 * It includes the processing version and revision, so a later transformation
 * or source revision cannot overwrite an earlier snapshot.
 */
export function capitalRecordKey(record: CapitalDataRecord): string {
  return [
    capitalRecordIdentity(record),
    record.publishedAt ?? "unpublished",
    record.asOf,
    record.processingVersion,
    String(record.revision),
    record.availability,
  ].join("|");
}

function publicationTimestamp(record: CapitalDataRecord): number {
  // A source failure/unknown record may have no publication date. Its asOf is
  // the time the absence was observed, so it must not appear before then.
  return timestamp(record.publishedAt ?? record.asOf);
}

function compareRecords(a: CapitalDataRecord, b: CapitalDataRecord): number {
  if (a.revision !== b.revision) return b.revision - a.revision;
  const published = publicationTimestamp(b) - publicationTimestamp(a);
  if (published !== 0) return published;
  return a.id.localeCompare(b.id);
}

/**
 * Reconstruct records visible at an information cutoff.
 *
 * Numeric records require `publishedAt <= asOf`. Non-value statuses with no
 * publication timestamp use their `asOf` observation time. Records remain
 * append-only: selecting a later revision never mutates or removes the earlier
 * source row. If a selected revision has a missing revision in the retained
 * history, its value is withheld and returned as
 * `incomplete_reconstruction` rather than presenting an unverified value.
 */
export function selectCapitalRecordsAt(
  records: readonly CapitalDataRecord[],
  asOf: string,
): CapitalDataRecord[] {
  const cutoff = timestamp(asOf);
  const visible = records.filter((record) => {
    assertCapitalDataRecord(record);
    return publicationTimestamp(record) <= cutoff;
  });

  const grouped = new Map<string, CapitalDataRecord[]>();
  for (const record of visible) {
    const key = capitalRecordIdentity(record);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(record);
    else grouped.set(key, [record]);
  }

  const selected: CapitalDataRecord[] = [];
  for (const bucket of grouped.values()) {
    const ordered = [...bucket].sort(compareRecords);
    const latest = ordered[0]!;
    const revisions = new Set(ordered.map((record) => record.revision));
    const hasRevisionGap = Array.from(
      { length: latest.revision },
      (_, index) => index + 1,
    ).some((revision) => !revisions.has(revision));

    if (
      latest.revision > 1 &&
      hasRevisionGap &&
      (latest.availability === CapitalAvailability.Available ||
        latest.availability === CapitalAvailability.Partial)
    ) {
      selected.push({
        ...latest,
        value: null,
        unit: null,
        availability: CapitalAvailability.IncompleteReconstruction,
        statusReason:
          "原始历史版本不可得，无法完整还原该点时数据；后来修订值未用于回填。",
      });
    } else {
      selected.push({ ...latest });
    }
  }

  return selected.sort((a, b) => {
    const identity = capitalRecordIdentity(a).localeCompare(capitalRecordIdentity(b));
    if (identity !== 0) return identity;
    return compareRecords(a, b);
  });
}
