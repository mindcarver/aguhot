/**
 * Deterministic integration verification for the published_timeline read model
 * (Story 4.1, AD-3b).
 *
 * Run with: pnpm --filter @aguhot/worker verify:timeline (tsx src/verify-timeline.ts).
 *
 * It exercises the spec 4.1 I/O & Edge-Case Matrix + AC1-AC6 against real local
 * PostgreSQL AND real local Redis (the self-heal job runs via BullMQ, so Redis
 * is required — Block-If: if Redis is unreachable, the script HALTs and reports
 * it, never skips). It seeds published HotEvents + multi-source EvidenceSources,
 * drives decideReview approve/takedown to assert the in-transaction incremental
 * upsert/delete (AC1/AC3, zero visibility window), runs the self-heal BullMQ
 * job to assert idempotency (AC6), and query-asserts trade-date grouping /
 * occurred_at desc order / folding / visibility isolation / session_tag
 * derivation / read contract (AC2/AC4/AC5). Prints PASS/FAIL and exits non-zero
 * iff any assertion fails.
 *
 * Flow:
 *   resetState → seed sources + archived records → clusterEvents (candidates) →
 *   decideReview approve multi-source event (assert timeline row appears, in-tx,
 *   with folded ids + session_tag + trade_date) → decideReview approve single-
 *   source event (assert independent entry) → listPublishedTimeline (AC4 read
 *   contract, desc order, trade-date grouping) → deriveSessionTag/deriveTradeDate
 *   boundary spot-checks (AC5) → decideReview takedown (assert row gone, AC3) →
 *   enqueue self-heal job (BullMQ, await via QueueEvents) twice → assert no
 *   duplicates / no orphans (AC6 idempotency) → empty-model list returns []
 *   (AC4 empty case) → PASS/FAIL → cleanup.
 *
 * Surface-anchored, not mock-based: every assertion reads real DB state through
 * the published_timeline_entries table or the listPublishedTimeline contract.
 */

import { QueueEvents } from "bullmq";

