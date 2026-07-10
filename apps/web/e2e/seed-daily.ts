/**
 * Seed script for the @daily e2e — Story 2.4.
 *
 * Run with: pnpm --filter web seed:daily
 *           (tsx e2e/seed-daily.ts)
 *
 * Self-contained: produces THREE published events (>=2 sharing the same
 * coverageDate with a generated digest, +1 for the empty-degradation scenario):
 *   - 芯片短缺 (2 evidence rows, same UTC day) → PUBLISHED WITH a generated
 *     daily digest (StubDigestAdapter, test-only) → exercises AC1/AC2 (daily
 *     page renders coverageDate + generatedAt + entries + daily→detail links).
 *   - 锂矿 (1 evidence row, same UTC day) → PUBLISHED (eligible for the same
 *     digest). Both 芯片短缺 + 锂矿 land on the same coverageDate so the digest
 *     has >=2 entries.
 *   - (seedDailyEmpty, a SEPARATE function at the end): produces >=1 published
 *     event on a coverageDate but does NOT call generateDailyDigest → the /daily
 *     page degrades honestly for that coverageDate (AC3).
 * Returns the coverageDate + the digest entry ids + titles + generatedAt so
 * daily.spec.ts can drive /daily + /daily?date= + /events/{id} assertions.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, seed-market-reaction.ts, seed-associations.ts,
 * seed-themes.ts, or any other seed (zero-change contract). Clears the full
 * table set (including the new 2.4 digest tables) so re-runs are deterministic.
 */

