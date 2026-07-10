/**
 * Seed script for the @themes e2e — Story 2.3.
 *
 * Run with: pnpm --filter web seed:themes
 *           (tsx e2e/seed-themes.ts)
 *
 * Self-contained: produces THREE published events to cover the I/O matrix rows
 * for theme continuity:
 *   - 芯片短缺A (2 evidence rows, earlier) → PUBLISHED WITH generated theme
 *     membership (StubThemeAdapter, test-only) → exercises AC1 (theme page
 *     chronological sequence + member links) + AC4 (detail→theme link).
 *   - 芯片短缺B (1 evidence row, later) → PUBLISHED WITH the SAME stub theme
 *     membership → the /topics/[slug] page aggregates BOTH as a chronological
 *     sequence (>=2 members sharing the stub slug).
 *   - 锂矿 (1 evidence row) → PUBLISHED WITHOUT any theme set → exercises AC3
 *     (honest degraded state "暂无已确认的主题关联。", no theme items).
 * Returns the themed hotEventIds + titles + the no-theme id + the stub slug +
 * label so themes.spec.ts can drive /topics/{slug} + /events/{id} + the
 * detail→theme + theme→detail closed-loop assertions.
 *
 * Requires DATABASE_URL pointing at local PG. Does NOT touch seed-console.ts,
 * seed-feed.ts, seed-detail.ts, seed-market-reaction.ts, seed-associations.ts,
 * or any other seed (zero-change contract). Clears the full table set (including
 * the new 2.3 theme tables) so re-runs are deterministic.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateThemes,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  resetPrisma,
  STUB_THEME_LABEL,
  STUB_THEME_SLUG,
  StubThemeAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export async function seedThemeEvents(): Promise<{
  themeSlug: string;
  themeLabel: string;
  themedHotEventIds: string[];
  themedTitles: string[];
  noThemeHotEventId: string;
  noThemeTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as verify-* scripts + the new 2.3
  // theme tables, order respects FK constraints). hot_event_revisions (Story
  // 1.9) has a Restrict FK on hot_events, so it must be cleared before
  // hot_events. The new 2.3 tables (themes/sets) have Cascade FKs but we clear
  // them explicitly before hot_events to keep reset ordering uniform.
  // Deterministic re-runs; does NOT touch other seeds.
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "themes-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // Three distinct-event record groups → 3 candidates. The 芯片短缺A group is a
  // short-title + long-superset pair (overlap-coefficient = 1.0 → merge) with 2
  // records (earlier evidence). The 芯片短缺B group is a single record (later
  // evidence). Both 芯片短缺 groups get published + themed (sharing the stub
  // slug). The 锂矿 group stays a single record, published but NOT themed.
  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const oneDayAgo = new Date(Date.now() - 1 * DAY);
  const recentAgo = new Date(Date.now() - 2 * HOUR);

  // Group A: 芯片短缺 (earlier evidence — 2 records that merge into 1 event)
  await seedRecord(prisma, source.id, {
    title: "芯片短缺加剧",
    summary: "全球芯片供应链短缺影响多个行业",
    url: `https://verify.test/芯片短缺-1`,
    publishedAt: twoDaysAgo,
  });
  await seedRecord(prisma, source.id, {
    title: "芯片短缺加剧持续蔓延",
    summary: "芯片供应链紧张覆盖汽车手机等行业",
    url: `https://verify.test/芯片短缺-2`,
    publishedAt: oneDayAgo,
  });

  // Group B: 芯片短缺B (later evidence — single record, distinct event)
  await seedRecord(prisma, source.id, {
    title: "芯片代工产能紧张",
    summary: "晶圆代工产能持续紧张",
    url: `https://verify.test/芯片代工`,
    publishedAt: recentAgo,
  });

  // Group C: 锂矿 (no theme — distinct event)
  await seedRecord(prisma, source.id, {
    title: "锂矿资源储量公布",
    summary: "锂矿储量数据公布",
    url: `https://verify.test/锂矿`,
    publishedAt: oneDayAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 3) {
    throw new Error(
      `[seed-themes] expected >= 3 candidates after cluster, got ${pending.length}`,
    );
  }

  const toPublishThemedA = pending.find((c) => c.title.includes("芯片短缺"))!;
  const toPublishThemedB = pending.find((c) => c.title.includes("芯片代工"))!;
  const toPublishNoTheme = pending.find((c) => c.title.includes("锂矿"))!;

  // PUBLISHED WITH themes: generate explanation, approve (flips to published),
  // then generateThemes with the StubThemeAdapter (test-only), then
  // refresh(publish) so the set flows into published_hot_event_themes.
  for (const candidate of [toPublishThemedA, toPublishThemedB]) {
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
      reviewer: "themes-e2e-seeder",
      note: "seed published with themes for themes e2e",
    });
    await generateThemes({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      adapter: new StubThemeAdapter(),
    });
    // Re-refresh to project the appended set into the public read model.
    // (decideReview's internal refresh ran before the set existed; this second
    // refresh projects it — same pattern the associations/market-reaction
    // seeds use.)
    const { refreshPublishedReadModel } = await import("@aguhot/core");
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: candidate.id,
      action: "publish",
    });
  }

  // PUBLISHED WITHOUT themes: generate explanation + approve directly (no
  // generateThemes) → the detail read model has a summary row but NO theme
  // projection row, so the detail page renders the degraded state (AC3).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishNoTheme.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublishNoTheme.id,
    outcome: "approve",
    reviewer: "themes-e2e-seeder",
    note: "seed published without themes for degraded-state e2e",
  });

  resetPrisma();

  return {
    themeSlug: STUB_THEME_SLUG,
    themeLabel: STUB_THEME_LABEL,
    themedHotEventIds: [toPublishThemedA.id, toPublishThemedB.id],
    themedTitles: [toPublishThemedA.title, toPublishThemedB.title],
    noThemeHotEventId: toPublishNoTheme.id,
    noThemeTitle: toPublishNoTheme.title,
  };
}

/**
 * Seed for the I/O-matrix row "无任何主题→目录降级": reset the DB and create ONE
 * published hot event with NO theme memberships (the only state). Mirrors the
 * no-theme path of seedThemeEvents() but as the SOLE published event, so the
 * /topics directory has zero themes and must render the degraded text
 * 「暂无已确认的主题。」. Returns the published hotEventId for visibility (not
 * asserted by the caller, but useful for debugging).
 *
 * Same pipeline as seedThemeEvents minus generateThemes: resetEnvCache →
 * requireEnv DATABASE_URL → getPrisma → clear tables in FK order → source +
 * one record → clusterEvents → generateExplanation → decideReview(approve),
 * WITHOUT generateThemes → resetPrisma. Table-clear ordering is identical so
 * re-runs stay deterministic.
 */
