/**
 * Seed script for the @detail e2e — Story 1.8.
 *
 * Run with: pnpm --filter web seed:detail
 *           (tsx e2e/seed-detail.ts)
 *
 * Self-contained: produces THREE candidates in distinct publish states so the
 * e2e can cover every I/O matrix row:
 *   - 新能源 (2 evidence rows, url + url-missing) → PUBLISHED WITH a generated
 *     explanation → exercises AC1/AC2/AC3 (three partitions + AI label + both
 *     link_status badges).
 *   - 半导体 (1 evidence row) → UNPUBLISHED → its id 404s on the detail page
 *     (AD-8 no-leak).
 *   - 锂矿 (1 evidence row) → PUBLISHED WITHOUT any generated explanation →
 *     exercises the honest degraded state (NFR: the explanation partition shows
 *     "系统解释生成中。" instead of fabricated text; facts still render).
 * Returns each hotEventId + title + the published event's evidence count so
 * detail.spec.ts can drive `/events/{id}` assertions.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts or
 * seed-feed.ts (zero-change contract). Clears the full table set so re-runs are
 * deterministic.
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
const DAY = 24 * HOUR;

export async function seedDetailEvents(): Promise<{
  publishedHotEventId: string;
  publishedTitle: string;
  unpublishedHotEventId: string;
  unpublishedTitle: string;
  expectedEvidenceCount: number;
  degradedHotEventId: string;
  degradedTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts, order respects
  // FK constraints). Deterministic re-runs; does NOT touch seed-console/feed.
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
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
      name: "detail-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Three distinct-event record groups → 3 candidates. The 新能源 group is a
  // short-title + long-superset pair (overlap-coefficient = 1.0 → merge) with
  // 2 records, one carrying a url and one WITHOUT, so the detail timeline
  // renders both "原文链接 ↗" and "无原始链接" badge. The 半导体 group stays an
  // unpublished candidate. The 锂矿 group is published WITHOUT an explanation
  // to exercise the degraded state.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const dayAgo = new Date(Date.now() - 1 * DAY);

  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量",
    summary: "新能源车销量突破历史峰值",
    url: `https://verify.test/新能源-销量`,
    publishedAt: recentAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "本月新能源乘用车零售销量同比大增",
    url: null, // missing url → "无原始链接" badge on the detail timeline
    publishedAt: dayAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "半导体出口同比下降",
    summary: "半导体出口数据回落",
    url: `https://verify.test/半导体`,
    publishedAt: dayAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "锂矿资源储量公布",
    summary: "锂矿储量数据公布",
    url: `https://verify.test/锂矿`,
    publishedAt: dayAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 3) {
    throw new Error(
      `[seed-detail] expected >= 3 candidates after cluster, got ${pending.length}`,
    );
  }

  // Three candidates, three publish states:
  //   - 新能源 → published WITH explanation (AC1/AC2/AC3).
  //   - 半导体 → left unpublished (AD-8 404 no-leak).
  //   - 锂矿 → published WITHOUT explanation (NFR degraded state).
  const toPublish = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;
  const toLeave = pending.find((c) => c.title.includes("半导体")) ?? pending[1]!;
  const toPublishDegraded = pending.find((c) => c.title.includes("锂矿")) ?? pending[2]!;

  // Published WITH explanation: generate BEFORE approve so the publish
  // projection surfaces the three partitions into the detail read model.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
    outcome: "approve",
    reviewer: "detail-e2e-seeder",
    note: "seed published with explanation for detail e2e",
  });

  // Published WITHOUT explanation: approve directly (no generateExplanation) →
  // the detail read model has a summary row but NO explanation projection row,
  // so the detail page renders the degraded state (NFR honest, no fake data).
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishDegraded.id,
    outcome: "approve",
    reviewer: "detail-e2e-seeder",
    note: "seed published without explanation for degraded-state e2e",
  });

  resetPrisma();

  return {
    publishedHotEventId: toPublish.id,
    publishedTitle: toPublish.title,
    unpublishedHotEventId: toLeave.id,
    unpublishedTitle: toLeave.title,
    expectedEvidenceCount: toPublish.evidenceCount,
    degradedHotEventId: toPublishDegraded.id,
    degradedTitle: toPublishDegraded.title,
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

// Run directly (tsx e2e/seed-detail.ts) — but NOT when imported by the e2e spec
// (which calls seedDetailEvents() itself in a beforeAll to capture the ids).
// ESM direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedDetailEvents();
  console.log(
    `[seed-detail] published: ${result.publishedHotEventId} (${result.publishedTitle}, ${result.expectedEvidenceCount} evidence) | unpublished: ${result.unpublishedHotEventId} (${result.unpublishedTitle}) | degraded: ${result.degradedHotEventId} (${result.degradedTitle})`,
  );
  process.exit(0);
}
