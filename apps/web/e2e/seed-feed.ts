/**
 * Seed script for the @feed e2e — Story 1.7.
 *
 * Run with: pnpm --filter web seed:feed
 *           (tsx e2e/seed-feed.ts)
 *
 * Self-contained: produces one PUBLISHED hot event (so the public feed has
 * something to show) and leaves one candidate UNPUBLISHED (so the e2e can assert
 * the unpublished title does not leak to `/`). The published event has a recent
 * latestEvidenceAt so the "近期升温" chip / today window have deterministic data.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts or
 * console.spec.ts (1.6 zero-change contract). Clears the same set of tables so
 * re-runs are deterministic.
 */

import {
  clusterEvents,
  decideReview,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;

export async function seedFeedEvents(): Promise<{
  publishedTitle: string;
  unpublishedTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean prior state (same table set as seed-console / verify-publish, order
  // respects FK constraints). Deterministic re-runs.
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.publicationDecision.deleteMany({});
  await prisma.reviewDecision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "feed-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event records → 2 candidates (different-event titles, no overlap).
  // The published one is recent (2h ago) so window=today / window=7d include it
  // and the "近期升温" chip has a signal.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const olderAgo = new Date(Date.now() - 2 * HOUR);

  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "新能源车销量突破历史峰值",
    publishedAt: recentAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "半导体出口同比下降",
    summary: "半导体出口数据回落",
    publishedAt: olderAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 2) {
    throw new Error(
      `[seed-feed] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  // Approve the 新能源 candidate → published. Leave the 半导体 candidate unpublished.
  const toPublish = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;
  const toLeave = pending.find((c) => c.id !== toPublish.id) ?? pending[1]!;

  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
    outcome: "approve",
    reviewer: "feed-e2e-seeder",
    note: "seed published for feed e2e",
  });

  resetPrisma();

  return {
    publishedTitle: toPublish.title,
    unpublishedTitle: toLeave.title,
  };
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string; summary: string; publishedAt: Date },
): Promise<void> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: `https://verify.test/${salt}`,
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

// Run directly (not imported by globalSetup).
void seedFeedEvents().then((r) => {
  console.log("[seed-feed] published:", r.publishedTitle, "| unpublished:", r.unpublishedTitle);
  process.exit(0);
}).catch((error) => {
  console.error("[seed-feed] fatal", error);
  process.exit(1);
});
