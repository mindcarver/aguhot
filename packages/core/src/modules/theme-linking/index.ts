/**
 * theme-linking module barrel — Story 2.2.
 *
 * Owns the event_association_sets table (AD-2 append-only). Exposes the
 * association generator + the latest-set read query + the AssociationAdapter
 * port + the StubAssociationAdapter (test-only). The Prisma client lives one
 * level up and is re-exported from the package barrel.
 *
 * This module never writes published_* (publish-orchestrator owns the public
 * projection) or hot_events (event-assembly owns those). It only appends
 * event_association_sets; publish-orchestrator reads the latest at projection
 * time and writes the public read model.
 *
 * V1 has NO worker for association generation (epic lists only market-signal /
 * digest / theme-backfill BullMQ job categories — association generation is NOT
 * among them). So generateAssociations is invoked by verify/seed only, never by
 * an apps/worker queue. apps/worker does NOT import StubAssociationAdapter.
 */

export {
  generateAssociations,
  getLatestAssociationSet,
  normalizeItems,
} from "./association-service.js";
export { StubAssociationAdapter, STUB_CONCEPT_LABEL } from "./stub-adapter.js";
export { AssociationKind, AssociationSource } from "./types.js";
export type {
  AssociationKind as AssociationKindType,
  AssociationSource as AssociationSourceType,
  AssociationItem,
  AssociationAdapter,
  GenerateAssociationsOptions,
  GenerateAssociationsResult,
  GetLatestAssociationSetOptions,
  AssociationSetRecord,
} from "./types.js";
