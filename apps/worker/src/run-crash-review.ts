/**
 * DEV runner — detect A-share crash days from index_daily_bars (8.1) and upsert
 * crash_days (8.2).
 *
 * Why this exists: Story 8.2 ships the pure detection/forward-return core
 * (verify:crash-logic) + the DB-bound upsertCrashDays service, but deliberately NOT
 * the prod runtime carrier (BullMQ/cron — out of scope, deferred to a later 8.x
 * story). This script is the manual way to populate crash_days from the bars 8.1
 * already ingested, mirroring run-digest.ts's role for daily_digests. It re-runs
 * idempotently: keyed by trade_date, recomputing refreshes forward returns as new
 * bars arrive (AC5).
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-crash-review.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--threshold -3.0]
 *
 * Optional flags bound the scanned trade-date range and override CRASH_THRESHOLD
 * (default -2.0%). With no flags it scans all index_daily_bars for the three broad
 * indices (sh000001 / sz399001 / sz399006).
 */
import {
  getPrisma,
  newTraceId,
  upsertCrashDays,
  CRASH_THRESHOLD,
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
const thresholdArg = arg("--threshold");
const threshold = thresholdArg !== undefined ? Number(thresholdArg) : undefined;

if (
  (fromDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fromDay)) ||
  (toDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(toDay))
) {
  console.error("--from/--to must be YYYY-MM-DD");
  process.exit(2);
}
if (threshold !== undefined && Number.isNaN(threshold)) {
  console.error("--threshold must be a number (e.g. -3.0)");
  process.exit(2);
}

const traceId = newTraceId();
const result = await upsertCrashDays({
  prisma,
  traceId,
  fromDay,
  toDay,
  threshold,
});

console.log(`crash-review @ threshold ${result.threshold} (default ${CRASH_THRESHOLD})`);
if (thresholdArg !== undefined) {
  // Upsert is keyed by trade_date; narrowing the threshold does NOT prune prior rows that
  // qualified only under the wider threshold. Surface this so the operator reconciles.
  console.log(
    `note: --threshold override — prior crash_days rows from other thresholds are NOT pruned; reconcile manually.`,
  );
}
console.log(`bars scanned by index:`, result.barsByIndex);
console.log(`crash days detected: ${result.crashDays.length}`);
for (const d of result.crashDays) {
  const triggers = d.indices
    .filter((i) => i.crashed)
    .map((i) => `${i.indexCode} ${i.pctChange.toFixed(2)}%`)
    .join(", ");
  console.log(
    `  ${d.tradeDay}  crashCount=${d.crashCount}  [${triggers}]`,
  );
}
console.log(`upserted ${result.upserted} crash_days row(s) (trace ${traceId}).`);

await prisma.$disconnect();
