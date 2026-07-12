/**
 * published_timeline read model — refresh + read contract (Story 4.1, AD-3b).
 *
 * Three exports:
 *   - refreshPublishedTimelineForEvent: per-HotEvent incremental upsert/delete
 *     that runs INSIDE decideReview's $transaction beside refreshPublishedReadModel
 *     (gate-atomic, method A, zero visibility window). publish → upsert this
 *     event's folded timeline row; takedown → delete it; none → no-op.
 *   - refreshPublishedTimelineAll: periodic full self-heal recompute (BullMQ).
 *     Corrective only — re-derives the whole published_timeline_entries table
 *     from the current published HotEvent set. Idempotent; failure leaves the
 *     prior projection readable.
 *   - listPublishedTimeline: the Web home feed read contract. Reads only this
 *     table; never assembles time-order SQL on the request path (AD-3/AD-3b).
 *
 * OWNERSHIP: publish-orchestrator is the sole writer of published_timeline_entries
 * (AD-2/AD-3b). It READS event-assembly's HotEvent + HotEventRevision +
 * HotEventEvidence, source-ingest's EvidenceRecord + EvidenceSource, the
 * explanation module's ExplanationVersion, and event-assembly's
 * TIMELINE_FOLD_THRESHOLD config constant. It never writes any of those.
 *
 * FOLDING: a HotEvent with >= TIMELINE_FOLD_THRESHOLD (default 2, event-assembly
 * owns it) member EvidenceRecords projects ONE timeline row tagged "同事件精选"
 * carrying the full set of folded evidence_record ids. A single-source event
 * still projects one row (with a single-element folded id set). Either way the
 * row count is exactly one per published HotEvent — folding collapses the
 * EVIDENCE set into one entry, not the events.
 *
 * NEVER full-overwrite as the primary refresh path (review item A1): the
 * per-event incremental upsert/delete inside decideReview's transaction is the
 * main path. refreshPublishedTimelineAll is a safety net only.
 */

import type { Prisma } from "../../../generated/client.js";
import { newTraceId } from "../../shared/ids.js";
import type { PublishAction } from "../review-workflow/types.js";
import {
  deriveSessionTag,
  deriveTradeDate,
} from "./session-tag.js";
import type {
  ListPublishedTimelineEntriesOptions,
  ListPublishedTimelineOptions,
  PublishedTimelineEntry,
  RefreshPublishedTimelineAllOptions,
  RefreshPublishedTimelineForEventOptions,
  TimelineSessionTagType,
} from "./types.js";

/**
 * The projection input: everything refreshPublishedTimelineForEvent needs to
 * derive one timeline row from a published HotEvent. Loaded in one findUniqueOrThrow
 * with nested selects (same shape as refreshPublishedReadModel's event load).
 *
 * `recommendationReasons` (Story 5.1) is take:1 ordered createdAt desc + id desc
 * — the latest AI 解读 row, or empty when none exist. projectTimelineFields
 * projects its `reason` (or null) into published_timeline_entries.recommendation_
 * reason. This keeps publish-orchestrator the SOLE writer of that column (AD-2/
 * AD-3b): the recommendation-reason worker only appends recommendation_reasons
 * and calls refreshPublishedTimelineForEvent to trigger this projection.
 */
interface TimelineProjectionInput {
  title: string;
  createdAt: Date;
  revisions: ReadonlyArray<{ title: string }>;
  evidence: ReadonlyArray<{
    evidenceRecord: {
      id: string;
      publishedAt: Date | null;
      source: { name: string };
    };
  }>;
  explanationVersions: ReadonlyArray<{ summary: string }>;
  recommendationReasons: ReadonlyArray<{ reason: string }>;
}

/**
 * Derive the timeline row fields from the loaded HotEvent. Pure (no DB). Used by
 * both the in-transaction per-event refresh and the full self-heal recompute so
 * they cannot drift apart. Returns null when the event has zero member evidence
 * records (defensive — a published event with no evidence links should not
 * surface on the timeline; it would have no source_name/occurred_at).
 */
