/**
 * Seed script for the @watchlist e2e — Story 3.3 (watchlist + revisit management).
 *
 * Run with: pnpm --filter web seed:watchlist
 *           (tsx e2e/seed-watchlist.ts)
 *
 * Mirrors seed-follow.ts but adds:
 *   - accountA: a real UserAccount created via createAccount (so the e2e can
 *     mint a session cookie for it via signSessionCookie).
 *   - live follows: accountA follows one published event + one published theme
 *     slug (both resolve as live in resolveWatchlistView).
 *   - offline follows: two follow rows whose targets are NOT in the published
 *     set (an unpublished hot_event id + a slug with no membership), so
 *     resolveWatchlistView classifies them offline and the page renders the
 *     「已下线」 group.
 *
 * Clears the full table set INCLUDING user_accounts + follow_targets so re-runs
 * are deterministic. Requires DATABASE_URL + SESSION_SECRET (the spec mints a
 * session cookie via signSessionCookie, which needs SESSION_SECRET).
 *
 * Direct-run guard: only auto-runs + exits when this module is the entry (ESM
 * import.meta.url check), so the spec can import + call seedWatchlistContext()
 * in a beforeAll to capture the ids.
 */

import {
  clusterEvents,
  createAccount,
  decideReview,
  followTarget,
  FollowTargetKind,
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
  uuidv7,
} from "@aguhot/core";
import { resetEnvCache, requireEnv } from "@aguhot/config";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Deterministic title word for the seeded live event. Exported so the spec can
 * locate it in the rendered EventCard.
 */
export const LIVE_EVENT_TITLE_WORD = "商业航天";

