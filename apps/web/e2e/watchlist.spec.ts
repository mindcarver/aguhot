import { expect, test } from "@playwright/test";

import { createAccount, getPrisma, newTraceId } from "@aguhot/core";

import { signSessionCookie } from "../lib/session-cookie-signer.js";
import { resetEnvCache, requireEnv } from "@aguhot/config";

import { seedWatchlistContext } from "./seed-watchlist";

/**
 * Watchlist e2e — Story 3.3 (关注列表与回访管理). Tagged @watchlist so it runs
 * only under `pnpm --filter web e2e:watchlist` (DB-backed + seed +
 * SESSION_SECRET) and does NOT run under the public `pnpm --filter web e2e`
 * (whose --grep-invert excludes @console, @feed, @detail, @revision,
 * @merge-split, @market-reaction, @associations, @themes, @daily, @loop,
 * @search, @follow, AND @watchlist).
 *
 * The beforeAll imports + runs seedWatchlistContext() (the same function
 * `pnpm --filter web seed:watchlist` runs) to capture the dynamic accountA id +
 * live event/theme + offline event/theme ids. Each logged-in test mints a
 * session cookie for accountA via signSessionCookie (the pure signer extracted
 * in 3.3) + context.addCookies — simulating a returning logged-in viewer
 * WITHOUT going through the login UI (AC2 returning-user path, which 3.2's
 * follow.spec did not drive).
 *
 * Requires request-time DATABASE_URL + SESSION_SECRET: the /favorites page is
 * force-dynamic and reads the session + three published reads. The e2e:watchlist
 * script passes SESSION_SECRET explicitly.
 *
 * Covers:
 *   - AC2 anon: anonymous /favorites → empty state + 「返回首页」/「探索主题」entries
 *     + HTTP 200, no redirect (AD-8).
 *   - AC1 live: logged-in /favorites lists the live event (EventCard, whole-card
 *     link to /events/{id}) + the live theme (link row to /topics/{slug}).
 *   - AC3 offline: offline event + theme annotated 「已下线」, NO detail link, NOT
 *     in the live group.
 *   - AC2 logged-in empty: a fresh account with zero follows → empty state.
 *   - Management: click a live item's FollowButton → unfollow → item disappears.
 *   - Management: click an offline item's FollowButton → unfollow → item
 *     disappears (AC3 recoverability — taken-down content is cleanable).
 *   - Tampered cookie → anonymous degradation: bad signature → empty state, no
 *     500.
 *
 * Serial mode: tests share the seeded DB + captured ids. The management tests
 * mutate DB state (unfollow) and are ordered so they do not break siblings.
 */

/**
 * Resolve SESSION_SECRET lazily (at test-run time, not module-import time) so
 * `playwright test --list` and module import do not throw when the env is
 * unset. The e2e:watchlist script injects SESSION_SECRET into the process env
 * before running playwright; by the time any test body calls this, the env is
 * populated.
 */
function sessionSecret(): string {
  return requireEnv("SESSION_SECRET");
}

