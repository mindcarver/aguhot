/**
 * DEV runner — ingest ALL enabled evidence_sources via the real RssAdapter.
 *
 * Unlike verify-ingest.ts (a self-contained test that resetState/cleanup wipes
 * evidence_* and only fetches a committed fixture), this calls ingestSources()
 * against whatever real sources currently live in the DB and LEAVES the
 * archived evidence_records in place. Use it to pull real feeds into dev.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-ingest.ts
 */
import { getPrisma, ingestSources, newTraceId } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");

const prisma = getPrisma();

// Map sourceId -> name so the summary is human-readable.
const sources = await prisma.evidenceSource.findMany({ select: { id: true, name: true } });
const byId = new Map(sources.map((s) => [s.id, s.name]));

console.log(`ingesting ${sources.length} enabled source(s)…`);
const result = await ingestSources({ prisma, traceId: newTraceId() });

console.log("\n=== ingest summary ===");
for (const s of result.sources) {
  console.log(
    `  ${byId.get(s.sourceId) ?? s.sourceId}  archived=${s.archived} dup=${s.skippedDuplicates} missing=${s.missingFields} err=${s.error ?? "—"}`,
  );
}

await prisma.$disconnect();
