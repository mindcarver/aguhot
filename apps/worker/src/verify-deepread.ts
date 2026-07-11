/**
 * Deterministic integration verification for the deep-read (AI 深读) generation
 * pipeline + projection — Story 5.2.
 *
 * Run with: pnpm --filter worker verify:deepread (tsx src/verify-deepread.ts).
 *
 * It exercises generateDeepRead with the StubLlmAdapter (test-only, imported from
 * core — NOT wired in the worker/prod runtime: the deep-read worker resolves
 * adapter = undefined so prod degrades honestly) against real local PostgreSQL (NO
 * Redis needed — generateDeepRead is pure logic + a DB append, no BullMQ queue at
 * the generator level, same convention as verify-digest / verify-reason calling the
 * generators directly), then asserts the DB state — surface-anchored, not mock-
 * based. It prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + 2 archived records → clusterEvents
 *   (candidates) → generateExplanation → decideReview(approve) → published →
 *   generateDeepRead({adapter: StubLlmAdapter}) → assert row projected →
 *   refreshPublishedReadModel(action:"publish") → assert projection non-null →
 *
 * Assertions (mirrors verify-reason's shape, adapted for the 3-segment deep read +
 * the published_hot_event_deep_reads projection + refreshPublishedReadModel):
 *   1. generateDeepRead appends one deep_reads row (source="ai", three segments,
 *      modelId, promptVersion, createdAt, traceId all present), segments =
 *      STUB_DEEP_READ.
 *   2. After refreshPublishedReadModel(action:"publish"), published_hot_event_
 *      deep_reads is non-null and carries the three segments (the projection
 *      derived them from the latest row — publish-orchestrator is the sole writer
 *      of that projection).
 *   3. AD-5 append-only: a second call appends a SECOND row; the projection
 *      reflects the latest.
 *   4. Self-heal: refreshPublishedReadModel(action:"publish") re-run keeps the
 *      projection alive (idempotent re-derivation from the latest row).
 *   5. adapter missing → generateDeepRead returns null, writes nothing (V1 prod
 *      honest-degradation path).
 *   6. AC fail-fast: an adapter segment that hits the guardrail (forbidden phrase)
 *      → generateDeepRead THROWS (never silently truncates).
 *   6b. Every forbidden phrase across all 6 classes is rejected in EACH of the three
 *      segments (a class list that is empty by accident cannot slip a phrase through
 *      just because it landed in impactSurface / beneficiaries / riskPoints).
 *   7. AC fail-fast: an adapter segment >120 字 → THROWS.
 *   7b. AC fail-fast: an empty segment → THROWS.
 *   8. Fail-fast throws wrote no extra rows (still count=2 from gen1+gen2).
 *   9. Pin the ≤120 字 boundary: exactly-120 accepted, exactly-121 rejected.
 *  10. Missing hotEventId → null, no write.
 *  11. Coverage: seed a SECOND published event that gets NO deep read, so the
 *      coverage denominator is meaningfully > 1 (2 published, 1 covered).
 */