function projectTimelineFields(input: TimelineProjectionInput): {
  tradeDate: string;
  occurredAt: Date;
  sessionTag: TimelineSessionTagType;
  sourceName: string;
  title: string;
  summary: string;
  evidenceCount: number;
  foldedEvidenceRecordIds: string[];
  recommendationReason: string | null;
} | null {
  if (input.evidence.length === 0) {
    return null;
  }

  // Effective title: latest revision overlay ?? cluster baseline (same rule as
  // refreshPublishedReadModel).
  const latestRevision = input.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : input.title;

  // Summary: latest ExplanationVersion.summary, or "" when none (honest degraded
  // state — the card renders an empty summary slot rather than fabricating one).
  const latestExplanation = input.explanationVersions[0] ?? null;
  const summary = latestExplanation !== null ? latestExplanation.summary : "";

  // Recommendation reason (Story 5.1): latest RecommendationReason.reason, or
  // null when none. Derived from the recommendation_reasons append-only table
  // (explanation module owns it); publish-orchestrator projects the latest into
  // published_timeline_entries.recommendation_reason — the SOLE writer of that
  // column (AD-2/AD-3b). null → the 4.2 card renders NO AI 解读 slot (absent
  // state, never an empty marketing placeholder).
  const latestReason = input.recommendationReasons[0] ?? null;
  const recommendationReason = latestReason !== null ? latestReason.reason : null;

  // occurredAt: the MAX member publishedAt. Falls back to the HotEvent's stable
  // createdAt when all members have null publishedAt (the column is non-null).
  // A STABLE fallback — not now() — is required so consecutive self-heal passes
  // re-derive the identical row (AC6 idempotency): now() would drift the row's
  // occurredAt/tradeDate/sessionTag/ordering on every 15-min pass for these
  // events. createdAt is the honest "we have no earlier time" anchor and does
  // not change between passes.
  let occurredAt: Date | null = null;
  for (const link of input.evidence) {
    const p = link.evidenceRecord.publishedAt;
    if (p !== null && (occurredAt === null || p > occurredAt)) {
      occurredAt = p;
    }
  }
  if (occurredAt === null) {
    occurredAt = input.createdAt;
  }

  // sourceName: the member with the latest publishedAt is the representative
  // source (most recent coverage). Tie-break by evidence record id for
  // determinism (mirrors projectEvidenceTimeline's tiebreaker). When all
  // publishedAt are null, occurredAt fell back to now() but the representative
  // source is still the max-id member (deterministic).
  let representative = input.evidence[0]!.evidenceRecord;
  for (const link of input.evidence) {
    const rec = link.evidenceRecord;
    const cur = representative.publishedAt;
    const cand = rec.publishedAt;
    if (cand === null) continue;
    if (cur === null || cand > cur || (cand.getTime() === cur.getTime() && rec.id > representative.id)) {
      representative = rec;
    }
  }
  const sourceName = representative.source.name;

  // Session tag + trade date: pure functions over the Asia/Shanghai framing of
  // occurredAt (AC5).
  const sessionTag = deriveSessionTag(occurredAt);
  const tradeDate = deriveTradeDate(occurredAt);

  // Folding: always one row per event. The folded id set is the full member set
  // (single-element when the event has one source). evidenceCount is the raw
  // member count (the card shows "N 条来源"); foldedEvidenceRecordIds lets the
  // 4.2 card's "同事件精选" expansion list each source. The fold THRESHOLD only
  // affects the card's "同事件精选" TAG display (>= threshold), not the row
  // count — the row is always one-per-event either way — so the threshold is
  // not read here at all; the 4.2 card render imports TIMELINE_FOLD_THRESHOLD
  // directly to make the tag decision (the constant is owned by event-assembly
  // per AD-2/AD-3b, and publish-orchestrator only writes the full folded id set
  // so the render-side decision is a pure >= check).
  const foldedEvidenceRecordIds = input.evidence.map((l) => l.evidenceRecord.id);

  return {
    tradeDate,
    occurredAt,
    sessionTag,
    sourceName,
    title: effectiveTitle,
    summary,
    evidenceCount: input.evidence.length,
    foldedEvidenceRecordIds,
    recommendationReason,
  };
}

