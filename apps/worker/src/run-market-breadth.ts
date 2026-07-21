/**
 * DEV runner — ingest market-breadth daily rows (8.6 sidecar `--scope breadth`) then re-project
 * published_crash_days.breadth (8.7).
 *
 * Why this exists: Story 8.6 shipped the Python sidecar that fetches limit-up/down/broken-board
 * pools, A-share spot advancing/declining/turnover, dragon-tiger 龙虎榜, and margin 融资融券 into
 * market_breadth_daily — but the sidecar could only be run by hand, and the public read model
 * published_crash_days did not yet know about breadth (8.3 projected indices + leadingSectors
 * only). This runner is the "采集 → 投影" wiring that closes that gap, mirroring run-crash-review.ts's
 * role for crash_days → published_crash_days. It does NOT write published_crash_days directly: it
 * spawns the sidecar to refresh market_breadth_daily, then calls refreshPublishedCrashDays (the
 * AD-3 single write-owner) which reads market_breadth_daily read-only and materializes breadth.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-market-breadth.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *
 * Optional `--from/--to` bound the projection range ONLY (passed to refreshPublishedCrashDays).
 * They are NOT forwarded to the sidecar: the sidecar's `--incremental` is a fixed ~7-day near
 * window and does not take date params (historical backfill breadth is run by hand via
 * `uv run ... --backfill --scope breadth`, never via this runner). The runner spawns the sidecar
 * first (cwd=apps/market-sidecar so uv resolves pyproject.toml + .venv), waits for it to exit,
 * and only then calls refresh — so a sidecar failure (non-zero exit) fails the runner fast
 * WITHOUT projecting a large null-breadth sweep (Design Notes: the sidecar exits non-zero only
 * when the source-failure ratio exceeds FAILURE_THRESHOLD, so non-zero ⇒ majority of sources
 * failed ⇒ refresh would mostly project null breadth; better to surface the sidecar error).
 *
 * Compliance gate (§12 Q10): prod does NOT run this until the financial-info review clears.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getPrisma,
  newTraceId,
  refreshPublishedCrashDays,
  refreshPublishedSurgeDays,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");
const prisma = getPrisma();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fromDay = arg("--from");
const toDay = arg("--to");
const isValidCalendarDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
};

if (
  (fromDay !== undefined && !isValidCalendarDay(fromDay)) ||
  (toDay !== undefined && !isValidCalendarDay(toDay))
) {
  console.error("--from/--to must be YYYY-MM-DD");
  process.exit(2);
}

// Resolve the market-sidecar absolute path relative to this runner file (ESM). The sidecar's
// pyproject.toml + .venv live at apps/market-sidecar; uv resolves the environment from cwd, so
// the spawn cwd MUST be that directory (not the repo root, not apps/worker). This file is at
// apps/worker/src/run-market-breadth.ts → ../../market-sidecar from src/.
const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const sidecarCwd = path.resolve(runnerDir, "..", "..", "market-sidecar");

const traceId = newTraceId();

// 1. Spawn the sidecar: `uv run python -m market_sidecar ingest --incremental --scope breadth`.
//    stdio:"inherit" surfaces the sidecar's per-source failure log directly (8.6 IngestReport).
//    env: process.env passes DATABASE_URL + HTTP_PROXY/HTTPS_PROXY through to the Python child
//    (requests/akshare read these natively). spawnSync (not execa/async spawn) is the zero-new-
//    dependency choice and matches run-crash-review.ts's await-in-order style — this is a sequential
//    dev/prod script, not a request path.
//
//    timeout/killSignal: AkShare network hangs are a known failure mode — a hung HTTP read inside
//    the sidecar would otherwise block spawnSync forever. Bound the run at 30 min and SIGTERM on
//    expiry (the sidecar's own source-failure threshold surfaces genuine source outages well under
//    this; 30 min is the "stuck process" ceiling, not the expected duration).
const sidecarResult = spawnSync(
  "uv",
  ["run", "python", "-m", "market_sidecar", "ingest", "--incremental", "--scope", "breadth"],
  {
    cwd: sidecarCwd,
    stdio: "inherit",
    env: process.env,
    timeout: 30 * 60 * 1000,
    killSignal: "SIGTERM",
  },
);

if (sidecarResult.error !== undefined) {
  // spawn itself failed (uv not on PATH / ENOENT) — not a sidecar logic failure. Fail fast.
  console.error(`market-breadth runner: failed to spawn sidecar: ${sidecarResult.error.message}`);
  await prisma.$disconnect();
  process.exit(1);
}

if (sidecarResult.signal !== null) {
  // Killed by a signal before producing an exit status: the SIGTERM from our timeout above, or an
  // OOM-kill / external signal. This is NOT a clean non-zero exit (status is null, not a code) —
  // don't print "exited null". Do NOT refresh: a sidecar killed mid-run leaves market_breadth_daily
  // in an unknown partial state, and refreshing would project that partial sweep. Exit non-zero so
  // the failure surfaces (the sidecar's own log up to the kill is already on the console).
  console.error(
    `market-breadth runner: sidecar killed by signal ${sidecarResult.signal} (timeout/OOM/external); skipping projection.`,
  );
  await prisma.$disconnect();
  process.exit(1);
}

if (sidecarResult.status !== 0) {
  // Sidecar exited non-zero ⇒ source-failure ratio exceeded FAILURE_THRESHOLD (8.6). Do NOT
  // refresh: projecting now would sweep a large null-breadth range and bury the sidecar error.
  // The sidecar's own log (already inherited to the console) names the failing sources.
  console.error(
    `market-breadth runner: sidecar exited ${String(sidecarResult.status)} (source-failure ratio exceeded threshold); skipping projection.`,
  );
  await prisma.$disconnect();
  process.exit(1);
}

// 2. Sidecar succeeded (near-window breadth ingested) → re-project published_crash_days.breadth.
//    refreshPublishedCrashDays reads market_breadth_daily read-only (AD-7) and materializes breadth
//    per crash day; a missing breadth row ⇒ breadth null (NFR-5, never fabricated), the published
//    row is still upserted. --from/--to bound the projection range; unbounded = all crash days.
//    Idempotent (tradeDate PK upsert); re-running a range refreshes breadth without duplicates.
const projection = await refreshPublishedCrashDays({
  prisma,
  traceId,
  fromDay,
  toDay,
});
console.log(
  `published_crash_days: projected ${projection.projected}, pruned ${projection.pruned} (trace ${traceId}).`,
);

const surgeProjection = await refreshPublishedSurgeDays({ prisma, traceId, fromDay, toDay });
console.log(
  `published_surge_days: projected ${surgeProjection.projected}, pruned ${surgeProjection.pruned} (trace ${traceId}).`,
);

await prisma.$disconnect();
