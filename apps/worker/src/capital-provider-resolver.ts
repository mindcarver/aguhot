/**
 * Capital provider resolver (worker runtime) — resolves the concrete external
 * capital-environment providers behind the `CapitalProviderPort` (Issue #51).
 *
 * Mirrors `digest-adapter-resolver.ts` / `llm-adapter-resolver.ts`: reads each
 * provider's credentials from env and returns that provider's adapter when all
 * required values are present, or omits it entirely (honest degradation) when
 * they are not. The job then skips the absent providers without error.
 *
 * Resolved once per job (cheap — env reads + allocation).
 *
 * Architecture authority: `.scd/designs/capital-provider-port.md` (AD-CAP-1).
 */

import type { CapitalProviderPort } from "@aguhot/core";
import { FredProviderAdapter } from "./fred-provider-adapter.js";

export function resolveCapitalProviders(): CapitalProviderPort[] {
  const providers: CapitalProviderPort[] = [];

  const fredApiKey = process.env.FRED_API_KEY;
  if (fredApiKey !== undefined && fredApiKey !== "") {
    providers.push(new FredProviderAdapter({ apiKey: fredApiKey }));
  }
  // NBS/ECOS/KRX adapters register here once their Delivery Issues land.

  return providers;
}
