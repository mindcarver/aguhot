/**
 * DEV runner — backfill investment_targets (+ the deep_reads byproduct) for every
 * published/candidate hot_event that lacks a pool, via the real SDK adapter.
 *
 * Calls generateInvestmentTargets directly (no BullMQ — the generator is pure
 * logic + DB append, same convention as verify-* calling generators directly).
 * The worker's self-heal cron does the same thing every 10 min; this script is
 * the on-demand equivalent (and the way to populate now without waiting).
 *
 * Env (beyond DATABASE_URL): ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) +
 * ANTHROPIC_BASE_URL + AGENT_MODEL, read by resolveTargetsAdapter / the SDK
 * subprocess. AGENT_LIMIT (optional int) caps the number of events processed —
 * handy for a smoke pass before the full backfill.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && NODE_USE_ENV_PROXY=1 node --import tsx/esm src/run-targets.ts
 */
import {
  generateInvestmentTargets,
  getPrisma,
  newTraceId,
  refreshPublishedReadModel,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { resolveTargetsAdapter } from "./targets-adapter-resolver.js";

resetEnvCache();
requireEnv("DATABASE_URL");

const adapter = resolveTargetsAdapter();
if (adapter === undefined) {
  console.error(
    "[run-targets] no adapter resolved — set ANTHROPIC_AUTH_TOKEN (+ ANTHROPIC_BASE_URL) + AGENT_MODEL",
  );
  process.exit(1);
}

const limit = parsePositiveInt(process.env.AGENT_LIMIT, Number.POSITIVE_INFINITY);
const concurrency = parsePositiveInt(process.env.AGENT_CONCURRENCY, 3);
const prisma = getPrisma();

const pending = await prisma.hotEvent.findMany({
  where: {
    publicationStatus: { in: ["candidate", "published"] },
    investmentTargets: { none: {} },
  },
  select: { id: true, publicationStatus: true },
  // Prisma rejects take: Infinity — only cap when a finite limit was requested.
  ...(Number.isFinite(limit) ? { take: limit } : {}),
});

console.log(
  `[run-targets] ${pending.length} event(s) to process (limit=${limit === Number.POSITIVE_INFINITY ? "∞" : limit}, concurrency=${concurrency})`,
);

let ok = 0;
let failed = 0;
let done = 0;

// Bounded-concurrency pool: the SDK adapter is stateless, so N events can run as N
// independent agent subprocesses. Cuts a 70+ event backfill from hours to ~1/N.
let cursor = 0;
async function worker(win: number): Promise<void> {
  while (true) {
    const idx = cursor++;
    if (idx >= pending.length) return;
    const ev = pending[idx]!;
    const traceId = newTraceId();
    const t0 = Date.now();
    try {
      const result = await generateInvestmentTargets({ prisma, traceId, hotEventId: ev.id, adapter });
      if (result === null) {
        failed += 1;
        console.log(`  [w${win}] ✗ ${ev.id}  null (degraded)  ${Date.now() - t0}ms`);
      } else {
        if (ev.publicationStatus === "published") {
          await refreshPublishedReadModel({ prisma, traceId: newTraceId(), hotEventId: ev.id, action: "publish" });
        }
        ok += 1;
        const top = result.candidates[0];
        console.log(
          `  [w${win}] ✓ ${ev.id}  n=${result.candidates.length}  top=${top?.name ?? "—"} (${top?.tier ?? ""})  ${Date.now() - t0}ms`,
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`  [w${win}] ✗ ${ev.id}  ERROR ${Date.now() - t0}ms`, error instanceof Error ? error.message : error);
    }
    done += 1;
    console.log(`  [w${win}] progress ${done}/${pending.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, (_, i) => worker(i)));

console.log(`\n[run-targets] done — ok=${ok} failed=${failed}`);
await prisma.$disconnect();
process.exit(failed > 0 && ok === 0 ? 1 : 0);

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