export async function seedWatchlistContext(): Promise<{
  accountAId: string;
  liveEventId: string;
  liveEventTitle: string;
  liveThemeSlug: string;
  liveThemeLabel: string;
  offlineEventId: string;
  offlineThemeSlug: string;
}> {
  resetEnvCache();
  requireEnv("DATABASE_URL");
  // SESSION_SECRET note: the @watchlist spec drives signSessionCookie (to mint
  // a logged-in cookie), which calls requireEnv("SESSION_SECRET"). The dev
  // server (booted by the playwright webServer) + the playwright process must
  // have SESSION_SECRET in their env. The package.json e2e:watchlist script
  // passes SESSION_SECRET=dev-watchlist-e2e-secret-32chars explicitly so both
  // inherit it. This seed file does NOT itself read SESSION_SECRET (the seed
  // only touches the DB, not the session), so it runs without it; the dev
  // server + spec are the consumers (mirrors seed-follow.ts convention).

  const prisma = getPrisma();

  // Clean the full table set (same superset as seed-follow; order respects FK
  // constraints). user_accounts + follow_targets cleared so a prior run's
  // accounts/follows are gone.
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
      name: "watchlist-e2e-source",
      kind: "rss",
      feedUrl: "file:///unused",
      enabled: true,
    },
  });

  const twoDaysAgo = new Date(Date.now() - 2 * DAY);
  const recentAgo = new Date(Date.now() - 2 * HOUR);

  // Two records feed the live event cluster (evidenceCount > 1).
  await seedRecord(prisma, source.id, {
    title: `${LIVE_EVENT_TITLE_WORD}首发圆满成功`,
    summary: `${LIVE_EVENT_TITLE_WORD}进入常态化发射阶段`,
    url: `https://verify.test/${LIVE_EVENT_TITLE_WORD}-1`,
    publishedAt: twoDaysAgo,
  });
  await seedRecord(prisma, source.id, {
    title: `${LIVE_EVENT_TITLE_WORD}产业链多环节提速`,
    summary: `${LIVE_EVENT_TITLE_WORD}相关公司订单增长`,
    url: `https://verify.test/${LIVE_EVENT_TITLE_WORD}-2`,
    publishedAt: recentAgo,
  });

  await clusterEvents({ prisma, traceId: newTraceId() });

  const pending = await listPendingCandidates({ prisma, traceId: newTraceId() });
  if (pending.length < 1) {
    throw new Error(
      `[seed-watchlist] expected >= 1 candidate after cluster, got ${pending.length}`,
    );
  }
  const liveCandidate = pending.find((c) => c.title.includes(LIVE_EVENT_TITLE_WORD));
  if (liveCandidate === undefined) {
    throw new Error(
      `[seed-watchlist] could not find ${LIVE_EVENT_TITLE_WORD} candidate among: ${pending.map((p) => p.title).join(" | ")}`,
    );
  }

  // Publish the live event + attach a stub theme membership (so the theme slug
  // resolves as live and the /topics/{slug} page is reachable). Mirrors
  // seed-follow's pattern: generateThemes appends an EventThemeSet AFTER the
  // publish projection ran inside decideReview, so we MUST call
  // refreshPublishedReadModel({ action: "publish" }) again to project the new
  // theme membership into published_hot_event_themes.
  await generateExplanation({
    prisma,
    traceId: newTraceId(),
    hotEventId: liveCandidate.id,
  });
  await decideReview({
    prisma,
    traceId: newTraceId(),
    hotEventId: liveCandidate.id,
    outcome: "approve",
    reviewer: "watchlist-e2e-seeder",
    note: "seed published live event for watchlist e2e",
  });
  await generateThemes({
    prisma,
    traceId: newTraceId(),
    hotEventId: liveCandidate.id,
    adapter: new StubThemeAdapter(),
  });
  await refreshPublishedReadModel({
    prisma,
    traceId: newTraceId(),
    hotEventId: liveCandidate.id,
    action: "publish",
  });

  // Create accountA (the logged-in viewer for most watchlist tests).
  const { accountId: accountAId } = await createAccount({
    prisma,
    traceId: newTraceId(),
  });

  // Live follows: accountA follows the published event + the published theme slug.
  await followTarget({
    prisma,
    traceId: newTraceId(),
    userAccountId: accountAId,
    ref: { kind: FollowTargetKind.HotEvent, hotEventId: liveCandidate.id },
  });
  await followTarget({
    prisma,
    traceId: newTraceId(),
    userAccountId: accountAId,
    ref: { kind: FollowTargetKind.Theme, themeSlug: STUB_THEME_SLUG },
  });

  // Offline follows: two rows whose targets are NOT in the published set. The
  // ids are freshly-minted uuidv7 strings that no published row carries, so
  // resolveWatchlistView classifies them offline (AC3 group).
  const offlineEventId = uuidv7();
  const offlineThemeSlug = "offline-theme-no-membership";
  await prisma.followTarget.create({
    data: {
      id: uuidv7(),
      userAccountId: accountAId,
      targetKind: FollowTargetKind.HotEvent,
      targetHotEventId: offlineEventId,
      targetThemeSlug: null,
    },
  });
  await prisma.followTarget.create({
    data: {
      id: uuidv7(),
      userAccountId: accountAId,
      targetKind: FollowTargetKind.Theme,
      targetHotEventId: null,
      targetThemeSlug: offlineThemeSlug,
    },
  });

  resetPrisma();

  return {
    accountAId,
    liveEventId: liveCandidate.id,
    liveEventTitle: liveCandidate.title,
    liveThemeSlug: STUB_THEME_SLUG,
    liveThemeLabel: STUB_THEME_LABEL,
    offlineEventId,
    offlineThemeSlug,
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

// Run directly (tsx e2e/seed-watchlist.ts) — but NOT when imported by the e2e
// spec (which calls seedWatchlistContext() itself in a beforeAll to capture the
// ids). ESM direct-run detection: only auto-run + exit when this module is the
// entry.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await seedWatchlistContext();
  console.log(
    `[seed-watchlist] accountA: ${result.accountAId} | liveEvent: ${result.liveEventId} (${result.liveEventTitle}) | liveTheme: ${result.liveThemeSlug} (${result.liveThemeLabel}) | offlineEvent: ${result.offlineEventId} | offlineTheme: ${result.offlineThemeSlug}`,
  );
  process.exit(0);
}
