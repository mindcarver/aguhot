/**
 * market-reaction module barrel — Story 2.1.
 *
 * Owns the market_reaction_snapshots table (AD-2 append-only). Exposes the
 * signal generator + the latest-snapshot read query + the MarketDataAdapter
 * port + the StubMarketDataAdapter (test-only). The Prisma client lives one
 * level up and is re-exported from the package barrel.
 *
 * This module never writes published_* (publish-orchestrator owns the public
 * projection) or hot_events (event-assembly owns those). It only appends
 * market_reaction_snapshots; publish-orchestrator reads the latest at
 * projection time and writes the public read model.
 */

export {
  generateMarketReaction,
  getLatestMarketReaction,
  deriveSignals,
} from "./market-reaction-service.js";
export { StubMarketDataAdapter } from "./stub-adapter.js";
export { ReactionTone, ReactionSource, ReactionDimension } from "./types.js";
export type {
  ReactionTone as ReactionToneType,
  ReactionSource as ReactionSourceType,
  ReactionDimension as ReactionDimensionType,
  ReactionSignal,
  MarketDataSnapshot,
  MarketDataAdapter,
  GenerateMarketReactionOptions,
  GenerateMarketReactionResult,
  GetLatestMarketReactionOptions,
  MarketReactionSnapshotRecord,
} from "./types.js";
