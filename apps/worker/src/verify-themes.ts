/**
 * Deterministic integration verification for the theme membership generation
 * pipeline + continuity projection — Story 2.3.
 *
 * Run with: pnpm --filter worker verify:themes (tsx src/verify-themes.ts).
 *
 * It exercises generateThemes with the StubThemeAdapter (test-only, imported
 * from core — NOT wired in the worker/prod runtime: the theme-backfill worker
 * resolves adapter = undefined so prod degrades honestly) against real local
 * PostgreSQL (NO Redis needed — generateThemes is pure logic + a DB append, no
 * BullMQ queue at the generator level, same convention as
 * verify-associations/verify-market-reaction calling generateAssociations/
 * generateMarketReaction directly), then asserts the DB state — surface-
 * anchored, not mock-based. It prints PASS/FAIL and exits non-zero iff any
 * assertion fails.
 *
 * Flow:
 *   resetState → seed one source + archived records → clusterEvents (candidate)
 *   → generateExplanation → decideReview(approve) → published →
 *   generateThemes({adapter: StubThemeAdapter}) → refresh(publish)
 *   → assert:
 *
 * Assertions:
 *   1. generateThemes appends one set row (source="template", traceId), items
 *      has >=1 item, every item has non-empty slug/label/mappingBasis.
 *   2. After refresh(publish), published_hot_event_themes projects the set;
 *      getPublishedHotEventDetail returns non-null `themes` (items).
 *   3. AD-5 append-only: a second generateThemes appends a SECOND row (the
 *      first untouched); refresh projects the latest (generatedAt = gen2,
 *      items = gen2 items).
 *   4. adapter missing → generateThemes returns null, writes nothing.
 *   5. adapter returns [] → generateThemes returns null, writes nothing.
 *   6. AC2: an adapter item missing mappingBasis / slug / label → generateThemes
 *      THROWS (fail-fast, never silently fills a default).
 *   7. NFR: no investment-advice wording (buy/sell/target-price/position) in any
 *      item label.
 *   8. takedown clears published_hot_event_themes (6th table) and
 *      getPublishedHotEventDetail returns null (404, no leak).
 *   9. listPublishedThemeMemberships returns the projected row (theme-page
 *      source).
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateThemes,
  getPrisma,
  getPublishedHotEventDetail,
  listPendingCandidates,
  listPublishedThemeMemberships,
  newTraceId,
  refreshPublishedReadModel,
  resetPrisma,
  StubThemeAdapter,
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
  // derivation is pure logic + a DB append. The theme-backfill worker exists
  // (epic-listed job category) but this verify calls generateThemes directly.
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
        name: "verify-themes-source",
        kind: "rss",
        feedUrl: "file:///unused",
        enabled: true,
      },
    });

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
        `[verify-themes] expected 1 candidate, got ${pending.length}`,
      );
    }
    const candidate = pending[0]!;

    // --- Publish the candidate (themes are projected at publish time) ---
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
      reviewer: "verify-themes",
      note: "publish for themes verify",
    });

    // --- 1 + 2: generateThemes appends one set, projects, detail --
    // The StubThemeAdapter returns a fixed non-null ThemeRef[]
    // (slug=chip-supply-chain, label=芯片供应链, mappingBasis="knowledge_base:v1").
    // generateThemes normalizes and appends one row.
    const adapter = new StubThemeAdapter();
    const genTrace = newTraceId();
    const gen1 = await generateThemes({
      prisma,
      traceId: genTrace,
      hotEventId: candidate.id,
      adapter,
    });
    assertions.push({
      name: "generateThemes returns non-null",
      ok: gen1 !== null,
      detail: gen1 === null ? "(null result)" : "(non-null)",
    });

    if (gen1 !== null) {
      assertions.push({
        name: "items has >=1 item with non-empty slug/label/mappingBasis",
        ok:
          gen1.items.length >= 1 &&
          gen1.items.every(
            (it) =>
              it.slug.trim() !== "" &&
              it.label.trim() !== "" &&
              it.mappingBasis.trim() !== "",
          ),
        detail: `items=${gen1.items.map((i) => `${i.slug}:${i.label}`).join(",")}`,
      });
      assertions.push({
        name: "generateThemes result carries source=template + traceId",
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

    const setsAfter1 = await prisma.eventThemeSet.count({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "event_theme_sets row appended (count=1, source=template)",
      ok: setsAfter1 === 1,
      detail: `count=${setsAfter1}`,
    });

    const row1 = await prisma.eventThemeSet.findFirst({
      where: { hotEventId: candidate.id },
      orderBy: { createdAt: "asc" },
    });
    assertions.push({
      name: "appended row: source=template, traceId carried",
      ok: row1 !== null && row1!.source === "template" && row1!.traceId === genTrace,
    });

    // Refresh the public projection so the set flows into
    // published_hot_event_themes.
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });

    const themeRow = await prisma.publishedHotEventTheme.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "published_hot_event_themes row projected after refresh",
      ok: themeRow !== null && themeRow!.themeSource === "template",
      detail:
        themeRow === null ? "(no row)" : `source=${themeRow!.themeSource}`,
    });

    const detail = await getPublishedHotEventDetail({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
    });
    assertions.push({
      name: "detail.themes non-null after projection (items carry through)",
      ok:
        detail !== null &&
        detail!.themes !== null &&
        detail!.themes!.items.length >= 1 &&
        detail!.themes!.items.every(
          (it) => it.slug.trim() !== "" && it.label.trim() !== "" && it.mappingBasis.trim() !== "",
        ),
      detail:
        detail === null || detail!.themes === null
          ? "(null detail/themes)"
          : `items=${detail!.themes!.items.map((i) => `${i.slug}:${i.label}`).join(",")}`,
    });

    // --- 3: AD-5 append-only — calling AGAIN appends a SECOND row --
    await sleep(20);
    const gen2 = await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter,
    });
    const setsAfter2 = await prisma.eventThemeSet.count({
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
        detailAfterGen2!.themes !== null &&
        detailAfterGen2!.themes!.generatedAt.getTime() ===
          gen2.createdAt.getTime(),
      detail:
        gen2 === null || detailAfterGen2?.themes === null
          ? "(gen2 or projection null)"
          : `projected generatedAt=${detailAfterGen2!.themes!.generatedAt.toISOString()} vs gen2=${gen2.createdAt.toISOString()}`,
    });

    // --- 4: adapter missing → returns null, writes nothing --
    // Create a second published event to test the no-adapter path on a clean
    // event (so the set count baseline is 0).
    await seedRecord(prisma, source.id, {
      title: "新能源补贴退坡",
      summary: "新能源补贴政策退坡",
      url: "https://verify.test/新能源",
      publishedAt: new Date(BASE_MS + 2 * DAY),
    });
    await clusterEvents({ prisma, traceId: newTraceId() });
    const pending2 = await listPendingCandidates({ prisma, traceId: newTraceId() });
    const newEnergy = pending2.find((c) => c.title.includes("新能源"))!;
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: newEnergy.id,
      outcome: "approve",
      reviewer: "verify-themes",
      note: "publish for no-adapter verify",
    });

    const noAdapter = await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: newEnergy.id,
      // adapter omitted → V1 prod path (theme-backfill worker resolves none) →
      // returns null.
    });
    const noAdapterSets = await prisma.eventThemeSet.count({
      where: { hotEventId: newEnergy.id },
    });
    assertions.push({
      name: "adapter missing: generateThemes returns null",
      ok: noAdapter === null,
    });
    assertions.push({
      name: "adapter missing: no event_theme_sets row written",
      ok: noAdapterSets === 0,
      detail: `count=${noAdapterSets}`,
    });

    // --- 5: adapter returns [] → returns null, writes nothing --
    const emptyAdapter: { fetchThemes: () => Promise<never[]> } = {
      fetchThemes: async () => [],
    };
    const emptyResult = await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: newEnergy.id,
      adapter: emptyAdapter as never,
    });
    const emptySets = await prisma.eventThemeSet.count({
      where: { hotEventId: newEnergy.id },
    });
    assertions.push({
      name: "adapter returns []: generateThemes returns null",
      ok: emptyResult === null,
    });
    assertions.push({
      name: "adapter returns []: no event_theme_sets row written",
      ok: emptySets === 0,
      detail: `count=${emptySets}`,
    });

    // --- 6: AC2 — adapter returns an item missing mappingBasis / slug / label → THROWS --
    const basisLessAdapter: {
      fetchThemes: () => Promise<
        { slug: string; label: string; mappingBasis: string }[]
      >;
    } = {
      fetchThemes: async () => [
        { slug: "no-basis", label: "无依据主题", mappingBasis: "" },
      ],
    };
    let threwBasis = false;
    try {
      await generateThemes({
        prisma,
        traceId: newTraceId(),
        hotEventId: newEnergy.id,
        adapter: basisLessAdapter as never,
      });
    } catch {
      threwBasis = true;
    }
    const basisLessSets = await prisma.eventThemeSet.count({
      where: { hotEventId: newEnergy.id },
    });
    assertions.push({
      name: "AC2: missing mappingBasis → generateThemes throws (fail-fast)",
      ok: threwBasis,
    });
    assertions.push({
      name: "AC2: missing mappingBasis → no row written",
      ok: basisLessSets === 0,
      detail: `count=${basisLessSets}`,
    });

    // AC2: missing slug → throws
    const noSlugAdapter: {
      fetchThemes: () => Promise<
        { slug: string; label: string; mappingBasis: string }[]
      >;
    } = {
      fetchThemes: async () => [
        { slug: "", label: "无标识主题", mappingBasis: "knowledge_base:v1" },
      ],
    };
    let threwSlug = false;
    try {
      await generateThemes({
        prisma,
        traceId: newTraceId(),
        hotEventId: newEnergy.id,
        adapter: noSlugAdapter as never,
      });
    } catch {
      threwSlug = true;
    }
    assertions.push({
      name: "AC2: missing slug → generateThemes throws (fail-fast)",
      ok: threwSlug,
    });

    // AC2: missing label → throws
    const noLabelAdapter: {
      fetchThemes: () => Promise<
        { slug: string; label: string; mappingBasis: string }[]
      >;
    } = {
      fetchThemes: async () => [
        { slug: "no-label", label: "", mappingBasis: "knowledge_base:v1" },
      ],
    };
    let threwLabel = false;
    try {
      await generateThemes({
        prisma,
        traceId: newTraceId(),
        hotEventId: newEnergy.id,
        adapter: noLabelAdapter as never,
      });
    } catch {
      threwLabel = true;
    }
    assertions.push({
      name: "AC2: missing label → generateThemes throws (fail-fast)",
      ok: threwLabel,
    });

    // AC2: malformed (non-URL-safe) slug → throws (fail-fast). A slug carrying
    // '/', '?', '#', or whitespace would break the /topics/{slug} route; reject
    // it at the gate rather than silently URL-encoding. The throw happens before
    // the append, so no row is written (same guarantee as the missing-field
    // throws above).
    const badSlugAdapter: {
      fetchThemes: () => Promise<
        { slug: string; label: string; mappingBasis: string }[]
      >;
    } = {
      fetchThemes: async () => [
        { slug: "bad/slug", label: "畸形 slug 主题", mappingBasis: "knowledge_base:v1" },
      ],
    };
    let threwBadSlug = false;
    try {
      await generateThemes({
        prisma,
        traceId: newTraceId(),
        hotEventId: newEnergy.id,
        adapter: badSlugAdapter as never,
      });
    } catch {
      threwBadSlug = true;
    }
    assertions.push({
      name: "AC2: malformed slug → generateThemes throws (fail-fast), no row written",
      ok: threwBadSlug,
    });

    // --- 7: NFR already asserted inline above per-item; re-check the projected row --
    const projectedRow = await prisma.publishedHotEventTheme.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "NFR: projected theme items have no investment-advice keywords",
      ok:
        projectedRow !== null &&
        (projectedRow!.items as Array<{ label: string }>).every((it) =>
          noInvestAdvice(it.label),
        ),
    });

    // --- 8: takedown clears published_hot_event_themes (6th table) + detail null --
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      outcome: "takedown",
      reviewer: "verify-themes",
      note: "takedown for theme-clear verify",
    });
    const themeRowAfterTakedown = await prisma.publishedHotEventTheme.findUnique({
      where: { hotEventId: candidate.id },
    });
    assertions.push({
      name: "takedown cleared published_hot_event_themes (no stale row)",
      ok: themeRowAfterTakedown === null,
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

    // --- 9: listPublishedThemeMemberships returns the projected row ---
    // Re-publish the newEnergy event + generate themes to test
    // listPublishedThemeMemberships on a populated projection (the candidate was
    // taken down above). Generate for BOTH newEnergy and re-published candidate
    // so the membership has >=2 events sharing the stub slug (continuity
    // substrate shape — the /topics/[slug] page aggregates them).
    await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: newEnergy.id,
      adapter,
    });
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: newEnergy.id,
      action: "publish",
    });
    const listResult = await listPublishedThemeMemberships({
      prisma,
      traceId: newTraceId(),
    });
    const newEnergyMembership = listResult.find((r) => r.hotEventId === newEnergy.id);
    assertions.push({
      name: "listPublishedThemeMemberships returns the projected row (theme-page source)",
      ok:
        newEnergyMembership !== undefined &&
        newEnergyMembership.items.length >= 1 &&
        newEnergyMembership.items.every(
          (it) => it.slug.trim() !== "" && it.mappingBasis.trim() !== "",
        ),
      detail:
        newEnergyMembership === undefined
          ? "(no row for newEnergy)"
          : `items=${newEnergyMembership.items.map((i) => `${i.slug}:${i.label}`).join(",")}`,
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
 * are the common buy/sell/target-price/position terms. Theme item labels are
 * descriptive (theme concept identity), never advisory.
 */
const ADVICE_KEYWORDS = ["买入", "卖出", "目标价", "持仓", "增持", "减持", "建议买", "建议卖"];

function noInvestAdvice(text: string): boolean {
  return !ADVICE_KEYWORDS.some((k) => text.includes(k));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetState(prisma: ReturnType<typeof getPrisma>): Promise<void> {
  // Order matters for FK constraints. published_hot_event_themes +
  // event_theme_sets + published_hot_event_associations + event_association_sets
  // + published_hot_event_reactions + market_reaction_snapshots +
  // explanation_versions + published_* new tables reference hot_events;
  // hot_event_evidence references both. hot_event_revisions (Story 1.9) has a
  // Restrict FK on hot_events, so it must be cleared before hot_events. The new
  // 2.3 tables (themes/sets) have Cascade FKs but we clear them explicitly
  // before hot_events to keep reset ordering uniform with
  // verify-publish/verify-explain/verify-market-reaction/verify-associations.
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
  console.log("=== themes verification ===");
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
  console.error("[verify-themes] fatal", error);
  process.exit(1);
});
