/**
 * DEV helper — seed evidence_sources pointing at the local self-hosted RSSHub
 * (Docker, :1200). Run once to (re)populate the source config, then run-ingest +
 * run-pipeline to pull + publish. Idempotent-ish: de-dupes by feedUrl (skips an
 * already-present feedUrl so re-running does not create duplicates).
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && NODE_USE_ENV_PROXY=1 node --import tsx/esm src/seed-sources.ts
 *
 * Sources are Chinese A股/财经 outlets RSSHub wraps into RSS 2.0 (the repo's
 * RssAdapter consumes RSS 2.0). 同花顺 (10jqka) has no working RSSHub route in
 * this build — 财联社 (cls) is the more realtime A股 source anyway.
 */
import { getPrisma, newTraceId } from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");

const HUB = process.env.RSSHUB_BASE_URL ?? "http://localhost:1200";

interface Seed {
  name: string;
  route: string;
}
const SEEDS: Seed[] = [
  { name: "华尔街见闻", route: "/wallstreetcn/news/global" },
  { name: "财联社·头条", route: "/cls/depth" },
  { name: "财联社·电报", route: "/cls/telegraph" },
  { name: "金十数据", route: "/jin10/fresh" },
  { name: "东方财富·芯片", route: "/eastmoney/search/%E8%8A%AF%E7%89%87" },
  { name: "东方财富·新能源", route: "/eastmoney/search/%E6%96%B0%E8%83%BD%E6%BA%90" },
];

const prisma = getPrisma();

const existing = await prisma.evidenceSource.findMany({ select: { feedUrl: true } });
const have = new Set(existing.map((s) => s.feedUrl));

let created = 0;
for (const s of SEEDS) {
  const feedUrl = `${HUB}${s.route}`;
  if (have.has(feedUrl)) {
    console.log(`  skip (exists): ${s.name}  ${feedUrl}`);
    continue;
  }
  await prisma.evidenceSource.create({
    data: { id: newTraceId(), name: s.name, kind: "rss", feedUrl, enabled: true },
  });
  console.log(`  seeded: ${s.name}  ${feedUrl}`);
  created += 1;
}

console.log(`\n${created} source(s) seeded, ${SEEDS.length - created} already present.`);
await prisma.$disconnect();
