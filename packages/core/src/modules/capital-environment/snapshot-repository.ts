/**
 * Capital provider snapshot repository (Issue #68).
 *
 * Append-only persistence for `capital_provider_snapshots`. Each
 * provider+metric+observed-period is captured ONCE — the snapshotKey uniqueness
 * enforces the "first occurrence" idempotency that locks `firstCapturedAt`
 * (the publishedAt source per AD-SNAP-1). A later poll finding the same period
 * is a no-op (`inserted: false`), never an overwrite.
 *
 * Architecture authority: `.scd/designs/capital-snapshot-store.md` (AD-SNAP-1).
 */

import type { PrismaClient, Prisma } from "../../../generated/client.js";
import { capitalSnapshotKey } from "./snapshot-key.js";

/**
 * Domain view of one captured snapshot row. The `rawPayload` is the provider's
 * original deserialized response (provider-specific shape); it is NOT parsed
 * here — parsing belongs to the provider adapter that knows the wire format.
 */
export interface CapitalProviderSnapshotRow {
  readonly id: string;
  readonly snapshotKey: string;
  readonly providerId: string;
  readonly metricKey: string;
  readonly market: string;
  readonly dimension: string;
  readonly observedAt: string;
  /** AGUHOT's first successful capture — the publishedAt source (AD-SNAP-1). */
  readonly firstCapturedAt: string;
  readonly rawPayload: Prisma.JsonValue;
  readonly processingVersion: string;
  readonly traceId: string | null;
}

export interface CapitalSnapshotAppendOptions {
  readonly traceId?: string | null;
}

export interface CapitalSnapshotAppendResult {
  /** True when this is a first-occurrence capture; false when already captured. */
  readonly inserted: boolean;
  readonly snapshotKey: string;
}

export interface CapitalSnapshotInput {
  readonly providerId: string;
  readonly metricKey: string;
  readonly market: string;
  readonly dimension: string;
  readonly observedAt: string;
  readonly firstCapturedAt: string;
  readonly rawPayload: Prisma.InputJsonValue;
  readonly processingVersion: string;
}

function toISO(date: Date): string {
  return date.toISOString();
}

function fromRow(row: {
  id: string;
  snapshotKey: string;
  providerId: string;
  metricKey: string;
  market: string;
  dimension: string;
  observedAt: Date;
  firstCapturedAt: Date;
  rawPayload: Prisma.JsonValue;
  processingVersion: string;
  traceId: string | null;
}): CapitalProviderSnapshotRow {
  return {
    id: row.id,
    snapshotKey: row.snapshotKey,
    providerId: row.providerId,
    metricKey: row.metricKey,
    market: row.market,
    dimension: row.dimension,
    observedAt: toISO(row.observedAt),
    firstCapturedAt: toISO(row.firstCapturedAt),
    rawPayload: row.rawPayload,
    processingVersion: row.processingVersion,
    traceId: row.traceId,
  };
}

function rowId(input: CapitalSnapshotInput): string {
  return `snap|${input.providerId}|${input.metricKey}|${input.observedAt}|${input.processingVersion}`;
}

/**
 * Append one snapshot. Idempotent on snapshotKey: a repeat capture of the same
 * provider+metric+observed-period+processing-version is a no-op returning
 * `inserted: false`. The row is never overwritten, so `firstCapturedAt` is the
 * monotonic lock per AD-SNAP-1.
 *
 * @returns `{ inserted, snapshotKey }` — `inserted` is true only on first capture.
 */
export async function appendCapitalProviderSnapshot(
  prisma: PrismaClient,
  input: CapitalSnapshotInput,
  options: CapitalSnapshotAppendOptions = {},
): Promise<CapitalSnapshotAppendResult> {
  const snapshotKey = capitalSnapshotKey(input);
  const traceId = options.traceId ?? null;

  // Fast path: if already captured, skip without attempting an insert.
  const existing = await prisma.capitalProviderSnapshot.findUnique({
    where: { snapshotKey },
  });
  if (existing !== null) {
    return { inserted: false, snapshotKey };
  }

  try {
    await prisma.capitalProviderSnapshot.create({
      data: {
        id: rowId(input),
        snapshotKey,
        providerId: input.providerId,
        metricKey: input.metricKey,
        market: input.market,
        dimension: input.dimension,
        observedAt: new Date(input.observedAt),
        firstCapturedAt: new Date(input.firstCapturedAt),
        rawPayload: input.rawPayload,
        processingVersion: input.processingVersion,
        traceId,
      },
    });
    return { inserted: true, snapshotKey };
  } catch (error) {
    // Race: another concurrent capture inserted the same key first. Treat as
    // already-captured (idempotent) — firstCapturedAt is locked by the winner.
    if ((error as { code?: string }).code !== "P2002") throw error;
    return { inserted: false, snapshotKey };
  }
}

/**
 * Read all snapshots for a provider, newest observedAt first. Used by the
 * snapshot→record conversion to feed `appendCapitalProviderObservations`.
 */
export async function listCapitalProviderSnapshots(
  prisma: PrismaClient,
  providerId: string,
): Promise<CapitalProviderSnapshotRow[]> {
  const rows = await prisma.capitalProviderSnapshot.findMany({
    where: { providerId },
    orderBy: { observedAt: "desc" },
  });
  return rows.map(fromRow);
}
