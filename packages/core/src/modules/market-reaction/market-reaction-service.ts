/**
 * market-reaction-service — derive two reaction signals from a market snapshot
 * and append a MarketReactionSnapshot row (AD-2/AD-5 append-only).
 *
 * Story 2.1. This module owns the market_reaction_snapshots table (AD-2
 * append-only). It derives TWO signal dimensions — price/volume + sector/limit-up
 * — from a MarketDataAdapter's output, each carrying a tone (up/down/flat) and a
 * display value, plus a shared tradingSession time context.
 *
 *   - generateMarketReaction: read the adapter → derive signals → APPEND one
 *     MarketReactionSnapshot (never update/delete prior rows — AD-5). Returns
 *     null when adapter is missing or returns null (no honest derivation
 *     possible; never writes a fabricated snapshot). source="template" in V1.
 *   - getLatestMarketReaction: createdAt desc + id desc first row, or null.
 *     publish-orchestrator reads this at projection time.
 *   - deriveSignals: pure function (snapshot → two signals), testable without a
 *     DB. Same input → identical tone/value (deterministic).
 *
 * This module never writes published_* (publish-orchestrator owns those
 * projections) and never writes hot_events (event-assembly owns those). It only
 * appends market_reaction_snapshots.
 *
 * The derivation is pure logic (no BullMQ, no SDK), so verify/seed scripts can
 * call it directly without Redis — same convention as generateExplanation /
 * clusterEvents. The BullMQ `market-reaction` worker (apps/worker) is the prod-
 * runtime carrier (AD-4) and calls this function via a dynamic import. V1 worker
 * resolves NO adapter → returns null → no snapshot → prod degrades honestly.
 */

import { newTraceId } from "../../shared/ids.js";
import { ReactionSource, ReactionTone } from "./types.js";
import type {
  GenerateMarketReactionOptions,
  GenerateMarketReactionResult,
  GetLatestMarketReactionOptions,
  MarketDataSnapshot,
  MarketReactionSnapshotRecord,
  ReactionSignal,
} from "./types.js";

/**
 * Generate two reaction signals from the adapter's market snapshot, then APPEND
 * one MarketReactionSnapshot row (source="template"). Returns null and writes
 * nothing when:
 *   - adapter is undefined (V1 worker runtime: no provider wired), OR
 *   - adapter.fetchSnapshot returns null (no market data available).
 *
 * Honest degradation (NFR: never fake data): no adapter / no data → no snapshot
 * → the public detail page shows the "市场反应数据暂不可用" degraded state (AC3).
 * Never fabricates a snapshot from nothing.
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are
 * never updated or deleted — the full snapshot history is the time series.
 * publish-orchestrator projects the LATEST row (createdAt desc, id desc
 * tiebreaker) into the public read model.
 *
 * NFR: the derived signal values describe observed market facts (change percent,
 * sector name, limit-up count) and NEVER contain buy/sell/target-price/position
 * wording (explanatory, not advisory).
 */
