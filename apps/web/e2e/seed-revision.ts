/**
 * Seed script for the @revision e2e — Story 1.9.
 *
 * Run with: pnpm --filter web seed:revision
 *           (tsx e2e/seed-revision.ts)
 *
 * Self-contained: produces ONE published hot event (cluster → generateExplanation
 * → approve) so the e2e can drive the revision flow:
 *   - /console/{publishedId} renders the revision form + current published version,
 *   - fill title/tags/explanation + submitRevision → public /events/{id} still
 *     shows the OLD version (pending, AC2), operator shows the pending diff,
 *   - submit republish → public shows the NEW title/tags/explanation, and the
 *     human-sourced explanation has NO <AiLabel> (AC3 + 1.8 defer).
 *
 * The seeded published event has a template-sourced explanation (so the e2e can
 * assert the AiLabel is present BEFORE revision and absent AFTER a human
 * republish) and empty tags (so the e2e can assert tag chips appear only after
 * a revision + republish).
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, or seed-detail.ts (zero-change contract). Clears the full table
 * set so re-runs are deterministic.
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

export async function seedRevisionEvent(): Promise<{
  publishedHotEventId: string;
  publishedTitle: string;
  expectedEvidenceCount: number;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as seed-detail/verify-* scripts,
  // order respects FK constraints). Deterministic re-runs; does NOT touch
  // seed-console/feed/detail.
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
      name: "revision-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two records that merge into one candidate (overlap-coefficient = 1.0), both
  // with urls so the evidence timeline is clean. The candidate gets a template
  // explanation generated BEFORE approve so the publish projection surfaces it.
  const recentAgo = new Date(Date.now() - 2 * HOUR);
  const earlier = new Date(Date.now() - 4 * HOUR);

  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量",
    summary: "新能源车销量突破历史峰值",
    url: `https://verify.test/revision-新能源-1`,
    publishedAt: earlier,
  });
  await seedRecord(prisma, source.id, {
    title: "新能源汽车销量再创新高",
    summary: "本月新能源乘用车零售销量同比大增",
    url: `https://verify.test/revision-新能源-2`,
    publishedAt: recentAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 1) {
    throw new Error(
      `[seed-revision] expected >= 1 candidate after cluster, got ${pending.length}`,
    );
  }

  const toPublish = pending.find((c) => c.title.includes("新能源")) ?? pending[0]!;

  // Generate a template explanation BEFORE approve so the publish projection
  // surfaces a template-sourced explanation (source="template" → AiLabel shown
  // initially; after a human revision + republish the source flips to "human"
  // → AiLabel dropped).
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
    reviewer: "revision-e2e-seeder",
    note: "seed published for revision e2e",
  });

  resetPrisma();

  return {
    publishedHotEventId: toPublish.id,
    publishedTitle: toPublish.title,
    expectedEvidenceCount: toPublish.evidenceCount,
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

// Run directly (tsx e2e/seed-revision.ts) — but NOT when imported by the e2e
// spec (which calls seedRevisionEvent() itself in a beforeAll to capture the id).
// ESM direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedRevisionEvent();
  console.log(
    `[seed-revision] published: ${result.publishedHotEventId} (${result.publishedTitle}, ${result.expectedEvidenceCount} evidence)`,
  );
  process.exit(0);
}
