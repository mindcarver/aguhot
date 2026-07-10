/**
 * Deterministic integration verification for the concept/industry/stock
 * association generation pipeline — Story 2.2.
 *
 * Run with: pnpm --filter worker verify:associations (tsx src/verify-associations.ts).
 *
 * It exercises generateAssociations with the StubAssociationAdapter (test-only,
 * imported from core — NOT wired in the worker/prod runtime: epic lists NO
 * association-generation BullMQ job category, so apps/worker does NOT import the
 * stub) against real local PostgreSQL (NO Redis needed — generateAssociations is
 * pure logic + a DB append, no BullMQ queue, same convention as
 * verify-explain/verify-market-reaction calling generateExplanation/
 * generateMarketReaction directly), then asserts the DB state — surface-
 * anchored, not mock-based. It prints PASS/FAIL and exits non-zero iff any
 * assertion fails.
 *
 * Flow:
 *   resetState → seed one source + archived records → clusterEvents (candidate)
 *   → generateExplanation → decideReview(approve) → published →
 *   generateAssociations({adapter: StubAssociationAdapter}) → refresh(publish)
 *   → assert:
 *
 * Assertions:
 *   1. generateAssociations appends one set row (source="template", traceId),
 *      items has >=1 item, every item has non-empty kind/label/mappingBasis.
 *   2. After refresh(publish), published_hot_event_associations projects the
 *      set; getPublishedHotEventDetail returns non-null `associations` (items).
 *   3. AD-5 append-only: a second generateAssociations appends a SECOND row
 *      (the first untouched); refresh projects the latest (generatedAt = gen2,
 *      items = gen2 items).
 *   4. adapter missing → generateAssociations returns null, writes nothing.
 *   5. adapter returns [] → generateAssociations returns null, writes nothing.
 *   6. AC2: an adapter item missing mappingBasis → generateAssociations THROWS
 *      (fail-fast, never silently fills a default basis).
 *   7. NFR: no investment-advice wording (buy/sell/target-price/position) in any
 *      item label.
 *   8. takedown clears published_hot_event_associations (5th table) and
 *      getPublishedHotEventDetail returns null (404, no leak).
 *   9. listPublishedAssociations returns the projected row (feed filter source).
 */

