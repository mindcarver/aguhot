/**
 * Seed script for the @merge-split e2e — Story 1.10.
 *
 * Run with: pnpm --filter web seed:merge-split
 *           (tsx e2e/seed-merge-split.ts)
 *
 * Self-contained: produces TWO published hot events (cluster → generateExplanation
 * → approve each) from disjoint token sets, so the e2e can drive the merge +
 * split + republish flows:
 *   - /console/{A} renders the merge form (B is the source option) + the split
 *     form (A's evidence checkboxes),
 *   - submit merge source=B → /events/{B} 404, /events/{A} shows the union,
 *     /console/{B} audit chain has the takedown,
 *   - a fresh split candidate + a taken_down event for the republish assertion.
 *
 * The two events MUST NOT cluster into one candidate: their title token sets are
 * disjoint (降准 vs 新能源销量 → 0 overlap-coefficient), so clusterEvents produces
 * two separate candidate groups, each approve-able into its own published event.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, or seed-revision.ts (zero-change contract).
 * Clears the full table set so re-runs are deterministic.
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

export async function seedMergeSplitEvents(): Promise<{
  publishedA: { hotEventId: string; title: string; evidenceCount: number };
  publishedB: { hotEventId: string; title: string; evidenceCount: number };
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as seed-revision/verify-* scripts,
  // order respects FK constraints). Deterministic re-runs; does NOT touch
  // seed-console/feed/detail/revision.
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "merge-split-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Group A: two records that merge with each other (overlap-coefficient 1.0 on
  // the 央行/降准 token set). Both with urls so the evidence timeline is clean.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const earlier = new Date(Date.now() - 4 * HOUR);
  await seedRecord(prisma, source.id, {
    title: "央行降准",
    summary: "央行宣布降准释放长期资金",
    url: "https://verify.test/merge-A-1",
    publishedAt: earlier,
  });
  await seedRecord(prisma, source.id, {
    title: "央行宣布降准0.5个百分点",
    summary: "本次降准为全面降准",
    url: "https://verify.test/merge-A-2",
    publishedAt: recentAgo,
  });

  // Group B: two records that merge with each other but NOT with group A
  // (disjoint 新能源/汽车/销量 token set → overlap-coefficient 0 vs group A).
  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量",
    summary: "新能源车销量突破历史峰值",
    url: "https://verify.test/merge-B-1",
    publishedAt: earlier,
  });
  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "本月新能源乘用车零售销量同比大增",
    url: "https://verify.test/merge-B-2",
    publishedAt: recentAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 2) {
    throw new Error(
      `[seed-merge-split] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  const toPublishA = pending.find((c) => c.title.includes("降准"))!;
  const toPublishB = pending.find((c) => c.title.includes("新能源"))!;

  // Generate template explanations + approve both → 2 published events.
  await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: toPublishA.id });
  await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: toPublishB.id });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishA.id,
    outcome: "approve",
    reviewer: "merge-split-e2e-seeder",
    note: "seed published A for merge-split e2e",
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishB.id,
    outcome: "approve",
    reviewer: "merge-split-e2e-seeder",
    note: "seed published B for merge-split e2e",
  });

  resetPrisma();

  return {
    publishedA: {
      hotEventId: toPublishA.id,
      title: toPublishA.title,
      evidenceCount: toPublishA.evidenceCount,
    },
    publishedB: {
      hotEventId: toPublishB.id,
      title: toPublishB.title,
      evidenceCount: toPublishB.evidenceCount,
    },
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

// Run directly (tsx e2e/seed-merge-split.ts) — but NOT when imported by the e2e
// spec (which calls seedMergeSplitEvents() itself in a beforeAll to capture ids).
// ESM direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedMergeSplitEvents();
  console.log(
    `[seed-merge-split] A: ${result.publishedA.hotEventId} (${result.publishedA.title}), B: ${result.publishedB.hotEventId} (${result.publishedB.title})`,
  );
  process.exit(0);
}