test.describe("关注列表与回访管理 (Story 3.3) @watchlist", () => {
  test.describe.configure({ mode: "serial" });

  let accountAId: string;
  let liveEventId: string;
  let liveEventTitle: string;
  let liveThemeSlug: string;
  let liveThemeLabel: string;
  let offlineEventId: string;
  let offlineThemeSlug: string;

  test.beforeAll(async () => {
    resetEnvCache();
    const seeded = await seedWatchlistContext();
    accountAId = seeded.accountAId;
    liveEventId = seeded.liveEventId;
    liveEventTitle = seeded.liveEventTitle;
    liveThemeSlug = seeded.liveThemeSlug;
    liveThemeLabel = seeded.liveThemeLabel;
    offlineEventId = seeded.offlineEventId;
    offlineThemeSlug = seeded.offlineThemeSlug;
  });

  /**
   * Mint a signed session cookie value for accountA and add it to the context.
   * Uses the pure signSessionCookie extracted in 3.3 — byte-identical to what
   * createSession would set (single source of truth for the cookie format).
   */
  async function loginAsAccountA(context: import("@playwright/test").BrowserContext): Promise<void> {
    const value = signSessionCookie(accountAId, sessionSecret());
    await context.addCookies([
      {
        name: "aguhot:session",
        value,
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
  }

  test("AC2 匿名 /favorites：空态 + 返回入口 + HTTP 200 无重定向", async ({ page }) => {
    const response = await page.goto("/favorites");
    expect(response!.status(), "/favorites anonymous should be 200").toBe(200);
    expect(page.url(), "should not redirect to login").not.toMatch(/\/login/);

    // H1 「收藏」 (nav consistency).
    await expect(page.getByRole("heading", { level: 1, name: "收藏" })).toBeVisible();
    // Empty-state copy for an anonymous viewer.
    await expect(page.getByText(/还没有收藏内容/)).toBeVisible();
    // CTA entries.
    await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
    await expect(page.getByRole("link", { name: "探索主题" })).toBeVisible();
  });

  test("AC1 已登录 /favorites：live 事件 EventCard + live 主题行可点进", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAsAccountA(context);
      const response = await page.goto("/favorites");
      expect(response!.status(), "/favorites logged-in should be 200").toBe(200);

      // The live event renders as an EventCard. Its whole card is a link to the
      // detail page. Assert the event title is visible + the detail link exists.
      await expect(page.getByText(liveEventTitle)).toBeVisible();
      const detailLink = page.locator(`a[href="/events/${liveEventId}"]`);
      await expect(detailLink).toHaveCount(1);

      // The live theme renders as a link row to /topics/{slug}.
      const themeLink = page.locator(
        `a[href="/topics/${encodeURIComponent(liveThemeSlug)}"]`,
      );
      await expect(themeLink).toHaveCount(1);
      await expect(themeLink).toContainText(liveThemeLabel);
    } finally {
      await context.close();
    }
  });

  test("AC3 已登录 /favorites：offline 事件/主题标「已下线」+ 无详情链接 + 不混入 live", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAsAccountA(context);
      await page.goto("/favorites");

      // The offline group heading + 「已下线」 badges are visible.
      await expect(page.getByText("已下线").first()).toBeVisible();
      await expect(page.getByText("该热点已下线")).toBeVisible();
      await expect(page.getByText("该主题已下线")).toBeVisible();

      // AC3 anti-disguise: there is NO link to the offline event's detail page
      // (detail would 404 — a clickable offline item is misleading).
      const offlineDetailLink = page.locator(`a[href="/events/${offlineEventId}"]`);
      await expect(offlineDetailLink).toHaveCount(0);
      // And NO link to the offline theme page.
      const offlineThemeLink = page.locator(
        `a[href="/topics/${encodeURIComponent(offlineThemeSlug)}"]`,
      );
      await expect(offlineThemeLink).toHaveCount(0);

      // The offline event id is NEVER exposed to the reader (no title exists).
      await expect(page.getByText(offlineEventId)).toHaveCount(0);
      // The bare offline slug is NEVER exposed either.
      await expect(page.getByText(offlineThemeSlug)).toHaveCount(0);

      // The live event + theme are still in the live group (NOT removed by the
      // presence of offline items).
      await expect(page.getByText(liveEventTitle)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("AC2 已登录零 follow：新账号 → 空态", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Create a fresh account with zero follows.
      const prisma = getPrisma();
      const { accountId: emptyAccountId } = await createAccount({
        prisma,
        traceId: newTraceId(),
      });
      const value = signSessionCookie(emptyAccountId, sessionSecret());
      await context.addCookies([
        { name: "aguhot:session", value, domain: "127.0.0.1", path: "/" },
      ]);

      const response = await page.goto("/favorites");
      expect(response!.status(), "/favorites empty logged-in should be 200").toBe(200);
      // Empty-state copy for a logged-in viewer.
      await expect(page.getByText(/还没有收藏内容/)).toBeVisible();
      await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
      // No EventCard, no theme row.
      await expect(page.getByText("已下线")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("管理：点 live 事件 FollowButton「已收藏」→ unfollow → 该项从列表消失", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAsAccountA(context);
      await page.goto("/favorites");

      // The live event card has a 「已收藏」 FollowButton. Click it to unfollow.
      const eventCard = page.locator("li", { hasText: liveEventTitle }).first();
      const unfollowButton = eventCard.getByRole("button", { name: /^已收藏/ }).first();
      await expect(unfollowButton).toBeVisible();
      await unfollowButton.click();

      // The revalidatePath refreshes the server data; the event title disappears
      // from the list (unfollowed → no longer in the follow set).
      await expect(page.getByText(liveEventTitle)).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("管理：点 offline 事件 FollowButton → unfollow → offline 项消失（AC3 可恢复）", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginAsAccountA(context);
      await page.goto("/favorites");

      // The offline event row carries a FollowButton. Click it to unfollow.
      const offlineRow = page.locator("li", { hasText: "该热点已下线" }).first();
      const unfollowButton = offlineRow.getByRole("button", { name: /^已收藏/ }).first();
      await expect(unfollowButton).toBeVisible();
      await unfollowButton.click();

      // The offline event annotation disappears (taken-down content is cleanable;
      // AC3 recoverability — it does NOT linger forever).
      await expect(page.getByText("该热点已下线")).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("会话验签失败→匿名：篡改 cookie → /favorites 降级匿名空态、无 500", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // First navigate so the cookie domain is established.
      await page.goto("/favorites");
      // Overwrite the session cookie with a tampered value (valid shape
      // accountId.hmac, but wrong signature).
      await context.addCookies([
        {
          name: "aguhot:session",
          value: `${"00000000-0000-7000-8000-000000000000"}.invalid-signature`,
          domain: "127.0.0.1",
          path: "/",
        },
      ]);
      // Reload: readSession should reject the bad signature → anonymous → empty
      // state (NOT a 500, NOT the logged-in list).
      const response = await page.reload();
      expect(response!.status(), "tampered-cookie page status should be 200").toBe(200);
      // Anonymous empty state (NOT the logged-in event/theme list).
      await expect(page.getByText(/还没有收藏内容/)).toBeVisible();
      await expect(page.getByText(liveEventTitle)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