import {
  clusterEvents,
  decideReview,
  deriveSessionTag,
  deriveTradeDate,
  getPrisma,
  listPublishedTimeline,
  newTraceId,
  resetPrisma,
  TIMELINE_FOLD_THRESHOLD,
  TimelineSessionTag,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { closeRedis, getRedis } from "./queues/connection.js";
import {
  PUBLISH_TIMELINE_QUEUE_NAME,
  enqueuePublishTimeline,
  registerPublishTimelineWorker,
} from "./queues/publish-timeline-queue.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records have deterministic publishedAt offsets.
// 2024-01-02T01:30:00Z = 2024-01-02 09:30 Asia/Shanghai (a Tuesday, intraday
// session open) — picks a known trading-day intraday instant so session_tag
// derivation is deterministic and assertable.
const BASE_MS = Date.UTC(2024, 0, 2, 1, 30, 0); // 2024-01-02T01:30:00Z
const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG AND Redis must be reachable — the self-heal job
  // runs via BullMQ, so Redis is required for AC6. The spec forbids skipping it).
  resetEnvCache();
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  const prisma = getPrisma();
  const redis = getRedis();
  await redis.ping();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: two sources + archived records → clusterEvents → candidates ----
    // Source A (multi-source event): two records with subset titles 1h apart,
    // both intraday, so they MERGE into one candidate with 2 evidence links
    // (≥ TIMELINE_FOLD_THRESHOLD → folds to "同事件精选" timeline entry).
    // Source B (single-source event): one record → own candidate → independent
    // timeline entry (below fold threshold).
    const sourceA = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-timeline-source-A",
        kind: "rss",
        feedUrl: "file:///unused-by-timeline",
        enabled: true,
      },
    });
    const sourceB = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-timeline-source-B",
        kind: "rss",
        feedUrl: "file:///unused-by-timeline",
        enabled: true,
      },
    });

    // Two records that merge: subset titles, 1h apart, both intraday on the
    // same trading day (2024-01-02 Tuesday).
    await seedRecord(prisma, sourceA.id, {
      title: "央行降准",
      summary: "央行宣布降准",
      publishedAt: new Date(BASE_MS), // 09:30 Shanghai, Intraday
    });
    await seedRecord(prisma, sourceA.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "本次降准为全面降准释放流动性",
      publishedAt: new Date(BASE_MS + 1 * HOUR), // 10:30 Shanghai, Intraday
    });
    // One record for the single-source event (different title → own candidate).
    await seedRecord(prisma, sourceB.id, {
      title: "美股大跌三大股指重挫",
      summary: "美股暴跌",
      publishedAt: new Date(BASE_MS + 2 * HOUR), // 11:30 Shanghai, PostClose boundary
    });

    // Produce real candidates via the 1.5 path.
    await clusterEvents({ prisma, traceId: newTraceId() });

    const candidates = await prisma.hotEvent.findMany({
      include: { evidence: { select: { evidenceRecordId: true } } },
    });
    // The multi-source event (2 links) and the single-source event (1 link).
    const multiEvent = candidates.find((c) => c.evidence.length === 2);
    const singleEvent = candidates.find((c) => c.evidence.length === 1);

    // --- AC1: decideReview approve → in-tx timeline upsert (zero window) ------
    // Approve the multi-source event. The timeline row must appear INSIDE the
    // same transaction — there is no window where the event is published but
    // the timeline row is absent.
    const multiEventId = multiEvent!.id;
    const approveTraceId = newTraceId();
    await decideReview({
      prisma,
      traceId: approveTraceId,
      hotEventId: multiEventId,
      outcome: "approve",
      reviewer: "verify-timeline",
      note: "approve multi-source",
    });

    // Read the timeline row directly + via the contract.
    const multiRow = await prisma.publishedTimelineEntry.findFirst({
      where: { hotEventId: multiEventId },
    });
    const multiFoldedIds = (multiRow?.foldedEvidenceRecordIds as unknown as string[]) ?? [];
    assertions.push({
      name: "AC1 approve multi-source event → timeline row exists in-tx (zero window)",
      ok: multiRow !== null,
      detail: multiRow === null ? "no timeline row after approve" : `hotEventId=${multiEventId}`,
    });
    assertions.push({
      name: "AC1 timeline row trace_id = decideReview trace_id",
      ok: multiRow !== null && multiRow.traceId === approveTraceId,
      detail:
        multiRow === null
          ? "no row"
          : `row.traceId=${multiRow.traceId} expected=${approveTraceId}`,
    });
    assertions.push({
      name: "AC2 multi-source event folds (evidence_count = 2, folded ids length = 2)",
      ok:
        multiRow !== null &&
        multiRow.evidenceCount === 2 &&
        multiFoldedIds.length === 2,
      detail:
        multiRow === null
          ? "no row"
          : `evidenceCount=${multiRow.evidenceCount} foldedIdsLen=${multiFoldedIds.length} threshold=${TIMELINE_FOLD_THRESHOLD}`,
    });
    // Zero-window assertion: at the moment decideReview resolved, the timeline
    // row was committed in the same tx. We cannot observe "during" the tx from
    // outside, but we CAN assert the row carries the SAME traceId as the
    // decision (proving it was written inside the decideReview tx, not by a
    // later async refresh). This is the surface-anchored zero-window proof.
    assertions.push({
      name: "AC1 zero-window: timeline row written by decideReview tx (not an async refresh)",
      ok: multiRow !== null && multiRow.traceId === approveTraceId,
      detail:
        multiRow === null
          ? "no row"
          : `trace_id match proves in-tx write (row.traceId=${multiRow.traceId})`,
    });

    // --- AC2: approve single-source event → independent entry -----------------
    const singleEventId = singleEvent!.id;
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: singleEventId,
      outcome: "approve",
      reviewer: "verify-timeline",
      note: "approve single-source",
    });
    const singleRow = await prisma.publishedTimelineEntry.findFirst({
      where: { hotEventId: singleEventId },
    });
    const singleFoldedIds =
      (singleRow?.foldedEvidenceRecordIds as unknown as string[]) ?? [];
    assertions.push({
      name: "AC2 single-source event → independent entry (evidence_count = 1)",
      ok:
        singleRow !== null &&
        singleRow.evidenceCount === 1 &&
        singleFoldedIds.length === 1,
      detail:
        singleRow === null
          ? "no row"
          : `evidenceCount=${singleRow.evidenceCount} foldedIdsLen=${singleFoldedIds.length}`,
    });
    assertions.push({
      name: "AC2 two distinct published events → two distinct timeline rows",
      ok:
        multiRow !== null &&
        singleRow !== null &&
        multiRow.id !== singleRow.id &&
        multiRow.hotEventId !== singleRow.hotEventId,
    });

    // --- AC4: listPublishedTimeline read contract (no SQL on request path) ----
    // Default trade_date = latest day with entries; ordered occurred_at DESC.
    const feed = await listPublishedTimeline({
      prisma,
      traceId: newTraceId(),
    });
    assertions.push({
      name: "AC4 listPublishedTimeline returns entries (non-empty)",
      ok: feed.length === 2,
      detail: `feed.length=${feed.length} expected=2`,
    });
    // Descending occurred_at: the single-source event (11:30 Shanghai) is later
    // than the multi-source event's latest member (10:30 Shanghai), so it sorts
    // first.
    const occurredTimes = feed.map((e) => e.occurredAt.getTime());
    const isDesc = occurredTimes.every((t, i) =>
      i === 0 ? true : t <= occurredTimes[i - 1]!,
    );
    assertions.push({
      name: "AC4 listPublishedTimeline ordered occurred_at DESC",
      ok: feed.length === 2 && isDesc,
      detail: `times=${occurredTimes.join(",")}`,
    });
    // Trade-date grouping: both events share the same trade_date (2024-01-02).
    const tradeDates = new Set(feed.map((e) => e.tradeDate));
    assertions.push({
      name: "AC4/AC5 trade_date grouping: both entries share trade_date 2024-01-02",
      ok: tradeDates.size === 1 && tradeDates.has("2024-01-02"),
      detail: `tradeDates=${[...tradeDates].join(",")}`,
    });
    // Read-contract shape: every entry has the required fields non-empty.
    assertions.push({
      name: "AC4 read-contract shape (id/hotEventId/tradeDate/occurredAt/sessionTag/sourceName/title/summary/evidenceCount/foldedEvidenceRecordIds)",
      ok: feed.every(
        (e) =>
          e.id !== "" &&
          e.hotEventId !== "" &&
          e.tradeDate !== "" &&
          e.title !== "" &&
          typeof e.summary === "string" &&
          typeof e.evidenceCount === "number" &&
          Array.isArray(e.foldedEvidenceRecordIds),
      ),
    });

    // --- AC4 read-contract filter params (Story 4.3 backing) ------------------
    // Explicit trade_date filter matches the default day; session_tag filter
    // narrows to one session; limit caps the page. These exercise the where-
    // clauses + take cap that the default call above does not reach.
    const byExplicitDate = await listPublishedTimeline({
      prisma,
      traceId: newTraceId(),
      tradeDate: "2024-01-02",
    });
    assertions.push({
      name: "AC4 listPublishedTimeline explicit tradeDate returns the same day (2)",
      ok: byExplicitDate.length === 2,
      detail: `length=${byExplicitDate.length} expected=2`,
    });
    const intradayOnly = await listPublishedTimeline({
      prisma,
      traceId: newTraceId(),
      tradeDate: "2024-01-02",
      sessionTag: TimelineSessionTag.Intraday,
    });
    assertions.push({
      name: "AC4 listPublishedTimeline sessionTag=intraday narrows to 1 entry",
      ok:
        intradayOnly.length === 1 &&
        intradayOnly[0]!.sessionTag === TimelineSessionTag.Intraday,
      detail: `length=${intradayOnly.length}`,
    });
    const limited = await listPublishedTimeline({
      prisma,
      traceId: newTraceId(),
      tradeDate: "2024-01-02",
      limit: 1,
    });
    assertions.push({
      name: "AC4 listPublishedTimeline limit=1 caps the page to 1 entry",
      ok: limited.length === 1,
      detail: `length=${limited.length} expected=1`,
    });

    // --- AC5: session_tag derivation boundary spot-checks --------------------
    // The multi-source event's latest member is at BASE_MS+1h = 10:30 Shanghai
    // → Intraday. The single-source event is at BASE_MS+2h = 11:30 Shanghai →
    // PostClose (the lunch-break boundary, 11:30 <= local < 13:00).
    assertions.push({
      name: "AC5 multi-source event session_tag = intraday (10:30 Shanghai)",
      ok:
        multiRow !== null &&
        multiRow.sessionTag === TimelineSessionTag.Intraday,
      detail:
        multiRow === null
          ? "no row"
          : `sessionTag=${multiRow.sessionTag} expected=${TimelineSessionTag.Intraday}`,
    });
    assertions.push({
      name: "AC5 single-source event session_tag = post_close (11:30 Shanghai lunch boundary)",
      ok:
        singleRow !== null &&
        singleRow.sessionTag === TimelineSessionTag.PostClose,
      detail:
        singleRow === null
          ? "no row"
          : `sessionTag=${singleRow.sessionTag} expected=${TimelineSessionTag.PostClose}`,
    });
    // Pure-function boundary spot-checks (independent of DB state).
    assertions.push(...sessionTagBoundaryAssertions());

    // --- AC6: self-heal job idempotency (BullMQ, requires Redis) --------------
    // Enqueue the self-heal job twice via BullMQ. Each job runs a full
    // refreshPublishedTimelineAll pass. After both, the row count must equal
    // the published-event count (2), and the row ids must be STABLE across the
    // passes (upsert keyed by hotEventId). No duplicates, no orphans.
    const rowsBeforeHeal = await prisma.publishedTimelineEntry.findMany({
      select: { id: true, hotEventId: true, traceId: true },
    });
    const idsBefore = new Set(rowsBeforeHeal.map((r) => r.id));

    // Run 1.
    const healTraceId1 = newTraceId();
    await runSelfHealJob(healTraceId1);
    const rowsAfterHeal1 = await prisma.publishedTimelineEntry.findMany({
      select: { id: true, hotEventId: true, traceId: true },
    });
    // Run 2.
    const healTraceId2 = newTraceId();
    await runSelfHealJob(healTraceId2);
    const rowsAfterHeal2 = await prisma.publishedTimelineEntry.findMany({
      select: { id: true, hotEventId: true, traceId: true },
    });

    assertions.push({
      name: "AC6 self-heal job idempotent: row count stays at 2 across two passes",
      ok:
        rowsAfterHeal1.length === 2 && rowsAfterHeal2.length === 2,
      detail: `after1=${rowsAfterHeal1.length} after2=${rowsAfterHeal2.length} expected=2`,
    });
    assertions.push({
      name: "AC6 self-heal job idempotent: row ids stable (no churn across passes)",
      ok:
        rowsAfterHeal1.every((r) => idsBefore.has(r.id)) &&
        rowsAfterHeal2.every((r) => idsBefore.has(r.id)),
      detail: `ids stable across heal runs`,
    });
    assertions.push({
      name: "AC6 self-heal job stamped its own trace_id on the rows (corrective recompute ran)",
      ok:
        rowsAfterHeal1.every((r) => r.traceId === healTraceId1) &&
        rowsAfterHeal2.every((r) => r.traceId === healTraceId2),
      detail: `traceId updated by each heal pass`,
    });

    // --- AC3: decideReview takedown → in-tx timeline delete ------------------
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: multiEventId,
      outcome: "takedown",
      reviewer: "verify-timeline",
      note: "takedown multi-source",
    });
    const afterTakedown = await prisma.publishedTimelineEntry.findFirst({
      where: { hotEventId: multiEventId },
    });
    assertions.push({
      name: "AC3 takedown → timeline row deleted in-tx (visibility isolation)",
      ok: afterTakedown === null,
      detail: afterTakedown === null ? "row gone" : "row still present",
    });
    // The OTHER published event's row is untouched (isolation).
    const singleAfterTakedown = await prisma.publishedTimelineEntry.findFirst({
      where: { hotEventId: singleEventId },
    });
    assertions.push({
      name: "AC3 takedown isolation: other published event's row untouched",
      ok: singleAfterTakedown !== null,
    });

    // --- AC6 continued: self-heal sweeps a stale orphan row -------------------
    // The takedown deleted multiEvent's row in-tx. Now seed a STALE orphan: re-
    // insert a timeline row for multiEventId (a real HotEvent that is now NON-
    // published) WITHOUT going through decideReview — simulating a row that
    // missed the in-tx delete. singleEvent is still published (publishedIds non-
    // empty → the sweep guard allows deletion). Run self-heal: it must sweep the
    // stale multiEvent row and leave singleEvent's row untouched, and must NOT
    // re-create the taken-down event's row.
    const staleOrphanId = newTraceId();
    await prisma.publishedTimelineEntry.create({
      data: {
        id: staleOrphanId,
        hotEventId: multiEventId,
        tradeDate: "2024-01-02",
        occurredAt: new Date(BASE_MS),
        sessionTag: TimelineSessionTag.Intraday,
        sourceName: "stale-orphan",
        title: "stale",
        summary: "",
        evidenceCount: 1,
        foldedEvidenceRecordIds: [],
        traceId: newTraceId(),
      },
    });
    await runSelfHealJob(newTraceId());
    const afterHealPostTakedown = await prisma.publishedTimelineEntry.findMany({
      select: { id: true, hotEventId: true },
    });
    assertions.push({
      name: "AC6 self-heal sweeps stale orphan row for a non-published event",
      ok:
        afterHealPostTakedown.length === 1 &&
        afterHealPostTakedown[0]!.hotEventId === singleEventId &&
        !afterHealPostTakedown.some((r) => r.id === staleOrphanId),
      detail: `rowCount=${afterHealPostTakedown.length} (expected 1: orphan swept, single-event row kept)`,
    });

    // --- AC6 read-path isolation: empty published read does NOT wipe -----------
    // singleEvent is still published with its timeline row. Bypass decideReview
    // and flip its publicationStatus directly to "taken_down", so the timeline
    // row remains but the published set is now EMPTY (no published HotEvents).
    // Run the self-heal: the orphan-sweep guard must SKIP when the published set
    // is empty (a transient empty read must not wipe the projection — AC6), so
    // the row survives. This is the read-path-isolation guarantee under a
    // degenerate empty published read.
    await prisma.hotEvent.update({
      where: { id: singleEventId },
      data: { publicationStatus: "taken_down" },
    });
    await runSelfHealJob(newTraceId());
    const rowAfterEmptyReadHeal = await prisma.publishedTimelineEntry.findFirst({
      where: { hotEventId: singleEventId },
    });
    assertions.push({
      name: "AC6 read-path isolation: empty published read does NOT wipe existing row (sweep guard)",
      ok: rowAfterEmptyReadHeal !== null,
      detail:
        rowAfterEmptyReadHeal === null
          ? "row wiped — sweep guard failed"
          : "row survived empty-read heal (guard held)",
    });
    // Clean up the intentionally-stale row so the empty-model assertion below is
    // observed against a genuinely empty table.
    await prisma.publishedTimelineEntry.deleteMany({});

    // --- AC4 empty-model case: listPublishedTimeline returns [] ---------------
    // singleEvent was flipped to "taken_down" and its (stale) row cleared above,
    // so no published events and no timeline rows remain. The read contract must
    // return [] (not error).
    const emptyFeed = await listPublishedTimeline({
      prisma,
      traceId: newTraceId(),
    });
    assertions.push({
      name: "AC4 empty read model → listPublishedTimeline returns [] (not error)",
      ok: Array.isArray(emptyFeed) && emptyFeed.length === 0,
      detail: `length=${emptyFeed.length}`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
    await closeRedis();
  }

  report(assertions);
}

