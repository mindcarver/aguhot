/**
 * association-service — derive concept/industry/stock associations from an
 * adapter's output and append an EventAssociationSet row (AD-2/AD-5 append-only).
 *
 * Story 2.2. This module owns the event_association_sets table (AD-2
 * append-only). It derives concept/industry/stock AssociationItems from an
 * AssociationAdapter's output, each item carrying a kind, a label, and a
 * NON-EMPTY mappingBasis (provenance — AC2).
 *
 *   - generateAssociations: read the adapter → validate each item's mappingBasis
 *     is non-empty (throw on a missing basis — AC2 fail-fast, never silently
 *     fill a default) → normalize (dedup by kind+label, preserve order) → APPEND
 *     one EventAssociationSet (never update/delete prior rows — AD-5). Returns
 *     null when adapter is missing, returns null, or returns an empty array (no
 *     honest derivation possible; never writes a fabricated set).
 *     source="template" in V1.
 *   - getLatestAssociationSet: createdAt desc + id desc first row, or null.
 *     publish-orchestrator reads this at projection time.
 *   - normalizeItems: pure function (items → deduped items), testable without a
 *     DB. Same input → identical output (deterministic).
 *
 * This module never writes published_* (publish-orchestrator owns those
 * projections) and never writes hot_events (event-assembly owns those). It only
 * appends event_association_sets.
 *
 * The derivation is pure logic + a DB append (no BullMQ, no SDK), so verify/seed
 * scripts can call it directly without Redis — same convention as
 * generateExplanation / generateMarketReaction / clusterEvents. V1 has NO
 * association-generation worker (epic lists only market-signal / digest /
 * theme-backfill BullMQ job categories), so there is no apps/worker queue for
 * this; generateAssociations is invoked by verify/seed only.
 */

import type { Prisma } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import { AssociationKind, AssociationSource } from "./types.js";
import type {
  AssociationItem,
  AssociationSetRecord,
  GenerateAssociationsOptions,
  GenerateAssociationsResult,
  GetLatestAssociationSetOptions,
} from "./types.js";

/**
 * Generate concept/industry/stock associations from the adapter's output, then
 * APPEND one EventAssociationSet row (source="template"). Returns null and
 * writes nothing when:
 *   - adapter is undefined (V1 prod: no worker, no provider wired), OR
 *   - adapter.fetchAssociations returns null, OR
 *   - adapter.fetchAssociations returns an empty array (no associations).
 *
 * Honest degradation (NFR: never fake data): no adapter / no data → no set →
 * the public detail page shows the "暂无已确认的概念 / 行业 / 个股关联。"
 * degraded state (AC3). Never fabricates a set from nothing.
 *
 * AC2 explicit mapping basis: every adapter-returned item MUST have a non-empty
 * mappingBasis. An item missing a basis is rejected — generateAssociations
 * THROWS (fail-fast). It never silently fills a default basis, because that
 * would make AC2's "explicit basis" requirement decorative (any source,
 * including future hand-filled, could produce basis-less associations).
 *
 * Append-only (AD-5): every successful call inserts a NEW row. Prior rows are
 * never updated or deleted — the full set history is the version series.
 * publish-orchestrator projects the LATEST row (createdAt desc, id desc
 * tiebreaker) into the public read model.
 *
 * NFR: the item labels describe entity identity only (concept name / industry
 * name / stock name) and NEVER contain buy/sell/target-price/position wording
 * (explanatory, not advisory).
 */
