/**
 * Seed script for the @follow e2e — Story 3.2 (deferred-login follow action).
 *
 * Run with: pnpm --filter web seed:follow
 *           (tsx e2e/seed-follow.ts)
 *
 * Self-contained: produces the minimal published fixtures the @follow spec
 * needs (mirrors the seed-search structure but trimmed to what the follow
 * surfaces assert):
 *   - (A) a published hot event whose title contains a deterministic word, used
 *     by the detail-page follow test + the feed-card follow test. Two records
 *     feed the cluster so its evidenceCount > 1 (avoids an anemic card).
 *   - (B) a second published hot event used for the cross-page consistency
 *     toggle-off test (distinct vocabulary so it clusters separately).
 *   - (C) a stub theme membership on event (A) so the theme-page follow test
 *     resolves (StubThemeAdapter, test-only — same convention as seed-themes /
 *     seed-search).
 *
 * Clears the full table set INCLUDING the new user_accounts + follow_targets
 * (Story 3.2 tables) so re-runs are deterministic. Requires DATABASE_URL
 * pointing at local PG.
 *
 * SESSION_SECRET note: the @follow spec drives the startSessionAndFollow /
 * toggleFollow server actions, which call readSession/createSession →
 * requireEnv("SESSION_SECRET"). The dev server (pnpm dev, booted by the
 * playwright webServer) must have SESSION_SECRET in its env. The package.json
 * e2e:follow script passes SESSION_SECRET=dev-follow-e2e-secret-32chars
 * explicitly so the dev server inherits it. This file does NOT itself read
 * SESSION_SECRET (the seed only touches the DB, not the session), so it runs
 * without it; the dev server is the consumer.
 */

import {
  clusterEvents,
  decideReview,
  generateExplanation,
  generateThemes,
  getPrisma,
  listPendingCandidates,
  newTraceId,
  refreshPublishedReadModel,
  resetPrisma,
  STUB_THEME_LABEL,
  STUB_THEME_SLUG,
  StubThemeAdapter,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Deterministic query/title word for the seeded events. Kept as exported const
 * so the spec can import it.
 */
export const EVENT_A_TITLE_WORD = "钛合金";
export const EVENT_B_TITLE_WORD = "风电";

export async function seedFollowContext(): Promise<{
  eventAId: string;
  eventATitle: string;
  eventBId: string;
  eventBTitle: string;
  themeSlug: string;
  themeLabel: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");

  const prisma = getPrisma();

  // Clean the full table set (same superset as seed-search; order respects FK
  // constraints). The Story 3.2 user_accounts + follow_targets tables are
  // included so a prior @follow run's created accounts + follows are cleared.
  await prisma.followTarget.deleteMany({});
  await prisma.userAccount.deleteMany({});
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

  const source = await prisma.evidenceSource.create({
    data: {
      id: newTraceId(),
      name: "follow-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const recentAgo = new Date(Date.now() - 2 * HOUR);

  // Group A: 钛合金 event (two records → evidenceCount > 1).
  await seedRecord(prisma, source.id, {
    title: `${EVENT_A_TITLE_WORD}产能扩张覆盖航空航天需求`,
    summary: `${EVENT_A_TITLE_WORD}材料需求增长影响下游产业链`,
    url: `https://verify.test/${EVENT_A_TITLE_WORD}-1`,
    publishedAt: twoDaysAgo,
  });
  await seedRecord(prisma, source.id, {
    title: `${EVENT_A_TITLE_WORD}材料供应持续紧张`,
    summary: `${EVENT_A_TITLE_WORD}上游海绵钛产量受限`,
    url: `https://verify.test/${EVENT_A_TITLE_WORD}-2`,
    publishedAt: twoDaysAgo,
  });

  // Group B: 风电 event (distinct vocabulary → separate cluster).
  await seedRecord(prisma, source.id, {
    title: `${EVENT_B_TITLE_WORD}装机容量再创新高`,
    summary: `${EVENT_B_TITLE_WORD}行业招标量同比增长`,
    url: `https://verify.test/${EVENT_B_TITLE_WORD}`,
    publishedAt: recentAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 2) {
    throw new Error(
      `[seed-follow] expected >= 2 candidates after cluster, got ${pending.length}`,
    );
  }

  const eventACandidate = pending.find((c) => c.title.includes(EVENT_A_TITLE_WORD));
  const eventBCandidate = pending.find((c) => c.title.includes(EVENT_B_TITLE_WORD));
  if (eventACandidate === undefined || eventBCandidate === undefined) {
    throw new Error(
      `[seed-follow] could not identify both candidates among: ${pending.map((p) => p.title).join(" | ")}`,
    );
  }

  // Event A: publish + theme membership (so /topics/{slug} resolves for the
  // theme follow test). generateThemes appends an EventThemeSet AFTER the
  // publish projection ran inside decideReview, so we MUST call
  // refreshPublishedReadModel({ action: "publish" }) again to project the new
  // theme membership into published_hot_event_themes (mirrors seed-search's
  // pattern). Without this re-projection, /topics/{slug} has no published
  // members → 404.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventACandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventACandidate.id,
    outcome: "approve",
    reviewer: "follow-e2e-seeder",
    note: "seed published event A for follow e2e",
  });
  await generateThemes({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventACandidate.id,
    adapter: new StubThemeAdapter(),
  });
  // Re-project so the theme membership enters published_hot_event_themes.
  await refreshPublishedReadModel({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventACandidate.id,
    action: "publish",
  });

  // Event B: publish (no theme — keeps the theme member count deterministic).
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventBCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: eventBCandidate.id,
    outcome: "approve",
    reviewer: "follow-e2e-seeder",
    note: "seed published event B for follow e2e",
  });

  resetPrisma();

  return {
    eventAId: eventACandidate.id,
    eventATitle: eventACandidate.title,
    eventBId: eventBCandidate.id,
    eventBTitle: eventBCandidate.title,
    themeSlug: STUB_THEME_SLUG,
    themeLabel: STUB_THEME_LABEL,
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

// Run directly (tsx e2e/seed-follow.ts) — but NOT when imported by the e2e spec
// (which calls seedFollowContext() itself in a beforeAll to capture the ids).
// ESM direct-run detection: only auto-run + exit when this module is the entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedFollowContext();
  console.log(
    `[seed-follow] eventA: ${result.eventAId} (${result.eventATitle}) | eventB: ${result.eventBId} (${result.eventBTitle}) | theme: ${result.themeSlug} (${result.themeLabel})`,
  );
  process.exit(0);
}
