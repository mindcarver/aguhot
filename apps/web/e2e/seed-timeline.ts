/**
 * Seed script for the @timeline e2e — Story 4.2 (Epic 4 时间流首页) + Story 4.3
 * (session/category filters).
 *
 * Run with: pnpm --filter web e2e:timeline
 *           (tsx e2e/seed-timeline.ts && playwright test --grep @timeline)
 *
 * Self-contained: produces FOUR published hot events via the real publish pipeline
 * (cluster → generateExplanation → decideReview approve) so the timeline e2e can
 * assert the populated-card behavior the surface-anchored timeline.spec.ts cannot:
 *   - Event A「半导体设备」: 2 member EvidenceRecords (merged into one candidate,
 *     overlap-coefficient = 1.0) → `evidenceCount = 2` → `foldedEvidenceRecordIds
 *     .length = 2 >= TIMELINE_FOLD_THRESHOLD(2)` → the card renders the
 *     「同事件精选」fold tag + the `<details>` disclosure.
 *   - Event B「稀土出口」: 1 member EvidenceRecord → `evidenceCount = 1` → single-
 *     source card, NO fold tag, NO reason tag (FR-3 revised).
 *
 * Both events go through `decideReview` approve, which calls
 * `refreshPublishedTimelineForEvent` inside the same `$transaction` (4.1, AD-3b
 * method A) — so the `published_timeline_entries` rows exist for the home feed.
 * `recommendationReason` stays NULL (the 5.1 AI 解读 slot) so the e2e can assert
 * the AI 解读 slot + AiLabel do NOT render pre-5.1.
 *
 * Story 4.3 — association injection for category-filter assertions:
 * After each event is published, three of the four get an `EventAssociationSet`
 * via `generateAssociations` (with an inline per-event adapter, NOT the shared
 * StubAssociationAdapter — the stub returns one fixed item set for every event,
 * but the category filter tests need DETERMINISTIC positive/negative coverage
 * across events + kinds). The fourth event (铜价) gets NO association set — the
 * negative case (no row, never matches any `?category=` filter). The map:
 *   - 半导体: concept(半导体) + industry(芯片) + stock(中芯国际) — all 3 kinds.
 *   - 稀土:   concept(稀土) + industry(有色金属) — concept + industry only.
 *   - 军工:   stock(中航沈飞) — stock only.
 *   - 铜价:   (no association set) — never matches any category filter.
 * So `?category=concept` matches 半导体 + 稀土; `?category=industry` matches
 * 半导体 + 稀土; `?category=stock` matches 半导体 + 军工; 铜价 is always the
 * negative sample. The per-event adapter keeps this deterministic across runs.
 *
 * Story 4.3 review-driven pin — deterministic session spread:
 * The 4 events' evidence-record `publishedAt` (which drives occurredAt /
 * latestEvidenceAt / sessionTag / tradeDate) are pinned to FIXED UTC instants
 * on Tuesday 2024-01-02 (a trading weekday, no PRC holiday calendar in V1) so
 * the session filter tests can assert specific event inclusion/exclusion rather
 * than the time-of-day-dependent `<=` they used before. Asia/Shanghai = UTC+8
 * (no DST); deriveSessionTag maps the Shanghai-local time to the bucket:
 *   - 半导体 (folded, evidenceCount 2): occurredAt = 10:00 Shanghai =
 *     2024-01-02T02:00:00.000Z → Intraday (09:30–11:30 morning).
 *   - 铜价 (single, NO association): 14:00 Shanghai =
 *     2024-01-02T06:00:00.000Z → Intraday (13:00–15:00 afternoon).
 *   - 稀土 (single, concept+industry): 09:15 Shanghai =
 *     2024-01-02T01:15:00.000Z → PreOpen (09:00–09:30 auction).
 *   - 军工 (single, stock only): 15:30 Shanghai =
 *     2024-01-02T07:30:00.000Z → PostClose (15:00+).
 * All 4 share tradeDate 2024-01-02 (same Shanghai calendar day; none roll past
 * midnight — the latest is 15:30 local). Intraday = {半导体, 铜价} (2), PreOpen =
 * {稀土} (1), PostClose = {军工} (1).
 *
 * Side-effect on the 4.2 band test (review-driven, acknowledged): band ordering
 * is evidenceCount DESC then latestEvidenceAt DESC. 半导体 (count 2) is rank 1;
 * the three count-1 events break by latestEvidenceAt DESC → 军工 (07:30Z) >
 * 铜价 (06:00Z) > 稀土 (01:15Z), so 稀土 drops to rank 4 (outside top-3) and
 * the band test's link assertion is updated to match. The `近期升温` reason tag
 * is a 72h-recency signal against the page's real wall-clock `now`; pinning to
 * 2024-01-02 puts every event ~930 days outside that window, so NO reason tag
 * renders and the band test's `近期升温` assertion is updated to assert the
 * no-tag state (signal-based, not recency-based, was the original assumption —
 * corrected here: the tag IS recency-based, so the pinned dates defeat it and
 * the test expectation is adjusted per the review-driven constraint).
 *
 * Requires DATABASE_URL pointing at local PG. Clears the full table set
 * (including published_timeline_entries + published_hot_event_associations,
 * which seed-revision does not touch) so re-runs are deterministic. Does NOT
 * touch seed-console/feed/detail/revision.
 */

