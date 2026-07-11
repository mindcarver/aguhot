/**
 * Seed script for the @feed e2e — Story 1.7.
 *
 * Run with: pnpm --filter web seed:feed
 *           (tsx e2e/seed-feed.ts)
 *
 * Self-contained: produces TWO PUBLISHED hot events and leaves one candidate
 * UNPUBLISHED (so the e2e can assert the unpublished title does not leak to
 * `/`):
 *   - 新能源汽车销量再创新高  (5min ago, published)  — in today/7d/30d/all
 *   - 稀土出口配额调整复盘      (40d ago, published)  — in all ONLY (outside 30d)
 *   - 半导体出口同比下降        (5min ago, unpublished)
 *
 * The 5min-ago timestamp is always within the current UTC day, so window=today
 * never flakes at UTC midnight (the prior `2h ago` fell on yesterday between
 * 00:00–02:00 UTC). The 40d-ago published event makes the date-window filter
 * distinguishable from a no-op: if the filter regresses, window=7d/30d would
 * still show it and the AC3 tests would fail loudly.
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

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export async function seedFeedEvents(): Promise<{
  publishedTitle: string;
  publishedOldTitle: string;
  unpublishedTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean prior state (same table set as seed-console / verify-publish, order
  // respects FK constraints). hot_event_revisions (Story 1.9) has a Restrict FK
  // on hot_events, so it must be cleared before hot_events. Deterministic re-runs.
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.hotEventRevision.deleteMany({});
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

  // Three distinct-event records → 3 candidates (different-event titles, no
  // signature overlap, and the 40d gap exceeds the 72h clustering time-window so
  // no incremental merge either).
  //
  // AC3 date-window contract (see feed.spec.ts):
  //   - recentAgo = now - 5min: ALWAYS within today/7d/30d/all, regardless of
  //     the wall-clock hour. The previous `now - 2h` was a UTC-midnight time
  //     bomb (between UTC 00:00 and 02:00 the 2h-ago instant falls on
  //     yesterday and the today window filters it out → flake).
  //   - otherAgo  = now - 5min: second distinct candidate left UNPUBLISHED.
  //     Named for its role (the other candidate), not an age — both are 5min
  //     old. Kept unpublished so AC2 asserts its title does not leak.
  //   - oldAgo    = now - 40d: PUBLISHED event strictly outside 7d and outside
  //     30d, so window=7d/30d must filter it out while window=all keeps it. If
  //     the date filter ever regresses to a no-op, the 7d/30d tests fail
  //     loudly instead of silently passing.
  const recentAgo = new Date(Date.now() - 5 * MINUTE);
  const otherAgo = new Date(Date.now() - 5 * MINUTE);
  const oldAgo = new Date(Date.now() - 40 * DAY);

  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "新能源车销量突破历史峰值",
    publishedAt: recentAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "半导体出口同比下降",
    summary: "半导体出口数据回落",
    publishedAt: otherAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "稀土出口配额调整复盘",
    summary: "稀土出口政策早期调整回顾",
    publishedAt: oldAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 3) {
    throw new Error(
      `[seed-feed] expected >= 3 candidates after cluster, got ${pending.length}`,
    );
  }

  // Approve 新能源 (recent, in all windows) AND 稀土 (40d ago, excluded from
  // today/7d/30d). Leave 半导体 unpublished so AC2's leak assertion holds.
  const toPublish = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;
  const toPublishOld =
    pending.find((c) => c.title.includes("稀土")) ?? null;
  const toLeave =
    pending.find(
      (c) => c.id !== toPublish.id && (!toPublishOld || c.id !== toPublishOld.id),
    ) ?? pending[1]!;

  if (!toPublishOld) {
    throw new Error(
      "[seed-feed] expected a 稀土 candidate for the 40d-ago window test, found none",
    );
  }

  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
    outcome: "approve",
    reviewer: "feed-e2e-seeder",
    note: "seed published (recent) for feed e2e",
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishOld.id,
    outcome: "approve",
    reviewer: "feed-e2e-seeder",
    note: "seed published (40d ago) for AC3 date-window exclusion test",
  });

  resetPrisma();

  return {
    publishedTitle: toPublish.title,
    publishedOldTitle: toPublishOld.title,
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
  console.log(
    `[seed-feed] published (recent): ${r.publishedTitle} | published (40d): ${r.publishedOldTitle} | unpublished: ${r.unpublishedTitle}`,
  );
  process.exit(0);
}).catch((error) => {
  console.error("[seed-feed] fatal", error);
  process.exit(1);
});
