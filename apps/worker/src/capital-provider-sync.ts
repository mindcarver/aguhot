/**
 * Worker-side assembly for capital provider sync (Issue #51).
 *
 * Resolves the configured external providers, fetches each one's observation
 * batch, appends it through the core service, and aggregates the per-provider
 * results into the shape expected by `MarketDataRefreshDependencies`.
 *
 * Per-provider fetch failures are captured and counted, not thrown: a single
 * provider outage must not abort the others or the rest of the refresh job.
 */

import {
  appendCapitalProviderObservations,
  getPrisma,
  type CapitalProviderPort,
} from "@aguhot/core";
import { resolveCapitalProviders } from "./capital-provider-resolver.js";

export interface SyncCapitalProvidersResult {
  inserted: number;
  unchanged: number;
  pendingReview: number;
  failed: number;
}

export interface SyncCapitalProvidersOptions {
  readonly observedFrom: string;
  readonly observedTo: string;
  readonly traceId: string;
  readonly prisma?: ReturnType<typeof getPrisma>;
  readonly providers?: readonly CapitalProviderPort[];
}

export async function syncCapitalProviders(
  options: SyncCapitalProvidersOptions,
): Promise<SyncCapitalProvidersResult> {
  const prisma = options.prisma ?? getPrisma();
  const providers = options.providers ?? resolveCapitalProviders();

  let inserted = 0;
  let unchanged = 0;
  let pendingReview = 0;
  let failed = 0;

  for (const provider of providers) {
    try {
      const batch = await provider.fetchObservations({
        observedFrom: options.observedFrom,
        observedTo: options.observedTo,
        traceId: options.traceId,
      });
      const result = await appendCapitalProviderObservations(
        prisma,
        batch,
        { asOf: options.observedTo, traceId: options.traceId },
      );
      inserted += result.inserted;
      unchanged += result.unchanged;
      pendingReview += result.pendingReview;
      failed += result.failed;
    } catch (error) {
      console.error(
        `[capital-provider-sync] provider ${provider.providerId} failed: ${(error as Error).message}`,
      );
      failed += 1;
    }
  }

  return { inserted, unchanged, pendingReview, failed };
}