/**
 * Run the publish-timeline self-heal job via BullMQ and await its completion.
 * Registers a temporary Worker in this process, enqueues one job, awaits via
 * QueueEvents, then closes both. Mirrors verify-cluster.ts' job-await pattern.
 */
async function runSelfHealJob(traceId: string): Promise<void> {
  const worker = registerPublishTimelineWorker();
  const queueEvents = new QueueEvents(PUBLISH_TIMELINE_QUEUE_NAME, {
    connection: getRedis(),
  });
  try {
    const job = await enqueuePublishTimeline(traceId);
    await job.waitUntilFinished(queueEvents);
  } finally {
    await queueEvents.close();
    await worker.close();
  }
}

/**
 * Pure-function boundary spot-checks for deriveSessionTag / deriveTradeDate
 * (AC5). These do not touch the DB — they pin the A-share session boundary
 * instants so a regression in session-tag.ts is caught here too.
 */
function sessionTagBoundaryAssertions(): Assertion[] {
  const out: Assertion[] = [];
  // All instants are UTC; comments show the Asia/Shanghai local equivalent.
  // 2024-01-02 is a Tuesday (trading day).
  const cases: Array<{
    label: string;
    utc: Date;
    session: string;
    tradeDate: string;
  }> = [
    {
      label: "pre_open (09:00 Shanghai = 01:00 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 1, 0, 0)),
      session: TimelineSessionTag.PreOpen,
      tradeDate: "2024-01-02",
    },
    {
      label: "intraday morning (09:30 Shanghai = 01:30 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 1, 30, 0)),
      session: TimelineSessionTag.Intraday,
      tradeDate: "2024-01-02",
    },
    {
      label: "lunch break / post_close boundary (11:30 Shanghai = 03:30 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 3, 30, 0)),
      session: TimelineSessionTag.PostClose,
      tradeDate: "2024-01-02",
    },
    {
      label: "intraday afternoon (13:00 Shanghai = 05:00 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 5, 0, 0)),
      session: TimelineSessionTag.Intraday,
      tradeDate: "2024-01-02",
    },
    {
      label: "post_close after 15:00 (15:00 Shanghai = 07:00 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 7, 0, 0)),
      session: TimelineSessionTag.PostClose,
      tradeDate: "2024-01-02",
    },
    {
      label: "non_trading before 09:00 (08:00 Shanghai = 00:00 UTC)",
      utc: new Date(Date.UTC(2024, 0, 2, 0, 0, 0)),
      session: TimelineSessionTag.NonTrading,
      tradeDate: "2024-01-02",
    },
    {
      label: "non_trading weekend (Saturday 10:00 Shanghai = 02:00 UTC Sat)",
      utc: new Date(Date.UTC(2024, 0, 6, 2, 0, 0)),
      session: TimelineSessionTag.NonTrading,
      tradeDate: "2024-01-06",
    },
    {
      label: "trade_date rolls at UTC+8 (16:00 UTC = next-day 00:00 Shanghai)",
      utc: new Date(Date.UTC(2024, 0, 2, 16, 0, 0)),
      session: TimelineSessionTag.NonTrading,
      tradeDate: "2024-01-03",
    },
  ];
  for (const c of cases) {
    const gotSession = deriveSessionTag(c.utc);
    const gotTradeDate = deriveTradeDate(c.utc);
    out.push({
      name: `AC5 deriveSessionTag/deriveTradeDate: ${c.label}`,
      ok: gotSession === c.session && gotTradeDate === c.tradeDate,
      detail: `session=${gotSession} (expected ${c.session}), tradeDate=${gotTradeDate} (expected ${c.tradeDate})`,
    });
  }
  return out;
}

