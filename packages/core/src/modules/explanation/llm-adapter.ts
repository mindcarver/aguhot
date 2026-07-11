/**
 * LLMAdapter port — the boundary domain modules use to reach external LLM
 * knowledge sources for AI 解读 (and, transitively, the future 5.2 AI 深读 /
 * 5.3 趋势研判) (AD-7).
 *
 * The explanation sub-domain depends only on this interface; concrete adapters
 * are resolved and constructed at the call site. In V1 the recommendation-reason
 * worker resolves NO adapter (real LLM provider procurement is deferred) →
 * generateRecommendationReason returns null and writes nothing → prod degrades
 * honestly (AC). The only concrete implementation today is StubLlmAdapter,
 * which is test-only (verify/e2e import it from core and pass it to
 * generateRecommendationReason directly; it is NOT imported by apps/worker
 * runtime code — the worker resolves adapter = undefined).
 *
 * This mirrors the sibling in-module ports: theme-adapter.ts (ThemeAdapter) +
 * association-adapter.ts (AssociationAdapter) + market-reaction/adapter.ts
 * (MarketDataAdapter) + source-ingest/adapter.ts + digest-adapter.ts
 * (DigestAdapter). Same shape, same conventions: the port lives in the module it
 * serves, the interface is defined once in types.ts, and this file is the thin
 * re-export home (describe-by-purpose, not a separate contracts dir). Story 5.2
 * (AI 深读) and 5.3 (趋势研判) will reuse this port — ponytail: if cross-module
 * import friction appears when those land, hoist the port to a shared location
 * then (a move, not a redesign — the interface shape is general).
 */

// The interface is defined in types.ts (single source of truth, alongside the
// other explanation domain types) and re-exported here as the port's home.
// Importing code reaches the port via either ./types.js or ./llm-adapter.js
// — both resolve to the same interface.
export type { LLMAdapter } from "./types.js";
