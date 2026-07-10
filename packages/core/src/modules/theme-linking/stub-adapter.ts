/**
 * StubAssociationAdapter — a deterministic test-only AssociationAdapter (AD-7).
 *
 * TEST-ONLY: this adapter is NOT wired in the worker/prod runtime. It returns
 * fixture association items (fixed concept/industry/stock labels with a
 * "knowledge_base:v1" mapping basis). Putting fixture associations on a public
 * page without a real mapping basis would mislead readers — a violation of AC2
 * ("associations must rest on an explicit mapping basis; arbitrary hand-filled
 * associations are not allowed") and the NFR "absence shown as absence, never
 * fabricated completeness" (see spec Design Notes).
 *
 * V1 has NO worker (epic lists only market-signal / digest / theme-backfill
 * BullMQ job categories — association generation is NOT among them) and NO real
 * adapter (procurement deferred) → generateAssociations is never called in prod
 * → prod degrades honestly (AC3). This stub exists solely so verify/e2e can
 * call generateAssociations directly and exercise the happy path (proving the
 * pipeline is correct). apps/worker does NOT import it.
 *
 * The fixture is deterministic: every call returns the same AssociationItem[]
 * (one concept, one industry, one stock, each with mappingBasis="knowledge_base:v1")
 * so verify/e2e assertions on the projected items are deterministic across runs.
 */

import type { AssociationAdapter, AssociationItem } from "./types.js";

/**
 * The fixed association items the stub reports. One per kind (concept /
 * industry / stock), each with a non-empty mappingBasis so AC2's explicit-basis
 * requirement is exercised. Stable across runs.
 */
const STUB_ITEMS: AssociationItem[] = [
  { kind: "concept", label: "半导体", mappingBasis: "knowledge_base:v1" },
  { kind: "industry", label: "芯片", mappingBasis: "knowledge_base:v1" },
  { kind: "stock", label: "中芯国际", mappingBasis: "knowledge_base:v1" },
];

/**
 * The concept label the stub reports. Exported so verify/e2e can assert the
 * `/?concept=<stubConcept>` feed-filter click-through lands on a known value
 * (AC1 non-dead-link).
 */
export const STUB_CONCEPT_LABEL = "半导体";

/**
 * Deterministic stub association adapter. Returns a fixed non-null
 * AssociationItem[] on every call. See the module doc for why this is test-only.
 */
export class StubAssociationAdapter implements AssociationAdapter {
  async fetchAssociations(
    _args: { hotEventId: string },
  ): Promise<AssociationItem[] | null> {
    // Return a fresh array each call so callers cannot mutate the shared
    // fixture constant (defensive copy; the items themselves are immutable
    // value types).
    return STUB_ITEMS.map((item) => ({ ...item }));
  }
}
