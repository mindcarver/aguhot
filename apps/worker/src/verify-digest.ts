/**
 * Deterministic integration verification for the daily-digest generation
 * pipeline + projection — Story 2.4.
 *
 * Run with: pnpm --filter worker verify:digest (tsx src/verify-digest.ts).
 *
 * It exercises generateDailyDigest with the StubDigestAdapter (test-only,
 * imported from core — NOT wired in the worker/prod runtime: the daily-digest
 * worker resolves adapter = undefined so prod degrades honestly) against real
 * local PostgreSQL (NO Redis needed — generateDailyDigest is pure logic + a DB
 * append, no BullMQ queue at the generator level, same convention as
 * verify-themes/verify-associations calling generateThemes/generateAssociations
 * directly), then asserts the DB state — surface-anchored, not mock-based. It
 * prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed one source + archived records (same UTC day) →
 *   clusterEvents (candidates) → generateExplanation → decideReview(approve)
 *   → published → generateDailyDigest({coverageDate: todayUTC, adapter:
 *   StubDigestAdapter}) → refreshPublishedDailyDigest(coverageDate) → assert:
 *
 * Assertions:
 *   1. generateDailyDigest appends one daily_digests row (source="template",
 *      traceId), entries has >=1 item, every entry has non-empty
 *      hotEventId/title/conclusion.
 *   2. After refreshPublishedDailyDigest, published_daily_digests projects the
 *      digest; getPublishedDailyDigest returns non-null (entries).
 *   3. AD-5 append-only: a second generateDailyDigest appends a SECOND row (the
 *      first untouched); refresh projects the latest (generatedAt = gen2,
 *      entries = gen2 entries).
 *   4. adapter missing → generateDailyDigest returns null, writes nothing.
 *   5. adapter returns [] → generateDailyDigest returns null, writes nothing.
 *   6. AC2: an adapter conclusion that is empty OR contains investment-advice
 *      keywords OR is for a non-eligible hotEventId → generateDailyDigest
 *      THROWS (fail-fast, never silently truncates).
 *   7. NFR: no investment-advice wording in any entry conclusion.
 *   8. coverageDate with NO eligible published events → generateDailyDigest
 *      returns null, writes nothing (no empty digest).
 *   9. listPublishedDailyDigestCoverageDates returns the projected coverageDate.
 *  10. refreshPublishedDailyDigest with no digest row → deleteMany no-op (does
 *      not throw, leaves no stale row).
 */