import {
  clusterEvents,
  decideReview,
  generateDeepRead,
  generateExplanation,
  getLatestDeepRead,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  newTraceId,
  DEEP_READ_SEGMENT_MAX_LENGTH,
  passesRecommendationGuardrail,
  RECOMMENDATION_FORBIDDEN_PHRASES,
  refreshPublishedReadModel,
  resetPrisma,
  StubLlmAdapter,
  STUB_DEEP_READ,
  type LLMAdapter,
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
  // derivation is pure logic + a DB append. The deep-read worker exists (Epic-5
  // job category) but this verify calls generateDeepRead directly.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 archived records → clusterEvents → 1 candidate →
    // approve it so it's published + has an ExplanationVersion (the summary
    // context the deep-read adapter reads). ---
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-deepread-source",
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
        `[verify-deepread] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // Generate the deterministic explanation (provides summary context) + publish
    // so the published_hot_event_deep_reads projection row can exist after refresh.
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
      reviewer: "verify-deepread",
      note: "publish for deep-read verify",
    });

    // --- 1: generateDeepRead appends one row, segments = stub ---
    const adapter = new StubLlmAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateDeepRead({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateDeepRead returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "result three segments = STUB_DEEP_READ (deterministic)",
        ok:
          gen1.impactSurface === STUB_DEEP_READ.impactSurface &&
          gen1.beneficiaries === STUB_DEEP_READ.beneficiaries &&
          gen1.riskPoints === STUB_DEEP_READ.riskPoints,
        detail: `impact=${gen1.impactSurface}`,
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
        name: "result each segment ≤ DEEP_READ_SEGMENT_MAX_LENGTH + passes guardrail",
        ok:
          [...gen1.impactSurface].length <= DEEP_READ_SEGMENT_MAX_LENGTH &&
          [...gen1.beneficiaries].length <= DEEP_READ_SEGMENT_MAX_LENGTH &&
          [...gen1.riskPoints].length <= DEEP_READ_SEGMENT_MAX_LENGTH &&
          passesRecommendationGuardrail(gen1.impactSurface) &&
          passesRecommendationGuardrail(gen1.beneficiaries) &&
          passesRecommendationGuardrail(gen1.riskPoints),
        detail: `impact.len=${[...gen1.impactSurface].length}`,
      });
    }

    const rowsAfter1 = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "deep_reads row appended (count=1)",
      ok: rowsAfter1 === 1,
      detail: `count=${rowsAfter1}`,
    });

    const row1 = await prisma.deepRead.findFirst({
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

    // --- 2: projection derives published_hot_event_deep_reads from the latest row
    // (publish-orchestrator is the sole writer of that projection). The worker
    // path reuses refreshPublishedReadModel(action:"publish"). ---
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const deepReadRow = await prisma.publishedHotEventDeepRead.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "projection: published_hot_event_deep_reads three segments non-null = appended segments",
      ok:
        deepReadRow !== null &&
        deepReadRow!.impactSurface === STUB_DEEP_READ.impactSurface &&
        deepReadRow!.beneficiaries === STUB_DEEP_READ.beneficiaries &&
        deepReadRow!.riskPoints === STUB_DEEP_READ.riskPoints &&
        deepReadRow!.deepReadSource === "ai",
      detail:
        deepReadRow === null
          ? "(no projection row)"
          : `impact=${deepReadRow!.impactSurface}`,
    });

    // --- 2b: the PUBLIC read query (the hop the detail page actually calls)
    // assembles detail.deepRead from the projection. Asserting the projection
    // table row (above) is not enough — a regression in getPublishedHotEventDetail's
    // select/mapping would ship undetected. This pins the read-assembly surface. ---
    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "read-model: getPublishedHotEventDetail.deepRead carries the three projected segments",
      ok:
        detail !== null &&
        detail.deepRead !== null &&
        detail.deepRead!.impactSurface === STUB_DEEP_READ.impactSurface &&
        detail.deepRead!.beneficiaries === STUB_DEEP_READ.beneficiaries &&
        detail.deepRead!.riskPoints === STUB_DEEP_READ.riskPoints &&
        detail.deepRead!.source === "ai",
      detail:
        detail === null
          ? "(detail null)"
          : detail.deepRead === null
            ? "(detail.deepRead null)"
            : `impact=${detail.deepRead!.impactSurface}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row; projection
    // reflects the latest. ---
    await sleep(20);
    const gen2 = await generateDeepRead({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const rowsAfter2 = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: rowsAfter2 === 2 && gen2 !== null,
      detail: `count=${rowsAfter2}`,
    });

    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const latestViaRead = await getLatestDeepRead({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    const projectionAfterGen2 = await prisma.publishedHotEventDeepRead.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "refresh projects the LATEST deep read (getLatestDeepRead + projection agree)",
      ok:
        latestViaRead !== null &&
        projectionAfterGen2 !== null &&
        projectionAfterGen2!.impactSurface === latestViaRead!.impactSurface &&
        projectionAfterGen2!.beneficiaries === latestViaRead!.beneficiaries &&
        projectionAfterGen2!.riskPoints === latestViaRead!.riskPoints,
      detail:
        latestViaRead === null || projectionAfterGen2 === null
          ? "(read or projection null)"
          : `projected.impact=${projectionAfterGen2!.impactSurface}`,
    });

    // --- 4: self-heal — refreshPublishedReadModel(action:"publish") re-run keeps
    // the projection alive (idempotent re-derivation from the latest row). This is
    // the safety-net path the spec relies on for eventual consistency. ---
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const projectionAfterSelfHeal = await prisma.publishedHotEventDeepRead.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "self-heal (refresh re-run) keeps the latest deep read on the projection",
      ok:
        projectionAfterSelfHeal !== null &&
        projectionAfterSelfHeal!.impactSurface === STUB_DEEP_READ.impactSurface &&
        projectionAfterSelfHeal!.beneficiaries === STUB_DEEP_READ.beneficiaries &&
        projectionAfterSelfHeal!.riskPoints === STUB_DEEP_READ.riskPoints,
      detail:
        projectionAfterSelfHeal === null
          ? "(no projection row)"
          : `impact=${projectionAfterSelfHeal!.impactSurface}`,
    });

    // --- 4b: takedown clears the projection (the spec's takedown I/O matrix row).
    // Run takedown then re-publish so the rest of the assertions have the event
    // published again. ---
    const deepReadRowsBeforeTakedown = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "takedown",
    });
    const projectionAfterTakedown = await prisma.publishedHotEventDeepRead.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "takedown: published_hot_event_deep_reads row deleted",
      ok: projectionAfterTakedown === null,
    });
    // AD-5 invariant: takedown deletes the PROJECTION only — the append-only
    // truth table (deep_reads) MUST survive so the audit history is intact.
    const deepReadRowsAfterTakedown = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "takedown: append-only deep_reads truth rows survive (AD-5)",
      ok: deepReadRowsAfterTakedown === deepReadRowsBeforeTakedown,
      detail: `before=${deepReadRowsBeforeTakedown} after=${deepReadRowsAfterTakedown}`,
    });
    // Re-publish to restore the projection for the remaining assertions.
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });

    // --- 5: adapter missing → returns null, writes nothing ---
    // Reuse the same event (it already has deep reads); assert the no-adapter call
    // does not append a third row.
    const rowsBeforeNoAdapter = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    const noAdapter = await generateDeepRead({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      // adapter omitted → V1 prod path (deep-read worker resolves none) → returns
      // null.
    });
    assertions.push({
      name: "adapter missing: generateDeepRead returns null",
      ok: noAdapter === null,
    });
    const rowsAfterNoAdapter = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "adapter missing: no deep_reads row written",
      ok: rowsAfterNoAdapter === rowsBeforeNoAdapter,
      detail: `before=${rowsBeforeNoAdapter} after=${rowsAfterNoAdapter}`,
    });

    // --- 6: AC fail-fast — forbidden-phrase segment → THROWS (impactSurface hits
    // ACTION class 买入). ---
    const forbiddenAdapter: LLMAdapter = {
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return {
          impactSurface: "建议买入相关概念股，影响扩散。",
          beneficiaries: "上游供应商短期或受关注。",
          riskPoints: "下游需求不确定性仍存。",
          modelId: "stub:forbidden",
          promptVersion: "deepread-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
    };
    let threwForbidden = false;
    try {
      await generateDeepRead({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: forbiddenAdapter,
      });
    } catch {
      threwForbidden = true;
    }
    assertions.push({
      name: "AC: forbidden-phrase segment → generateDeepRead throws (fail-fast)",
      ok: threwForbidden,
    });

    // --- 6b: every forbidden phrase across all 6 classes is rejected in EACH of
    // the three segments (a regression where a class list is empty by accident
    // cannot slip a phrase through just because it landed in a particular segment).
    const allForbidden = Object.values(RECOMMENDATION_FORBIDDEN_PHRASES).flat();
    const segments: Array<keyof Pick<LlmDeepReadResult, "impactSurface" | "beneficiaries" | "riskPoints">> = [
      "impactSurface",
      "beneficiaries",
      "riskPoints",
    ];
    let allForbiddenRejected = true;
    for (const phrase of allForbidden) {
      for (const seg of segments) {
        const localAdapter: LLMAdapter = {
          async generateDeepRead(): Promise<LlmDeepReadResult | null> {
            const base = {
              impactSurface: "事件波及相关产业链上下游企业。",
              beneficiaries: "上游原材料供应商短期或受关注。",
              riskPoints: "下游需求不确定性仍存。",
              modelId: "stub:forbidden",
              promptVersion: "deepread-stub-v1",
            };
            // Inject the forbidden phrase into ONE segment only; the other two stay
            // clean so the throw is attributable to the injected segment.
            return { ...base, [seg]: `事件涉及${phrase}，后续仍需观察。` };
          },
          async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
            return null;
          },
        };
        try {
          await generateDeepRead({
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
    }
    assertions.push({
      name: "AC: all 6 classes × all phrases × all 3 segments rejected by guardrail",
      ok: allForbiddenRejected,
      detail: `phrases=${allForbidden.length} segments=${segments.length} combos=${allForbidden.length * segments.length}`,
    });

    // --- 7: AC fail-fast — over-length (>120 字) segment → THROWS ---
    // Built deliberately long (200 字) from a safe repeated char so the length is
    // unambiguous (no natural-language miscount).
    const overlength = "证".repeat(200);
    const overlenAdapter: LLMAdapter = {
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return {
          impactSurface: overlength,
          beneficiaries: "上游原材料供应商短期或受关注。",
          riskPoints: "下游需求不确定性仍存。",
          modelId: "stub:overlen",
          promptVersion: "deepread-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
    };
    let threwOverlen = false;
    try {
      await generateDeepRead({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: overlenAdapter,
      });
    } catch {
      threwOverlen = true;
    }
    assertions.push({
      name: "AC: >120 字 segment → generateDeepRead throws (fail-fast)",
      ok: threwOverlen && [...overlength].length > DEEP_READ_SEGMENT_MAX_LENGTH,
      detail: `len=${[...overlength].length}`,
    });

    // --- 7b: AC fail-fast — empty segment → THROWS ---
    const emptyAdapter: LLMAdapter = {
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return {
          impactSurface: "   ", // whitespace-only → trims to empty
          beneficiaries: "上游原材料供应商短期或受关注。",
          riskPoints: "下游需求不确定性仍存。",
          modelId: "stub:empty",
          promptVersion: "deepread-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
    };
    let threwEmpty = false;
    try {
      await generateDeepRead({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: emptyAdapter,
      });
    } catch {
      threwEmpty = true;
    }
    assertions.push({
      name: "AC: empty segment → generateDeepRead throws (fail-fast)",
      ok: threwEmpty,
    });

    // --- 8: forbidden / over-length / empty throws did NOT write rows ---
    // (fail-fast means no append, not just a throw). Still count=2 from gen1+gen2.
    const rowsAfterFailFast = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AC: fail-fast throws wrote no extra rows (still count=2 from gen1+gen2)",
      ok: rowsAfterFailFast === 2,
      detail: `count=${rowsAfterFailFast}`,
    });

    // --- 9: pin the ≤120 字 boundary exactly. A 120-字 segment is ACCEPTED
    // (appended); a 121-字 segment is REJECTED (throws). Built from a safe repeated
    // char so the off-by-one at the cap is unambiguous (a 200-字 overlength test
    // alone cannot distinguish `> 120` from `>= 120` or `> 121`). ---
    const exact120 = "适".repeat(120);
    const exact121 = "适".repeat(121);
    const exact120Adapter: LLMAdapter = {
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return {
          // One segment at exactly the cap; the other two stay short + clean.
          impactSurface: exact120,
          beneficiaries: "上游原材料供应商短期或受关注。",
          riskPoints: "下游需求不确定性仍存。",
          modelId: "stub:boundary",
          promptVersion: "deepread-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
    };
    const rowsBefore120 = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    let exact120Appended = false;
    try {
      const r = await generateDeepRead({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: exact120Adapter,
      });
      exact120Appended = r !== null;
    } catch {
      exact120Appended = false;
    }
    const rowsAfter120 = await prisma.deepRead.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AC: exactly-120 字 segment is ACCEPTED (boundary, not off-by-one)",
      ok:
        exact120Appended &&
        [...exact120].length === 120 &&
        rowsAfter120 === rowsBefore120 + 1,
      detail: `appended=${exact120Appended} len=${[...exact120].length}`,
    });

    const exact121Adapter: LLMAdapter = {
      async generateDeepRead(): Promise<LlmDeepReadResult | null> {
        return {
          impactSurface: exact121,
          beneficiaries: "上游原材料供应商短期或受关注。",
          riskPoints: "下游需求不确定性仍存。",
          modelId: "stub:boundary",
          promptVersion: "deepread-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
    };
    let threwExact121 = false;
    try {
      await generateDeepRead({
        prisma,
        traceId: newTraceId(),
        hotEventId: candidate.id,
        adapter: exact121Adapter,
      });
    } catch {
      threwExact121 = true;
    }
    assertions.push({
      name: "AC: exactly-121 字 segment is REJECTED (boundary, not off-by-one)",
      ok: threwExact121 && [...exact121].length === 121,
      detail: `threw=${threwExact121} len=${[...exact121].length}`,
    });

    // --- 10: missing hotEventId → null, no write ---
    const missing = await generateDeepRead({
      prisma,
      traceId: newTraceId(),
      hotEventId: "00000000-0000-0000-0000-000000000000",
      adapter,
    });
    assertions.push({
      name: "missing hotEventId: returns null (no write)",
      ok: missing === null,
    });

    // --- 11: coverage — seed a SECOND published event that intentionally gets NO
    // deep read, so the denominator is meaningfully > 1 and the coverage metric
    // actually distinguishes covered from uncovered (a single covered event would
    // make N=N trivially true and hide a regression). ---
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
      name: "coverage seed: second candidate produced (distinct cluster)",
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
        reviewer: "verify-deepread",
        note: "publish WITHOUT a deep read for coverage denominator",
      });
    }

    const publishedDeepTotal = await prisma.publishedHotEventDeepRead.count();
    const publishedSummaryTotal = await prisma.publishedHotEvent.count();
    assertions.push({
      name: "coverage: metric distinguishes covered vs uncovered (2 published, 1 deep-read projection)",
      ok: publishedSummaryTotal === 2 && publishedDeepTotal === 1,
      detail: `deep=${publishedDeepTotal}/${publishedSummaryTotal}`,
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
  // Order matters for FK constraints. deep_reads has a Cascade FK to hot_events,
  // but we clear it explicitly before hot_events to keep reset ordering uniform
  // with verify-reason/verify-digest/verify-timeline. The published_hot_event_
  // deep_reads projection carries the derived segments.
  await prisma.publishedHotEventDeepRead.deleteMany({});
  await prisma.deepRead.deleteMany({});
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
  console.log("=== deep-read verification ===");
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
  console.error("[verify-deepread] fatal", error);
  process.exit(1);
});