import {
  clusterEvents,
  decideReview,
  generateAssociations,
  generateExplanation,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  listPublishedAssociations,
  newTraceId,
  refreshPublishedReadModel,
  resetPrisma,
  StubAssociationAdapter,
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
const DAY = 24 * HOUR;

async function main(): Promise<void> {
  // Resolve infra (Block-If: PG must be reachable). No Redis needed — the
  // derivation is pure logic + a DB append, no BullMQ queue (Story 2.2 has NO
  // worker).
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  const assertions: Assertion[] = [];

  try {
    await resetState(prisma);

    // --- Seed: one source + 2 archived records → clusterEvents → 1 candidate --
    // Two records whose titles are strict subsets of one another so they merge
    // into ONE candidate via overlap-coefficient (each scores 1.0 against the
    // accumulated signature).
    const source = await prisma.evidenceSource.create({
      data: {
        id: newTraceId(),
        name: "verify-associations-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

    await seedRecord(prisma, source.id, {
      title: "半导体涨价",
      summary: "半导体产业链涨价",
      url: "https://verify.test/半导体-1",
      publishedAt: new Date(BASE_MS),
    });
    await seedRecord(prisma, source.id, {
      title: "半导体产业链涨价持续",
      summary: "本轮半导体涨价覆盖芯片设计封测",
      url: "https://verify.test/半导体-2",
      publishedAt: new Date(BASE_MS + 1 * DAY),
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
        `[verify-associations] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // --- Publish the candidate (associations are projected at publish time) ---
    // generateExplanation before approve (so the detail read model is complete),
    // then decideReview(approve) to flip to published.
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
      reviewer: "verify-associations",
      note: "publish for associations verify",
    });

    // --- 1 + 2: generateAssociations appends one set, projects, detail --
    // The StubAssociationAdapter returns a fixed non-null AssociationItem[]
    // (concept=半导体, industry=芯片, stock=中芯国际, each mappingBasis=
    // "knowledge_base:v1"). generateAssociations normalizes and appends one row.
    const adapter = new StubAssociationAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateAssociations({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateAssociations returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "items has >=1 item with non-empty kind/label/mappingBasis",
        ok:
          gen1.items.length >= 1 &&
          gen1.items.every(
            (it) =>
              (it.kind === "concept" ||
                it.kind === "industry" ||
                it.kind === "stock") &&
              it.label.trim() !== "" &&
              it.mappingBasis.trim() !== "",
          ),
        detail: `items=${gen1.items.map((i) => `${i.kind}:${i.label}`).join(",")}`,
      });
      assertions.push({
        name: "generateAssociations result carries source=template + traceId",
        ok: gen1.source === "template" && gen1.traceId === genTrace,
        detail: `source=${gen1.source}`,
      });
      // NFR: no investment-advice wording in any label.
      assertions.push({
        name: "NFR: no buy/sell/target-price/position wording in any item label",
        ok: gen1.items.every((it) => noInvestAdvice(it.label)),
        detail: "(checked 买卖/目标价/持仓/买入/卖出/增持/减持 keywords)",
      });
    }

    const setsAfter1 = await prisma.eventAssociationSet.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "event_association_sets row appended (count=1, source=template)",
      ok: setsAfter1 === 1,
      detail: `count=${setsAfter1}`,
    });

    const row1 = await prisma.eventAssociationSet.findFirst({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=template, traceId carried",
      ok: row1 !== null && row1!.source === "template" && row1!.traceId === genTrace,
    });

    // Refresh the public projection so the set flows into
    // published_hot_event_associations.
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });

    const associationRow = await prisma.publishedHotEventAssociation.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "published_hot_event_associations row projected after refresh",
      ok: associationRow !== null && associationRow!.associationSource === "template",
      detail:
        associationRow === null
          ? "(no row)"
          : `source=${associationRow!.associationSource}`,
    });

    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "detail.associations non-null after projection (items carry through)",
      ok:
        detail !== null &&
        detail!.associations !== null &&
        detail!.associations!.items.length >= 1 &&
        detail!.associations!.items.every(
          (it) => it.label.trim() !== "" && it.mappingBasis.trim() !== "",
        ),
      detail:
        detail === null || detail!.associations === null
          ? "(null detail/associations)"
          : `items=${detail!.associations!.items.map((i) => `${i.kind}:${i.label}`).join(",")}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row --
    await sleep(20);
    const gen2 = await generateAssociations({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const setsAfter2 = await prisma.eventAssociationSet.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "AD-5 append-only: second call appends a second row (first untouched)",
      ok: setsAfter2 === 2 && gen2 !== null,
      detail: `count=${setsAfter2}`,
    });

    // Refresh projects the LATEST set (generatedAt = gen2.createdAt, items = gen2).
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
    const detailAfterGen2 = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "refresh projects the LATEST set (generatedAt = gen2.createdAt)",
      ok:
        gen2 !== null &&
        detailAfterGen2 !== null &&
        detailAfterGen2!.associations !== null &&
        detailAfterGen2!.associations!.generatedAt.getTime() ===
          gen2.createdAt.getTime(),
      detail:
        gen2 === null || detailAfterGen2?.associations === null
          ? "(gen2 or projection null)"
          : `projected generatedAt=${detailAfterGen2!.associations!.generatedAt.toISOString()} vs gen2=${gen2.createdAt.toISOString()}`,
    });

    // --- 4: adapter missing → returns null, writes nothing --
    // Create a second published event to test the no-adapter path on a clean
    // event (so the set count baseline is 0).
    await seedRecord(prisma, source.id, {
      title: "美股大跌三大股指重挫",
      summary: "美股暴跌",
      url: "https://verify.test/美股",
      publishedAt: new Date(BASE_MS + 2 * DAY),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pending2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const usMarket = pending2.find((c) => c.title.includes("美股"))!;
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      outcome: "approve",
      reviewer: "verify-associations",
      note: "publish for no-adapter verify",
    });

    const noAdapter = await generateAssociations({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      // adapter omitted → V1 prod path (no worker, no provider) → returns null.
    });
    const noAdapterSets = await prisma.eventAssociationSet.count({
      where: { hotEventId: usMarket.id },
    });
    assertions.push({
      name: "adapter missing: generateAssociations returns null",
      ok: noAdapter === null,
    });
    assertions.push({
      name: "adapter missing: no event_association_sets row written",
      ok: noAdapterSets === 0,
      detail: `count=${noAdapterSets}`,
    });

    // --- 5: adapter returns [] → returns null, writes nothing --
    const emptyAdapter: { fetchAssociations: () => Promise<never[]> } = {
      fetchAssociations: async () => [],
    };
    const emptyResult = await generateAssociations({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      adapter: emptyAdapter as never,
    });
    const emptySets = await prisma.eventAssociationSet.count({
      where: { hotEventId: usMarket.id },
    });
    assertions.push({
      name: "adapter returns []: generateAssociations returns null",
      ok: emptyResult === null,
    });
    assertions.push({
      name: "adapter returns []: no event_association_sets row written",
      ok: emptySets === 0,
      detail: `count=${emptySets}`,
    });

    // --- 6: AC2 — adapter returns an item missing mappingBasis → THROWS --
    const basisLessAdapter: {
      fetchAssociations: () => Promise<
        { kind: string; label: string; mappingBasis: string }[]
      >;
    } = {
      fetchAssociations: async () => [
        { kind: "concept", label: "无依据概念", mappingBasis: "" },
      ],
    };
    let threw = false;
    try {
      await generateAssociations({
        prisma,
        traceId: newTraceId(),
        hotEventId: usMarket.id,
        adapter: basisLessAdapter as never,
      });
    } catch {
      threw = true;
    }
    const basisLessSets = await prisma.eventAssociationSet.count({
      where: { hotEventId: usMarket.id },
    });
    assertions.push({
      name: "AC2: missing mappingBasis → generateAssociations throws (fail-fast)",
      ok: threw,
    });
    assertions.push({
      name: "AC2: missing mappingBasis → no row written",
      ok: basisLessSets === 0,
      detail: `count=${basisLessSets}`,
    });

    // --- 7: NFR already asserted inline above per-item; re-check the projected row --
    const projectedRow = await prisma.publishedHotEventAssociation.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "NFR: projected association items have no investment-advice keywords",
      ok:
        projectedRow !== null &&
        (projectedRow!.items as Array<{ label: string }>).every((it) =>
          noInvestAdvice(it.label),
        ),
    });

    // --- 8: takedown clears published_hot_event_associations (5th table) + detail null --
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "takedown",
      reviewer: "verify-associations",
      note: "takedown for association-clear verify",
    });
    const associationRowAfterTakedown =
      await prisma.publishedHotEventAssociation.findUnique({
        where: { hotEventId: candidate.id },
      });
    assertions.push({
      name: "takedown cleared published_hot_event_associations (no stale row)",
      ok: associationRowAfterTakedown === null,
    });
    const detailAfterTakedown = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "takedown: getPublishedHotEventDetail returns null (no leak, AD-8)",
      ok: detailAfterTakedown === null,
    });

    // --- 9: listPublishedAssociations returns the projected row (before takedown) --
    // Re-publish the US event + generate associations to test listPublishedAssociations
    // on a populated projection (the candidate was taken down above).
    await generateAssociations({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      adapter,
    });
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: usMarket.id,
      action: "publish",
    });
    const listResult = await listPublishedAssociations({
      prisma,
      traceId: newTraceId(),
    });
    const usAssoc = listResult.find((r) => r.hotEventId === usMarket.id);
    assertions.push({
      name: "listPublishedAssociations returns the projected row (feed filter source)",
      ok:
        usAssoc !== undefined &&
        usAssoc.items.length >= 1 &&
        usAssoc.items.every((it) => it.mappingBasis.trim() !== ""),
      detail:
        usAssoc === undefined
          ? "(no row for usMarket)"
          : `items=${usAssoc.items.map((i) => `${i.kind}:${i.label}`).join(",")}`,
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
 * product must not imply investment advice). The check is conservative — these
 * are the common buy/sell/target-price/position terms. Association item labels
 * are descriptive (entity identity), never advisory.
 */
const ADVICE_KEYWORDS = ["买入", "卖出", "目标价", "持仓", "增持", "减持", "建议买", "建议卖"];

function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. published_hot_event_associations +
  // event_association_sets + published_hot_event_reactions +
  // market_reaction_snapshots + explanation_versions + published_* new tables
  // reference hot_events; hot_event_evidence references both. hot_event_revisions
  // (Story 1.9) has a Restrict FK on hot_events, so it must be cleared before
  // hot_events. The new 2.2 tables (associations/sets) have Cascade FKs but we
  // clear them explicitly before hot_events to keep reset ordering uniform with
  // verify-publish/verify-explain/verify-market-reaction.
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
  console.log("=== associations verification ===");
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
  console.error("[verify-associations] fatal", error);
  process.exit(1);
});