import {
  clusterEvents,
  decideReview,
  generateDailyDigest,
  generateExplanation,
  getPrisma,
  getPublishedDailyDigest,
  getPublishedHotEventDetail,
  listPendingCandidates,
  listPublishedDailyDigestCoverageDates,
  newTraceId,
  refreshPublishedDailyDigest,
  resetPrisma,
  StubDigestAdapter,
  STUB_DIGEST_CONCLUSION,
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
  // derivation is pure logic + a DB append. The daily-digest worker exists
  // (epic-listed job category) but this verify calls generateDailyDigest
  // directly.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 archived records (same UTC day) → clusterEvents
    // → 1+ candidates → approve them so they're published + eligible ---
    // Two records whose titles are strict subsets of one another so they merge
    // into ONE candidate via overlap-coefficient (each scores 1.0 against the
    // accumulated signature). Both have publishedAt on BASE_MS day so
    // latestEvidenceAt lands on that UTC day.
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-digest-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    // Coverage date = the UTC day of BASE_MS (2024-01-01).
    const coverageDate = new Date(BASE_MS);

    // Record A: publishedAt = BASE_MS (same UTC day as coverageDate).
    await seedRecord(prisma, source.id, {
      title: "芯片短缺",
      summary: "全球芯片供应链短缺",
      url: "https://verify.test/芯片-1",
      publishedAt: new Date(BASE_MS),
    });
    // Record B: publishedAt = BASE_MS + 2h (same UTC day).
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
        `[verify-digest] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // --- Publish the candidate (digest eligibility = published) ---
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
      reviewer: "verify-digest",
      note: "publish for digest verify",
    });

    // --- 1 + 2: generateDailyDigest appends one row, projects, read ---
    // The StubDigestAdapter returns a fixed non-empty conclusion per passed
    // hotEventId. generateDailyDigest validates, assembles entries, and appends.
    const adapter = new StubDigestAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateDailyDigest({
      prisma,
      traceId: genTrace,
      coverageDate,
      adapter,
    });
    assertions.push({
      name: "generateDailyDigest returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "entries has >=1 item with non-empty hotEventId/title/conclusion",
        ok:
          gen1.entries.length >= 1 &&
          gen1.entries.every(
            (e) =>
              e.hotEventId.trim() !== "" &&
              e.title.trim() !== "" &&
              e.conclusion.trim() !== "",
          ),
        detail: `entries=${gen1.entries.length}`,
      });
      assertions.push({
        name: "generateDailyDigest result carries source=template + traceId",
        ok: gen1.source === "template" && gen1.traceId === genTrace,
        detail: `source=${gen1.source}`,
      });
      assertions.push({
        name: "each entry conclusion = STUB_DIGEST_CONCLUSION (deterministic)",
        ok: gen1.entries.every((e) => e.conclusion === STUB_DIGEST_CONCLUSION),
      });
      // NFR: no investment-advice wording in any conclusion.
      assertions.push({
        name: "NFR: no buy/sell/target-price/position wording in any entry conclusion",
        ok: gen1.entries.every((e) => noInvestAdvice(e.conclusion)),
        detail: "(checked 买卖/目标价/持仓/买入/卖出/增持/减持 keywords)",
      });
    }

    const rowsAfter1 = await prisma.dailyDigest.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "daily_digests row appended (count=1, source=template)",
      ok: rowsAfter1 === 1,
      detail: `count=${rowsAfter1}`,
    });

    const row1 = await prisma.dailyDigest.findFirst({
      where: { coverageDate },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=template, traceId carried",
      ok: row1 !== null && row1!.source === "template" && row1!.traceId === genTrace,
    });

    // Refresh the public projection so the digest flows into
    // published_daily_digests.
    await refreshPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });

    const publishedRow = await prisma.publishedDailyDigest.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "published_daily_digests row projected after refresh",
      ok: publishedRow !== null && publishedRow!.source === "template",
      detail:
        publishedRow === null ? "(no row)" : `source=${publishedRow!.source}`,
    });

    const digest = await getPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    assertions.push({
      name: "getPublishedDailyDigest non-null after projection (entries carry through)",
      ok:
        digest !== null &&
        digest!.entries.length >= 1 &&
        digest!.entries.every(
          (e) =>
            e.hotEventId.trim() !== "" &&
            e.title.trim() !== "" &&
            e.conclusion.trim() !== "",
        ),
      detail:
        digest === null
          ? "(null digest)"
          : `entries=${digest!.entries.length}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row ---
    await sleep(20);
    const gen2 = await generateDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
      adapter,
    });
    const rowsAfter2 = await prisma.dailyDigest.count({
      where: { coverageDate },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: rowsAfter2 === 2 && gen2 !== null,
      detail: `count=${rowsAfter2}`,
    });

    // Refresh projects the LATEST digest (generatedAt = gen2.createdAt, entries
    // = gen2 entries).
    await refreshPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const digestAfterGen2 = await getPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    assertions.push({
      name: "refresh projects the LATEST digest (generatedAt = gen2.createdAt)",
      ok:
        gen2 !== null &&
        digestAfterGen2 !== null &&
        digestAfterGen2!.generatedAt.getTime() === gen2.createdAt.getTime(),
      detail:
        gen2 === null || digestAfterGen2 === null
          ? "(gen2 or projection null)"
          : `projected generatedAt=${digestAfterGen2!.generatedAt.toISOString()} vs gen2=${gen2.createdAt.toISOString()}`,
    });

    // --- 4: adapter missing → returns null, writes nothing ---
    // Use a coverageDate with no existing digest to keep counts clean.
    const emptyCoverageDate = new Date(BASE_MS + 30 * 24 * 60 * 60 * 1000); // ~a month later
    const noAdapter = await generateDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate: emptyCoverageDate,
      // adapter omitted → V1 prod path (daily-digest worker resolves none) →
      // returns null.
    });
    assertions.push({
      name: "adapter missing: generateDailyDigest returns null",
      ok: noAdapter === null,
    });
    const noAdapterRows = await prisma.dailyDigest.count({
      where: { coverageDate: emptyCoverageDate },
    });
    assertions.push({
      name: "adapter missing: no daily_digests row written",
      ok: noAdapterRows === 0,
      detail: `count=${noAdapterRows}`,
    });

    // --- 5: adapter returns [] → returns null, writes nothing ---
    // (The eligible set for emptyCoverageDate is empty, so we need to also
    // verify the empty-adapter path. Use the main coverageDate which has
    // eligible events but an adapter that returns [].)
    const emptyAdapter: {
      fetchConclusions: () => Promise<never[]>;
    } = {
      fetchConclusions: async () => [],
    };
    const emptyResult = await generateDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate, // has eligible events
      adapter: emptyAdapter as never,
    });
    assertions.push({
      name: "adapter returns []: generateDailyDigest returns null",
      ok: emptyResult === null,
    });

    // --- 6: AC2 — empty / advisory conclusion OR non-eligible hotEventId → THROWS --
    // Empty conclusion.
    const emptyConclAdapter: {
      fetchConclusions: () => Promise<
        { hotEventId: string; conclusion: string }[]
      >;
    } = {
      fetchConclusions: async () => [
        { hotEventId: candidate.id, conclusion: "" },
      ],
    };
    let threwEmpty = false;
    try {
      await generateDailyDigest({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: emptyConclAdapter as never,
      });
    } catch {
      threwEmpty = true;
    }
    assertions.push({
      name: "AC2: empty conclusion → generateDailyDigest throws (fail-fast)",
      ok: threwEmpty,
    });

    // Advisory conclusion (contains a buy keyword).
    const advisoryAdapter: {
      fetchConclusions: () => Promise<
        { hotEventId: string; conclusion: string }[]
      >;
    } = {
      fetchConclusions: async () => [
        { hotEventId: candidate.id, conclusion: "建议买入相关概念股" },
      ],
    };
    let threwAdvisory = false;
    try {
      await generateDailyDigest({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: advisoryAdapter as never,
      });
    } catch {
      threwAdvisory = true;
    }
    assertions.push({
      name: "AC2: advisory conclusion → generateDailyDigest throws (fail-fast)",
      ok: threwAdvisory,
    });

    // Non-eligible hotEventId (an id not in the eligible set).
    const nonEligibleAdapter: {
      fetchConclusions: () => Promise<
        { hotEventId: string; conclusion: string }[]
      >;
    } = {
      fetchConclusions: async () => [
        {
          hotEventId: "00000000-0000-0000-0000-000000000000",
          conclusion: "该事件不在当日范围内。",
        },
      ],
    };
    let threwNonEligible = false;
    try {
      await generateDailyDigest({
        prisma,
        traceId: newTraceId(),
        coverageDate,
        adapter: nonEligibleAdapter as never,
      });
    } catch {
      threwNonEligible = true;
    }
    assertions.push({
      name: "AC2: non-eligible hotEventId → generateDailyDigest throws (fail-fast)",
      ok: threwNonEligible,
    });

    // --- 7: NFR already asserted inline above per-entry; re-check the projected row --
    const projectedRow = await prisma.publishedDailyDigest.findUnique({
      where: { coverageDate },
    });
    assertions.push({
      name: "NFR: projected digest entries have no investment-advice keywords",
      ok:
        projectedRow !== null &&
        (projectedRow!.items as Array<{ conclusion: string }>).every((e) =>
          noInvestAdvice(e.conclusion),
        ),
    });

    // --- 8: coverageDate with NO eligible published events → null, no write ---
    // emptyCoverageDate has no published events on that day. Already asserted
    // no rows written in step 4 (adapter missing); now assert it also returns
    // null WITH an adapter (no eligible events → no digest).
    const noEligible = await generateDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate: emptyCoverageDate,
      adapter,
    });
    assertions.push({
      name: "coverageDate with no eligible events: returns null (no empty digest)",
      ok: noEligible === null,
    });
    const noEligibleRows = await prisma.dailyDigest.count({
      where: { coverageDate: emptyCoverageDate },
    });
    assertions.push({
      name: "coverageDate with no eligible events: no daily_digests row written",
      ok: noEligibleRows === 0,
      detail: `count=${noEligibleRows}`,
    });

    // --- 9: listPublishedDailyDigestCoverageDates returns the projected coverageDate ---
    const coverageDates = await listPublishedDailyDigestCoverageDates({
      prisma,
      traceId: newTraceId(),
    });
    const hasCoverageDate = coverageDates.some(
      (r) => r.coverageDate.getTime() === coverageDate.getTime(),
    );
    assertions.push({
      name: "listPublishedDailyDigestCoverageDates returns the projected coverageDate",
      ok: hasCoverageDate,
      detail: `dates=${coverageDates.map((r) => r.coverageDate.toISOString().slice(0, 10)).join(",")}`,
    });

    // --- 9b: DESC ordering of listPublishedDailyDigestCoverageDates ---
    // The /daily default view picks index [0] as the "latest" digest. If the
    // orderBy regressed (ASC or removed), /daily would surface the OLDEST digest
    // as current. Membership (assertion 9) cannot detect this with one date, so
    // project a second LATER digest and assert [0] is the later date.
    const laterCoverageDate = new Date(Date.UTC(2024, 5, 1)); // 2024-06-01 > 2024-01-01
    await prisma.publishedDailyDigest.create({
      data: {
        coverageDate: laterCoverageDate,
        items: [],
        source: "template",
        generatedAt: new Date(),
        traceId: newTraceId(),
      },
    });
    const orderedDates = await listPublishedDailyDigestCoverageDates({
      prisma,
      traceId: newTraceId(),
    });
    assertions.push({
      name: "listPublishedDailyDigestCoverageDates is DESC (latest first) — /daily default-view guard",
      ok:
        orderedDates.length >= 2 &&
        orderedDates[0]!.coverageDate.getTime() === laterCoverageDate.getTime(),
      detail: `first=${orderedDates[0]?.coverageDate.toISOString().slice(0, 10)}`,
    });

    // --- 10: refreshPublishedDailyDigest with no digest row → deleteMany no-op ---
    // emptyCoverageDate has no daily_digests row. refresh should not throw and
    // should leave no published row.
    let refreshNoOpThrew = false;
    try {
      await refreshPublishedDailyDigest({
        prisma,
        traceId: newTraceId(),
        coverageDate: emptyCoverageDate,
      });
    } catch {
      refreshNoOpThrew = true;
    }
    const noOpPublishedRow = await prisma.publishedDailyDigest.findUnique({
      where: { coverageDate: emptyCoverageDate },
    });
    assertions.push({
      name: "refreshPublishedDailyDigest with no digest row: no throw, no stale row (deleteMany no-op)",
      ok: !refreshNoOpThrew && noOpPublishedRow === null,
    });

    // --- 11: takedown of a digest member → detail 404, digest unchanged ---
    // AC: a digest entry whose event is later taken down honestly 404s on
    // /events/{id} (AD-8 — getPublishedHotEventDetail returns null). The digest
    // read model is NOT auto-recomputed on member takedown: it is a versioned
    // point-in-time artifact (re-generation appends a new row that naturally
    // drops the taken-down event; auto-recompute is deferred). decideReview
    // (takedown) clears the hotEvent-keyed published_* tables — NOT the
    // coverageDate-keyed published_daily_digests — so the digest survives intact.
    const digestBeforeTakedown = await getPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    const entriesBefore =
      digestBeforeTakedown === null ? 0 : digestBeforeTakedown.entries.length;

    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "takedown",
      reviewer: "verify-digest",
      note: "takedown of digest member for versioned-artifact verify",
    });

    const detailAfterTakedown = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    const digestAfterTakedown = await getPublishedDailyDigest({
      prisma,
      traceId: newTraceId(),
      coverageDate,
    });
    assertions.push({
      name: "takedown of digest member: getPublishedHotEventDetail returns null (daily→detail link 404, AD-8)",
      ok: detailAfterTakedown === null,
    });
    assertions.push({
      name: "takedown of digest member: digest read model unchanged (versioned artifact, not auto-recomputed)",
      ok:
        digestAfterTakedown !== null &&
        digestAfterTakedown.entries.length === entriesBefore,
      detail: `entries before=${entriesBefore} after=${digestAfterTakedown === null ? 0 : digestAfterTakedown.entries.length}`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- helpers -----------------------------------------------------------------

/**
 * The investment-advice keywords the derivation must NEVER emit (NFR: the
 * product must not imply investment advice). Mirrors the digest-service
 * noInvestAdvice check; duplicated here so this verify script does not depend on
 * the internal helper export for its own assertion text.
 */
const ADVICE_KEYWORDS = ["买入", "卖出", "目标价", "持仓", "增持", "减持", "建议买", "建议卖"];

function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. The new 2.4 tables (daily_digests +
  // published_daily_digests) have NO FK to hot_events (the digest is
  // coverageDate-keyed, hotEventId is a data-only link), so they are independent
  // of the hot_events clear order — but we clear them at the top to keep the
  // reset ordering uniform with verify-themes/verify-associations. The other
  // published_* + write tables reference hot_events (Cascade FKs) but we clear
  // them explicitly before hot_events to keep reset ordering uniform.
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
  console.log("=== digest verification ===");
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
  console.error("[verify-digest] fatal", error);
  process.exit(1);
});