export async function generateMarketReaction(
  options: GenerateMarketReactionOptions,
): Promise<GenerateMarketReactionResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // No adapter → honest degradation (V1 worker runtime). Never fabricate.
  if (adapter === undefined) return null;

  const snapshot = await adapter.fetchSnapshot({ hotEventId });
  if (snapshot === null) return null;

  const { priceVolume, sectorLimitUp, limitUpCount } = deriveSignals(snapshot);

  // APPEND a new snapshot row (source="template"). Never update or delete prior
  // rows (AD-5).
  const created = await prisma.marketReactionSnapshot.create({
    data: {
      id: newTraceId(),
      hotEventId,
      priceVolumeTone: priceVolume.tone,
      priceVolumeValue: priceVolume.value,
      sectorLimitUpTone: sectorLimitUp.tone,
      sectorLimitUpValue: sectorLimitUp.value,
      limitUpCount,
      tradingSession: snapshot.tradingSession,
      source: ReactionSource.Template,
      traceId,
    },
    select: {
      id: true,
      priceVolumeTone: true,
      priceVolumeValue: true,
      sectorLimitUpTone: true,
      sectorLimitUpValue: true,
      limitUpCount: true,
      tradingSession: true,
      source: true,
      createdAt: true,
    },
  });

  return {
    marketReactionSnapshotId: created.id,
    hotEventId,
    priceVolume: {
      tone: created.priceVolumeTone as ReactionTone,
      value: created.priceVolumeValue,
    },
    sectorLimitUp: {
      tone: created.sectorLimitUpTone as ReactionTone,
      value: created.sectorLimitUpValue,
    },
    limitUpCount: created.limitUpCount,
    tradingSession: created.tradingSession,
    source: created.source as ReactionSource,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest MarketReactionSnapshot for an event (createdAt desc, id desc
 * tiebreaker — UUIDv7 ids embed a monotonic timestamp so two snapshots sharing
 * the same createdAt millisecond resolve deterministically to the newer one), or
 * null if none exist. publish-orchestrator uses this at projection time to
 * surface the current snapshot into the public read model.
 */
export async function getLatestMarketReaction(
  options: GetLatestMarketReactionOptions,
): Promise<MarketReactionSnapshotRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.marketReactionSnapshot.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      priceVolumeTone: true,
      priceVolumeValue: true,
      sectorLimitUpTone: true,
      sectorLimitUpValue: true,
      limitUpCount: true,
      tradingSession: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    hotEventId: latest.hotEventId,
    priceVolume: {
      tone: latest.priceVolumeTone as ReactionTone,
      value: latest.priceVolumeValue,
    },
    sectorLimitUp: {
      tone: latest.sectorLimitUpTone as ReactionTone,
      value: latest.sectorLimitUpValue,
    },
    limitUpCount: latest.limitUpCount,
    tradingSession: latest.tradingSession,
    source: latest.source as ReactionSource,
    createdAt: latest.createdAt,
  };
}

// --- deterministic derivation -----------------------------------------------

/**
 * The threshold (in absolute percent) above which a signal is "up" or "down"
 * rather than "flat". Below this the change is treated as negligible (flat) so
 * we do not over-signal noise. ±0.1% matches typical market convention for
 * "no meaningful move."
 */
const FLAT_THRESHOLD_PERCENT = 0.1;

/**
 * Derive the two reaction signals from a market snapshot. Pure function: same
 * snapshot → identical signals. No clocks, no randomness inside the values.
 *
 *   - priceVolume (价格/成交): tone from priceVolumeChangePercent sign vs the
 *     flat threshold; value is a formatted "+X.XX%" / "-X.XX%" / "X.XX%" string.
 *   - sectorLimitUp (板块/涨停): tone from sector.changePercent sign; value is
 *     "<sectorName> +X.X% / 涨停 N 家" — a single chip carrying the sector name,
 *     its change, and the session's limit-up count (the two facts are paired
 *     because the sector move and limit-up breadth together describe the
 *     reaction breadth).
 *
 * NFR: the value strings describe observed facts only. No buy/sell/target-price
 * /position wording (explanatory, not advisory).
 */
export function deriveSignals(snapshot: MarketDataSnapshot): {
  priceVolume: ReactionSignal;
  sectorLimitUp: ReactionSignal;
  limitUpCount: number;
} {
  const priceVolume: ReactionSignal = {
    tone: toneFromPercent(snapshot.priceVolumeChangePercent),
    value: formatPercent(snapshot.priceVolumeChangePercent),
  };

  const sector = snapshot.sector;
  const sectorLimitUp: ReactionSignal = {
    tone: toneFromPercent(sector.changePercent),
    value: `${sector.name} ${formatPercent(sector.changePercent)} / 涨停 ${snapshot.limitUpCount} 家`,
  };

  return {
    priceVolume,
    sectorLimitUp,
    limitUpCount: snapshot.limitUpCount,
  };
}

/**
 * Map a signed change percent to a reaction tone. Above +threshold → up, below
 * -threshold → down, in between → flat.
 */
function toneFromPercent(percent: number): ReactionTone {
  if (percent > FLAT_THRESHOLD_PERCENT) return ReactionTone.Up;
  if (percent < -FLAT_THRESHOLD_PERCENT) return ReactionTone.Down;
  return ReactionTone.Flat;
}

/**
 * Format a signed change percent as a display string. Always includes the sign
 * for up/down (e.g. "+3.42%", "-1.30%") so the chip's value reads unambiguously
 * alongside the 涨/跌/平 label. Flat uses the signed form too for consistency
 * (e.g. "+0.05%"). Two decimal places.
 */
function formatPercent(percent: number): string {
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}