/**
 * Refresh the timeline entry for ONE HotEvent. Designed to run inside
 * decideReview's $transaction (the caller passes its `tx` cast to PrismaClient),
 * beside refreshPublishedReadModel — so the timeline projection is atomic with
 * the publish/takedown decision (zero visibility window, AD-3b method A).
 *
 *   - action "publish":  upsert the event's timeline row (create if new, update
 *     if it already exists from a prior publish). Stable id across republishes
 *     (looked up by hotEventId) so the home feed cursor is not churned.
 *   - action "takedown": delete the event's timeline row(s). Idempotent.
 *   - action "none":     no-op (reject never published).
 *
 * If a published event has zero member evidence records, the row is deleted
 * (defensive: no source to show on the timeline).
 */
export async function refreshPublishedTimelineForEvent(
  options: RefreshPublishedTimelineForEventOptions,
): Promise<void> {
  const { prisma, traceId, hotEventId, action } = options;

  if (action === ("none" satisfies PublishAction)) {
    return;
  }

  if (action === ("takedown" satisfies PublishAction)) {
    await prisma.publishedTimelineEntry.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  // action === "publish": load the event's projection input.
  const event = await prisma.hotEvent.findUniqueOrThrow({
    where: { id: hotEventId },
    select: {
      title: true,
      createdAt: true,
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { title: true },
      },
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              id: true,
              publishedAt: true,
              source: { select: { name: true } },
            },
          },
        },
      },
      explanationVersions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { summary: true },
      },
      recommendationReasons: {
        // Story 5.4: skip suppressed reasons so a surgical takedown survives the
        // whole-event refresh (republish / self-heal). The latest non-suppressed
        // row wins; all suppressed → empty → recommendationReason projects null.
        // The signal is co-located on the source row (suppressedAt), which the
        // projection already reads — no cross-module reverse dependency on
        // review-workflow / ReviewDecision.
        where: { suppressedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { reason: true },
      },
    },
  });

  const input: TimelineProjectionInput = {
    title: event.title,
    createdAt: event.createdAt,
    revisions: event.revisions,
    evidence: event.evidence,
    explanationVersions: event.explanationVersions,
    recommendationReasons: event.recommendationReasons,
  };
  const projected = projectTimelineFields(input);

  if (projected === null) {
    // No member evidence: delete any stale row (defensive — nothing to project).
    await prisma.publishedTimelineEntry.deleteMany({
      where: { hotEventId },
    });
    return;
  }

  // Upsert by hotEventId (UNIQUE — see schema). The DB enforces one row per
  // event, so a republish UPDATES in place (home feed id stable) and a
  // concurrent in-tx publish + self-heal cannot duplicate. The row id is minted
  // once on first publish and reused on every republish.
  await prisma.publishedTimelineEntry.upsert({
    where: { hotEventId },
    create: {
      id: newTraceId(),
      hotEventId,
      tradeDate: projected.tradeDate,
      occurredAt: projected.occurredAt,
      sessionTag: projected.sessionTag,
      sourceName: projected.sourceName,
      title: projected.title,
      summary: projected.summary,
      evidenceCount: projected.evidenceCount,
      foldedEvidenceRecordIds:
        projected.foldedEvidenceRecordIds as unknown as Prisma.InputJsonValue,
      recommendationReason: projected.recommendationReason,
      traceId,
    },
    update: {
      tradeDate: projected.tradeDate,
      occurredAt: projected.occurredAt,
      sessionTag: projected.sessionTag,
      sourceName: projected.sourceName,
      title: projected.title,
      summary: projected.summary,
      evidenceCount: projected.evidenceCount,
      foldedEvidenceRecordIds:
        projected.foldedEvidenceRecordIds as unknown as Prisma.InputJsonValue,
      recommendationReason: projected.recommendationReason,
      traceId,
    },
  });
}

