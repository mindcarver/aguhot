/**
 * Capital provider resolver (worker runtime) — resolves the concrete external
 * capital-environment providers behind the `CapitalProviderPort` (Issue #51).
 *
 * Mirrors `digest-adapter-resolver.ts` / `llm-adapter-resolver.ts`: reads each
 * provider's credentials from env and returns that provider's adapter when all
 * required values are present, or omits it entirely (honest degradation) when
 * they are not. The job then skips the absent providers without error.
 *
 * Resolved once per job (cheap — env reads only). The concrete adapters
 * (FRED/NBS/ECOS/KRX) are materialized by their own Delivery Issues; this
 * skeleton establishes the resolver seam and returns an empty list until the
 * first adapter lands.
 *
 * Architecture authority: `.scd/designs/capital-provider-port.md` (AD-CAP-1).
 */

import type { CapitalProviderPort } from "@aguhot/core";

export function resolveCapitalProviders(): CapitalProviderPort[] {
  const providers: CapitalProviderPort[] = [];
  // FRED adapter (Issue #52) is registered here once implemented:
  //   const fredApiKey = process.env.FRED_API_KEY;
  //   if (fredApiKey !== undefined && fredApiKey !== "") {
  //     providers.push(new FredProviderAdapter({ apiKey: fredApiKey }));
  //   }
  // Until then, no concrete provider is wired and the job degrades honestly.
  return providers;
}
