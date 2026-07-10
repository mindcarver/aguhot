/**
 * market-reaction domain types — Story 2.1.
 *
 * The market-reaction module owns MarketReactionSnapshot (AD-2 append-only write
 * table, one row per market snapshot). It derives TWO signal dimensions from a
 * MarketDataSnapshot — a price/volume dimension and a sector/limit-up dimension —
 * each carrying a tone (up/down/flat, reusing the ReactionChip semantics) and a
 * display value string, plus a shared tradingSession time context. The public
 * read model is owned by publish-orchestrator (published_hot_event_reactions).
 *
 * V1 has no real market-data provider (procurement deferred). The worker runtime
 * resolves NO adapter → generateMarketReaction returns null and writes nothing →
 * prod degrades honestly (AC3). StubMarketDataAdapter is test-only (verify/e2e
 * call generateMarketReaction directly with it to exercise the happy path).
 *
 * NFR: signals are explanatory, never advisory. tone/value describe observed
 * market facts (change percent, sector name, limit-up count) and NEVER contain
 * buy/sell/target-price/position wording.
 *
 * The flat 2-dimension column layout (not a JSON signals array) mirrors V1 AC
 * (exactly two required dimensions) and maps directly to ReactionChip's
 * {tone, value}.
 */

import type { PrismaClient } from "../../../generated/client.js";

/**
 * The tone of a reaction signal. Reuses the ReactionChip semantics (up/down/flat)
 * so a snapshot's derived signal maps directly to the chip the detail page
 * renders. Market semantics follow DESIGN a11y floor: a chip carries BOTH a
 * Chinese text label (涨/跌/平) AND color — color is never the sole signal.
 */
export const ReactionTone = {
  Up: "up",
  Down: "down",
  Flat: "flat",
} as const;

export type ReactionTone = (typeof ReactionTone)[keyof typeof ReactionTone];

/**
 * The provenance of a market-reaction snapshot. Stored on every
 * MarketReactionSnapshot row. The public read model carries this through as
 * `reactionSource`.
 *
 *   - template: V1 deterministic fixture-backed derivation (StubMarketDataAdapter,
 *     test-only). When a real provider lands, source becomes the provider id.
 *
 * V1 worker runtime resolves NO adapter (prod degrades honestly), so no snapshot
 * with source="template" is ever written by the worker — only by verify/e2e
 * direct calls.
 */
export const ReactionSource = {
  Template: "template",
} as const;

export type ReactionSource = (typeof ReactionSource)[keyof typeof ReactionSource];

/**
 * The two required signal dimensions for a market-reaction snapshot (AC2). V1
 * flattens these into columns; a future third dimension (e.g. capital flow) is a
 * schema migration (deferred).
 */
export const ReactionDimension = {
  PriceVolume: "price_volume",
  SectorLimitUp: "sector_limit_up",
} as const;

export type ReactionDimension =
  (typeof ReactionDimension)[keyof typeof ReactionDimension];

/**
 * One derived reaction signal — a tone + display value. Maps directly to the
 * ReactionChip's {tone, value} props on the detail page. The value is a display
 * string (e.g. "+3.42%" or "半导体 +2.1% / 涨停 5 家") — formatted at the
 * derivation layer, rendered verbatim by the chip.
 */
export interface ReactionSignal {
  tone: ReactionTone;
  value: string;
}

/**
 * A raw market-data snapshot fetched by a MarketDataAdapter. This is the
 * adapter's normalized output — domain code never sees the provider's native
 * wire format. The derivation turns this into two ReactionSignals.
 *
 *   - tradingSession: the trading session the data reflects (epic: every signal
 *     carries an explicit trading-session time context).
 *   - priceVolumeChangePercent: the price/volume change percent (e.g. 3.42).
 *   - sector: the sector with the strongest reaction (name + change percent).
 *   - limitUpCount: the count of limit-up (涨停) stocks in the session.
 */
export interface MarketDataSnapshot {
  tradingSession: Date;
  priceVolumeChangePercent: number;
  sector: {
    name: string;
    changePercent: number;
  };
  limitUpCount: number;
}

/**
 * Options for generateMarketReaction. `{ prisma, traceId, hotEventId, adapter? }`
 * mirrors the established command pattern (clusterEvents, generateExplanation)
 * plus an optional adapter. When adapter is omitted or returns null, the function
 * returns null and writes nothing (honest degradation — never fabricates a
 * snapshot from no data). Otherwise it derives the two signals and APPENDS one
 * MarketReactionSnapshot row (source="template").
 */
export interface GenerateMarketReactionOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
  adapter?: MarketDataAdapter;
}

/**
 * The result of a successful generation: the newly-appended snapshot's id + the
 * two derived signals + tradingSession + provenance + createdAt. Callers
 * (publish-orchestrator projection, verify/seed) consume the signals directly.
 */
export interface GenerateMarketReactionResult {
  marketReactionSnapshotId: string;
  hotEventId: string;
  priceVolume: ReactionSignal;
  sectorLimitUp: ReactionSignal;
  limitUpCount: number;
  tradingSession: Date;
  source: ReactionSource;
  createdAt: Date;
  traceId: string;
}

/**
 * Options for getLatestMarketReaction — returns the most recent
 * MarketReactionSnapshot for an event (createdAt desc, id desc tiebreaker) or
 * null if none exist. publish-orchestrator uses this at projection time.
 */
export interface GetLatestMarketReactionOptions {
  prisma: PrismaClient;
  traceId: string;
  hotEventId: string;
}

/**
 * One market-reaction snapshot row projected for read. Mirrors the
 * MarketReactionSnapshot columns the public projection + operator audit need
 * (no write paths here).
 */
export interface MarketReactionSnapshotRecord {
  id: string;
  hotEventId: string;
  priceVolume: ReactionSignal;
  sectorLimitUp: ReactionSignal;
  limitUpCount: number;
  tradingSession: Date;
  source: ReactionSource;
  createdAt: Date;
}

/**
 * The MarketDataAdapter port (AD-7). All market-data (行情) sources enter
 * exclusively through this interface; domain modules never import a third-party
 * SDK. V1 has no concrete implementation wired in the worker (procurement
 * deferred) — the worker resolves to none → prod degrades honestly. The only
 * concrete implementation is StubMarketDataAdapter (test-only, verify/e2e).
 *
 * Defined in adapter.ts and re-exported here for the package barrel.
 */
export interface MarketDataAdapter {
  /**
   * Fetch one market-data snapshot for the given hot event. Implementations
   * resolve the event's relevant ticker/sector (V1 deferred — real mapping
   * depends on Epic 2.2 concept/industry/stock associations) and return the
   * observed market facts. Return null when no market data is available (the
   * caller writes nothing and degrades honestly).
   */
  fetchSnapshot(args: { hotEventId: string }): Promise<MarketDataSnapshot | null>;
}
