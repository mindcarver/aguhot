/**
 * Deterministic integration verification for the trend-briefing (AI 趋势研判)
 * generation pipeline + projection — Story 5.3.
 *
 * Run with: pnpm --filter worker verify:trendbriefing (tsx src/verify-trendbriefing.ts).
 *
 * It exercises generateTrendBriefing with the StubLlmAdapter (test-only, imported from
 * core — NOT wired in the worker/prod runtime: the daily-digest worker resolves
 * llmAdapter = undefined so prod degrades honestly) against real local PostgreSQL (NO
 * Redis needed — generateTrendBriefing is pure logic + a DB append, no BullMQ queue at
 * the generator level, same convention as verify-digest / verify-deepread calling the
 * generators directly), then asserts the DB state — surface-anchored, not mock-based. It
 * prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + 2 archived records (same UTC day) → clusterEvents
 *   (candidates) → generateExplanation → decideReview(approve) → published →
 *   generateTrendBriefing({coverageDate, adapter: StubLlmAdapter}) → assert row appended
 *   → refreshPublishedTrendBriefing(coverageDate) → assert projection non-null →
 *   getPublishedTrendBriefing non-null →
 *
 * Assertions (mirrors verify-deepread's shape, adapted for the single-paragraph trend
 * briefing + the published_trend_briefings projection + refreshPublishedTrendBriefing):
 *   1. generateTrendBriefing appends one trend_briefings row (source="ai", briefing,
 *      modelId, promptVersion, createdAt, traceId all present), briefing = STUB_TREND_
 *      BRIEFING, basedOnHotEventIds contains the day's eligible event id.
 *   2. After refreshPublishedTrendBriefing, published_trend_briefings is non-null and
 *      carries the briefing; getPublishedTrendBriefing (the /daily read query) returns
 *      non-null too (pins the read-assembly surface the page consumes, mirroring the 5.2
 *      review triage patch that caught a read-assembly regression).
 *   3. AD-5 append-only: a second call appends a SECOND row; the projection reflects the
 *      latest.
 *   4. Self-heal: refreshPublishedTrendBriefing re-run keeps the projection alive
 *      (idempotent re-derivation from the latest row).
 *   5. adapter missing → generateTrendBriefing returns null, writes nothing (V1 prod
 *      honest-degradation path).
 *   6. AC fail-fast: an adapter briefing that hits the guardrail (forbidden phrase)
 *      → generateTrendBriefing THROWS (never silently truncates).
 *   6b. Every forbidden phrase across all 6 classes is rejected (a class list that is
 *      empty by accident cannot slip a phrase through).
 *   7. AC fail-fast: an adapter briefing >200 字 → THROWS.
 *   7b. AC fail-fast: an empty briefing → THROWS.
 *   8. Fail-fast throws wrote no extra rows (still count=2 from gen1+gen2).
 *   9. Pin the ≤200 字 boundary: exactly-200 accepted, exactly-201 rejected.
 *  10. coverageDate with NO eligible published events → null, no write.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateTrendBriefing,
  getPrisma,
  getPublishedTrendBriefing,
  getLatestTrendBriefing,
  listPendingCandidates,
  newTraceId,
  TREND_BRIEFING_MAX_LENGTH,
  passesRecommendationGuardrail,
  RECOMMENDATION_FORBIDDEN_PHRASES,
  refreshPublishedTrendBriefing,
  resetPrisma,
  StubLlmAdapter,
  STUB_TREND_BRIEFING,
  type LLMAdapter,
  type LlmTrendBriefingResult,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records land on the same UTC day
// deterministically. The coverageDate is derived from this day.
const BASE_MS = Date.UTC(2024, 0, 1); // 2024-01-01 UTC
const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — the
  // derivation is pure logic + a DB append. The daily-digest worker hosts the
  // trend-briefing path (Epic-5 job category) but this verify calls
  // generateTrendBriefing directly.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 archived records → clusterEvents → 1 candidate →
    // approve it so it's published + has an ExplanationVersion (the summary
    // context the trend-briefing adapter reads). ---
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-trendbriefing-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    // Coverage date = the UTC day of BASE_MS (2024-01-01).
    const coverageDate = new Date(BASE_MS);

    // Two overlapping-title records so they merge into ONE candidate via
    // overlap-coefficient. Both publishedAt on BASE_MS day → latestEvidenceAt
    // lands on that UTC day → the event is eligible for coverageDate.
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
        `[verify-trendbriefing] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // Generate the deterministic explanation (provides summary context) + publish
    // so the event is eligible for the coverageDate (latestEvidenceAt UTC day =
    // coverageDate). Published status is the digest/trend-briefing eligibility gate.
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
      reviewer: "verify-trendbriefing",
      note: "publish for trend-briefing verify",
    });

    // --- 1: generateTrendBriefing appends one row, briefing = stub ---
    const adapter = new StubLlmAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateTrendBriefing({
      prisma,
      traceId: genTrace,
      coverageDate,
      adapter,
    });
    assertions.push({
      name: "generateTrendBriefing returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "result briefing = STUB_TREND_BRIEFING (deterministic)",
        ok: gen1.briefing === STUB_TREND_BRIEFING,
        detail: `briefing=${gen1.briefing.slice(0, 24)}…`,
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
        name: "result briefing ≤ TREND_BRIEFING_MAX_LENGTH + passes guardrail",
        ok:
          [...gen1.briefing].length <= TREND_BRIEFING_MAX_LENGTH &&
          passesRecommendationGuardrail(gen1.briefing),
        detail: `len=${[...gen1.briefing].length}`,
      });
      assertions.push({
        name: "result basedOnHotEventIds contains the day's eligible event id",
        ok:
          gen1.basedOnHotEventIds.includes(candidate.id) &&
          gen1.basedOnHotEventIds.length >= 1,
        detail: `ids=${gen1.basedOnHotEventIds.length}`,
      });
    }

    const rowsAfter1 = await prisma.trendBriefing.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "trend_briefings row appended (count=1)",
      ok: rowsAfter1 === 1,
      detail: `count=${rowsAfter1}`,
    });

    const row1 = await prisma.trendBriefing.findFirst({
      where: { coverageDate },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=ai, modelId/promptVersion/traceId carried, basedOnHotEventIds has candidate",
      ok:
        row1 !== null &&
        row1!.source === "ai" &&
        row1!.modelId.trim() !== "" &&
        row1!.promptVersion.trim() !== "" &&
        row1!.traceId === genTrace &&
        (row1!.basedOnHotEventIds as unknown as string[]).includes(candidate.id),
    });

    // --- 2: projection derives published_trend_briefings from the latest row
    // (publish-orchestrator is the sole writer of that projection). The worker
    // path calls refreshPublishedTrendBriefing after a successful generate. ---
    await refreshPublishedTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const trendRow = await prisma.publishedTrendBriefing.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "projection: published_trend_briefings briefing non-null = appended briefing",
      ok:
        trendRow !== null &&
        trendRow!.briefing === STUB_TREND_BRIEFING &&
        trendRow!.source === "ai",
      detail:
        trendRow === null
          ? "(no projection row)"
          : `briefing=${trendRow!.briefing.slice(0, 24)}…`,
    });

    // --- 2b: the PUBLIC read query (the hop the /daily page actually calls)
    // assembles the briefing from the projection. Asserting the projection table
    // row (above) is not enough — a regression in getPublishedTrendBriefing's
    // select/mapping would ship undetected. This pins the read-assembly surface
    // (mirrors the 5.2 review triage patch that added the same guard for
    // getPublishedHotEventDetail.deepRead). ---
    const published = await getPublishedTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    assertions.push({
      name: "read-model: getPublishedTrendBriefing carries the projected briefing",
      ok:
        published !== null &&
        published.briefing === STUB_TREND_BRIEFING &&
        published.source === "ai" &&
        published.coverageDate.getTime() === coverageDate.getTime(),
      detail:
        published === null
          ? "(null)"
          : `briefing=${published.briefing.slice(0, 24)}…`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row; projection
    // reflects the latest. ---
    await sleep(20);
    const gen2 = await generateTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
      adapter,
    });
    const rowsAfter2 = await prisma.trendBriefing.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: rowsAfter2 === 2 && gen2 !== null,
      detail: `count=${rowsAfter2}`,
    });

    await refreshPublishedTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const latestViaRead = await getLatestTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const projectionAfterGen2 = await prisma.publishedTrendBriefing.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "refresh projects the LATEST trend briefing (getLatestTrendBriefing + projection agree)",
      ok:
        latestViaRead !== null &&
        projectionAfterGen2 !== null &&
        projectionAfterGen2!.briefing === latestViaRead!.briefing,
      detail:
        latestViaRead === null || projectionAfterGen2 === null
          ? "(read or projection null)"
          : `projected.briefing=${projectionAfterGen2!.briefing.slice(0, 24)}…`,
    });

    // --- 4: self-heal — refreshPublishedTrendBriefing re-run keeps the projection
    // alive (idempotent re-derivation from the latest row). This is the safety-net
    // path the spec relies on for eventual consistency. ---
    await refreshPublishedTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const projectionAfterSelfHeal = await prisma.publishedTrendBriefing.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "self-heal (refresh re-run) keeps the latest briefing on the projection",
      ok:
        projectionAfterSelfHeal !== null &&
        projectionAfterSelfHeal!.briefing === STUB_TREND_BRIEFING,
      detail:
        projectionAfterSelfHeal === null
          ? "(no projection row)"
          : `briefing=${projectionAfterSelfHeal!.briefing.slice(0, 24)}…`,
    });

    // --- 5: adapter missing → returns null, writes nothing ---
    // Use a coverageDate with no existing briefing to keep counts clean.
    const emptyCoverageDate = new Date(BASE_MS + 30 * 24 * 60 * 60 * 1000); // ~a month later
    const rowsBeforeNoAdapter = await prisma.trendBriefing.count({
      where: { coverageDate: emptyCoverageDate },
    });
    const noAdapter = await generateTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate: emptyCoverageDate,
      // adapter omitted → V1 prod path (daily-digest worker resolves none) → returns
      // null.
    });
    assertions.push({
      name: "adapter missing: generateTrendBriefing returns null",
      ok: noAdapter === null,
    });
    const rowsAfterNoAdapter = await prisma.trendBriefing.count({
      where: { coverageDate: emptyCoverageDate },
    });
    assertions.push({
      name: "adapter missing: no trend_briefings row written",
      ok: rowsAfterNoAdapter === rowsBeforeNoAdapter,
      detail: `before=${rowsBeforeNoAdapter} after=${rowsAfterNoAdapter}`,
    });

    // --- 6: AC fail-fast — forbidden-phrase briefing → THROWS (hits ACTION class 买入) ---
    const forbiddenAdapter: LLMAdapter = {
      async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
        return {
          briefing: "建议买入相关概念股，事件影响扩散。",
          modelId: "stub:forbidden",
          promptVersion: "trendbriefing-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
      async generateDeepRead(): Promise<null> {
        return null;
      },
    };
    let threwForbidden = false;
    try {
      await generateTrendBriefing({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: forbiddenAdapter,
      });
    } catch {
      threwForbidden = true;
    }
    assertions.push({
      name: "AC: forbidden-phrase briefing → generateTrendBriefing throws (fail-fast)",
      ok: threwForbidden,
    });

    // --- 6b: every forbidden phrase across all 6 classes is rejected (a regression
    // where a class list is empty by accident cannot slip a phrase through). ---
    const allForbidden = Object.values(RECOMMENDATION_FORBIDDEN_PHRASES).flat();
    let allForbiddenRejected = true;
    for (const phrase of allForbidden) {
      const localAdapter: LLMAdapter = {
        async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
          return {
            // Inject the forbidden phrase into the briefing paragraph.
            briefing: `当日事件涉及${phrase}，后续仍需观察确认。`,
            modelId: "stub:forbidden",
            promptVersion: "trendbriefing-stub-v1",
          };
        },
        async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
          return null;
        },
        async generateDeepRead(): Promise<null> {
          return null;
        },
      };
      try {
        await generateTrendBriefing({
          prisma,
          traceId: newTraceId(),
          coverageDate,
          adapter: localAdapter,
        });
        allForbiddenRejected = false;
      } catch {
        // expected
      }
    }
    assertions.push({
      name: "AC: all 6 classes × all phrases rejected by guardrail",
      ok: allForbiddenRejected,
      detail: `phrases=${allForbidden.length}`,
    });

    // --- 7: AC fail-fast — over-length (>200 字) briefing → THROWS ---
    // Built deliberately long (300 字) from a safe repeated char so the length is
    // unambiguous (no natural-language miscount).
    const overlength = "适".repeat(300);
    const overlenAdapter: LLMAdapter = {
      async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
        return {
          briefing: overlength,
          modelId: "stub:overlen",
          promptVersion: "trendbriefing-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
      async generateDeepRead(): Promise<null> {
        return null;
      },
    };
    let threwOverlen = false;
    try {
      await generateTrendBriefing({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: overlenAdapter,
      });
    } catch {
      threwOverlen = true;
    }
    assertions.push({
      name: "AC: >200 字 briefing → generateTrendBriefing throws (fail-fast)",
      ok: threwOverlen && [...overlength].length > TREND_BRIEFING_MAX_LENGTH,
      detail: `len=${[...overlength].length}`,
    });

    // --- 7b: AC fail-fast — empty briefing → THROWS ---
    const emptyAdapter: LLMAdapter = {
      async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
        return {
          briefing: "   ", // whitespace-only → trims to empty
          modelId: "stub:empty",
          promptVersion: "trendbriefing-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
      async generateDeepRead(): Promise<null> {
        return null;
      },
    };
    let threwEmpty = false;
    try {
      await generateTrendBriefing({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: emptyAdapter,
      });
    } catch {
      threwEmpty = true;
    }
    assertions.push({
      name: "AC: empty briefing → generateTrendBriefing throws (fail-fast)",
      ok: threwEmpty,
    });

    // --- 8: forbidden / over-length / empty throws did NOT write rows ---
    // (fail-fast means no append, not just a throw). Still count=2 from gen1+gen2.
    const rowsAfterFailFast = await prisma.trendBriefing.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "AC: fail-fast throws wrote no extra rows (still count=2 from gen1+gen2)",
      ok: rowsAfterFailFast === 2,
      detail: `count=${rowsAfterFailFast}`,
    });

    // --- 9: pin the ≤200 字 boundary exactly. A 200-字 briefing is ACCEPTED
    // (appended); a 201-字 briefing is REJECTED (throws). Built from a safe repeated
    // char so the off-by-one at the cap is unambiguous (a 300-字 overlength test
    // alone cannot distinguish `> 200` from `>= 200` or `> 201`). ---
    const exact200 = "适".repeat(200);
    const exact201 = "适".repeat(201);
    const exact200Adapter: LLMAdapter = {
      async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
        return {
          briefing: exact200,
          modelId: "stub:boundary",
          promptVersion: "trendbriefing-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
      async generateDeepRead(): Promise<null> {
        return null;
      },
    };
    const rowsBefore200 = await prisma.trendBriefing.count({
      where: { coverageDate },
    });
    let exact200Appended = false;
    try {
      const r = await generateTrendBriefing({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: exact200Adapter,
      });
      exact200Appended = r !== null;
    } catch {
      exact200Appended = false;
    }
    const rowsAfter200 = await prisma.trendBriefing.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "AC: exactly-200 字 briefing is ACCEPTED (boundary, not off-by-one)",
      ok:
        exact200Appended &&
        [...exact200].length === 200 &&
        rowsAfter200 === rowsBefore200 + 1,
      detail: `appended=${exact200Appended} len=${[...exact200].length}`,
    });

    const exact201Adapter: LLMAdapter = {
      async generateTrendBriefing(): Promise<LlmTrendBriefingResult | null> {
        return {
          briefing: exact201,
          modelId: "stub:boundary",
          promptVersion: "trendbriefing-stub-v1",
        };
      },
      async generateReason(): Promise<{ reason: string; modelId: string; promptVersion: string } | null> {
        return null;
      },
      async generateDeepRead(): Promise<null> {
        return null;
      },
    };
    let threwExact201 = false;
    try {
      await generateTrendBriefing({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: exact201Adapter,
      });
    } catch {
      threwExact201 = true;
    }
    assertions.push({
      name: "AC: exactly-201 字 briefing is REJECTED (boundary, not off-by-one)",
      ok: threwExact201 && [...exact201].length === 201,
      detail: `threw=${threwExact201} len=${[...exact201].length}`,
    });

    // --- 10: coverageDate with NO eligible published events → null, no write ---
    // emptyCoverageDate has no published events on that day. Already asserted
    // no rows written in step 5 (adapter missing); now assert it also returns
    // null WITH an adapter (no eligible events → no briefing).
    const noEligible = await generateTrendBriefing({
      prisma,
      traceId: newTraceId(),
      coverageDate: emptyCoverageDate,
      adapter,
    });
    assertions.push({
      name: "coverageDate with no eligible events: returns null (no contextless briefing)",
      ok: noEligible === null,
    });
    const noEligibleRows = await prisma.trendBriefing.count({
      where: { coverageDate: emptyCoverageDate },
    });
    assertions.push({
      name: "coverageDate with no eligible events: no trend_briefings row written",
      ok: noEligibleRows === 0,
      detail: `count=${noEligibleRows}`,
    });

    // --- 11: refreshPublishedTrendBriefing stale-clear branch (parity with
    // verify-digest assertion #10: refreshPublishedDailyDigest with no digest
    // row → deleteMany no-op). When the underlying trend_briefings rows for a
    // coverageDate are gone, the next refresh must deleteMany the
    // published_trend_briefings projection so /daily does not serve a stale
    // briefing forever (honest-degradation contract). This is the
    // `latest === null → deleteMany` branch, otherwise unexercised.
    const staleProjectionBefore = await prisma.publishedTrendBriefing.findUnique({
      where: { coverageDate },
    });
    await prisma.trendBriefing.deleteMany({ where: { coverageDate } });
    let staleThrew = false;
    try {
      await refreshPublishedTrendBriefing({ prisma, traceId: newTraceId(), coverageDate });
    } catch {
      staleThrew = true;
    }
    const staleProjectionAfter = await prisma.publishedTrendBriefing.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "refreshPublishedTrendBriefing clears stale projection when no truth row exists (deleteMany branch)",
      ok:
        !staleThrew &&
        staleProjectionBefore !== null &&
        staleProjectionAfter === null,
      detail: `threw=${staleThrew} before=${staleProjectionBefore !== null} after=${staleProjectionAfter === null}`,
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
  // Order matters for FK constraints. The 5.3 tables (trend_briefings +
  // published_trend_briefings) have NO FK to hot_events (the briefing is
  // coverageDate-keyed, basedOnHotEventIds is a data-only link — mirrors the 2.4
  // daily_digests invariant), so they are independent of the hot_events clear order —
  // but we clear them at the top to keep the reset ordering uniform with
  // verify-digest/verify-deepread. The other published_* + write tables reference
  // hot_events (Cascade FKs) but we clear them explicitly before hot_events to keep
  // reset ordering uniform.
  await prisma.publishedTrendBriefing.deleteMany({});
  await prisma.trendBriefing.deleteMany({});
  await prisma.publishedTimelineEntry.deleteMany({});
  await prisma.recommendationReason.deleteMany({});
  await prisma.publishedHotEventDeepRead.deleteMany({});
  await prisma.deepRead.deleteMany({});
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
  console.log("=== trend-briefing verification ===");
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
  console.error("[verify-trendbriefing] fatal", error);
  process.exit(1);
});
