/**
 * DEV runner — approve every candidate hot_event (dev bypass of the operator
 * gate). Calls decideReview directly (pure DB tx, no worker/Redis). Each
 * approve refreshes that event's published read model + timeline entry.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-approve.ts
 */
import { getPrisma, newTraceId, decideReview } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");
const prisma = getPrisma();

const candidates = await prisma.hotEvent.findMany({
  where: { publicationStatus: "candidate" },
  select: { id: true, title: true },
});
console.log(`approving ${candidates.length} candidate(s)…`);

let ok = 0;
let fail = 0;
for (const c of candidates) {
  try {
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: c.id,
      outcome: "approve",
      reviewer: "dev-auto-publish",
    });
    ok += 1;
  } catch (e) {
    fail += 1;
    console.error(`✗ ${c.id}:`, e instanceof Error ? e.message : e);
  }
}
console.log(`approved=${ok} failed=${fail}`);
await prisma.$disconnect();
