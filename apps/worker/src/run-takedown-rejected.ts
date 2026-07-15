/**
 * DEV runner — takedown already-published hot_events that the Epic 7 gate would
 * REJECT (relevance=fail off-topic noise, or saliency < LOW). These slipped onto
 * the public feed under the old "blind-approve every candidate" dev pipeline
 * (pre-PR-#7); the gate now flags them as garbage.
 *
 * Goes through the SANCTIONED publish gate — decideReview({outcome:"takedown"})
 * — so it's auditable (ReviewDecision + PublicationDecision rows) and reversible
 * (republish), per AD-6. It does NOT touch the hold tier (single-source / slow
 * but relevant) — that's real finance news the operator triages in /console.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && NODE_USE_ENV_PROXY=1 node --import tsx/esm src/run-takedown-rejected.ts
 */
import {
  getPrisma,
  newTraceId,
  decideReview,
  decideAutoPublishOutcome,
  RelevanceLabel,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");
const prisma = getPrisma();

const published = await prisma.hotEvent.findMany({
  where: { publicationStatus: "published", saliency: { not: null }, relevanceLabel: { not: null } },
  select: { id: true, title: true, saliency: true, relevanceLabel: true },
});

const toTakedown = published.filter(
  (e) =>
    decideAutoPublishOutcome(e.relevanceLabel as RelevanceLabel, e.saliency!) === "reject",
);

console.log(`takedown: ${toTakedown.length} reject-tier published event(s)…`);
let done = 0;
for (const e of toTakedown) {
  try {
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: e.id,
      outcome: "takedown",
      reviewer: "dev-gate-cleanup",
      note: "Epic 7 gate reject tier (low-relevance/low-saliency)",
    });
    done += 1;
    console.log(`  ✗ taken down: ${(e.title ?? e.id).slice(0, 50)}`);
  } catch (err) {
    console.error(`  ! ${e.id}:`, err instanceof Error ? err.message : err);
  }
}
console.log(`takedown done: ${done} removed from public feed.`);
await prisma.$disconnect();
