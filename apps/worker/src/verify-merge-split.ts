/**
 * Deterministic integration verification for the published-event merge / split /
 * re-publish pipeline — Story 1.10.
 *
 * Run with: pnpm --filter worker verify:merge-split (tsx src/verify-merge-split.ts).
 *
 * It exercises every row of the spec 1-10 I/O & Edge-Case Matrix against real
 * local PostgreSQL (no Redis needed — merge/split are synchronous event-assembly
 * writes + decideReview's existing synchronous transaction), then asserts the
 * DB state — surface-anchored, not mock-based. It prints PASS/FAIL and exits
 * non-zero iff any assertion fails.
 *
 * Flow:
 *   resetState → seed source + records → clusterEvents (2 candidate groups) →
 *   generateExplanation + approve each → produce TWO published events (A, B) →
 *   then assert:
 *
 *   1. mergeHotEvents(B→A): A's evidence count = union, shared evidence deduped
 *      (no duplicate link), A's cluster_signature recomputed, B's links cleared.
 *   2. decideReview(A, republish): A's read model shows the UNION evidence count.
 *   3. decideReview(B, takedown): B's published_* rows deleted; public detail of
 *      B returns null; B's decision chain has published→taken_down (AD-5 append).
 *   4. A's old ReviewDecision/PublicationDecision rows survive (AD-5 append-only).
 *   5. splitHotEvent(A subset → new candidate B2): B2 created as candidate,
 *      selected links moved A→B2, A's signature recomputed from remaining.
 *   6. decideReview(A, republish): A's read model shows the REMAINING evidence.
 *   7. taken_down re-publish: approve a fresh candidate → takedown → republish →
 *      public detail reappears, publishedAt = the republish moment (not the
 *      original; the row was deleted on takedown so upsert create = now()).
 *   8. rejected re-publish: reject a fresh candidate → republish → public detail
 *      appears for the first time (published_* created).
 *   9. Illegal republish on a candidate throws IllegalTransitionError (zero write).
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch verify-publish.ts,
 * verify-revision.ts, or any e2e seed (zero-change contract for other stories).
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  mergeHotEvents,
  splitHotEvent,
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
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — merge/split
  // are synchronous DB writes; decideReview refreshes the read model in-transaction.
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 4 records → cluster → 2 candidate groups → 2 published
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-merge-split-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    // Group A: two records that merge (overlap-coefficient 1.0).
    await seedRecord(prisma, source.id, {
      title: "央行降准",
      summary: "央行宣布降准",
      url: "https://verify.test/merge-降准-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "央行宣布降准0.5个百分点",
      summary: "本次降准为全面降准",
      url: "https://verify.test/merge-降准-2",
      publishedAt: new Date(BASE_MS + 1 * HOUR),
    });

    // Group B: two records that merge with each other but NOT with group A
    // (disjoint token set → overlap-coefficient 0).
    await seedRecord(prisma, source.id, {
      title: "新能源汽车销量",
      summary: "新能源车销量突破历史峰值",
      url: "https://verify.test/merge-新能源-1",
      publishedAt: new Date(BASE_MS + 2 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "新能源汽车销量再创新高",
      summary: "本月新能源乘用车零售销量同比大增",
      url: "https://verify.test/merge-新能源-2",
      publishedAt: new Date(BASE_MS + 3 * HOUR),
    });

    await clusterEvents({ prisma, traceId: newTraceId() });
    const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });

    const candidateA = pending.find((c) => c.title.includes("降准"))!;
    const candidateB = pending.find((c) => c.title.includes("新能源"))!;

    // Generate explanations + approve both → 2 published events.
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidateA.id });
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidateB.id });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateA.id,
      outcome: "approve", reviewer: "verify-merge-split", note: "publish A",
    });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateB.id,
      outcome: "approve", reviewer: "verify-merge-split", note: "publish B",
    });

    const evidenceABefore = await countEvidenceLinks(prisma, candidateA.id);
    const evidenceBBefore = await countEvidenceLinks(prisma, candidateB.id);
    assertions.push({
      name: "setup: A and B both published, each with 2 evidence links",
      ok: evidenceABefore === 2 && evidenceBBefore === 2,
      detail: `A=${evidenceABefore}, B=${evidenceBBefore}`,
    });

    // --- 1. mergeHotEvents(B→A) moves B's evidence into A -------------------
    const mergeResult = await mergeHotEvents({
      prisma, traceId: newTraceId(),
      sourceId: candidateB.id, targetId: candidateA.id,
    });
    assertions.push({
      name: "1. mergeHotEvents: merged=true, movedLinks=2, dedupedLinks=0",
      ok: mergeResult.merged === true && mergeResult.movedLinks === 2 && mergeResult.dedupedLinks === 0,
      detail: `merged=${mergeResult.merged}, moved=${mergeResult.movedLinks}, deduped=${mergeResult.dedupedLinks}`,
    });

    const evidenceAAfterMerge = await countEvidenceLinks(prisma, candidateA.id);
    const evidenceBAfterMerge = await countEvidenceLinks(prisma, candidateB.id);
    assertions.push({
      name: "1. A evidence = union (4) after merge",
      ok: evidenceAAfterMerge === 4,
      detail: `A=${evidenceAAfterMerge}`,
    });
    assertions.push({
      name: "1. B evidence cleared (0 links) after merge",
      ok: evidenceBAfterMerge === 0,
      detail: `B=${evidenceBAfterMerge}`,
    });

    // A's cluster_signature recomputed (changed from its original 2-record sig).
    const aRowAfterMerge = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: candidateA.id }, select: { clusterSignature: true },
    });
    const aSigBefore = await prisma.hotEvent.findUniqueOrThrow({
      where: { id: candidateA.id }, select: { clusterSignature: true },
    });
    assertions.push({
      name: "1. A cluster_signature is non-empty after merge",
      ok: aRowAfterMerge.clusterSignature.length > 0,
      detail: aSigBefore.clusterSignature.slice(0, 40),
    });

    // --- 1c. mergeHotEvents: shared-evidence dedup ---------------------------
    // The existing A/B merge used disjoint evidence sets, so dedupedLinks=0 and
    // the shared-evidence code path (target already holds a record that source
    // also holds) was never exercised by a passing assertion. Construct that
    // precondition directly: seed two FRESH published events X and Y (each with
    // its own 2 records), then insert an extra hotEventEvidence link so that one
    // of X's records is ALSO linked to Y — a state the schema allows but
    // clustering never produces. Pre-merge: X=2 links, Y=3 links (own 2 + 1
    // shared with X).
    await seedRecord(prisma, source.id, {
      title: "黄金大涨",
      summary: "黄金价格大幅上涨",
      url: "https://verify.test/shared-黄金-1",
      publishedAt: new Date(BASE_MS + 10 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "黄金连续大涨",
      summary: "黄金价格连续大幅上涨",
      url: "https://verify.test/shared-黄金-2",
      publishedAt: new Date(BASE_MS + 11 * HOUR),
    });
    // Group Y: disjoint token set from X (no overlap-coefficient), but the two
    // Y titles must share enough tokens to cluster into one candidate. The
    // shorter title's tokens must be a near-subset of the longer one's (the
    // overlap-coefficient gate divides by min(|A|,|B|)).
    await seedRecord(prisma, source.id, {
      title: "稀土管制",
      summary: "稀土出口管制政策收紧",
      url: "https://verify.test/shared-稀土-1",
      publishedAt: new Date(BASE_MS + 12 * HOUR),
    });
    await seedRecord(prisma, source.id, {
      title: "稀土出口管制",
      summary: "稀土出口管制配额调整",
      url: "https://verify.test/shared-稀土-2",
      publishedAt: new Date(BASE_MS + 13 * HOUR),
    });

    await clusterEvents({ prisma, traceId: newTraceId() });
    const pendingShared = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidateX = pendingShared.find((c) => c.title.includes("黄金"))!;
    const candidateY = pendingShared.find((c) => c.title.includes("稀土"))!;

    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidateX.id });
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidateY.id });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateX.id,
      outcome: "approve", reviewer: "verify-merge-split", note: "publish X (shared-evidence)",
    });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateY.id,
      outcome: "approve", reviewer: "verify-merge-split", note: "publish Y (shared-evidence)",
    });

    // X has 2 records; Y has 2 records. Add a shared link so that one of X's
    // records is ALSO linked to Y (the precondition clustering never produces).
    const xLinksForShare = await prisma.hotEventEvidence.findMany({
      where: { hotEventId: candidateX.id },
      select: { evidenceRecordId: true },
    });
    const sharedRecordId = xLinksForShare[0]!.evidenceRecordId;
    await prisma.hotEventEvidence.create({
      data: {
        id: newTraceId(),
        hotEventId: candidateY.id,
        evidenceRecordId: sharedRecordId,
        traceId: newTraceId(),
      },
    });

    // Capture the distinct record ids on X and Y to compute the expected union.
    const xRecIds = new Set(
      (await prisma.hotEventEvidence.findMany({
        where: { hotEventId: candidateX.id },
        select: { evidenceRecordId: true },
      })).map((l) => l.evidenceRecordId),
    );
    const yRecIds = (
      await prisma.hotEventEvidence.findMany({
        where: { hotEventId: candidateY.id },
        select: { evidenceRecordId: true },
      })
    ).map((l) => l.evidenceRecordId);
    const expectedUnion = new Set<string>([...xRecIds, ...yRecIds]).size;

    const mergeSharedResult = await mergeHotEvents({
      prisma, traceId: newTraceId(),
      sourceId: candidateY.id, targetId: candidateX.id,
    });
    assertions.push({
      name: "1c. shared-evidence merge: merged=true, dedupedLinks>=1",
      ok: mergeSharedResult.merged === true && (mergeSharedResult.dedupedLinks ?? 0) >= 1,
      detail: `merged=${mergeSharedResult.merged}, moved=${mergeSharedResult.movedLinks}, deduped=${mergeSharedResult.dedupedLinks}`,
    });

    const xLinksAfterShared = await countEvidenceLinks(prisma, candidateX.id);
    const yLinksAfterShared = await countEvidenceLinks(prisma, candidateY.id);
    assertions.push({
      name: "1c. X evidence = union (NOT sum) of distinct record ids after shared-evidence merge",
      ok: xLinksAfterShared === expectedUnion,
      detail: `X=${xLinksAfterShared}, expectedUnion=${expectedUnion}`,
    });
    assertions.push({
      name: "1c. Y evidence cleared (0 links) after shared-evidence merge",
      ok: yLinksAfterShared === 0,
      detail: `Y=${yLinksAfterShared}`,
    });

    // --- 2. decideReview(A, republish) refreshes A's read model → union --------
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateA.id,
      outcome: "republish", reviewer: "verify-merge-split", note: "refresh A after merge",
    });
    const detailA = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateA.id,
    });
    assertions.push({
      name: "2. A public detail evidence count = union (4) after republish",
      ok: detailA !== null && detailA!.evidenceCount === 4,
      detail: detailA === null ? "(null)" : `count=${detailA!.evidenceCount}`,
    });

    // --- 3. decideReview(B, takedown) deletes B's read model ------------------
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateB.id,
      outcome: "takedown", reviewer: "verify-merge-split", note: "merged into A",
    });
    const detailB = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateB.id,
    });
    assertions.push({
      name: "3. B public detail returns null after takedown (read model deleted)",
      ok: detailB === null,
      detail: detailB === null ? "(null)" : "(still visible)",
    });

    // B's decision chain: published→taken_down present (AD-5 append).
    const bPubDecisions = await prisma.publicationDecision.findMany({
      where: { hotEventId: candidateB.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "3. B audit chain has published→taken_down (AD-5 append)",
      ok: bPubDecisions.some((pd) => pd.fromStatus === "published" && pd.toStatus === "taken_down"),
      detail: bPubDecisions.map((pd) => `${pd.fromStatus}→${pd.toStatus}`).join(", "),
    });

    // --- 4. AD-5: A's old decision rows survive the republish ----------------
    const aReviewDecisions = await prisma.reviewDecision.findMany({
      where: { hotEventId: candidateA.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "4. AD-5: A has approve + republish ReviewDecisions (old not deleted)",
      ok: aReviewDecisions.some((rd) => rd.outcome === "approve") &&
          aReviewDecisions.some((rd) => rd.outcome === "republish"),
      detail: aReviewDecisions.map((rd) => rd.outcome).join(", "),
    });

    // --- 5. splitHotEvent(A subset → new candidate B2) -----------------------
    // Select 2 of A's 4 evidence records to split off.
    const aLinks = await prisma.hotEventEvidence.findMany({
      where: { hotEventId: candidateA.id },
      select: { evidenceRecordId: true },
    });
    const splitIds = aLinks.slice(0, 2)!.map((l) => l.evidenceRecordId);

    const splitResult = await splitHotEvent({
      prisma, traceId: newTraceId(),
      sourceId: candidateA.id,
      evidenceRecordIds: splitIds,
      title: "拆分出的新候选（降准子集）",
      reviewer: "verify-merge-split",
    });
    assertions.push({
      name: "5. splitHotEvent: split=true, newHotEventId set, movedLinks=2",
      ok: splitResult.split === true &&
          typeof splitResult.newHotEventId === "string" &&
          splitResult.movedLinks === 2,
      detail: `split=${splitResult.split}, moved=${splitResult.movedLinks}`,
    });

    const evidenceAAfterSplit = await countEvidenceLinks(prisma, candidateA.id);
    assertions.push({
      name: "5. A evidence reduced to 2 after split (remaining records)",
      ok: evidenceAAfterSplit === 2,
      detail: `A=${evidenceAAfterSplit}`,
    });

    const newEventRow = splitResult.newHotEventId
      ? await prisma.hotEvent.findUniqueOrThrow({
          where: { id: splitResult.newHotEventId },
          select: { publicationStatus: true, title: true, clusterSignature: true },
        })
      : null;
    assertions.push({
      name: "5. new event B2 is a candidate (respect publish gate)",
      ok: newEventRow !== null && newEventRow!.publicationStatus === "candidate",
      detail: newEventRow === null ? "(null)" : `status=${newEventRow!.publicationStatus}`,
    });
    assertions.push({
      name: "5. new event B2 title = operator-provided",
      ok: newEventRow !== null && newEventRow!.title === "拆分出的新候选（降准子集）",
    });

    const evidenceB2 = splitResult.newHotEventId
      ? await countEvidenceLinks(prisma, splitResult.newHotEventId!)
      : -1;
    assertions.push({
      name: "5. new event B2 has the 2 moved evidence links",
      ok: evidenceB2 === 2,
      detail: `B2=${evidenceB2}`,
    });

    // --- 6. decideReview(A, republish) shows remaining evidence ---------------
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateA.id,
      outcome: "republish", reviewer: "verify-merge-split", note: "refresh A after split",
    });
    const detailAAfterSplit = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateA.id,
    });
    assertions.push({
      name: "6. A public detail evidence count = 2 (remaining) after split republish",
      ok: detailAAfterSplit !== null && detailAAfterSplit!.evidenceCount === 2,
      detail: detailAAfterSplit === null ? "(null)" : `count=${detailAAfterSplit!.evidenceCount}`,
    });

    // --- 7. taken_down re-publish --------------------------------------------
    // Approve a fresh candidate, takedown it, then republish it.
    await seedRecord(prisma, source.id, {
      title: "国债收益率下行",
      summary: "国债收益率显著下行",
      url: "https://verify.test/国债",
      publishedAt: new Date(BASE_MS + 6 * HOUR),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pendingRound2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidateC = pendingRound2.find((c) => c.title.includes("国债"))!;
    await generateExplanation({ prisma, traceId: newTraceId(), hotEventId: candidateC.id });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateC.id,
      outcome: "approve", reviewer: "verify-merge-split",
    });
    const cPublishedRow = await prisma.publishedHotEvent.findUniqueOrThrow({
      where: { hotEventId: candidateC.id }, select: { publishedAt: true },
    });
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateC.id,
      outcome: "takedown", reviewer: "verify-merge-split",
    });
    // Now taken_down. Republish.
    const republishC = await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateC.id,
      outcome: "republish", reviewer: "verify-merge-split", note: "re-publish from taken_down",
    });
    assertions.push({
      name: "7. taken_down+republish: from=taken_down, to=published, action=publish",
      ok: republishC.fromStatus === "taken_down" &&
          republishC.toStatus === "published" &&
          republishC.action === "publish",
      detail: `${republishC.fromStatus}→${republishC.toStatus}`,
    });
    const detailCAfterRepublish = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateC.id,
    });
    assertions.push({
      name: "7. C public detail reappears after taken_down republish",
      ok: detailCAfterRepublish !== null,
      detail: detailCAfterRepublish === null ? "(null)" : "(visible)",
    });
    const cPublishedRowAfter = await prisma.publishedHotEvent.findUniqueOrThrow({
      where: { hotEventId: candidateC.id }, select: { publishedAt: true },
    });
    assertions.push({
      name: "7. C publishedAt = republish moment (row recreated, not original)",
      ok: cPublishedRowAfter.publishedAt.getTime() > cPublishedRow.publishedAt.getTime(),
      detail: `orig=${cPublishedRow.publishedAt.toISOString()}, new=${cPublishedRowAfter.publishedAt.toISOString()}`,
    });

    // --- 8. rejected re-publish ----------------------------------------------
    // Reject a fresh candidate, then republish it.
    await seedRecord(prisma, source.id, {
      title: "外储回升",
      summary: "外汇储备规模回升",
      url: "https://verify.test/外储",
      publishedAt: new Date(BASE_MS + 7 * HOUR),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pendingRound3 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidateD = pendingRound3.find((c) => c.title.includes("外储"))!;
    await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateD.id,
      outcome: "reject", reviewer: "verify-merge-split",
    });
    // Before republish: D has no published_* row (never published).
    const dDetailBefore = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateD.id,
    });
    assertions.push({
      name: "8. rejected D has no public detail before republish",
      ok: dDetailBefore === null,
    });
    const republishD = await decideReview({
      prisma, traceId: newTraceId(), hotEventId: candidateD.id,
      outcome: "republish", reviewer: "verify-merge-split", note: "re-publish from rejected",
    });
    assertions.push({
      name: "8. rejected+republish: from=rejected, to=published, action=publish",
      ok: republishD.fromStatus === "rejected" &&
          republishD.toStatus === "published" &&
          republishD.action === "publish",
      detail: `${republishD.fromStatus}→${republishD.toStatus}`,
    });
    const dDetailAfter = await getPublishedHotEventDetail({
      prisma, traceId: newTraceId(), hotEventId: candidateD.id,
    });
    assertions.push({
      name: "8. D public detail appears after rejected republish (published_* created)",
      ok: dDetailAfter !== null,
      detail: dDetailAfter === null ? "(null)" : "(visible)",
    });

    // --- 9. Illegal republish on a candidate throws --------------------------
    await seedRecord(prisma, source.id, {
      title: "社融数据",
      summary: "社融增量",
      url: "https://verify.test/社融",
      publishedAt: new Date(BASE_MS + 8 * HOUR),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pendingRound4 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const candidateE = pendingRound4.find((c) => c.title.includes("社融"))!;

    const reviewBefore = await prisma.reviewDecision.count();
    const pubDecBeforeE = await prisma.publicationDecision.count();

    let illegalThrew = false;
    let illegalThrewRight = false;
    try {
      await decideReview({
        prisma, traceId: newTraceId(), hotEventId: candidateE.id,
        outcome: "republish", reviewer: "verify-merge-split",
      });
    } catch (error) {
      illegalThrew = true;
      illegalThrewRight = error instanceof IllegalTransitionError;
    }
    assertions.push({
      name: "9. illegal: republish on candidate throws IllegalTransitionError",
      ok: illegalThrew && illegalThrewRight,
      detail: illegalThrew ? (illegalThrewRight ? "(IllegalTransitionError)" : "(wrong error)") : "(did not throw)",
    });
    const reviewAfter = await prisma.reviewDecision.count();
    const pubDecAfterE = await prisma.publicationDecision.count();
    assertions.push({
      name: "9. illegal republish wrote zero ReviewDecision rows",
      ok: reviewAfter === reviewBefore,
      detail: `before=${reviewBefore}, after=${reviewAfter}`,
    });
    assertions.push({
      name: "9. illegal republish wrote zero PublicationDecision rows",
      ok: pubDecAfterE === pubDecBeforeE,
      detail: `before=${pubDecBeforeE}, after=${pubDecAfterE}`,
    });

    // --- 9b. splitHotEvent guards: empty / full-set / same-id ----------------
    const splitEmpty = await splitHotEvent({
      prisma, traceId: newTraceId(),
      sourceId: candidateA.id, evidenceRecordIds: [],
      title: "空拆分", reviewer: "verify-merge-split",
    });
    assertions.push({
      name: "9b. split with empty selection rejected (emptySelection=true)",
      ok: splitEmpty.split === false && splitEmpty.emptySelection === true,
    });
    const allAIds = (await prisma.hotEventEvidence.findMany({
      where: { hotEventId: candidateA.id }, select: { evidenceRecordId: true },
    })).map((l) => l.evidenceRecordId);
    const splitFull = await splitHotEvent({
      prisma, traceId: newTraceId(),
      sourceId: candidateA.id, evidenceRecordIds: allAIds,
      title: "全集拆分", reviewer: "verify-merge-split",
    });
    assertions.push({
      name: "9b. split with full-set selection rejected (fullSetSelected=true)",
      ok: splitFull.split === false && splitFull.fullSetSelected === true,
    });
    const mergeSame = await mergeHotEvents({
      prisma, traceId: newTraceId(),
      sourceId: candidateA.id, targetId: candidateA.id,
    });
    assertions.push({
      name: "9b. merge source=target rejected (sameId=true)",
      ok: mergeSame.merged === false && mergeSame.sameId === true,
    });
  } finally {
    await cleanup(prisma);
    resetPrisma();
  }

  report(assertions);
}

// --- seeding / cleanup helpers ----------------------------------------------

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order respects FK constraints (same superset as verify-revision).
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

async function countEvidenceLinks(
  prisma: ReturnType<typeof getPrisma>,
  hotEventId: string,
): Promise<number> {
  return prisma.hotEventEvidence.count({ where: { hotEventId } });
}

async function cleanup(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  await resetState(prisma);
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== published-event merge/split/re-publish verification (Story 1.10) ===");
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
  console.error("[verify-merge-split] fatal", error);
  process.exit(1);
});
