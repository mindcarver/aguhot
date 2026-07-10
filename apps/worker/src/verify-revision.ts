/**
 * Deterministic integration verification for the published-event copy & tag
 * revision pipeline — Story 1.9.
 *
 * Run with: pnpm --filter worker verify:revision (tsx src/verify-revision.ts).
 *
 * It exercises every row of the spec 1-9 I/O & Edge-Case Matrix against real
 * local PostgreSQL (no Redis needed — revisions + republish are synchronous
 * lightweight commands inside decideReview's transaction, no BullMQ queue),
 * then asserts the DB state — surface-anchored, not mock-based. It prints
 * PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed source + records → clusterEvents → generateExplanation →
 *   decideReview(approve) → produce ONE published event → then assert:
 *
 *   1. reviseHotEvent appends a HotEventRevision with the new title+tags;
 *      effective = latest revision (title overlay + tag set).
 *   2. No-op revise (same values as effective) does NOT append a second row.
 *   3. saveExplanation(human) appends an ExplanationVersion with source="human".
 *   4. After revision but BEFORE republish: getPublishedHotEventDetail still
 *      shows the OLD title/tags/template explanation (pending not yet public).
 *      getPublishedEventForRevision reports pending.title/tags/explanation=true.
 *   5. decideReview(republish) → published→published, action=publish; the read
 *      model now shows the NEW title/tags/human explanation (source="human").
 *   6. publishedAt is stable across republish (first-publish time preserved).
 *   7. AD-5 append-only: the first HotEventRevision row is NOT deleted after a
 *      second revision; explanation_versions rows accumulate.
 *   8. Illegal republish on a non-published event (candidate/taken_down) throws
 *      IllegalTransitionError and writes nothing.
 *   9. Tag normalization: separators (ASCII/fullwidth comma, newline), trim,
 *      dedupe preserve-order, case-sensitive.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch verify-publish.ts
 * or any e2e seed (zero-change contract for other stories).
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  getPrisma,
  getPublishedEventForRevision,
  getPublishedHotEventDetail,
  listPendingCandidates,
  newTraceId,
  normalizeTags,
  resetPrisma,
  reviseHotEvent,
  saveExplanation,
  ExplanationSource,
  IllegalTransitionError,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// Fixed base time so all seeded records have deterministic publishedAt offsets.
const BASE_MS = Date.UTC(2024, 0, 1);
const HOUR = 60 * 60 * 1000;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — revisions
  // + republish are synchronous DB writes inside decideReview's transaction.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 records → cluster → 1 published event -----------
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-revision-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    await seedRecord(prisma, source.id, {
      title: "央行降准",
      summary: "央行宣布降准",
      url: "https://verify.test/降准-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "本次降准为全面降准",
      url: "https://verify.test/降准-2",
      publishedAt: new Date(BASE_MS + 1 * HOUR),
    });

    await clusterEvents({ prisma, traceId: newTraceId() });
    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidate = pending.find((c) => c.title.includes("降准"))!;

    // Generate a template explanation + approve → 1 published event with a
    // template-sourced public explanation (so we can later assert the human
    // revision flips the projected source).
    await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    const approveResult = await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "approve",
      reviewer: "verify-revision",
      note: "publish for revision verify",
    });
    assertions.push({
      name: "setup: approve → published (action=publish)",
      ok: approveResult.toStatus === "published" && approveResult.action === "publish",
      detail: `${approveResult.fromStatus}→${approveResult.toStatus}`,
    });

    // Capture the first-published publishedAt to assert stability across republish.
    const publishedRowInitial = await prisma.publishedHotEvent.findUniqueOrThrow({
      where: { hotEventId: candidate.id },
      select: { publishedAt: true, title: true, tags: true },
    });
    assertions.push({
      name: "setup: published row has empty tags (no revision yet)",
      ok: publishedRowInitial.tags.length === 0,
      detail: `tags=${JSON.stringify(publishedRowInitial.tags)}`,
    });

    // --- 1. reviseHotEvent appends a HotEventRevision with new title+tags -----
    const revise1 = await reviseHotEvent({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      title: "央行全面降准0.5个百分点（修订标题）",
      tags: "货币政策,A股，流动性\n货币政策", // separators + dup → normalized
      reviewer: "verify-revision",
      note: "first revision",
    });
    assertions.push({
      name: "1. reviseHotEvent appended a revision (appended=true, revisionId set)",
      ok: revise1.appended === true && typeof revise1.revisionId === "string",
      detail: revise1.appended ? `revisionId=${revise1.revisionId}` : "(no append)",
    });

    const revisionRows = await prisma.hotEventRevision.findMany({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "1. HotEventRevision row carries the new title + normalized tags",
      ok: revisionRows.length === 1 &&
          revisionRows[0]!.title === "央行全面降准0.5个百分点（修订标题）" &&
          revisionRows[0]!.tags.length === 3 &&
          revisionRows[0]!.tags[0] === "货币政策" &&
          revisionRows[0]!.tags[1] === "A股" &&
          revisionRows[0]!.tags[2] === "流动性",
      detail: `tags=${JSON.stringify(revisionRows[0]?.tags)}`,
    });

    // --- 2. No-op revise (same values as effective) does NOT append ----------
    const revise1Dup = await reviseHotEvent({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      title: "央行全面降准0.5个百分点（修订标题）", // same as effective
      tags: "货币政策,A股，流动性", // same set, different separator order
      reviewer: "verify-revision",
    });
    assertions.push({
      name: "2. no-op revise (same effective values) does NOT append (appended=false)",
      ok: revise1Dup.appended === false && revise1Dup.revisionId === undefined,
      detail: `appended=${revise1Dup.appended}`,
    });
    const revisionRowsAfterDup = await prisma.hotEventRevision.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "2. still exactly 1 HotEventRevision row after no-op",
      ok: revisionRowsAfterDup === 1,
      detail: `${revisionRowsAfterDup} rows`,
    });

    // --- 3. saveExplanation(human) appends an ExplanationVersion -------------
    const explainHuman = await saveExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      summary: "人工修订摘要：央行降准释放长期资金。",
      whyItMatters: "人工修订：关注流动性影响（运营手输，非投资建议）。",
      uncertainties: "人工修订：后续政策路径仍需观察。",
      source: ExplanationSource.Human,
    });
    assertions.push({
      name: "3. saveExplanation(human) appended a version (appended=true)",
      ok: explainHuman.appended === true && typeof explainHuman.explanationVersionId === "string",
      detail: `appended=${explainHuman.appended}`,
    });

    const humanVersion = await prisma.explanationVersion.findUnique({
      where: { id: explainHuman.explanationVersionId! },
    });
    assertions.push({
      name: "3. appended ExplanationVersion has source='human' + the typed partitions",
      ok: humanVersion !== null &&
          humanVersion.source === "human" &&
          humanVersion.summary === "人工修订摘要：央行降准释放长期资金。" &&
          humanVersion.whyItMatters === "人工修订：关注流动性影响（运营手输，非投资建议）。" &&
          humanVersion.uncertainties === "人工修订：后续政策路径仍需观察。",
      detail: humanVersion === null ? "(null)" : `source=${humanVersion.source}`,
    });

    // saveExplanation no-op (same text) does not append again.
    const explainHumanDup = await saveExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      summary: "人工修订摘要：央行降准释放长期资金。",
      whyItMatters: "人工修订：关注流动性影响（运营手输，非投资建议）。",
      uncertainties: "人工修订：后续政策路径仍需观察。",
      source: ExplanationSource.Human,
    });
    assertions.push({
      name: "3b. saveExplanation no-op (same partitions) does NOT append",
      ok: explainHumanDup.appended === false,
      detail: `appended=${explainHumanDup.appended}`,
    });

    // --- 4. Before republish: public still shows OLD; operator view pending ---
    const detailBefore = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "4. pre-republish public detail shows OLD title (pending not yet public)",
      ok: detailBefore !== null && detailBefore!.title === candidate.title,
      detail: detailBefore === null ? "(null)" : `title=${detailBefore!.title}`,
    });
    assertions.push({
      name: "4. pre-republish public detail shows OLD tags (empty)",
      ok: detailBefore !== null && detailBefore!.tags.length === 0,
      detail: detailBefore === null ? "(null)" : `tags=${JSON.stringify(detailBefore!.tags)}`,
    });
    assertions.push({
      name: "4. pre-republish public detail shows template explanation (source=template)",
      ok: detailBefore !== null &&
          detailBefore!.explanation !== null &&
          detailBefore!.explanation!.source === "template",
      detail: detailBefore?.explanation === null ? "(null)" : `source=${detailBefore!.explanation!.source}`,
    });

    const opViewBefore = await getPublishedEventForRevision({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "4. operator view: pending.title=true (effective != published)",
      ok: opViewBefore.pending.title === true,
      detail: `pending=${JSON.stringify(opViewBefore.pending)}`,
    });
    assertions.push({
      name: "4. operator view: pending.tags=true (effective non-empty != published empty)",
      ok: opViewBefore.pending.tags === true,
    });
    assertions.push({
      name: "4. operator view: pending.explanation=true (human != template)",
      ok: opViewBefore.pending.explanation === true,
    });
    assertions.push({
      name: "4. operator view: effective title = latest revision title",
      ok: opViewBefore.effective.title === "央行全面降准0.5个百分点（修订标题）",
    });
    assertions.push({
      name: "4. operator view: effective tags = latest revision tags",
      ok: opViewBefore.effective.tags.length === 3 &&
          opViewBefore.effective.tags[0] === "货币政策",
    });

    // --- 5. decideReview(republish) → published→published, refresh projects --
    const republishResult = await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "republish",
      reviewer: "verify-revision",
      note: "republish after operator revision",
    });
    assertions.push({
      name: "5. republish: from=published, to=published, action=publish",
      ok: republishResult.fromStatus === "published" &&
          republishResult.toStatus === "published" &&
          republishResult.action === "publish",
      detail: `${republishResult.fromStatus}→${republishResult.toStatus} (${republishResult.action})`,
    });

    const detailAfter = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "5. post-republish public detail shows NEW title (effective projected)",
      ok: detailAfter !== null &&
          detailAfter!.title === "央行全面降准0.5个百分点（修订标题）",
      detail: detailAfter === null ? "(null)" : `title=${detailAfter!.title}`,
    });
    assertions.push({
      name: "5. post-republish public detail shows NEW tags (projected)",
      ok: detailAfter !== null &&
          detailAfter!.tags.length === 3 &&
          detailAfter!.tags[0] === "货币政策" &&
          detailAfter!.tags[1] === "A股" &&
          detailAfter!.tags[2] === "流动性",
      detail: detailAfter === null ? "(null)" : `tags=${JSON.stringify(detailAfter!.tags)}`,
    });
    assertions.push({
      name: "5. post-republish public detail shows HUMAN explanation (source=human)",
      ok: detailAfter !== null &&
          detailAfter!.explanation !== null &&
          detailAfter!.explanation!.source === "human" &&
          detailAfter!.explanation!.summary === "人工修订摘要：央行降准释放长期资金。",
      detail: detailAfter?.explanation === null ? "(null)" : `source=${detailAfter!.explanation!.source}`,
    });

    // pending is now zero after republish.
    const opViewAfter = await getPublishedEventForRevision({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "5. post-republish operator view: pending all false (effective == published)",
      ok: opViewAfter.pending.title === false &&
          opViewAfter.pending.tags === false &&
          opViewAfter.pending.explanation === false,
      detail: `pending=${JSON.stringify(opViewAfter.pending)}`,
    });

    // --- 6. publishedAt stable across republish ------------------------------
    const publishedRowAfter = await prisma.publishedHotEvent.findUniqueOrThrow({
      where: { hotEventId: candidate.id },
      select: { publishedAt: true },
    });
    assertions.push({
      name: "6. publishedAt unchanged across republish (first-publish time stable)",
      ok: publishedRowAfter.publishedAt.getTime() === publishedRowInitial.publishedAt.getTime(),
      detail: `before=${publishedRowInitial.publishedAt.toISOString()}, after=${publishedRowAfter.publishedAt.toISOString()}`,
    });

    // --- 7. AD-5 append-only: second revision does not delete the first ------
    const revise2 = await reviseHotEvent({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      title: "央行全面降准（二次修订）",
      tags: "政策",
      reviewer: "verify-revision",
      note: "second revision",
    });
    assertions.push({
      name: "7. second reviseHotEvent appends a second revision",
      ok: revise2.appended === true,
    });
    const revisionRowsFinal = await prisma.hotEventRevision.findMany({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "7. AD-5: 2 HotEventRevision rows (first not deleted), effective = latest",
      ok: revisionRowsFinal.length === 2 &&
          revisionRowsFinal[0]!.title === "央行全面降准0.5个百分点（修订标题）" &&
          revisionRowsFinal[1]!.title === "央行全面降准（二次修订）",
      detail: `${revisionRowsFinal.length} rows; titles=${revisionRowsFinal.map((r) => r.title).join(" | ")}`,
    });

    // audit chain contains approve + republish review decisions (append-only).
    const reviewDecisions = await prisma.reviewDecision.findMany({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "7. AD-5 audit chain: approve + republish ReviewDecisions present",
      ok: reviewDecisions.length >= 2 &&
          reviewDecisions.some((rd) => rd.outcome === "approve") &&
          reviewDecisions.some((rd) => rd.outcome === "republish"),
      detail: reviewDecisions.map((rd) => rd.outcome).join(", "),
    });
    const publicationDecisions = await prisma.publicationDecision.findMany({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "7. AD-5 audit chain: PublicationDecision includes published→published (republish)",
      ok: publicationDecisions.some(
        (pd) => pd.fromStatus === "published" && pd.toStatus === "published",
      ),
      detail: publicationDecisions.map((pd) => `${pd.fromStatus}→${pd.toStatus}`).join(", "),
    });

    // explanation_versions accumulate (template + human, neither deleted).
    const explanationVersionCount = await prisma.explanationVersion.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "7. AD-5: explanation_versions accumulate (>=2: template + human)",
      ok: explanationVersionCount >= 2,
      detail: `${explanationVersionCount} rows`,
    });

    // --- 8. taken_down+republish is LEGAL as of Story 1.10 (re-publish path) --
    // Story 1.9 deferred taken_down+republish to 1.10; Story 1.10 makes it a
    // legal transition (taken_down → published, action=publish). So this section
    // now asserts the LEGAL path: after takedown, a republish succeeds and
    // re-creates the published_* row. The candidate+republish illegal case is
    // covered in 8b below (candidate was never published, republish makes no
    // sense and stays illegal).
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "takedown",
      reviewer: "verify-revision",
      note: "takedown before 1.10 taken_down republish",
    });
    // capture counts before the republish (now legal, should write one of each).
    const reviewBefore = await prisma.reviewDecision.count();
    const pubDecBefore = await prisma.publicationDecision.count();

    const takenDownRepublish = await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "republish",
      reviewer: "verify-revision",
      note: "1.10 taken_down republish",
    });
    assertions.push({
      name: "8. taken_down+republish: from=taken_down, to=published, action=publish (1.10 legal)",
      ok: takenDownRepublish.fromStatus === "taken_down" &&
          takenDownRepublish.toStatus === "published" &&
          takenDownRepublish.action === "publish",
      detail: `${takenDownRepublish.fromStatus}→${takenDownRepublish.toStatus} (${takenDownRepublish.action})`,
    });
    const reviewAfter = await prisma.reviewDecision.count();
    const pubDecAfter = await prisma.publicationDecision.count();
    assertions.push({
      name: "8. taken_down republish appended exactly one ReviewDecision row",
      ok: reviewAfter === reviewBefore + 1,
      detail: `before=${reviewBefore}, after=${reviewAfter}`,
    });
    assertions.push({
      name: "8. taken_down republish appended exactly one PublicationDecision row",
      ok: pubDecAfter === pubDecBefore + 1,
      detail: `before=${pubDecBefore}, after=${pubDecAfter}`,
    });

    // Illegal republish on a fresh candidate too.
    await seedRecord(prisma, source.id, {
      title: "债券收益率上行",
      summary: "债券",
      url: "https://verify.test/债券",
      publishedAt: new Date(BASE_MS + 5 * HOUR),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const freshPending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const freshCand = freshPending.find((c) => c.title.includes("债券"))!;
    let candIllegalThrew = false;
    try {
      await decideReview({
        prisma,
        traceId: newTraceId(),
        hotEventId: freshCand.id,
        outcome: "republish",
        reviewer: "verify-revision",
      });
    } catch (error) {
      candIllegalThrew = error instanceof IllegalTransitionError;
    }
    assertions.push({
      name: "8b. illegal: republish on candidate throws IllegalTransitionError",
      ok: candIllegalThrew,
    });

    // --- 9. Tag normalization ------------------------------------------------
    // Separators (ASCII comma, fullwidth comma, newline), trim, drop empties,
    // dedupe preserve-order, case-sensitive. The binding separator rule is from
    // the spec Boundaries "Always" section: 英文/中文逗号、换行 (ASCII comma,
    // fullwidth comma, newline). Spaces are NOT separators (a tag may contain a
    // space, e.g. "A股 市场"); only the leading/trailing space is trimmed.
    const norm = normalizeTags("A股, a股，政策\n政策 ");
    assertions.push({
      name: "9. normalizeTags: split/trim/dedupe preserve-order, case-sensitive",
      ok: norm.length === 3 &&
          norm[0] === "A股" &&
          norm[1] === "a股" &&
          norm[2] === "政策",
      detail: JSON.stringify(norm),
    });
    assertions.push({
      name: "9b. normalizeTags: empty input → empty array (no fabricated tags)",
      ok: normalizeTags("").length === 0 && normalizeTags(" , ").length === 0,
    });
    assertions.push({
      name: "9c. normalizeTags: array input joined then re-split (a,b → two tags)",
      ok: normalizeTags(["a,b", "c"]).length === 3,
      detail: JSON.stringify(normalizeTags(["a,b", "c"])),
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- seeding / cleanup helpers ----------------------------------------------

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order respects FK constraints. hot_event_revisions reference hot_events
  // (Restrict FK like review_decisions, so delete hot_events after revisions).
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
  console.log("=== published-event revision verification (Story 1.9) ===");
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
  console.error("[verify-revision] fatal", error);
  process.exit(1);
});
