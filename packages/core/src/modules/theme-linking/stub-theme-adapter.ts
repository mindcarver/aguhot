/**
 * StubThemeAdapter — a deterministic test-only ThemeAdapter (AD-7).
 *
 * TEST-ONLY: this adapter is NOT wired in the worker/prod runtime. It returns
 * fixture theme memberships (fixed slug/label with a "knowledge_base:v1" mapping
 * basis). Putting fixture themes on a public page without a real mapping basis
 * would mislead readers — a violation of AC2 ("theme memberships must rest on an
 * explicit mapping basis; arbitrary hand-filled memberships are not allowed")
 * and the NFR "absence shown as absence, never fabricated completeness" (see
 * spec Design Notes).
 *
 * V1 has a theme-backfill worker (epic lists theme-backfill as a BullMQ job
 * category, unlike 2.2 associations which had no worker) but the worker resolves
 * adapter = undefined (procurement deferred) → generateThemes returns null →
 * prod degrades honestly (AC3). This stub exists solely so verify/e2e can call
 * generateThemes directly and exercise the happy path (proving the pipeline is
 * correct). apps/worker does NOT import it.
 *
 * The fixture is deterministic: every call returns the same ThemeRef[] (one
 * theme: chip-supply-chain / 芯片供应链, with mappingBasis="knowledge_base:v1")
 * so verify/e2e assertions on the projected items are deterministic across runs
 * and multiple seeded events share the same slug (so the /topics/[slug] page has
 * >=2 chronological members to assert the continuity time-series).
 */

import type { ThemeAdapter, ThemeRef } from "./types.js";

/**
 * The slug the stub reports. Exported so verify/e2e can assert the
 * /topics/{slug} route + the detail→theme FilterPill link land on a known slug
 * (FR9/FR11 closed-loop, AC1 theme page). Stable across runs; multiple seeded
 * events share this slug so the theme page aggregates >=2 members.
 */
export const STUB_THEME_SLUG = "chip-supply-chain";

/**
 * The label the stub reports. Exported so verify/e2e can assert the theme page
 * title (editorial serif) renders the known label.
 */
export const STUB_THEME_LABEL = "芯片供应链";

/**
 * The fixed theme items the stub reports. One theme (chip-supply-chain /
 * 芯片供应链), with a non-empty mappingBasis so AC2's explicit-basis requirement
 * is exercised. Stable across runs.
 */
const STUB_ITEMS: ThemeRef[] = [
  {
    slug: STUB_THEME_SLUG,
    label: STUB_THEME_LABEL,
    mappingBasis: "knowledge_base:v1",
  },
];

/**
 * Deterministic stub theme adapter. Returns a fixed non-null ThemeRef[] on
 * every call. See the module doc for why this is test-only.
 */
export class StubThemeAdapter implements ThemeAdapter {
  async fetchThemes(
    _args: { hotEventId: string },
  ): Promise<ThemeRef[] | null> {
    // Return a fresh array each call so callers cannot mutate the shared
    // fixture constant (defensive copy; the items themselves are immutable
    // value types).
    return STUB_ITEMS.map((item) => ({ ...item }));
  }
}