/**
 * Full self-heal recompute of published_timeline_entries. Corrective only — the
 * main refresh path is the in-transaction refreshPublishedTimelineForEvent. This
 * runs as a periodic BullMQ job (AD-4) and:
 *   1. Loads ALL currently-published HotEvents (+ evidence, revisions, explanations).
 *   2. For each, projects the timeline row and upserts it (stable id by hotEventId).
 *   3. Deletes any timeline row whose hotEventId is NOT in the published set
 *      (takedown that somehow missed the in-tx delete, or a stale orphan).
 *
 * Idempotent: a second consecutive run produces the exact same row set (same
 * ids, same fields). Failure of this job does NOT touch the existing projection
 * — the prior version stays readable (AC6 read-path isolation). Per-event errors
 * are logged and skipped (one bad event does not abort the whole pass).
 */
export async function refreshPublishedTimelineAll(
  options: RefreshPublishedTimelineAllOptions,
): Promise<void> {
  const { prisma, traceId } = options;

  // Load all published events with the projection input shape (same as the
  // per-event refresh, but batched). evidence.revisions.explanationVersions are
  // nested under the event.
  const publishedEvents = await prisma.hotEvent.findMany({
    where: { publicationStatus: "published" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { title: true },
      },
      evidence: {
        select: {
          evidenceRecord: {
            select: {
              id: true,
              publishedAt: true,
              source: { select: { name: true } },
            },
          },
        },
      },
      explanationVersions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { summary: true },
      },
      recommendationReasons: {
        // Story 5.4: skip suppressed reasons (same where clause as the per-event
        // refresh above — keeps the self-heal recompute consistent with the
        // in-transaction projection so a suppressed reason cannot be revived by
        // the periodic full-recompute pass).
        where: { suppressedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { reason: true },
      },
    },
  });

  // The set of published hotEventIds — used to detect + delete orphan timeline
  // rows (a row whose hotEventId is no longer published).
  const publishedIds = new Set(publishedEvents.map((e) => e.id));

  // Project + upsert each published event by hotEventId (UNIQUE — one row per
  // event, stable across passes). Per-event isolation: a projection failure on
  // one event is logged and skipped (AC6 — the job does not abort; the prior
  // projection of that event stays readable from the last successful pass).
  // Mirrors theme-backfill's per-event try/catch pattern.
  let upserted = 0;
  for (const event of publishedEvents) {
    try {
      const input: TimelineProjectionInput = {
        title: event.title,
        createdAt: event.createdAt,
        revisions: event.revisions,
        evidence: event.evidence,
        explanationVersions: event.explanationVersions,
        recommendationReasons: event.recommendationReasons,
      };
      const projected = projectTimelineFields(input);
      if (projected === null) {
        // Published event with no evidence: skip (and let the orphan sweep
        // below clean any stale row for this hotEventId, since it is not
        // re-projected here).
        continue;
      }
      await prisma.publishedTimelineEntry.upsert({
        where: { hotEventId: event.id },
        create: {
          id: newTraceId(),
          hotEventId: event.id,
          tradeDate: projected.tradeDate,
          occurredAt: projected.occurredAt,
          sessionTag: projected.sessionTag,
          sourceName: projected.sourceName,
          title: projected.title,
          summary: projected.summary,
          evidenceCount: projected.evidenceCount,
          foldedEvidenceRecordIds:
            projected.foldedEvidenceRecordIds as unknown as Prisma.InputJsonValue,
          recommendationReason: projected.recommendationReason,
          traceId,
        },
        update: {
          tradeDate: projected.tradeDate,
          occurredAt: projected.occurredAt,
          sessionTag: projected.sessionTag,
          sourceName: projected.sourceName,
          title: projected.title,
          summary: projected.summary,
          evidenceCount: projected.evidenceCount,
          foldedEvidenceRecordIds:
            projected.foldedEvidenceRecordIds as unknown as Prisma.InputJsonValue,
          recommendationReason: projected.recommendationReason,
          traceId,
        },
      });
      upserted += 1;
    } catch (error) {
      console.error(
        `[publish-orchestrator] refreshPublishedTimelineAll: failed for hotEvent ${event.id}`,
        error,
      );
    }
  }

  // Orphan sweep: delete timeline rows whose hotEventId is no longer in the
  // published set. This is what makes the job corrective — a row whose event was
  // taken down (and somehow missed the in-tx delete) is removed.
  //
  // Guard: ONLY sweep when the published set is non-empty. A transient empty
  // result here (a read-replica blip, a connection hiccup that Prisma resolves
  // to [] rather than throwing) must NOT wipe the projection — AC6 requires
  // that a failure of this job leaves the prior projection readable. Mass-
  // takedowns are already handled by the in-tx delete path, so an empty
  // published set with existing rows is far more likely a read glitch than a
  // genuine "everything unpublished" state; the next pass with a healthy read
  // will sweep true orphans then. We accept that a real all-unpublished state
  // leaves stale rows until a subsequent non-empty pass, trading a rare stale
  // row for protection against a catastrophic full-table wipe.
  if (publishedIds.size > 0) {
    const existingRows = await prisma.publishedTimelineEntry.findMany({
      select: { id: true, hotEventId: true },
    });
    const orphanIds = existingRows
      .filter((r) => !publishedIds.has(r.hotEventId))
      .map((r) => r.id);
    if (orphanIds.length > 0) {
      await prisma.publishedTimelineEntry.deleteMany({
        where: { id: { in: orphanIds } },
      });
    }
  }

  void upserted; // operator-log surface; not returned to keep the signature void.
}

