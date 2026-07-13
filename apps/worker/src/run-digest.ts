/**
 * DEV runner — populate published_daily_digests using each event's already-
 * generated recommendation_reason as the per-event conclusion (zero extra LLM).
 *
 * Why this exists: the daily-digest worker hardcodes `digestAdapter = undefined`
 * (V1 honest-degradation — the per-event summarizer is a deferred procurement),
 * so the real worker writes no digest entries. This script bypasses that by
 * calling generateDailyDigest + refreshPublishedDailyDigest directly with a
 * reasons-backed adapter. Prod worker is NOT modified.
 *
 * Run: cd apps/worker && set -a && . ../../.env && set +a \
 *      && node --import tsx/esm src/run-digest.ts
 */
import {
  getPrisma,
  generateDailyDigest,
  refreshPublishedDailyDigest,
  newTraceId,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

resetEnvCache();
requireEnv("DATABASE_URL");
const prisma = getPrisma();

// ReasonDigestAdapter — latest recommendation_reason per event = conclusion.
const reasonDigestAdapter = {
  async fetchConclusions({ hotEventIds }: { coverageDate: Date; hotEventIds: string[] }) {
    if (hotEventIds.length === 0) return null;
    const reasons = await prisma.recommendationReason.findMany({
      where: { hotEventId: { in: hotEventIds } },
      orderBy: { createdAt: "desc" },
      select: { hotEventId: true, reason: true },
    });
    const latest = new Map<string, string>();
    for (const r of reasons) if (!latest.has(r.hotEventId)) latest.set(r.hotEventId, r.reason);
    const out = hotEventIds
      .filter((id) => latest.has(id))
      .map((id) => ({ hotEventId: id, conclusion: latest.get(id)! }));
    return out.length > 0 ? out : null;
  },
};

// Distinct UTC coverage days among published events.
const events = await prisma.publishedHotEvent.findMany({ select: { latestEvidenceAt: true } });
const days = new Set<string>();
for (const e of events) {
  const d = e.latestEvidenceAt;
  const iso = d.toISOString().slice(0, 10);
  days.add(iso);
}

for (const day of [...days].sort()) {
  const coverageDate = new Date(`${day}T00:00:00.000Z`);
  const traceId = newTraceId();
  try {
    const result = await generateDailyDigest({
      prisma,
      traceId,
      coverageDate,
      adapter: reasonDigestAdapter,
    });
    if (result === null) {
      console.log(`[${day}] no digest (generator returned null)`);
      continue;
    }
    await refreshPublishedDailyDigest({ prisma, traceId: newTraceId(), coverageDate });
    const n = Array.isArray((result as { entries?: unknown[] }).entries)
      ? (result as { entries: unknown[] }).entries.length
      : "?";
    console.log(`[${day}] digest published — entries: ${n}`);
  } catch (e) {
    console.error(`[${day}] FAILED:`, e instanceof Error ? e.message : e);
  }
}

await prisma.$disconnect();
