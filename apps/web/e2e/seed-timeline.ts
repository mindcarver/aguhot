/**
 * Seed script for the @timeline e2e — Story 4.2 (Epic 4 时间流首页).
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
 * Requires DATABASE_URL pointing at local PG. Clears the full table set
 * (including published_timeline_entries, which seed-revision does not touch) so
 * re-runs are deterministic. Does NOT touch seed-console/feed/detail/revision.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;

export interface SeededTimeline {
  folded: { hotEventId: string; title: string; sourceName: string; evidenceCount: number };
  single: { hotEventId: string; title: string; sourceName: string };
  /**
   * Total number of published events seeded (1 folded + N singles). The band
   * top-N slice test relies on this being > MAIN_LINE_BAND_TOP_N (3) so it can
   * assert the band caps at 3 items.
   */
  totalPublishedEvents: number;
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
  // respects FK constraints, plus the 4.1 published_timeline_entries). Deterministic
  // re-runs; does NOT touch seed-console/feed/detail/revision.
  await prisma.publishedTimelineEntry.deleteMany({});
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
  // evidenceCount = 2 → folded). Distinct publishedAt so the representative
  // source + occurredAt are deterministic.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const earlier = new Date(Date.now() - 4 * HOUR);
  await seedRecord(prisma, sourceSemi.id, {
    title: "半导体设备国产化提速",
    summary: "国产半导体设备出货量显著增长",
    url: "https://verify.test/timeline-半导体-1",
    publishedAt: earlier,
  });
  await seedRecord(prisma, sourceSemi.id, {
    title: "半导体设备国产化再提速",
    summary: "刻蚀与薄膜设备订单同比大增",
    url: "https://verify.test/timeline-半导体-2",
    publishedAt: recentAgo,
  });

  // Event B: one record, a clearly distinct topic so it does NOT merge with A.
  await seedRecord(prisma, sourceRare.id, {
    title: "稀土出口配额例行调整",
    summary: "稀土年度出口配额按计划修订",
    url: "https://verify.test/timeline-稀土-1",
    publishedAt: recentAgo,
  });
  // Events C + D: two more distinct single-source topics. They exist so the
  // band (top-3) has more candidates than its slice — the top-N cap is then
  // observable (4 published events, band shows 3). Their hotEventIds are not
  // returned; only 稀土 is pinned by name (the no-fold assertion target).
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
    publishedAt: recentAgo,
  });
  await seedRecord(prisma, sourceCopper.id, {
    title: "铜价窄幅震荡",
    summary: "本周铜价区间震荡整理",
    url: "https://verify.test/timeline-铜-1",
    publishedAt: recentAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < TOTAL_PUBLISHED_EVENTS) {
    throw new Error(
      `[seed-timeline] expected >= ${TOTAL_PUBLISHED_EVENTS} candidates after cluster, got ${pending.length}`,
    );
  }

  const foldedCandidate = pending.find((c) => c.title.includes("半导体"));
  const singleCandidate = pending.find((c) => c.title.includes("稀土"));
  if (foldedCandidate === undefined || singleCandidate === undefined) {
    throw new Error(
      `[seed-timeline] expected 半导体 + 稀土 candidates, got: ${pending.map((p) => p.title).join(" / ")}`,
    );
  }
  if (foldedCandidate.evidenceCount < 2) {
    throw new Error(
      `[seed-timeline] 半导体 candidate should fold (>=2 evidence), got ${foldedCandidate.evidenceCount}`,
    );
  }

  // Template explanation before approve so the published projection surfaces a
  // non-empty summary (the card's summary slot). recommendationReason stays NULL.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: foldedCandidate.id,
  });
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: singleCandidate.id,
  });

  // Approve the folded + 稀土 single candidates, plus two more single-source
  // candidates (any remaining distinct topics) so 4 events publish total.
  const extraSingles = pending.filter(
    (c) => c.id !== foldedCandidate.id && c.id !== singleCandidate.id,
  );
  for (const c of extraSingles) {
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: c.id });
  }

  const toApprove = [foldedCandidate.id, singleCandidate.id, ...extraSingles.map((c) => c.id)];
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
    `[seed-timeline] folded: ${result.folded.hotEventId} (${result.folded.title}, ${result.folded.evidenceCount} evidence) | single: ${result.single.hotEventId} (${result.single.title}, 1 evidence)`,
  );
  process.exit(0);
}
