/**
 * DigestAdapter port — the boundary domain modules use to reach external digest
 * knowledge sources (LLM summarizers, extractive summarization providers)
 * (AD-7).
 *
 * The digest sub-domain depends only on this interface; concrete adapters are
 * resolved and constructed at the call site. In V1 the daily-digest worker
 * resolves NO adapter (real digest LLM/summarizer provider procurement is
 * deferred) → generateDailyDigest returns null and writes nothing → prod
 * degrades honestly (AC3). The only concrete implementation today is
 * StubDigestAdapter, which is test-only (verify/e2e import it from core and
 * pass it to generateDailyDigest directly; it is NOT imported by apps/worker
 * runtime code — the worker resolves adapter = undefined).
 *
 * This mirrors theme-adapter.ts (ThemeAdapter) + association-adapter.ts
 * (AssociationAdapter) + market-reaction/adapter.ts (MarketDataAdapter) +
 * source-ingest/adapter.ts's in-module port convention (describe-by-purpose: the
 * port lives in the module it serves, not in a separate contracts dir). Story
 * 2.4 introduces the digest module alongside the existing Epic-2 modules — same
 * shape, same conventions.
 */

// The interface is defined in types.ts (single source of truth, alongside the
// other digest domain types) and re-exported here as the port's home.
// Importing code reaches the port via either ./types.js or ./digest-adapter.js
// — both resolve to the same interface.
export type { DigestAdapter } from "./types.js";