export async function generateAssociations(
  options: GenerateAssociationsOptions,
): Promise<GenerateAssociationsResult | null> {
  const { prisma, traceId, hotEventId, adapter } = options;

  // No adapter → honest degradation (V1 prod has no worker + no provider).
  // Never fabricate.
  if (adapter === undefined) return null;

  const rawItems = await adapter.fetchAssociations({ hotEventId });
  if (rawItems === null) return null;
  if (rawItems.length === 0) return null;

  // AC2: validate every item has a non-empty mappingBasis. Throw on a missing
  // basis rather than silently filling a default (fail-fast).
  const normalized = normalizeItems(rawItems);
  if (normalized.length === 0) return null;

  // APPEND a new set row (source="template"). Never update or delete prior
  // rows (AD-5). The items Json column accepts the typed array via a cast to
  // Prisma.InputJsonValue (Prisma's Json envelope does not infer the element
  // type; the cast is the documented boundary between TS types and the Json
  // column — same role as `raw as object` in source-ingest).
  const created = await prisma.eventAssociationSet.create({
    data: {
      id: newTraceId(),
      hotEventId,
      items: normalized as unknown as Prisma.InputJsonValue,
      source: AssociationSource.Template,
      traceId,
    },
    select: {
      id: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  return {
    eventAssociationSetId: created.id,
    hotEventId,
    items: created.items as unknown as AssociationItem[],
    source: created.source as AssociationSource,
    createdAt: created.createdAt,
    traceId,
  };
}

/**
 * Return the latest EventAssociationSet for an event (createdAt desc, id desc
 * tiebreaker — UUIDv7 ids embed a monotonic timestamp so two sets sharing the
 * same createdAt millisecond resolve deterministically to the newer one), or
 * null if none exist. publish-orchestrator uses this at projection time to
 * surface the current set into the public read model.
 */
export async function getLatestAssociationSet(
  options: GetLatestAssociationSetOptions,
): Promise<AssociationSetRecord | null> {
  const { prisma, hotEventId } = options;

  const latest = await prisma.eventAssociationSet.findFirst({
    where: { hotEventId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      hotEventId: true,
      items: true,
      source: true,
      createdAt: true,
    },
  });

  if (latest === null) return null;
  return {
    id: latest.id,
    hotEventId: latest.hotEventId,
    items: latest.items as unknown as AssociationItem[],
    source: latest.source as AssociationSource,
    createdAt: latest.createdAt,
  };
}

// --- deterministic normalization --------------------------------------------

/**
 * Normalize the adapter's raw items into the stored form:
 *   - validate each item has a known kind + non-empty label + NON-EMPTY
 *     mappingBasis (AC2). An item missing a basis THROWS (fail-fast, never
 *     silently filled). This is the AC2 data-level enforcement.
 *   - dedup by (kind, label), preserving first-seen order so re-projection is
 *     deterministic across runs.
 *   - drop items with an empty label (defensive; an adapter that returns an
 *     empty label is malformed but we skip rather than throw — the basis check
 *     is the AC2 hard gate, the label check is a sanity filter).
 *
 * Pure function: same input → identical output. No clocks, no randomness.
 */
export function normalizeItems(rawItems: AssociationItem[]): AssociationItem[] {
  const seen = new Set<string>();
  const out: AssociationItem[] = [];
  for (const item of rawItems) {
    // AC2 hard gate: every item must carry a non-empty mappingBasis. Throw on
    // a missing/empty basis — never silently fill a default (otherwise the
    // "explicit basis" requirement becomes decoration).
    if (
      item.mappingBasis === undefined ||
      item.mappingBasis === null ||
      item.mappingBasis.trim() === ""
    ) {
      throw new Error(
        `[theme-linking] adapter returned an association item without a mappingBasis (kind=${item.kind}, label=${item.label}); AC2 requires an explicit mapping basis on every item`,
      );
    }
    // Sanity filter: skip items with an empty label (malformed adapter output).
    if (item.label === undefined || item.label === null || item.label.trim() === "") {
      continue;
    }
    if (!isAssociationKind(item.kind)) {
      // Skip items with an unknown kind rather than throwing — a future adapter
      // adding a 4th kind should not crash V1 (it is silently dropped until the
      // union + UI are extended). ponytail: no speculative kind handling.
      continue;
    }
    const key = `${item.kind} ${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: item.kind,
      label: item.label,
      mappingBasis: item.mappingBasis,
    });
  }
  return out;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<string>([
  AssociationKind.Concept,
  AssociationKind.Industry,
  AssociationKind.Stock,
]);

function isAssociationKind(value: unknown): value is AssociationKind {
  return typeof value === "string" && KNOWN_KINDS.has(value);
}