/**
 * The shared published_timeline_entries column selection used by both
 * listPublishedTimeline (date-scoped feed) and listPublishedTimelineEntries
 * (filter-free search corpus). Extracted so the two fns cannot drift apart on
 * the projected column set — they MUST produce identical row shapes (the search
 * corpus is the filter-free sibling of the feed contract). 11 columns. Plain
 * object (NOT `as const`) so it stays assignable to Prisma's mutable select
 * payload type.
 */
const TIMELINE_ENTRY_SELECT = {
  id: true,
  hotEventId: true,
  tradeDate: true,
  occurredAt: true,
  sessionTag: true,
  sourceName: true,
  title: true,
  summary: true,
  evidenceCount: true,
  foldedEvidenceRecordIds: true,
  recommendationReason: true,
};

/**
 * The row shape produced by `findMany({ select: TIMELINE_ENTRY_SELECT })`. The
 * two list fns feed these rows to mapPublishedTimelineRow so they share BOTH the
 * selection AND the PublishedTimelineEntry mapping (including the
 * sessionTag→TimelineSessionTagType and foldedEvidenceRecordIds Json→string[]
 * casts). Structural type — avoids importing the generated Prisma select
 * payload type (the codebase has no precedent for `satisfies Prisma.*Select`).
 */
interface SelectedTimelineEntryRow {
  id: string;
  hotEventId: string;
  tradeDate: string;
  occurredAt: Date;
  sessionTag: string;
  sourceName: string;
  title: string;
  summary: string;
  evidenceCount: number;
  foldedEvidenceRecordIds: unknown;
  recommendationReason: string | null;
}

/**
 * Map a selected published_timeline_entries row to the PublishedTimelineEntry
 * contract. Shared by listPublishedTimeline and listPublishedTimelineEntries so
 * the row→entry mapping (the sessionTag enum-string cast + the Json→string[]
 * cast for foldedEvidenceRecordIds) is defined once. Both list fns MUST call
 * this — they are contractually identical in projected shape (feed contract vs
 * filter-free search corpus; they differ only in scope, not in row shape).
 */
function mapPublishedTimelineRow(r: SelectedTimelineEntryRow): PublishedTimelineEntry {
  return {
    id: r.id,
    hotEventId: r.hotEventId,
    tradeDate: r.tradeDate,
    occurredAt: r.occurredAt,
    sessionTag: r.sessionTag as PublishedTimelineEntry["sessionTag"],
    sourceName: r.sourceName,
    title: r.title,
    summary: r.summary,
    evidenceCount: r.evidenceCount,
    foldedEvidenceRecordIds: r.foldedEvidenceRecordIds as unknown as string[],
    recommendationReason: r.recommendationReason,
  };
}

