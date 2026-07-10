/**
 * Seed script for the @associations e2e — Story 2.2.
 *
 * Run with: pnpm --filter web seed:associations
 *           (tsx e2e/seed-associations.ts)
 *
 * Self-contained: produces TWO published events to cover the two I/O matrix rows
 * for the association block:
 *   - 新能源 (2 evidence rows) → PUBLISHED WITH generated concept/industry/stock
 *     associations (StubAssociationAdapter, test-only) → exercises AC1 (grouped
 *     clickable links + provenance) + AC2 (provenance line).
 *   - 锂矿 (1 evidence row) → PUBLISHED WITHOUT any association set → exercises
 *     AC3 (honest degraded state "暂无已确认的概念 / 行业 / 个股关联。", no items).
 * Returns each hotEventId + title + the stub concept label so
 * associations.spec.ts can drive /events/{id} + the `/?concept=` feed-filter
 * click-through assertion (AC1 non-dead-link).
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, seed-market-reaction.ts, or any other seed
 * (zero-change contract). Clears the full table set (including the new 2.2
 * association tables) so re-runs are deterministic.
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
  STUB_CONCEPT_LABEL,
  StubAssociationAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function seedAssociationEvents(): Promise<{
  withAssocHotEventId: string;
  withAssocTitle: string;
  withoutAssocHotEventId: string;
  withoutAssocTitle: string;
  stubConcept: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts + the new 2.2
  // association tables, order respects FK constraints). hot_event_revisions
  // (Story 1.9) has a Restrict FK on hot_events, so it must be cleared before
  // hot_events. The new 2.2 tables (associations/sets) have Cascade FKs but we
  // clear them explicitly before hot_events to keep reset ordering uniform.
  // Deterministic re-runs; does NOT touch seed-console/feed/detail/market-reaction.
  await prisma.publishedHotEventAssociation.deleteMany({});
  await prisma.eventAssociationSet.deleteMany({});
  await prisma.publishedHotEventReaction.deleteMany({});
  await prisma.marketReactionSnapshot.deleteMany({});
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
      name: "associations-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event record groups → 2 candidates. The 新能源 group is a
  // short-title + long-superset pair (overlap-coefficient = 1.0 → merge) with 2
  // records. The 锂矿 group stays a single record. Both get published; only
  // 新能源 gets an association set.
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
    url: `https://verify.test/新能源-新高`,
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
  if (pending.length < 2) {
    throw new Error(
      `[seed-associations] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  const toPublishWithAssoc = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;
  const toPublishWithoutAssoc = pending.find((c) => c.title.includes("锂矿")) ?? pending[1]!;

  // PUBLISHED WITH associations: generate explanation, approve (flips to
  // published), then generateAssociations with the StubAssociationAdapter
  // (test-only), then refresh(publish) so the set flows into
  // published_hot_event_associations (decideReview's internal refresh ran before
  // the set existed; this second refresh projects it).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithAssoc.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithAssoc.id,
    outcome: "approve",
    reviewer: "associations-e2e-seeder",
    note: "seed published with associations for associations e2e",
  });
  await generateAssociations({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithAssoc.id,
    adapter: new StubAssociationAdapter(),
  });
  // Re-refresh to project the appended set into the public read model.
  // (decideReview's internal refresh ran before the set existed; this second
  // refresh projects it — same pattern the market-reaction seed uses.)
  const { refreshPublishedReadModel } = await import("@aguhot/core");
  await refreshPublishedReadModel({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithAssoc.id,
    action: "publish",
  });

  // PUBLISHED WITHOUT associations: generate explanation + approve directly (no
  // generateAssociations) → the detail read model has a summary row but NO
  // association projection row, so the detail page renders the degraded state
  // (AC3).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithoutAssoc.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishWithoutAssoc.id,
    outcome: "approve",
    reviewer: "associations-e2e-seeder",
    note: "seed published without associations for degraded-state e2e",
  });

  resetPrisma();

  return {
    withAssocHotEventId: toPublishWithAssoc.id,
    withAssocTitle: toPublishWithAssoc.title,
    withoutAssocHotEventId: toPublishWithoutAssoc.id,
    withoutAssocTitle: toPublishWithoutAssoc.title,
    stubConcept: STUB_CONCEPT_LABEL,
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

// Run directly (tsx e2e/seed-associations.ts) — but NOT when imported by the
// e2e spec (which calls seedAssociationEvents() itself in a beforeAll to
// capture the ids). ESM direct-run detection: only auto-run + exit when this
// module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedAssociationEvents();
  console.log(
    `[seed-associations] withAssoc: ${result.withAssocHotEventId} (${result.withAssocTitle}) | withoutAssoc: ${result.withoutAssocHotEventId} (${result.withoutAssocTitle}) | stubConcept: ${result.stubConcept}`,
  );
  process.exit(0);
}