import {
  clusterEvents,
  decideReview,
  generateDailyDigest,
  generateExplanation,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  refreshPublishedDailyDigest,
  resetPrisma,
  STUB_DIGEST_CONCLUSION,
  StubDigestAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;

export async function seedDailyDigest(): Promise<{
  coverageDate: string; // ISO YYYY-MM-DD
  digestEntryIds: string[];
  digestTitles: string[];
  generatedAt: Date;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts + the new 2.4
  // digest tables, order respects FK constraints). The new 2.4 tables
  // (daily_digests + published_daily_digests) have NO FK to hot_events, so they
  // are independent of the hot_events clear order — but we clear them at the top
  // to keep reset ordering uniform. Deterministic re-runs; does NOT touch other
  // seeds.
  await prisma.publishedDailyDigest.deleteMany({});
  await prisma.dailyDigest.deleteMany({});
  await prisma.publishedHotEventTheme.deleteMany({});
  await prisma.eventThemeSet.deleteMany({});
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
      name: "daily-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event record groups (both on the SAME UTC day) → 2 candidates
  // → 2 published events. Both land on the same coverageDate so the digest has
  // >=2 entries.
  // Use a fixed recent UTC day so the seed is deterministic across runs
  // (independent of "now"). 2024-01-15 UTC.
  const coverageMs = Date.UTC(2024, 0, 15);
  const coverageDate = new Date(coverageMs);

  // Group A: 芯片短缺 (2 records that merge into 1 event via overlap)
  await seedRecord(prisma, source.id, {
    title: "芯片短缺加剧",
    summary: "全球芯片供应链短缺影响多个行业",
    url: `https://verify.test/芯片短缺-1`,
    publishedAt: new Date(coverageMs),
  });
  await seedRecord(prisma, source.id, {
    title: "芯片短缺加剧持续蔓延",
    summary: "芯片供应链紧张覆盖汽车手机等行业",
    url: `https://verify.test/芯片短缺-2`,
    publishedAt: new Date(coverageMs + 2 * HOUR),
  });

  // Group B: 锂矿 (single record, distinct event, same UTC day)
  await seedRecord(prisma, source.id, {
    title: "锂矿资源储量公布",
    summary: "锂矿储量数据公布",
    url: `https://verify.test/锂矿`,
    publishedAt: new Date(coverageMs + 3 * HOUR),
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 2) {
    throw new Error(
      `[seed-daily] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  // Publish ALL candidates so they are eligible for the digest (latestEvidenceAt
  // UTC day = coverageDate).
  for (const candidate of pending) {
    await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "approve",
      reviewer: "daily-e2e-seeder",
      note: "seed published for daily digest e2e",
    });
  }

  // Generate the daily digest for coverageDate with the StubDigestAdapter
  // (test-only). generateDailyDigest selects eligible events (published +
  // latestEvidenceAt UTC day = coverageDate), validates conclusions, and
  // appends one daily_digests row.
  const result = await generateDailyDigest({
    prisma,
    traceId: newTraceId(),
    coverageDate,
    adapter: new StubDigestAdapter(),
  });
  if (result === null) {
    throw new Error(
      `[seed-daily] generateDailyDigest returned null — expected a digest with >=2 entries`,
    );
  }

  // Refresh the public projection so the digest flows into
  // published_daily_digests.
  await refreshPublishedDailyDigest({
    prisma,
    traceId: newTraceId(),
    coverageDate,
  });

  resetPrisma();

  return {
    coverageDate: coverageDate.toISOString().slice(0, 10), // YYYY-MM-DD
    digestEntryIds: result.entries.map((e) => e.hotEventId),
    digestTitles: result.entries.map((e) => e.title),
    generatedAt: result.createdAt,
  };
}

/**
 * Seed for the I/O-matrix row "日报未生成→降级不空白 (AC3)": reset the DB and
 * create ONE published hot event (latestEvidenceAt on a known UTC day) WITHOUT
 * generating a digest for that day → the /daily page must render the degraded
 * text「该覆盖日期的日报尚未生成。」+ current coverage scope. Returns the
 * emptyCoverageDate + emptyEventCount so daily.spec.ts can assert the degraded
 * text + the count.
 *
 * Same pipeline as seedDailyDigest minus generateDailyDigest: resetEnvCache →
 * requireEnv DATABASE_URL → getPrisma → clear tables in FK order → source + one
 * record → clusterEvents → generateExplanation → decideReview(approve),
 * WITHOUT generateDailyDigest → resetPrisma. Table-clear ordering is identical
 * so re-runs stay deterministic.
 */
export async function seedDailyEmpty(): Promise<{
  emptyCoverageDate: string; // ISO YYYY-MM-DD
  emptyEventCount: number;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Same clean-the-full-table-set ordering as seedDailyDigest() (order respects
  // FK constraints; hot_event_revisions has a Restrict FK on hot_events, so it
  // must be cleared before hot_events). See seedDailyDigest() for the rationale.
  await prisma.publishedDailyDigest.deleteMany({});
  await prisma.dailyDigest.deleteMany({});
  await prisma.publishedHotEventTheme.deleteMany({});
  await prisma.eventThemeSet.deleteMany({});
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
      name: "daily-empty-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // A single record on a known UTC day → a single candidate → published WITHOUT
  // a digest. The /daily page will degrade for this coverageDate.
  const emptyCoverageMs = Date.UTC(2024, 1, 20); // 2024-02-20 UTC
  const emptyCoverageDate = new Date(emptyCoverageMs);
  await seedRecord(prisma, source.id, {
    title: "稀土出口配额调整",
    summary: "稀土出口配额数据公布",
    url: `https://verify.test/稀土`,
    publishedAt: new Date(emptyCoverageMs),
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 1) {
    throw new Error(
      `[seed-daily-empty] expected >= 1 candidate after cluster, got ${pending.length}`,
    );
  }
  const toPublish = pending[0]!;

  // PUBLISHED WITHOUT a digest: generate explanation + approve directly (no
  // generateDailyDigest) → no published_daily_digests row, so the /daily page
  // degrades. Same path as the no-digest branch of seedDailyDigest().
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
    reviewer: "daily-empty-e2e-seeder",
    note: "seed published without digest for degraded-daily e2e",
  });

  resetPrisma();

  return {
    emptyCoverageDate: emptyCoverageDate.toISOString().slice(0, 10),
    emptyEventCount: 1,
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

// Run directly (tsx e2e/seed-daily.ts) — but NOT when imported by the e2e spec
// (which calls seedDailyDigest() itself in a beforeAll to capture the ids). ESM
// direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedDailyDigest();
  console.log(
    `[seed-daily] coverageDate: ${result.coverageDate} | entries: ${result.digestEntryIds.length} (${result.digestTitles.join(", ")})`,
  );
  console.log(
    `[seed-daily] stub conclusion: ${STUB_DIGEST_CONCLUSION}`,
  );
  process.exit(0);
}
