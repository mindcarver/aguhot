/**
 * Capital snapshot poll job (Issue #68) — cron-driven capture of raw payloads
 * from sources (NBS/ECOS/KRX) that lack a programmatic release timestamp.
 *
 * Per AD-SNAP-2 (capital-snapshot-store.md), each provider runs on its own cron
 * `pattern` (the first cron-based schedule in this repo — all existing
 * schedulers use fixed `every`). Per AD-SNAP-1, `publishedAt = firstCapturedAt`
 * (AGUHOT's capture time), locked on first occurrence via snapshotKey uniqueness.
 *
 * The raw-fetch is injected (`SnapshotRawFetcher`) so this orchestration is
 * provider-agnostic and testable offline. Each provider adapter (#69 NBS,
 * future ECOS/KRX) supplies its own fetcher + extractor + cron pattern.
 *
 * Architecture authority: `.scd/designs/capital-snapshot-store.md` (AD-SNAP-1/2).
 */

import type { PrismaClient, Prisma } from "@aguhot/core";
import {
  appendCapitalProviderSnapshot,
  appendCapitalProviderObservations,
  getPrisma,
  listCapitalProviderSnapshots,
  snapshotsToProviderBatch,
  newTraceId,
  type CapitalSnapshotInput,
  type SnapshotValueExtractor,
} from "@aguhot/core";

import { resolveEastmoneyTargets } from "./eastmoney-capital-adapter.js";

/**
 * One provider's polling configuration. The raw-fetch + value extraction are
 * provider-specific and injected; this module only orchestrates the
 * capture → store → convert → append pipeline.
 */
export interface SnapshotPollTarget {
  readonly providerId: string;
  readonly processingVersion: string;
  /**
   * Fetch the latest raw payload for this provider. Returns `null` when the
   * provider has not yet published new data (e.g. the period isn't out yet) —
   * the poller treats null as "not yet, try next cron tick" (no insert).
   */
  readonly fetchLatest: () => Promise<RawFetchResult | null>;
  readonly extractor: SnapshotValueExtractor;
}

export interface RawFetchResult {
  readonly metricKey: string;
  readonly market: string;
  readonly dimension: string;
  readonly observedAt: string;
  readonly rawPayload: Prisma.InputJsonValue;
}

export interface SnapshotPollResult {
  readonly providerId: string;
  /** Snapshots newly captured this tick (first occurrence). */
  readonly captured: number;
  /** Snapshots already captured previously (idempotent skip). */
  readonly skipped: number;
  /** Records appended to capital_environment_records this tick. */
  readonly appended: number;
  /** Fetch failures this tick (does not throw — next cron retries). */
  readonly failed: number;
}

export interface SnapshotPollOptions {
  readonly traceId: string;
  readonly prisma?: PrismaClient;
}

/**
 * Run one poll tick for a set of targets. For each target: fetch raw → capture
 * snapshot (idempotent) → convert all provider snapshots → append to records.
 *
 * Failures are isolated per target: one provider's fetch error does not abort
 * the others (mirrors capital-provider-sync.ts per-provider isolation).
 */
export async function runCapitalSnapshotPoll(
  targets: readonly SnapshotPollTarget[],
  options: SnapshotPollOptions,
): Promise<SnapshotPollResult[]> {
  const prisma = options.prisma ?? getPrisma();
  const now = new Date().toISOString();
  const results: SnapshotPollResult[] = [];

  for (const target of targets) {
    let captured = 0;
    let skipped = 0;
    let appended = 0;
    let failed = 0;

    try {
      const fetched = await target.fetchLatest();
      if (fetched !== null) {
        const input: CapitalSnapshotInput = {
          providerId: target.providerId,
          metricKey: fetched.metricKey,
          market: fetched.market,
          dimension: fetched.dimension,
          observedAt: fetched.observedAt,
          firstCapturedAt: now,
          rawPayload: fetched.rawPayload,
          processingVersion: target.processingVersion,
        };
        const appendSnap = await appendCapitalProviderSnapshot(prisma, input, {
          traceId: options.traceId,
        });
        if (appendSnap.inserted) {
          captured += 1;
          // Only convert+append the snapshot captured THIS tick. Re-converting
          // prior snapshots every tick would use a fresh `asOf = now`, producing
          // a new recordKey (which includes asOf) and inserting duplicate rows
          // each cron tick. Backfill of historical data happens via repeated
          // polls capturing distinct observedAt periods — each new period is a
          // new snapshot, converted once on its capture tick.
          const snapshots = await listCapitalProviderSnapshots(prisma, target.providerId);
          const justCaptured = snapshots.find((s) => s.snapshotKey === appendSnap.snapshotKey);
          if (justCaptured !== undefined) {
            const batch = snapshotsToProviderBatch([justCaptured], {
              providerId: target.providerId,
              extractor: target.extractor,
              processingVersion: target.processingVersion,
            });
            const appendResult = await appendCapitalProviderObservations(prisma, batch, {
              asOf: now,
              traceId: options.traceId,
            });
            appended = appendResult.inserted;
          }
        } else {
          skipped += 1;
        }
      }
    } catch (error) {
      // A fetch/parse failure is captured, not thrown — next cron tick retries.
      failed += 1;
      console.error(
        `[capital-snapshot-poll ${target.providerId}] ${options.traceId.slice(0, 8)} failed: ${(error as Error).message}`,
      );
    }

    results.push({
      providerId: target.providerId,
      captured,
      skipped,
      appended,
      failed,
    });
  }

  return results;
}

/**
 * Resolve poll targets from the environment. Each registered provider
 * contributes its targets; providers without credentials/config are omitted
 * (honest degradation, mirroring capital-provider-resolver.ts).
 *
 * #69 registers the Eastmoney (China GDP/CPI) targets. ECOS/KRX register in
 * their follow-on adapter Issues.
 */
export function resolveSnapshotPollTargets(): SnapshotPollTarget[] {
  const targets: SnapshotPollTarget[] = [];
  // #69: China GDP/CPI via akshare/Eastmoney (NBS WAF-blocked, Eastmoney bypasses it).
  targets.push(...resolveEastmoneyTargets());
  return targets;
}

/** Production entry used by BullMQ. */
export async function pollCapitalSnapshots(traceId: string): Promise<SnapshotPollResult[]> {
  const targets = resolveSnapshotPollTargets();
  if (targets.length === 0) {
    return [];
  }
  return runCapitalSnapshotPoll(targets, { traceId });
}

export { newTraceId };
