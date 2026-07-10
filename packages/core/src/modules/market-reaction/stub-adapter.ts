/**
 * StubMarketDataAdapter — a deterministic test-only MarketDataAdapter (AD-7).
 *
 * TEST-ONLY: this adapter is NOT wired in the worker/prod runtime. It returns
 * fixture market data (fixed percentages + sector + limit-up count). Putting
 * fixture market numbers on a public financial page would mislead readers into
 * thinking they are real market reactions — a violation of the NFR "absence
 * shown as absence, never fabricated completeness" (see spec Design Notes).
 *
 * The V1 worker runtime resolves NO adapter (real provider procurement is
 * deferred) → generateMarketReaction returns null → prod degrades honestly
 * (AC3). This stub exists solely so verify/e2e can call generateMarketReaction
 * directly and exercise the happy path (proving the pipeline is correct). When a
 * real provider lands, the worker will resolve that provider and the stub stays
 * for tests.
 *
 * The fixture is deterministic: every call returns the same MarketDataSnapshot
 * (fixed tradingSession, change percents, sector, limit-up count) so verify can
 * assert exact derived tone/value strings.
 */

import type { MarketDataAdapter, MarketDataSnapshot } from "./types.js";

/**
 * The fixed trading session the stub reports. A stable past date so
 * verify/e2e assertions on the projected tradingSession are deterministic
 * across runs. 2024-06-03T03:00:00Z (a Monday 11:00 CST session).
 */
const STUB_TRADING_SESSION = new Date(Date.UTC(2024, 5, 3, 3, 0, 0));

/**
 * Deterministic stub market-reaction adapter. Returns a fixed non-null
 * MarketDataSnapshot on every call. See the module doc for why this is
 * test-only.
 */
export class StubMarketDataAdapter implements MarketDataAdapter {
  async fetchSnapshot(_args: { hotEventId: string }): Promise<MarketDataSnapshot | null> {
    return {
      tradingSession: STUB_TRADING_SESSION,
      priceVolumeChangePercent: 3.42,
      sector: {
        name: "半导体",
        changePercent: 2.1,
      },
      limitUpCount: 5,
    };
  }
}
