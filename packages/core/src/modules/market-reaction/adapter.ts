/**
 * MarketDataAdapter port — the boundary domain modules use to reach external
 * market-data (行情) sources (AD-7).
 *
 * The market-reaction service depends only on this interface; concrete adapters
 * are resolved and constructed in the worker assembly layer (real provider,
 * deferred) or in verify/e2e (StubMarketDataAdapter). Swapping a provider means
 * pointing the worker at a different adapter implementation —
 * generateMarketReaction never imports a third-party SDK or wire format.
 *
 * V1 worker runtime resolves NO adapter (procurement deferred) →
 * generateMarketReaction returns null and writes nothing → prod degrades
 * honestly (AC3). The only concrete implementation today is
 * StubMarketDataAdapter, which is test-only (verify/e2e import it from core and
 * pass it to generateMarketReaction directly; it is NOT imported by
 * apps/worker runtime code).
 *
 * This mirrors source-ingest/adapter.ts's in-module port convention
 * (describe-by-purpose: the port lives in the module it serves, not in a
 * separate contracts dir).
 */

// The interface is defined in types.ts (single source of truth, alongside the
// other market-reaction domain types) and re-exported here as the port's home.
// Importing code reaches the port via either ./types.js or ./adapter.js — both
// resolve to the same interface.
export type { MarketDataAdapter } from "./types.js";