import {
  clusterEvents,
  decideReview,
  generateAssociations,
  generateExplanation,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
} from "@aguhot/core";
import type { AssociationAdapter, AssociationItem } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

/**
 * Fixed UTC instants for the 4 events' evidence records (Story 4.3 review pin).
 * See the module-level docstring above for the full session-spread rationale.
 * These replace the former `Date.now() - N*HOUR` relative timestamps so session
 * derivation is deterministic across run times (no weekend non_trading collapse,
 * no time-of-day drift). All share Shanghai calendar date 2024-01-02.
 */
const SEMI_LATER = new Date("2024-01-02T02:00:00.000Z"); // 10:00 Shanghai → Intraday
const SEMI_EARLIER = new Date("2024-01-02T01:45:00.000Z"); // 09:45 Shanghai → Intraday (earlier member)
const COPPER_PUBLISHED_AT = new Date("2024-01-02T06:00:00.000Z"); // 14:00 Shanghai → Intraday
const RARE_PUBLISHED_AT = new Date("2024-01-02T01:15:00.000Z"); // 09:15 Shanghai → PreOpen
const MILITARY_PUBLISHED_AT = new Date("2024-01-02T07:30:00.000Z"); // 15:30 Shanghai → PostClose

export interface SeededTimeline {
  folded: { hotEventId: string; title: string; sourceName: string; evidenceCount: number };
  single: { hotEventId: string; title: string; sourceName: string };
  /**
   * Total number of published events seeded (1 folded + N singles). The band
   * top-N slice test relies on this being > MAIN_LINE_BAND_TOP_N (3) so it can
   * assert the band caps at 3 items.
   */
  totalPublishedEvents: number;
  /**
   * Story 4.3 — the hotEventId of the event with NO association set (铜价).
   * Category-filter tests use this as the deterministic negative sample: it
   * never matches `?category=concept|industry|stock`.
   */
  noAssocHotEventId: string;
  /**
   * Story 4.3 — the hotEventId of an event with a stock association (军工).
   * Used by `?category=stock` positive/negative assertions (半导体 also has
   * stock, but 军工 is the stock-ONLY event so it isolates the dimension).
   */
  stockAssocHotEventId: string;
}

/**
 * Seed 1 folded event (半导体, 2 evidence) + 3 distinct single-source events
 * (稀土 / 军工 / 铜价) = 4 published total, so the band (top-3) has more
 * candidates than its slice and the top-N cap is observable.
 */
const TOTAL_PUBLISHED_EVENTS = 4;