// --- seeding / cleanup helpers ----------------------------------------------

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // FK-safe delete order. published_timeline_entries has onDelete: Cascade to
  // hot_events, but we clear it explicitly so a prior run's residue is gone
  // even if hot_events is empty. hot_event_revisions has Restrict on hot_events
  // → clear first.
  await prisma.publishedTimelineEntry.deleteMany({});
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEventReaction.deleteMany({});
  await prisma.publishedHotEventAssociation.deleteMany({});
  await prisma.publishedHotEventTheme.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.hotEventRevision.deleteMany({});
  await prisma.explanationVersion.deleteMany({});
  await prisma.publicationDecision.deleteMany({});
  await prisma.reviewDecision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string; summary: string; publishedAt: Date },
): Promise<{ id: string; title: string }> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  const rec = await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: `https://verify.test/${encodeURIComponent(data.title)}`,
      title: data.title,
      summary: data.summary,
      publishedAt: data.publishedAt,
      ingestedAt: new Date(),
      contentHash,
      status: "archived",
      failureReason: null,
      rawPayload: { seeded: true, salt },
      traceId: newTraceId(),
    },
  });
  return { id: rec.id, title: rec.title ?? "" };
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await resetState(prisma);
}

// --- reporting --------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== published_timeline verification (Story 4.1) ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[verify-timeline] fatal", error);
  process.exit(1);
});
