/**
 * Deterministic integration verification for the recommendation-reason (AI 解读)
 * generation pipeline + projection — Story 5.1.
 *
 * Run with: pnpm --filter worker verify:reason (tsx src/verify-reason.ts).
 *
 * It exercises generateRecommendationReason with the StubLlmAdapter (test-only,
 * imported from core — NOT wired in the worker/prod runtime: the recommendation-
 * reason worker resolves adapter = undefined so prod degrades honestly) against
 * real local PostgreSQL (NO Redis needed — generateRecommendationReason is pure
 * logic + a DB append, no BullMQ queue at the generator level, same convention
 * as verify-digest calling generateDailyDigest directly), then asserts the DB
 * state — surface-anchored, not mock-based. It prints PASS/FAIL and exits
 * non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + 2 archived records → clusterEvents
 *   (candidates) → generateExplanation → decideReview(approve) → published →
 *   generateRecommendationReason({adapter: StubLlmAdapter}) → assert row
 *   projected → refreshPublishedTimelineForEvent → assert card non-null →
 *
 * Assertions:
 *   1. generateRecommendationReason appends one recommendation_reasons row
 *      (source="ai", modelId, promptVersion, createdAt, traceId all present),
 *      reason = STUB_RECOMMENDATION_REASON.
 *   2. After refreshPublishedTimelineForEvent, published_timeline_entries.
 *      recommendation_reason is non-null and equals the appended reason (the
 *      projection derived it from the latest row — publish-orchestrator is the
 *      sole writer of that column).
 *   3. AD-5 append-only: a second call appends a SECOND row; the projection
 *      reflects the latest.
 *   4. adapter missing → generateRecommendationReason returns null, writes
 *      nothing (V1 prod honest-degradation path).
 *   5. AC fail-fast: an adapter reason that hits the guardrail (forbidden
 *      phrase) → generateRecommendationReason THROWS (never silently truncates).
 *   6. AC fail-fast: an adapter reason >40 字 → THROWS.
 *   7. Missing hotEventId → returns null, no write.
 *   8. Coverage: SM-7 denominator — non-null recommendation_reason rows / total
 *      published rows.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateRecommendationReason,
  getPrisma,
  getLatestRecommendationReason,
  listPendingCandidates,
  newTraceId,
  passesRecommendationGuardrail,
  RECOMMENDATION_FORBIDDEN_PHRASES,
  refreshPublishedTimelineAll,
  refreshPublishedTimelineForEvent,
  resetPrisma,
  StubLlmAdapter,
  STUB_RECOMMENDATION_REASON,
  type LLMAdapter,
  type LlmReasonResult,
  type LlmDeepReadResult,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records land on the same UTC day
// deterministically.
const BASE_MS = Date.UTC(2024, 0, 1); // 2024-01-01 UTC
const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — the
  // derivation is pure logic + a DB append. The recommendation-reason worker
  // exists (Epic-5 job category) but this verify calls
  // generateRecommendationReason directly.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 archived records → clusterEvents → 1 candidate →
    // approve it so it's published + has an ExplanationVersion (the summary
    // context the reason adapter reads). ---
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-reason-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    // Two overlapping-title records so they merge into ONE candidate via
    // overlap-coefficient.
    await seedRecord(prisma, source.id, {
      title: "芯片短缺",
      summary: "全球芯片供应链短缺",
      url: "https://verify.test/芯片-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "芯片短缺持续蔓延",
      summary: "芯片供应链紧张覆盖多个行业",
      url: "https://verify.test/芯片-2",
      publishedAt: new Date(BASE_MS + 2 * HOUR),
    });

    const clusterResult = await clusterEvents({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "seed: cluster produced 1 candidate from 2 overlapping records",
      ok: clusterResult.newCandidates === 1,
      detail: `newCandidates=${clusterResult.newCandidates}`,
    });

    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    if (pending.length !== 1) {
      throw new Error(
        `[verify-reason] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // Generate the deterministic explanation (provides summary context) +
    // publish so the timeline projection row exists.
    await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "approve",
      reviewer: "verify-reason",
      note: "publish for reason verify",
    });

    // --- 1: generateRecommendationReason appends one row, reason = stub ---
    const adapter = new StubLlmAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateRecommendationReason({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateRecommendationReason returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "result reason = STUB_RECOMMENDATION_REASON (deterministic)",
        ok: gen1.reason === STUB_RECOMMENDATION_REASON,
        detail: `reason=${gen1.reason}`,
      });
      assertions.push({
        name: "result carries source=ai + modelId + promptVersion + traceId",
        ok:
          gen1.source === "ai" &&
          gen1.modelId.trim() !== "" &&
          gen1.promptVersion.trim() !== "" &&
          gen1.traceId === genTrace,
        detail: `source=${gen1.source} modelId=${gen1.modelId} promptVersion=${gen1.promptVersion}`,
      });
      assertions.push({
        name: "result reason ≤40 字 + passes guardrail",
        ok:
          gen1.reason.length <= 40 && passesRecommendationGuardrail(gen1.reason),
        detail: `len=${gen1.reason.length}`,
      });
    }

    const rowsAfter1 = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "recommendation_reasons row appended (count=1)",
      ok: rowsAfter1 === 1,
      detail: `count=${rowsAfter1}`,
    });

    const row1 = await prisma.recommendationReason.findFirst({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=ai, modelId/promptVersion/traceId carried",
      ok:
        row1 !== null &&
        row1!.source === "ai" &&
        row1!.modelId.trim() !== "" &&
        row1!.promptVersion.trim() !== "" &&
        row1!.traceId === genTrace,
    });

    // --- 2: projection derives published_timeline_entries.recommendation_reason
    // from the latest row (publish-orchestrator is the sole writer of that column).
    // The worker path reuses refreshPublishedTimelineForEvent(action:"publish").
    await refreshPublishedTimelineForEvent({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const timelineRow = await prisma.publishedTimelineEntry.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "projection: published_timeline_entries.recommendation_reason non-null = appended reason",
      ok:
        timelineRow !== null &&
        timelineRow!.recommendationReason === STUB_RECOMMENDATION_REASON,
      detail:
        timelineRow === null
          ? "(no timeline row)"
          : `reason=${timelineRow!.recommendationReason}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row; projection
    // reflects the latest. ---
    await sleep(20);
    const gen2 = await generateRecommendationReason({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const rowsAfter2 = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: rowsAfter2 === 2 && gen2 !== null,
      detail: `count=${rowsAfter2}`,
    });

    await refreshPublishedTimelineForEvent({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const latestViaRead = await getLatestRecommendationReason({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    const timelineAfterGen2 = await prisma.publishedTimelineEntry.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "refresh projects the LATEST reason (getLatestRecommendationReason + projection agree)",
      ok:
        latestViaRead !== null &&
        timelineAfterGen2 !== null &&
        timelineAfterGen2!.recommendationReason === latestViaRead!.reason,
      detail:
        latestViaRead === null || timelineAfterGen2 === null
          ? "(read or projection null)"
          : `projected=${timelineAfterGen2!.recommendationReason}`,
    });

    // --- 3b: the self-heal path (refreshPublishedTimelineAll) also re-derives
    // recommendation_reason from the latest row. This is the safety-net path
    // the spec relies on for eventual consistency; pin it so a regression that
    // drops the reason from the All-projection cannot ship green. ---
    await refreshPublishedTimelineAll({ prisma, traceId: newTraceId() });
    const timelineAfterSelfHeal = await prisma.publishedTimelineEntry.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "self-heal (refreshPublishedTimelineAll) projects the latest reason onto the timeline row",
      ok:
        timelineAfterSelfHeal !== null &&
        timelineAfterSelfHeal!.recommendationReason === STUB_RECOMMENDATION_REASON,
      detail:
        timelineAfterSelfHeal === null
          ? "(no timeline row)"
          : `reason=${timelineAfterSelfHeal!.recommendationReason}`,
    });

    // --- 4: adapter missing → returns null, writes nothing ---
    // Use a second candidate (publish it) so we have an event with NO reason
    // to assert the no-adapter path does not write. Reuse the same event: it
    // already has reasons, so we assert the no-adapter call does not append a
    // third row.
    const rowsBeforeNoAdapter = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    const noAdapter = await generateRecommendationReason({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      // adapter omitted → V1 prod path (recommendation-reason worker resolves
      // none) → returns null.
    });
    assertions.push({
      name: "adapter missing: generateRecommendationReason returns null",
      ok: noAdapter === null,
    });
    const rowsAfterNoAdapter = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "adapter missing: no recommendation_reasons row written",
      ok: rowsAfterNoAdapter === rowsBeforeNoAdapter,
      detail: `before=${rowsBeforeNoAdapter} after=${rowsAfterNoAdapter}`,
    });

    // --- 5: AC fail-fast — forbidden-phrase reason → THROWS ---
    const forbiddenAdapter: LLMAdapter = {
      async generateReason(): Promise<LlmReasonResult | null> {
        // Hit ACTION class (买入).
        return {
          reason: "建议买入相关概念股，证据链完整。",
          modelId: "stub:forbidden",
          promptVersion: "reason-stub-v1",
        };
      },
      // verify-reason exercises only the reason path; deep-read is covered by
      // verify-deepread. Return null so the LLMAdapter interface is satisfied.
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return null;
      },
    };
    let threwForbidden = false;
    try {
      await generateRecommendationReason({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: forbiddenAdapter,
      });
    } catch {
      threwForbidden = true;
    }
    assertions.push({
      name: "AC: forbidden-phrase reason → generateRecommendationReason throws (fail-fast)",
      ok: threwForbidden,
    });

    // --- 5b: every forbidden phrase across all 6 classes is actually rejected ---
    // (guards against a regression where a class list is empty by accident).
    const allForbidden = Object.values(RECOMMENDATION_FORBIDDEN_PHRASES).flat();
    let allForbiddenRejected = true;
    for (const phrase of allForbidden) {
      const localAdapter: LLMAdapter = {
        async generateReason(): Promise<LlmReasonResult | null> {
          return {
            reason: `事件涉及${phrase}，后续仍需观察。`,
            modelId: "stub:forbidden",
            promptVersion: "reason-stub-v1",
          };
        },
        // verify-reason exercises only the reason path; deep-read is covered by
        // verify-deepread. Return null so the LLMAdapter interface is satisfied.
        async generateDeepRead(): Promise<LlmDeepReadResult | null> {
          return null;
        },
      };
      try {
        await generateRecommendationReason({
          prisma,
          traceId: newTraceId(),
          hotEventId: candidate.id,
          adapter: localAdapter,
        });
        allForbiddenRejected = false;
      } catch {
        // expected
      }
    }
    assertions.push({
      name: "AC: all 6 classes × all phrases rejected by guardrail (none slips through)",
      ok: allForbiddenRejected,
      detail: `phrases checked=${allForbidden.length}`,
    });

    // --- 6: AC fail-fast — over-length (>40 字) reason → THROWS ---
    // Built deliberately long (60 字) from a safe repeated char so the length is
    // unambiguous (no natural-language miscount).
    const overlength = "证".repeat(60);
    const overlenAdapter: LLMAdapter = {
      async generateReason(): Promise<LlmReasonResult | null> {
        return {
          reason: overlength,
          modelId: "stub:overlen",
          promptVersion: "reason-stub-v1",
        };
      },
      // verify-reason exercises only the reason path; deep-read is covered by
      // verify-deepread. Return null so the LLMAdapter interface is satisfied.
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return null;
      },
    };
    let threwOverlen = false;
    try {
      await generateRecommendationReason({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: overlenAdapter,
      });
    } catch {
      threwOverlen = true;
    }
    assertions.push({
      name: "AC: >40 字 reason → generateRecommendationReason throws (fail-fast)",
      ok: threwOverlen && [...overlength].length > 40,
      detail: `len=${[...overlength].length}`,
    });

    // --- 6b: forbidden-phrase / over-length throws did NOT write rows ---
    // (fail-fast means no append, not just a throw).
    const rowsAfterFailFast = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AC: fail-fast throws wrote no extra rows (still count=2 from gen1+gen2)",
      ok: rowsAfterFailFast === 2,
      detail: `count=${rowsAfterFailFast}`,
    });

    // --- 6c: pin the ≤40 字 boundary exactly. A 40-字 reason is ACCEPTED
    // (appended); a 41-字 reason is REJECTED (throws). Built from a safe repeated
    // char so the off-by-one at the cap is unambiguous (a 46-字 overlength test
    // alone cannot distinguish `> 40` from `>= 40` or `> 41`). ---
    const exact40 = "适".repeat(40);
    const exact41 = "适".repeat(41);
    const exact40Adapter: LLMAdapter = {
      async generateReason(): Promise<LlmReasonResult | null> {
        return {
          reason: exact40,
          modelId: "stub:boundary",
          promptVersion: "reason-stub-v1",
        };
      },
      // verify-reason exercises only the reason path; deep-read is covered by
      // verify-deepread. Return null so the LLMAdapter interface is satisfied.
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return null;
      },
    };
    const rowsBefore40 = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    let exact40Appended = false;
    try {
      const r = await generateRecommendationReason({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: exact40Adapter,
      });
      exact40Appended = r !== null;
    } catch {
      exact40Appended = false;
    }
    const rowsAfter40 = await prisma.recommendationReason.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AC: exactly-40 字 reason is ACCEPTED (boundary, not off-by-one)",
      ok:
        exact40Appended &&
        [...exact40].length === 40 &&
        rowsAfter40 === rowsBefore40 + 1,
      detail: `appended=${exact40Appended} len=${[...exact40].length}`,
    });

    const exact41Adapter: LLMAdapter = {
      async generateReason(): Promise<LlmReasonResult | null> {
        return {
          reason: exact41,
          modelId: "stub:boundary",
          promptVersion: "reason-stub-v1",
        };
      },
      // verify-reason exercises only the reason path; deep-read is covered by
      // verify-deepread. Return null so the LLMAdapter interface is satisfied.
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return null;
      },
    };
    let threwExact41 = false;
    try {
      await generateRecommendationReason({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: exact41Adapter,
      });
    } catch {
      threwExact41 = true;
    }
    assertions.push({
      name: "AC: exactly-41 字 reason is REJECTED (boundary, not off-by-one)",
      ok: threwExact41 && [...exact41].length === 41,
      detail: `threw=${threwExact41} len=${[...exact41].length}`,
    });

    // --- 7: missing hotEventId → null, no write ---
    const missing = await generateRecommendationReason({
      prisma,
      traceId: newTraceId(),
      hotEventId: "00000000-0000-0000-0000-000000000000",
      adapter,
    });
    assertions.push({
      name: "missing hotEventId: returns null (no write)",
      ok: missing === null,
    });

    // --- 8: SM-7 coverage — non-null reason rows / total published rows.
    // Seed a SECOND published event that intentionally gets NO reason, so the
    // denominator is meaningfully > 1 and the metric actually distinguishes
    // covered from uncovered (a single covered event would make N=N trivially
    // true and hide a regression in the coverage query). ---
    await seedRecord(prisma, source.id, {
      title: "新能源补贴退坡",
      summary: "新能源补贴政策退坡影响产业链",
      url: "https://verify.test/新能源-1",
      publishedAt: new Date(BASE_MS + 4 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "新能源补贴退坡持续",
      summary: "补贴退坡覆盖多家企业",
      url: "https://verify.test/新能源-2",
      publishedAt: new Date(BASE_MS + 5 * HOUR),
    });
    const clusterResult2 = await clusterEvents({ prisma, traceId: newTraceId() });
    const pending2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidate2 = pending2.find(
      (c) => c.id !== candidate.id && c.title.includes("新能源"),
    );
    assertions.push({
      name: "SM-7 seed: second candidate produced (distinct cluster)",
      ok: clusterResult2.newCandidates === 1 && candidate2 !== undefined,
      detail: `newCandidates=${clusterResult2.newCandidates}`,
    });
    if (candidate2 !== undefined) {
      await generateExplanation({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate2.id,
      });
      await decideReview({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate2.id,
        outcome: "approve",
        reviewer: "verify-reason",
        note: "publish WITHOUT a reason for SM-7 denominator",
      });
    }

    const publishedTotal = await prisma.publishedTimelineEntry.count();
    const nonNullReason = await prisma.publishedTimelineEntry.count({
      where: { recommendationReason: { not: null } },
    });
    assertions.push({
      name: "SM-7 coverage: metric distinguishes covered vs uncovered (2 published, 1 covered)",
      ok: publishedTotal === 2 && nonNullReason === 1,
      detail: `non-null=${nonNullReason}/${publishedTotal}`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- helpers -----------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. recommendation_reasons has a Cascade FK
  // to hot_events, but we clear it explicitly before hot_events to keep reset
  // ordering uniform with verify-digest/verify-timeline. The published_timeline
  // projection carries the derived recommendation_reason column.
  await prisma.publishedTimelineEntry.deleteMany({});
  await prisma.recommendationReason.deleteMany({});
  await prisma.publishedDailyDigest.deleteMany({});
  await prisma.dailyDigest.deleteMany({});
  await prisma.publishedHotEventTheme.deleteMany({});
  await prisma.eventThemeSet.deleteMany({});
  await prisma.publishedHotEventAssociation.deleteMany({});
  await prisma.eventAssociationSet.deleteMany({});
  await prisma.publishedHotEventReaction.deleteMany({});
  await prisma.marketReactionSnapshot.deleteMany({});
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
  await prisma.hotEventRevision.deleteMany({});
  await prisma.explanationVersion.deleteMany({});
  await prisma.publicationDecision.deleteMany({});
  await prisma.reviewDecision.deleteMany({});
  await prisma.hotEventEvidence.deleteMany({});
  await prisma.hotEvent.deleteMany({});
  await prisma.evidenceRecord.deleteMany({});
  await prisma.evidenceSource.deleteMany({});
}

async function seedRecord(
  prisma: ReturnType<typeof getPrisma>,
  sourceId: string,
  data: { title: string; summary: string; url: string | null; publishedAt: Date },
): Promise<void> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  await prisma.evidenceRecord.create({
    data: {
      id: newTraceId(),
      sourceId,
      url: data.url,
      title: data.title,
      summary: data.summary,
      publishedAt: data.publishedAt,
      ingestedAt: new Date(),
      contentHash,
      status: "archived",
      failureReason: null,
      rawPayload: { seeded: true, salt },
      traceId: newTraceId(),
    },
  });
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await resetState(prisma);
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== recommendation-reason verification ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[verify-reason] fatal", error);
  process.exit(1);
});
