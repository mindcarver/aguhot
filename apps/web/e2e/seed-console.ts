/**
 * Seed script for the DB-backed console e2e. Story 1.6.
 *
 * Run with: pnpm --filter web seed:console
 *           (tsx e2e/seed-console.ts)
 *
 * Seeds the local DB with deterministic archived evidence records, then runs
 * clusterEvents to produce 2 candidate HotEvents — so /console has a
 * predictable list to assert against. The console e2e spec (console.spec.ts)
 * runs this as a prerequisite (globalSetup or a beforeEach), then drives the
 * operator UI.
 *
 * Requires DATABASE_URL pointing at local PG. The public e2e (home/navigation/
 * design) does NOT use this — it stays DATABASE_URL-free.
 */

import { clusterEvents, getPrisma, newTraceId, resetPrisma } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const BASE_MS = Date.UTC(2024, 0, 1);
const HOUR = 60 * 60 * 1000;

export async function seedConsoleCandidates(): Promise<{ candidateTitles: string[] }> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean any prior seed state so re-runs are deterministic.
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
      name: "console-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Two distinct-event records → 2 candidates (predictable titles for assertions).
  await seedRecord(prisma, source.id, {
    title: "央行宣布降准0.5个百分点",
    summary: "央行宣布降准释放流动性",
    publishedAt: new Date(BASE_MS),
  });
  await seedRecord(prisma, source.id, {
    title: "美股大跌三大股指重挫",
    summary: "美股暴跌",
    publishedAt: new Date(BASE_MS + 1 * HOUR),
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  resetPrisma();

  return {
    candidateTitles: ["央行宣布降准0.5个百分点", "美股大跌三大股指重挫"],
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
void seedConsoleCandidates().then(() => {
  console.log("[seed-console] candidates seeded");
  process.exit(0);
}).catch((error) => {
  console.error("[seed-console] fatal", error);
  process.exit(1);
});
