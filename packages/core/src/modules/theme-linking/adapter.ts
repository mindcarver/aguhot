/**
 * AssociationAdapter port — the boundary domain modules use to reach external
 * association knowledge sources (concept/industry/stock mapping libraries, NER,
 * LLM-based extraction) (AD-7).
 *
 * The theme-linking service depends only on this interface; concrete adapters
 * are resolved and constructed at the call site. In V1 there is NO worker and
 * NO real adapter wired in prod (procurement deferred, and epic lists no
 * association-generation BullMQ job category), so the prod runtime never
 * resolves an adapter → generateAssociations returns null and writes nothing →
 * prod degrades honestly (AC3). The only concrete implementation today is
 * StubAssociationAdapter, which is test-only (verify/e2e import it from core
 * and pass it to generateAssociations directly; it is NOT imported by
 * apps/worker runtime code).
 *
 * This mirrors market-reaction/adapter.ts + source-ingest/adapter.ts's
 * in-module port convention (describe-by-purpose: the port lives in the module
 * it serves, not in a separate contracts dir).
 */

// The interface is defined in types.ts (single source of truth, alongside the
// other theme-linking domain types) and re-exported here as the port's home.
// Importing code reaches the port via either ./types.js or ./adapter.js — both
// resolve to the same interface.
export type { AssociationAdapter } from "./types.js";