export async function seedTimelineFeed(): Promise<SeededTimeline> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (superset of seed-detail/seed-revision, order
  // respects FK constraints, plus the 4.1 published_timeline_entries and the
  // 2.2 association tables — Story 4.3 injects associations so both must clear).
  // Deterministic re-runs; does NOT touch seed-console/feed/detail/revision.
  await prisma.publishedTimelineEntry.deleteMany({});
  await prisma.publishedHotEventAssociation.deleteMany({});
  await prisma.eventAssociationSet.deleteMany({});
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.hotEventRevision.deleteMany({});
  await prisma.explanationVersion.deleteMany({});
  await prisma.publicationDecision.deleteMany({});
  await prisma.reviewDecision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});

  const sourceSemi = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "timeline-e2e-半导体源",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });
  const sourceRare = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "timeline-e2e-稀土源",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Event A: two records with near-identical titles (overlap → one candidate,
  // evidenceCount = 2 → folded). occurredAt = MAX(publishedAt) = SEMI_LATER
  // (10:00 Shanghai → Intraday). The earlier member (SEMI_EARLIER, 09:45) is
  // also Intraday but only the MAX drives sessionTag/occurredAt.
  await seedRecord(prisma, sourceSemi.id, {
    title: "半导体设备国产化提速",
    summary: "国产半导体设备出货量显著增长",
    url: "https://verify.test/timeline-半导体-1",
    publishedAt: SEMI_EARLIER,
  });
  await seedRecord(prisma, sourceSemi.id, {
    title: "半导体设备国产化再提速",
    summary: "刻蚀与薄膜设备订单同比大增",
    url: "https://verify.test/timeline-半导体-2",
    publishedAt: SEMI_LATER,
  });

  // Event B: one record, a clearly distinct topic so it does NOT merge with A.
  // 09:15 Shanghai → PreOpen (09:00–09:30 auction window).
  await seedRecord(prisma, sourceRare.id, {
    title: "稀土出口配额例行调整",
    summary: "稀土年度出口配额按计划修订",
    url: "https://verify.test/timeline-稀土-1",
    publishedAt: RARE_PUBLISHED_AT,
  });
  // Events C + D: two more distinct single-source topics. They exist so the
  // band (top-3) has more candidates than its slice — the top-N cap is then
  // observable (4 published events, band shows 3). Story 4.3 also resolves
  // them by name (军工 / 铜价) so the per-event association injection below
  // can target them precisely: 军工 gets a stock association, 铜价 gets none
  // (the category-filter negative sample). Pinned instants: 军工 15:30 →
  // PostClose, 铜价 14:00 → Intraday (see module docstring).
  const sourceMilitary = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "timeline-e2e-军工源",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });
  const sourceCopper = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "timeline-e2e-铜源",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });
  await seedRecord(prisma, sourceMilitary.id, {
    title: "军工订单季度环比增长",
    summary: "军工板块新签订单季度环比提升",
    url: "https://verify.test/timeline-军工-1",
    publishedAt: MILITARY_PUBLISHED_AT,
  });
  await seedRecord(prisma, sourceCopper.id, {
    title: "铜价窄幅震荡",
    summary: "本周铜价区间震荡整理",
    url: "https://verify.test/timeline-铜-1",
    publishedAt: COPPER_PUBLISHED_AT,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < TOTAL_PUBLISHED_EVENTS) {
    throw new Error(
      `[seed-timeline] expected >= ${TOTAL_PUBLISHED_EVENTS} candidates after cluster, got ${pending.length}`,
    );
  }

  // Resolve all four candidates by name so the per-event association injection
  // below can target each precisely. 半导体 folds (>=2 evidence); the other
  // three are single-source. 铜价 is the category-filter negative sample (no
  // association set injected), so its identity must be pinned here.
  const foldedCandidate = pending.find((c) => c.title.includes("半导体"));
  const singleCandidate = pending.find((c) => c.title.includes("稀土"));
  const militaryCandidate = pending.find((c) => c.title.includes("军工"));
  const copperCandidate = pending.find((c) => c.title.includes("铜价"));
  if (
    foldedCandidate === undefined ||
    singleCandidate === undefined ||
    militaryCandidate === undefined ||
    copperCandidate === undefined
  ) {
    throw new Error(
      `[seed-timeline] expected 半导体 + 稀土 + 军工 + 铜价 candidates, got: ${pending.map((p) => p.title).join(" / ")}`,
    );
  }
  if (foldedCandidate.evidenceCount < 2) {
    throw new Error(
      `[seed-timeline] 半导体 candidate should fold (>=2 evidence), got ${foldedCandidate.evidenceCount}`,
    );
  }

  // Template explanation before approve so the published projection surfaces a
  // non-empty summary (the card's summary slot). recommendationReason stays NULL.
  const explainedIds = [
    foldedCandidate.id,
    singleCandidate.id,
    militaryCandidate.id,
    copperCandidate.id,
  ];
  for (const hotEventId of explainedIds) {
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId });
  }

  // Approve all four so each gets a published_timeline row + a band summary.
  // decideReview runs refreshPublishedTimelineForEvent + refreshPublishedReadModel
  // inside the same transaction (AD-3b method A); the latter calls
  // projectAssociations, but at this point no EventAssociationSet exists yet →
  // no published_hot_event_associations row (honest degraded state).
  const toApprove = explainedIds;
  for (const hotEventId of toApprove) {
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId,
      outcome: "approve",
      reviewer: "timeline-e2e-seeder",
      note: "seed published for timeline e2e",
    });
  }

  // --- Story 4.3: inject deterministic association sets ------------------
  // Three of the four events get an EventAssociationSet via generateAssociations
  // (with a per-event adapter, NOT the shared StubAssociationAdapter — the stub
  // returns one fixed set for every event, but category-filter tests need
  // deterministic positive/negative coverage ACROSS events + kinds). 铜价 gets
  // NO set: the category-filter negative sample (never matches ?category=).
  //
  // After appending each set, re-run refreshPublishedReadModel({ action:
  // "publish" }) so projectAssociations picks up the new set (decideReview's
  // internal refresh ran before the set existed — same two-step pattern as
  // seed-associations.ts). The timeline projection is untouched by this refresh
  // (refreshPublishedTimelineForEvent is NOT re-run; the timeline row already
  // exists and its content does not depend on associations).
  const { refreshPublishedReadModel } = await import("@aguhot/core");
  const eventsWithAssoc: Array<{ hotEventId: string; items: AssociationItem[] }> = [
    {
      hotEventId: foldedCandidate.id,
      items: [
        { kind: "concept", label: "半导体", mappingBasis: "knowledge_base:v1" },
        { kind: "industry", label: "芯片", mappingBasis: "knowledge_base:v1" },
        { kind: "stock", label: "中芯国际", mappingBasis: "knowledge_base:v1" },
      ],
    },
    {
      hotEventId: singleCandidate.id,
      items: [
        { kind: "concept", label: "稀土", mappingBasis: "knowledge_base:v1" },
        { kind: "industry", label: "有色金属", mappingBasis: "knowledge_base:v1" },
      ],
    },
    {
      hotEventId: militaryCandidate.id,
      items: [
        { kind: "stock", label: "中航沈飞", mappingBasis: "knowledge_base:v1" },
      ],
    },
  ];
  for (const { hotEventId, items } of eventsWithAssoc) {
    const perEventAdapter: AssociationAdapter = {
      async fetchAssociations(): Promise<AssociationItem[] | null> {
        // Return a fresh array (defensive copy, mirroring StubAssociationAdapter)
        // so callers cannot mutate the seed's fixture constants.
        return items.map((item) => ({ ...item }));
      },
    };
    await generateAssociations({
      prisma,
      traceId: newTraceId(),
      hotEventId,
      adapter: perEventAdapter,
    });
    // Re-refresh to project the appended set into published_hot_event_
    // associations (decideReview's internal refresh ran before the set existed;
    // this second refresh projects it — same pattern as seed-associations.ts).
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId,
      action: "publish",
    });
  }
  // 铜价 deliberately gets NO generateAssociations call → no association set →
  // no published_hot_event_associations row → the category-filter negative
  // sample (never matches ?category=concept|industry|stock).

  resetPrisma();

  return {
    folded: {
      hotEventId: foldedCandidate.id,
      title: foldedCandidate.title,
      sourceName: sourceSemi.name,
      evidenceCount: foldedCandidate.evidenceCount,
    },
    single: {
      hotEventId: singleCandidate.id,
      title: singleCandidate.title,
      sourceName: sourceRare.name,
    },
    totalPublishedEvents: toApprove.length,
    noAssocHotEventId: copperCandidate.id,
    stockAssocHotEventId: militaryCandidate.id,
  };
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string; summary: string; url: string | null; publishedAt: Date },
): Promise<void> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: data.url,
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
}

// Run directly (tsx e2e/seed-timeline.ts) — but NOT when imported by the e2e
// spec (which calls seedTimelineFeed() itself in a beforeAll to capture ids).
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedTimelineFeed();
  console.log(
    `[seed-timeline] folded: ${result.folded.hotEventId} (${result.folded.title}, ${result.folded.evidenceCount} evidence) | single: ${result.single.hotEventId} (${result.single.title}, 1 evidence) | noAssoc: ${result.noAssocHotEventId} | stockAssoc: ${result.stockAssocHotEventId}`,
  );
  process.exit(0);
}
