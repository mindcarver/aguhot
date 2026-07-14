/**
 * DEV one-off — strip embedded HTML highlight markup (`<em>`, etc.) from already-
 * stored title/summary text across all layers. The eastmoney RSSHub search route
 * emits `两大存储<em>芯片</em>巨头`; that propagated evidence → HotEvent → every
 * published_* read model at projection time. rss-adapter now strips at ingest
 * (future rows clean); this cleans the existing rows so every surface (feed,
 * detail, daily, search, favorites, topics) renders plain text without waiting
 * for re-ingest/re-cluster.
 *
 * Direct UPDATE on the published_* read models (nominally publish-orchestrator-
 * owned) is acceptable for a one-time dev tag-strip — it is idempotent and
 * changes only the tag characters, not the projection logic.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-strip-markup.ts
 */
import { getPrisma } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");

const prisma = getPrisma();

const STRIP = (col: string) => `regexp_replace(${col}, '<[^>]*>', '', 'g')`;

const updates: Array<{ table: string; col: string }> = [
  { table: "evidence_records", col: "title" },
  { table: "evidence_records", col: "summary" },
  { table: "hot_events", col: "title" },
  { table: "hot_event_revisions", col: "title" },
  { table: "published_hot_events", col: "title" },
  { table: "published_timeline_entries", col: "title" },
  { table: "published_hot_event_evidence", col: "summary" },
];

for (const { table, col } of updates) {
  const where = `${col} ~ '<'`;
  // NULL-safe: only rows where the column contains a tag get rewritten.
  const sql = `UPDATE ${table} SET ${col} = ${STRIP(col)} WHERE ${col} IS NOT NULL AND ${col} ~ '<[^>]*>';`;
  const n = await prisma.$executeRawUnsafe(sql);
  console.log(`  ${table}.${col}: ${n} row(s) stripped`);
}

console.log("\n[run-strip-markup] done");
await prisma.$disconnect();
