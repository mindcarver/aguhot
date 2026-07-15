/**
 * DEV runner — backfill Epic 7 relevance + saliency onto hot_events that predate
 * the scoring code (created before PR #7, so their relevance_label / saliency /
 * saliency_breakdown columns are null). Loads each unscored event's members,
 * recomputes via the SAME exported pure functions clusterEvents uses, and writes
 * the row. Idempotent: only touches rows where saliency IS null.
 *
 * This makes SM-9 + the /console score columns reflect the real backlog (so the
 * operator can see which already-published events the gate would now hold/reject
 * and consider takedowns). NOT a test: real writes, no reset.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && NODE_USE_ENV_PROXY=1 node --import tsx/esm src/run-score-backfill.ts
 */
import { getPrisma, newTraceId, judgeRelevance, scoreSaliency } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");
const prisma = getPrisma();

const VELOCITY_WINDOW_MS = 6 * 60 * 60 * 1000;

const unscored = await prisma.hotEvent.findMany({
  where: { saliency: null },
  select: {
    id: true,
    title: true,
    evidence: {
      select: {
        evidenceRecord: {
          select: { title: true, summary: true, publishedAt: true, sourceId: true },
        },
      },
    },
  },
});

console.log(`backfill: ${unscored.length} unscored hot_event(s)…`);
let done = 0;
for (const e of unscored) {
  const text = e.evidence
    .map((l) => `${l.evidenceRecord.title ?? ""} ${l.evidenceRecord.summary ?? ""}`)
    .join(" ");
  const { label } = judgeRelevance(text);
  const distinctSources = new Set(e.evidence.map((l) => l.evidenceRecord.sourceId)).size;
  const nonNull = e.evidence
    .map((l) => l.evidenceRecord.publishedAt)
    .filter((d): d is Date => d !== null);
  const spanMs =
    nonNull.length >= 2
      ? Math.max(...nonNull.map((d) => d.getTime())) - Math.min(...nonNull.map((d) => d.getTime()))
      : VELOCITY_WINDOW_MS;
  const { score, breakdown } = scoreSaliency({
    evidenceCount: e.evidence.length,
    distinctSourceCount: distinctSources,
    spanMs,
  });
  // Fresh object literal (numbers) is assignable to the Json column without a
  // Prisma.InputJsonValue cast (a typed SaliencyBreakdown interface is not).
  const breakdownJson = {
    breadth: breakdown.breadth,
    velocity: breakdown.velocity,
    marketReaction: breakdown.marketReaction,
    association: breakdown.association,
    total: breakdown.total,
  };
  await prisma.hotEvent.update({
    where: { id: e.id },
    data: {
      relevanceLabel: label,
      saliency: score,
      saliencyBreakdown: breakdownJson,
      traceId: newTraceId(),
    },
  });
  // V1 has no market-reaction/association data, so the published-time combined
  // score equals the cluster base. Mirror the score into the two published read
  // models so the home feed (ranked by published_*.saliency) reflects the
  // backfilled scores immediately. updateMany is a no-op where no row matches.
  await prisma.publishedHotEvent.updateMany({
    where: { hotEventId: e.id },
    data: { saliency: score },
  });
  await prisma.publishedTimelineEntry.updateMany({
    where: { hotEventId: e.id },
    data: { saliency: score },
  });
  done += 1;
}
console.log(`backfill done: ${done} scored.`);
await prisma.$disconnect();
