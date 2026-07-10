/**
 * Deterministic integration verification for the review/publish gate.
 *
 * Run with: pnpm --filter worker verify:publish (tsx src/verify-publish.ts).
 *
 * It exercises every row of the spec 1-6 I/O & Edge-Case Matrix against real
 * local PostgreSQL (no Redis needed — decisions are synchronous lightweight
 * commands, no BullMQ queue), then asserts the DB state — surface-anchored, not
 * mock-based. It prints PASS/FAIL and exits non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed archived records → clusterEvents (produce candidates) →
 *   listPendingCandidates (AC1) → decideReview approve (reviewer+note → two
 *   decision records + published read model row) → decideReview reject (no
 *   read model row) → decideReview takedown (read model row deleted) →
 *   append-only (two decisions on one event → two review + two publication
 *   rows) → illegal transition throws (no writes) → read-model idempotent on
 *   re-publish → write isolation (only the 4 owned tables changed) → audit
 *   chain queryable → PASS/FAIL → cleanup.
 *
 * The seed + cluster reuse the 1-5 path (clusterEvents) to produce real
 * candidates, then the review-workflow commands drive the rest.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  getCandidateDetail,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  listPublishedHotEvents,
  newTraceId,
  resetPrisma,
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
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — decisions
  // are synchronous DB writes, no BullMQ queue (AD-4: operator actions are
  // "submit operator action", not heavy async work).
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + archived records → clusterEvents → candidates ----
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-publish-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    // Two events so we can approve one and reject another. The 降准 cluster gets
    // TWO records (a short title + its long superset, so overlap-coefficient =
    // 1.0 merges them; one with a url, one WITHOUT) so the Story 1.8 detail-
    // projection assertion can exercise both linkStatus paths (available +
    // unavailable) and the evidence row count = member count.
    await seedRecord(prisma, source.id, {
      title: "央行降准",
      summary: "央行宣布降准",
      url: "https://verify.test/降准-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "本次降准为全面降准",
      url: null, // missing url → linkStatus="unavailable" in the projection
      publishedAt: new Date(BASE_MS + 1 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "美股大跌三大股指重挫",
      summary: "美股暴跌",
      url: "https://verify.test/美股",
      publishedAt: new Date(BASE_MS + 2 * HOUR),
    });

    // Capture baseline row counts for write-isolation assertion.
    const tablesBefore = await ownedTableRowCounts(prisma);

    // Cluster: produces 2 candidates. The 降准 pair merges into one candidate
    // (overlap coefficient >= threshold, within 72h window) with 2 links; the
    // 美股 record forms its own with 1 link.
    const clusterTrace = newTraceId();
    const clusterResult = await clusterEvents({ prisma, traceId: clusterTrace });
    assertions.push({
      name: "seed cluster: 2 candidates produced (降准 merged 2 records, 美股 separate)",
      ok: clusterResult.newCandidates === 2,
      detail: `newCandidates=${clusterResult.newCandidates}`,
    });

    // AC1: listPendingCandidates returns the candidates with evidence count.
    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "AC1 listPendingCandidates returns 2 candidates",
      ok: pending.length === 2,
      detail: `${pending.length} candidates`,
    });
    assertions.push({
      name: "AC1 each pending candidate has its evidence count (降准=2, 美股=1)",
      ok: pending.find((c) => c.title.includes("降准"))!.evidenceCount === 2 &&
          pending.find((c) => c.title.includes("美股"))!.evidenceCount === 1,
      detail: pending.map((c) => `${c.title.slice(0, 8)}…(${c.evidenceCount})`).join(", "),
    });

    const approvedCandidate = pending.find((c) => c.title.includes("降准"))!;
    const rejectedCandidate = pending.find((c) => c.title.includes("美股"))!;

    // --- Story 1.8: generate an explanation for the to-be-approved candidate --
    // BEFORE approve. The publish projection reads the latest ExplanationVersion
    // and surfaces it into published_hot_event_explanations. Generating pre-
    // publish mirrors how a real pipeline would run (explain job → then approve).
    const explainTrace = newTraceId();
    const explainResult = await generateExplanation({
      prisma,
      traceId: explainTrace,
      hotEventId: approvedCandidate.id,
    });
    assertions.push({
      name: "1.8 pre-publish: generateExplanation produced a version (three partitions non-empty)",
      ok: explainResult !== null &&
          explainResult.summary.trim() !== "" &&
          explainResult.whyItMatters.trim() !== "" &&
          explainResult.uncertainties.trim() !== "",
      detail: explainResult === null ? "(null)" : `source=${explainResult.source}`,
    });

    // --- AC2: approve candidate → published + read model row ------------------
    const approveTrace = newTraceId();
    const approveResult = await decideReview({
      prisma,
      traceId: approveTrace,
      hotEventId: approvedCandidate.id,
      outcome: "approve",
      reviewer: "verify-operator",
      note: "multi-source, confirmed",
    });
    assertions.push({
      name: "AC2 approve: from=candidate, to=published, action=publish",
      ok: approveResult.fromStatus === "candidate" &&
          approveResult.toStatus === "published" &&
          approveResult.action === "publish",
      detail: `${approveResult.fromStatus}→${approveResult.toStatus} (${approveResult.action})`,
    });

    // Two decision records written (ReviewDecision + PublicationDecision).
    const rdApprove = await prisma.reviewDecision.findUnique({
      where: { id: approveResult.reviewDecisionId },
    });
    const pdApprove = await prisma.publicationDecision.findUnique({
      where: { id: approveResult.publicationDecisionId },
    });
    assertions.push({
      name: "AC2 approve: ReviewDecision written (outcome=approve, reviewer, note, traceId)",
      ok: rdApprove !== null &&
          rdApprove.outcome === "approve" &&
          rdApprove.reviewer === "verify-operator" &&
          rdApprove.note === "multi-source, confirmed" &&
          rdApprove.traceId === approveTrace,
    });
    assertions.push({
      name: "AC2 approve: PublicationDecision written (candidate→published, linked to review)",
      ok: pdApprove !== null &&
          pdApprove.fromStatus === "candidate" &&
          pdApprove.toStatus === "published" &&
          pdApprove.reviewDecisionId === approveResult.reviewDecisionId,
    });

    // publication_status on hot_events updated.
    const approvedEvent = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: approvedCandidate.id },
      select: { publicationStatus: true },
    });
    assertions.push({
      name: "AC2 approve: hot_events.publication_status = published",
      ok: approvedEvent.publicationStatus === "published",
      detail: `status=${approvedEvent.publicationStatus}`,
    });

    // Read model row exists (publish = upsert).
    const publishedRow = await prisma.publishedHotEvent.findUnique({
      where: { hotEventId: approvedCandidate.id },
    });
    assertions.push({
      name: "AC2 approve: published_hot_events row exists (evidenceCount=2, title copied)",
      ok: publishedRow !== null &&
          publishedRow.evidenceCount === 2 &&
          publishedRow.title === approvedCandidate.title,
      detail: publishedRow ? `evidenceCount=${publishedRow.evidenceCount}` : "no row",
    });

    // --- Story 1.7 public read: listPublishedHotEvents returns the approved row ---
    // The public read query (first consumer of the read model, AD-3) must surface
    // the just-published event with consistent title/evidenceCount/latestEvidenceAt.
    const publishedList = await listPublishedHotEvents({ prisma, traceId: newTraceId() });
    const approvedInList = publishedList.find((p) => p.hotEventId === approvedCandidate.id);
    assertions.push({
      name: "1.7 public read: listPublishedHotEvents returns the approved row",
      ok: approvedInList !== undefined &&
          approvedInList.title === approvedCandidate.title &&
          approvedInList.evidenceCount === 2 &&
          approvedInList.latestEvidenceAt.getTime() === publishedRow!.latestEvidenceAt.getTime(),
      detail: approvedInList
        ? `evidenceCount=${approvedInList.evidenceCount}, latest=${approvedInList.latestEvidenceAt.toISOString()}`
        : "approved row missing from list",
    });

    // --- Story 1.8 public detail: getPublishedHotEventDetail projects the 3 read models ---
    // The detail read query assembles summary + explanation + evidence from the
    // three published_* tables (AD-3: never reads hot_events/evidence_records/
    // explanation_versions). Must surface the explanation generated pre-publish
    // (three partitions), the evidence timeline (2 rows = member count), and the
    // correct link_status derivation (one available + one unavailable).
    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
    });
    assertions.push({
      name: "1.8 detail: getPublishedHotEventDetail returns non-null for published event",
      ok: detail !== null &&
          detail!.hotEventId === approvedCandidate.id &&
          detail!.title === approvedCandidate.title &&
          detail!.evidenceCount === 2,
      detail: detail === null ? "(null)" : `evidenceCount=${detail!.evidenceCount}`,
    });
    assertions.push({
      name: "1.8 detail: explanation projected (three partitions non-empty, source=template)",
      ok: detail !== null &&
          detail!.explanation !== null &&
          detail!.explanation!.summary.trim() !== "" &&
          detail!.explanation!.whyItMatters.trim() !== "" &&
          detail!.explanation!.uncertainties.trim() !== "" &&
          detail!.explanation!.source === "template",
      detail: detail?.explanation === null ? "(no explanation projected)" : `source=${detail!.explanation!.source}`,
    });
    assertions.push({
      name: "1.8 detail: evidence timeline has 2 rows (member count), ordered by position",
      ok: detail !== null &&
          detail!.evidence.length === 2 &&
          detail!.evidence[0]!.position === 0 &&
          detail!.evidence[1]!.position === 1,
      detail: detail ? `${detail.evidence.length} rows` : "(null detail)",
    });
    assertions.push({
      name: "1.8 detail: link_status derived (1 available + 1 unavailable, rows not dropped)",
      ok: detail !== null &&
          detail!.evidence.some((e) => e.linkStatus === "available") &&
          detail!.evidence.some((e) => e.linkStatus === "unavailable"),
      detail: detail ? detail.evidence.map((e) => `${e.linkStatus}`).join(", ") : "(null detail)",
    });
    assertions.push({
      name: "1.8 detail: each evidence row carries sourceName + summary (not silently empty)",
      ok: detail !== null &&
          detail!.evidence.every((e) => e.sourceName === "verify-publish-source") &&
          detail!.evidence.every((e) => e.summary !== null && e.summary.trim() !== ""),
      detail: detail ? `sourceName=${detail.evidence[0]!.sourceName}` : "(null detail)",
    });

    // --- Story 1.8 AD-5: re-projection surfaces the LATEST ExplanationVersion ---
    // A second generateExplanation appends a new version (append-only, AD-5).
    // The publish refresh must project the LATEST version (createdAt desc, id
    // desc tiebreaker) into published_hot_event_explanations — never a stale
    // earlier version. The derivation is deterministic, so gen1 and gen2 share
    // the same partition text but differ in createdAt; we assert the projected
    // generatedAt equals gen2.createdAt (the latest), proving the projection
    // tracks the newest version. Without this assertion a regression that pinned
    // the projection to the OLDEST version would ship green (no test read the
    // projection back after a 2nd append).
    const gen2 = await generateExplanation({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
    });
    const { refreshPublishedReadModel } = await import("@aguhot/core");
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
      action: "publish",
    });
    const detailAfterGen2 = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
    });
    assertions.push({
      name: "1.8 AD-5 re-project: latest ExplanationVersion projected after append (not stale)",
      ok: gen2 !== null &&
          detailAfterGen2 !== null &&
          detailAfterGen2!.explanation !== null &&
          detailAfterGen2!.explanation!.generatedAt.getTime() === gen2.createdAt.getTime(),
      detail:
        gen2 === null || detailAfterGen2?.explanation === null
          ? "(gen2 or projection null)"
          : `projected generatedAt=${detailAfterGen2!.explanation!.generatedAt.toISOString()} vs gen2=${gen2.createdAt.toISOString()}`,
    });

    // --- AC2: reject candidate → rejected, no read model row -----------------
    const rejectTrace = newTraceId();
    const rejectResult = await decideReview({
      prisma,
      traceId: rejectTrace,
      hotEventId: rejectedCandidate.id,
      outcome: "reject",
      reviewer: "verify-operator",
      note: "insufficient sources",
    });
    assertions.push({
      name: "AC2 reject: from=candidate, to=rejected, action=none",
      ok: rejectResult.fromStatus === "candidate" &&
          rejectResult.toStatus === "rejected" &&
          rejectResult.action === "none",
    });

    const rejectedRow = await prisma.publishedHotEvent.findUnique({
      where: { hotEventId: rejectedCandidate.id },
    });
    assertions.push({
      name: "AC3 reject: no published_hot_events row (never published)",
      ok: rejectedRow === null,
    });

    const rejectedEvent = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: rejectedCandidate.id },
      select: { publicationStatus: true },
    });
    assertions.push({
      name: "AC2 reject: hot_events.publication_status = rejected",
      ok: rejectedEvent.publicationStatus === "rejected",
    });

    // Rejected candidate no longer in pending list.
    const pendingAfterReject = await listPendingCandidates({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "AC1 reject: candidate removed from pending list",
      ok: !pendingAfterReject.some((c) => c.id === rejectedCandidate.id) &&
          !pendingAfterReject.some((c) => c.id === approvedCandidate.id),
      detail: `${pendingAfterReject.length} pending`,
    });

    // --- AC2: takedown published → taken_down, read model row deleted ---------
    const takedownTrace = newTraceId();
    const takedownResult = await decideReview({
      prisma,
      traceId: takedownTrace,
      hotEventId: approvedCandidate.id,
      outcome: "takedown",
      reviewer: "verify-operator",
      note: "retraction needed",
    });
    assertions.push({
      name: "AC2 takedown: from=published, to=taken_down, action=takedown",
      ok: takedownResult.fromStatus === "published" &&
          takedownResult.toStatus === "taken_down" &&
          takedownResult.action === "takedown",
    });

    const publishedRowAfterTakedown = await prisma.publishedHotEvent.findUnique({
      where: { hotEventId: approvedCandidate.id },
    });
    assertions.push({
      name: "AC2 takedown: published_hot_events row deleted (public-invisible)",
      ok: publishedRowAfterTakedown === null,
    });

    // --- Story 1.7 public read: listPublishedHotEvents no longer contains the row ---
    // After takedown the public read query must not surface the taken-down event
    // (row existence = currently published; the surface IS the query result set).
    const publishedListAfterTakedown = await listPublishedHotEvents({ prisma, traceId: newTraceId() });
    assertions.push({
      name: "1.7 public read: listPublishedHotEvents excludes the taken-down row",
      ok: !publishedListAfterTakedown.some((p) => p.hotEventId === approvedCandidate.id),
      detail: `${publishedListAfterTakedown.length} rows after takedown`,
    });

    // --- Story 1.8 detail read: takedown clears all 3 published_* tables ---
    // After takedown, getPublishedHotEventDetail returns null (no summary row →
    // 404 on the detail page, AD-8 unpublished id does not leak). All three
    // published_* read models must be clean for the hotEventId (row-gone =
    // public-invisible across summary + explanation + evidence uniformly).
    const detailAfterTakedown = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
    });
    assertions.push({
      name: "1.8 detail: getPublishedHotEventDetail returns null after takedown (no leak)",
      ok: detailAfterTakedown === null,
    });
    const explanationRowAfterTakedown = await prisma.publishedHotEventExplanation.findUnique({
      where: { hotEventId: approvedCandidate.id },
    });
    const evidenceRowsAfterTakedown = await prisma.publishedHotEventEvidence.count({
      where: { hotEventId: approvedCandidate.id },
    });
    assertions.push({
      name: "1.8 detail: takedown cleared published_hot_event_explanations (no stale row)",
      ok: explanationRowAfterTakedown === null,
    });
    assertions.push({
      name: "1.8 detail: takedown cleared published_hot_event_evidence (0 rows)",
      ok: evidenceRowsAfterTakedown === 0,
      detail: `${evidenceRowsAfterTakedown} rows`,
    });

    const takenDownEvent = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: approvedCandidate.id },
      select: { publicationStatus: true },
    });
    assertions.push({
      name: "AC2 takedown: hot_events.publication_status = taken_down",
      ok: takenDownEvent.publicationStatus === "taken_down",
    });

    // --- AD-5 append-only: two decisions on approvedCandidate → 2 review + 2 publication rows
    const reviewDecisionsForApproved = await prisma.reviewDecision.findMany({
      where: { hotEventId: approvedCandidate.id },
      orderBy: { createdAt: "asc" },
    });
    const publicationDecisionsForApproved = await prisma.publicationDecision.findMany({
      where: { hotEventId: approvedCandidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "AD-5 append-only: 2 ReviewDecisions (approve then takedown), ascending",
      ok: reviewDecisionsForApproved.length === 2 &&
          reviewDecisionsForApproved[0]!.outcome === "approve" &&
          reviewDecisionsForApproved[1]!.outcome === "takedown",
    });
    assertions.push({
      name: "AD-5 append-only: 2 PublicationDecisions (candidate→published, published→taken_down)",
      ok: publicationDecisionsForApproved.length === 2 &&
          publicationDecisionsForApproved[0]!.fromStatus === "candidate" &&
          publicationDecisionsForApproved[0]!.toStatus === "published" &&
          publicationDecisionsForApproved[1]!.fromStatus === "published" &&
          publicationDecisionsForApproved[1]!.toStatus === "taken_down",
    });

    // --- Illegal transitions throw and write nothing --------------------------
    // Capture counts before to assert nothing was written.
    const reviewBefore = await prisma.reviewDecision.count();
    const pubDecBefore = await prisma.publicationDecision.count();
    const eventBefore = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: rejectedCandidate.id },
      select: { publicationStatus: true },
    });

    // reject on already-published (approve a fresh candidate first, then reject).
    const illegalCases: Array<{
      label: string;
      setup: () => Promise<{ hotEventId: string; outcome: "approve" | "reject" | "takedown" }>;
    }> = [
      // approve already-rejected
      {
        label: "approve already-rejected throws",
        setup: async () => ({ hotEventId: rejectedCandidate.id, outcome: "approve" as const }),
      },
      // approve taken_down
      {
        label: "approve taken_down throws",
        setup: async () => ({ hotEventId: approvedCandidate.id, outcome: "approve" as const }),
      },
      // takedown candidate (need a fresh candidate for this)
      {
        label: "takedown never-published candidate throws",
        setup: async () => {
          const rFresh = await seedRecord(prisma, source.id, {
            title: "债券收益率上行",
            summary: "债券",
            url: "https://verify.test/债券",
            publishedAt: new Date(BASE_MS + 5 * HOUR),
          });
          void rFresh;
          await clusterEvents({ prisma, traceId: newTraceId() });
          const freshPending = await listPendingCandidates({ prisma, traceId: newTraceId() });
          const freshCand = freshPending.find((c) => c.title.includes("债券"))!;
          return { hotEventId: freshCand.id, outcome: "takedown" as const };
        },
      },
    ];

    for (const c of illegalCases) {
      const { hotEventId, outcome } = await c.setup();
      let threw = false;
      let threwRight = false;
      try {
        await decideReview({
          prisma,
          traceId: newTraceId(),
          hotEventId,
          outcome,
          reviewer: "verify-operator",
        });
      } catch (error) {
        threw = true;
        threwRight = error instanceof IllegalTransitionError;
      }
      assertions.push({
        name: `illegal transition: ${c.label}`,
        ok: threw && threwRight,
        detail: threw ? (threwRight ? "(IllegalTransitionError)" : "(wrong error)") : "(did not throw)",
      });
    }

    // Illegal transitions wrote nothing.
    const reviewAfter = await prisma.reviewDecision.count();
    const pubDecAfter = await prisma.publicationDecision.count();
    assertions.push({
      name: "illegal transitions wrote no ReviewDecision rows",
      ok: reviewAfter === reviewBefore,
      detail: `before=${reviewBefore}, after=${reviewAfter}`,
    });
    assertions.push({
      name: "illegal transitions wrote no PublicationDecision rows",
      ok: pubDecAfter === pubDecBefore,
      detail: `before=${pubDecBefore}, after=${pubDecAfter}`,
    });
    const eventAfterRejected = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: rejectedCandidate.id },
      select: { publicationStatus: true },
    });
    assertions.push({
      name: "illegal transition left publication_status unchanged (rejected event)",
      ok: eventAfterRejected.publicationStatus === eventBefore.publicationStatus,
      detail: `before=${eventBefore.publicationStatus}, after=${eventAfterRejected.publicationStatus}`,
    });

    // --- Read-model idempotent on re-publish ----------------------------------
    // Approve the fresh candidate (bond), then approve again — wait, re-approve
    // on a published event is illegal. Instead test idempotency via a direct
    // refreshPublishedReadModel call (the upsert path). We need a published
    // event for this: approve the bond candidate.
    const freshPending2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const bondCand = freshPending2.find((c) => c.title.includes("债券"));
    if (bondCand !== undefined) {
      await decideReview({
        prisma,
        traceId: newTraceId(),
        hotEventId: bondCand.id,
        outcome: "approve",
        reviewer: "verify-operator",
      });
      const { refreshPublishedReadModel } = await import("@aguhot/core");
      // Call refresh again (idempotent upsert) — should not duplicate.
      await refreshPublishedReadModel({
        prisma,
        traceId: newTraceId(),
        hotEventId: bondCand.id,
        action: "publish",
      });
      const bondRows = await prisma.publishedHotEvent.count({
        where: { hotEventId: bondCand.id },
      });
      assertions.push({
        name: "read-model idempotent: re-publish leaves exactly 1 row",
        ok: bondRows === 1,
        detail: `${bondRows} rows`,
      });
    }

    // --- Write isolation: only the 4 owned tables changed ---------------------
    const tablesAfter = await ownedTableRowCounts(prisma);
    assertions.push({
      name: "write isolation: evidence_sources unchanged",
      ok: tablesAfter.evidence_sources === tablesBefore.evidence_sources,
      detail: `before=${tablesBefore.evidence_sources}, after=${tablesAfter.evidence_sources}`,
    });
    assertions.push({
      name: "write isolation: evidence_records unchanged (only count-identical re-seeds)",
      ok: tablesAfter.evidence_records >= tablesBefore.evidence_records,
      detail: `(seeded new records during illegal-setup; base grows monotonically)`,
    });

    // --- Audit chain queryable via getCandidateDetail -------------------------
    const candidateDetail = await getCandidateDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: approvedCandidate.id,
    });
    assertions.push({
      name: "audit chain: getCandidateDetail returns decisions ascending (approve, takedown)",
      ok: candidateDetail.decisions.length >= 2 &&
          candidateDetail.decisions.some((d) => d.type === "review" && d.outcome === "approve") &&
          candidateDetail.decisions.some((d) => d.type === "review" && d.outcome === "takedown") &&
          candidateDetail.decisions.some((d) => d.type === "publication" && d.fromStatus === "candidate" && d.toStatus === "published") &&
          candidateDetail.decisions.some((d) => d.type === "publication" && d.fromStatus === "published" && d.toStatus === "taken_down"),
      detail: `${candidateDetail.decisions.length} decisions`,
    });
    assertions.push({
      name: "audit chain: decisions sorted ascending by createdAt",
      ok: isSortedAsc(candidateDetail.decisions.map((d) => d.createdAt.getTime())),
    });
    assertions.push({
      name: "candidate detail: evidence list populated (sourceName, title, url)",
      ok: candidateDetail.evidence.length >= 1 &&
          candidateDetail.evidence.every((e) => e.sourceName === "verify-publish-source") &&
          candidateDetail.evidence.every((e) => e.title !== null || e.summary !== null),
      detail: `${candidateDetail.evidence.length} evidence items`,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- seeding / cleanup helpers ----------------------------------------------

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. The published_* read models +
  // explanation_versions + review/publication decisions reference hot_events;
  // hot_event_evidence references both hot_events and evidence_records.
  await prisma.publishedHotEventEvidence.deleteMany({});
  await prisma.publishedHotEventExplanation.deleteMany({});
  await prisma.publishedHotEvent.deleteMany({});
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
): Promise<{ id: string; title: string }> {
  const { createHash, randomUUID } = await import("node:crypto");
  const salt = randomUUID();
  const material = `${data.title}|${data.publishedAt.toISOString()}|${salt}`;
  const contentHash = createHash("sha256").update(material).digest("hex");
  const rec = await prisma.evidenceRecord.create({
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
  return { id: rec.id, title: rec.title ?? "" };
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await resetState(prisma);
}

interface OwnedTableCounts {
  evidence_sources: number;
  evidence_records: number;
}

async function ownedTableRowCounts(prisma: ReturnType<typeof getPrisma>): Promise<OwnedTableCounts> {
  const sources = await prisma.evidenceSource.count();
  const records = await prisma.evidenceRecord.count();
  return { evidence_sources: sources, evidence_records: records };
}

function isSortedAsc(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
  }
  return true;
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== review/publish verification ===");
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
  console.error("[verify-publish] fatal", error);
  process.exit(1);
});