/**
 * Web home feed read contract (AD-3 / AD-3b). Reads ONLY published_timeline_entries.
 * No time-order SQL assembled on the request path; the composite index
 * (trade_date, session_tag, occurred_at) backs the ordering. Returns entries for
 * one trade_date (defaults to the latest day that has entries), optionally
 * filtered by session_tag (Story 4.3). Ordered occurred_at DESC (newest first).
 *
 * No cursor pagination in V1 (tiny scale; mirror listPublishedHotEvents' full-
 * read shape). `limit` caps the page (default 50) so a runaway day cannot OOM
 * the request.
 */
export async function listPublishedTimeline(
  options: ListPublishedTimelineOptions,
): Promise<PublishedTimelineEntry[]> {
  const { prisma, tradeDate, sessionTag, limit } = options;

  // Resolve the effective trade_date: the caller's filter, or the latest day
  // that has entries (the home feed's default view = today, falling back to the
  // most recent day with content).
  let effectiveTradeDate = tradeDate;
  if (effectiveTradeDate === undefined) {
    const latest = await prisma.publishedTimelineEntry.findFirst({
      orderBy: [{ tradeDate: "desc" }, { occurredAt: "desc" }],
      select: { tradeDate: true },
    });
    if (latest === null) {
      // Empty read model: return [] (not an error — the home renders the empty
      // state). AC4 / Verification: empty model → empty list.
      return [];
    }
    effectiveTradeDate = latest.tradeDate;
  }

  const rows = await prisma.publishedTimelineEntry.findMany({
    where: {
      tradeDate: effectiveTradeDate,
      ...(sessionTag !== undefined ? { sessionTag } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit ?? 50,
    select: TIMELINE_ENTRY_SELECT,
  });

  return rows.map(mapPublishedTimelineRow);
}

/**
 * Filter-free full-table read of published_timeline_entries — the search corpus
 * (Story 4.4). Distinct from `listPublishedTimeline` (the home feed contract):
 *   - listPublishedTimeline is date-scoped: tradeDate defaults to the latest day
 *     with entries, limit caps at 50. It serves the HOME FEED's "today" view and
 *     CANNOT be the search corpus (it would miss historical entries on other
 *     trade dates).
 *   - listPublishedTimelineEntries is filter-free: no tradeDate/sessionTag/
 *     limit. It returns EVERY published timeline row across ALL trade dates so
 *     the search-read path can match title/summary against the full corpus. The
 *     same `published_timeline` read-model column set is projected to the same
 *     `PublishedTimelineEntry` shape (11 fields) — the two fns share the row→
 *     entry mapping, they differ only in scope (date-scoped feed vs full-table
 *     corpus). This mirrors the established "filter-free sibling list fn for
 *     search" family (listPublishedHotEvents / listPublishedHotEventExplanations
 *     / listPublishedThemeMemberships — AD-3 read-only, V1 published volume is
 *     tiny so a full read is the ponytail choice over SQL filter / FTS).
 *
 * `orderBy: [{ hotEventId: "asc" }]` gives deterministic row order across loads
 * (mirrors the listPublishedHotEventExplanations sibling contract). The search
 * layer applies its own ranking (tier then occurredAt DESC), so this order is
 * not the final display order — it just makes the row sequence stable for
 * reproducible matching.
 *
 * Reads ONLY published_timeline_entries; never touches hot_events /
 * explanation_versions / evidence_* (AD-3). Row existence = currently published
 * (no status column, AD-8). A taken-down event's timeline row is cascade-
 * deleted inside decideReview's transaction → it automatically disappears from
 * the search corpus (no extra filter).
 */
export async function listPublishedTimelineEntries(
  options: ListPublishedTimelineEntriesOptions,
): Promise<PublishedTimelineEntry[]> {
  const { prisma } = options;

  const rows = await prisma.publishedTimelineEntry.findMany({
    select: TIMELINE_ENTRY_SELECT,
    orderBy: [{ hotEventId: "asc" }],
  });

  return rows.map(mapPublishedTimelineRow);
}
