/**
 * StubDigestAdapter — a deterministic test-only DigestAdapter (AD-7).
 *
 * TEST-ONLY: this adapter is NOT wired in the worker/prod runtime. It returns
 * fixture conclusions (a fixed non-empty conclusion per passed hotEventId).
 * Putting fixture conclusions on a public daily page without a real LLM
 * summarizer would mislead readers — a violation of the NFR "absence shown as
 * absence, never fabricated completeness" (see spec Design Notes).
 *
 * V1 has a daily-digest worker (epic lists daily digest as a BullMQ job
 * category) but the worker resolves adapter = undefined (procurement deferred)
 * → generateDailyDigest returns null → prod degrades honestly (AC3). This stub
 * exists solely so verify/e2e can call generateDailyDigest directly and
 * exercise the happy path (proving the pipeline is correct). apps/worker does
 * NOT import it.
 *
 * The fixture is deterministic: every call returns the SAME conclusion for each
 * passed hotEventId (one fixed string, no per-event variation) so verify/e2e
 * assertions on the projected entries are deterministic across runs. The
 * conclusion carries no investment-advice keywords (NFR).
 */

import type { DigestConclusion, DigestAdapter } from "./types.js";

/**
 * The fixed conclusion the stub reports for every event. Exported so verify/e2e
 * can assert the projected daily-digest entries carry exactly this conclusion
 * (deterministic across runs). Non-empty and free of investment-advice wording.
 */
export const STUB_DIGEST_CONCLUSION = "当日重点事件，证据链已归档。";

/**
 * Deterministic stub digest adapter. Returns a fixed non-null DigestConclusion[]
 * on every call — one conclusion per passed hotEventId, all carrying the same
 * STUB_DIGEST_CONCLUSION. See the module doc for why this is test-only.
 *
 * Returns null when no hotEventIds are passed (the caller writes nothing and
 * degrades honestly — mirrors the real adapter contract: no events → no
 * conclusions → no digest).
 */
export class StubDigestAdapter implements DigestAdapter {
  async fetchConclusions(args: {
    coverageDate: Date;
    hotEventIds: string[];
  }): Promise<DigestConclusion[] | null> {
    // No events → no conclusions (caller degrades honestly).
    if (args.hotEventIds.length === 0) return null;
    // Return a fresh array each call so callers cannot mutate the shared
    // fixture constant (defensive copy).
    return args.hotEventIds.map((hotEventId) => ({
      hotEventId,
      conclusion: STUB_DIGEST_CONCLUSION,
    }));
  }
}