export async function seedTopicsEmpty(): Promise<{
  publishedHotEventId: string;
  publishedTitle: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Same clean-the-full-table-set ordering as seedThemeEvents() (order respects
  // FK constraints; hot_event_revisions has a Restrict FK on hot_events, so it
  // must be cleared before hot_events). See seedThemeEvents() for the rationale.
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "themes-empty-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  // A single record → a single candidate → published WITHOUT themes. The
  // /topics directory read model will then have zero theme rows, so the
  // directory must render the degraded text.
  const oneDayAgo = new Date(Date.now() - DAY);
  await seedRecord(prisma, source.id, {
    title: "稀土出口配额调整",
    summary: "稀土出口配额数据公布",
    url: `https://verify.test/稀土`,
    publishedAt: oneDayAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 1) {
    throw new Error(
      `[seed-themes-empty] expected >= 1 candidate after cluster, got ${pending.length}`,
    );
  }
  const toPublish = pending[0]!;

  // PUBLISHED WITHOUT themes: generate explanation + approve directly (no
  // generateThemes) → no theme projection, so the /topics directory has no
  // themes to list and must degrade. Same path as the noTheme branch of
  // seedThemeEvents().
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: toPublish.id,
    outcome: "approve",
    reviewer: "themes-empty-e2e-seeder",
    note: "seed published without themes for empty-topics-directory e2e",
  });

  resetPrisma();

  return {
    publishedHotEventId: toPublish.id,
    publishedTitle: toPublish.title,
  };
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

// Run directly (tsx e2e/seed-themes.ts) — but NOT when imported by the e2e spec
// (which calls seedThemeEvents() itself in a beforeAll to capture the ids). ESM
// direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedThemeEvents();
  console.log(
    `[seed-themes] themeSlug: ${result.themeSlug} (${result.themeLabel}) | themed: ${result.themedHotEventIds.join(",")} | noTheme: ${result.noThemeHotEventId} (${result.noThemeTitle})`,
  );
  process.exit(0);
}
