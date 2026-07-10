/**
 * ThemeAdapter port — the boundary domain modules use to reach external theme
 * knowledge sources (theme mapping libraries, NER, LLM-based theme extraction)
 * (AD-7).
 *
 * The theme-linking theme sub-domain depends only on this interface; concrete
 * adapters are resolved and constructed at the call site. In V1 the
 * theme-backfill worker resolves NO adapter (real theme knowledge source
 * procurement is deferred) → generateThemes returns null and writes nothing →
 * prod degrades honestly (AC3). The only concrete implementation today is
 * StubThemeAdapter, which is test-only (verify/e2e import it from core and pass
 * it to generateThemes directly; it is NOT imported by apps/worker runtime code
 * — the worker resolves adapter = undefined).
 *
 * This mirrors adapter.ts (AssociationAdapter) + market-reaction/adapter.ts +
 * source-ingest/adapter.ts's in-module port convention (describe-by-purpose: the
 * port lives in the module it serves, not in a separate contracts dir). Story 2.3
 * extends the theme-linking module (2.2 built the association sub-domain) with a
 * theme sub-domain alongside it — same shape, same conventions.
 */

// The interface is defined in types.ts (single source of truth, alongside the
// other theme-linking domain types) and re-exported here as the port's home.
// Importing code reaches the port via either ./types.js or ./theme-adapter.js —
// both resolve to the same interface.
export type { ThemeAdapter } from "./types.js";
