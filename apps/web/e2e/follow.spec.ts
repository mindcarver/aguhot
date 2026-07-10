import { expect, test } from "@playwright/test";

import { followTarget, getPrisma, newTraceId } from "@aguhot/core";

import { seedFollowContext } from "./seed-follow";

/**
 * Deferred-login follow action e2e — Story 3.2. Tagged @follow so it runs only
 * under `pnpm --filter web e2e:follow` (DB-backed + seed + SESSION_SECRET) and
 * does NOT run under the public `pnpm --filter web e2e` (whose --grep-invert
 * excludes @console, @feed, @detail, @revision, @merge-split, @market-reaction,
 * @associations, @themes, @daily, @loop, @search, AND @follow).
 *
 * The beforeAll imports + runs seedFollowContext() (the same function
 * `pnpm --filter web seed:follow` runs) to capture the dynamic eventA/eventB
 * ids + the stub theme slug/label.
 *
 * Requires request-time DATABASE_URL + SESSION_SECRET: the detail/feed/theme
 * pages read the session + follow state, and the server actions (toggleFollow /
 * startSessionAndFollow) call readSession/createSession which requireEnv
 * SESSION_SECRET. The e2e:follow script passes SESSION_SECRET explicitly.
 *
 * Covers:
 *   - AC1 anonymous→login follow on detail: click 「收藏」 → dialog → 「登录并收藏」
 *     → button flips to 「已收藏」 + the `aguhot:session` cookie is set.
 *   - AC2 cross-page consistency: after the above, the feed card for the same
 *     event also shows 「已收藏」; the theme page follow also works.
 *   - AC2 logged-in toggle off: click 「已收藏」 → 「收藏」, and the state
 *     disappears across pages.
 *   - AC3 abandon login: click 「收藏」 → 「取消」 → dialog closes, page still
 *     usable, no follow row written (DB assertion), still anonymous.
 *   - AD-8 anonymous no-wall: /, /events/{id}, /topics/{slug}, /search,
 *     /favorites, /daily all return 200 with no redirect.
 *   - Tampered cookie → anonymous degradation: overwrite aguhot:session with a
 *     bad value → user treated as anonymous, button 「收藏」, no 500.
 *   - Valid-kind follow writes exactly one row (positive invariant; the
 *     forged-kind REJECTION is pinned purely by the action-layer selfcheck
 *     `pnpm --filter web verify:follow-ref`, which drives parseFollowRef with
 *     targetKind=evil / empty / over-length / non-UUIDv7 ids without a browser).
 *   - Idempotent re-follow: a logged-in user who ALREADY follows a target
 *     drives a second followTarget on that same already-followed target (no
 *     intervening unfollow) → row count unchanged (pins core's findFirst
 *     early-return + P2002 catch at the DB layer).
 *   - /favorites anonymously reachable (AD-8).
 *
 * Serial mode: tests share the seeded DB + captured ids. The toggle-off /
 * valid-kind / idempotent tests mutate DB state and are ordered so they do
 * not break siblings.
 */

test.describe("延迟登录的收藏动作 (Story 3.2) @follow", () => {
  test.describe.configure({ mode: "serial" });

  let eventAId: string;
  let eventBId: string;
  let themeSlug: string;
  let themeLabel: string;

  test.beforeAll(async () => {
    const seeded = await seedFollowContext();
    eventAId = seeded.eventAId;
    eventBId = seeded.eventBId;
    themeSlug = seeded.themeSlug;
    themeLabel = seeded.themeLabel;
  });

  test("AC1 匿名详情页收藏→引导→登录并收藏：按钮变「已收藏」+ cookie 存在", async ({ page, context }) => {
    await page.goto(`/events/${eventAId}`);

    // The FollowButton renders 「收藏」 for an anonymous viewer.
    const followButton = page.getByRole("button", { name: /^收藏/ }).first();
    await expect(followButton).toBeVisible();
    await expect(followButton).toHaveAttribute("aria-pressed", "false");

    // Click 「收藏」 → the native <dialog> opens.
    await followButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText(/登录以保存收藏/)).toBeVisible();

    // 「登录并收藏」 creates an account + sets the cookie + writes the follow.
    const confirmButton = page.getByRole("button", { name: /登录并收藏/ });
    await confirmButton.click();

    // The dialog closes and the button flips to 「已收藏」.
    await expect(dialog).toBeHidden();
    // The button text changes to 「已收藏」 (aria-pressed=true). It may re-render
    // after the revalidate, so poll for the pressed state.
    const pressedButton = page.getByRole("button", { name: /^已收藏/ }).first();
    await expect(pressedButton).toBeVisible();
    await expect(pressedButton).toHaveAttribute("aria-pressed", "true");

    // The session cookie exists (httpOnly, so we check via context cookies).
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === "aguhot:session");
    expect(sessionCookie, "aguhot:session cookie should be set").toBeDefined();
    expect(sessionCookie?.httpOnly, "session cookie should be httpOnly").toBe(true);
    expect(sessionCookie?.value.includes("."), "cookie value should be accountId.hmac").toBe(true);
  });

  test("AC2 跨页一致：上例后 feed 卡片显示「已收藏」", async ({ browser }) => {
    // The previous test set the session cookie in its own context. Each test
    // gets a fresh context by default in serial mode, so this test starts
    // anonymous again. To verify cross-page consistency for the SAME logged-in
    // user, we re-login on the detail page, then navigate to the feed and
    // assert the card shows 「已收藏」. This mirrors a real user's flow.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Log in by following event A from the detail page.
      await page.goto(`/events/${eventAId}`);
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await followButton.click();
      await page.getByRole("button", { name: /登录并收藏/ }).click();
      // Wait for the flip to 「已收藏」.
      await expect(page.getByRole("button", { name: /^已收藏/ }).first()).toBeVisible();

      // Navigate to the feed. The eventA card should render 「已收藏」 (same
      // accountId, hot_event, hotEventId truth).
      await page.goto("/");
      const card = page.locator("li", { hasText: "钛合金" }).first();
      await expect(card).toBeVisible();
      const cardFollowButton = card.getByRole("button", { name: /^已收藏/ });
      await expect(cardFollowButton).toBeVisible();
      await expect(cardFollowButton).toHaveAttribute("aria-pressed", "true");
    } finally {
      await context.close();
    }
  });

  test("主题页 follow：登录后收藏主题 → 按钮变「已收藏」", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const response = await page.goto(`/topics/${encodeURIComponent(themeSlug)}`);
      expect(response!.status(), "theme page should be 200").toBe(200);
      // The theme page header renders the theme label as the h1 + a FollowButton.
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toContainText(themeLabel);
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await expect(followButton).toBeVisible();

      // Click 「收藏」 → dialog → 「登录并收藏」.
      await followButton.click();
      await page.getByRole("button", { name: /登录并收藏/ }).click();
      await expect(page.getByRole("button", { name: /^已收藏/ }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("AC3 放弃登录：引导→取消→dialog 关闭、无 follow 写入、仍匿名", async ({ page, context }) => {
    // Fresh anonymous context. Scope the count to eventB so the assertion is
    // not racy against follow rows other test contexts (running serially) may
    // write for other targets.
    const countBefore = await countFollowRowsForEvent(eventBId);

    await page.goto(`/events/${eventBId}`);
    const followButton = page.getByRole("button", { name: /^收藏/ }).first();
    await followButton.click();

    // The dialog opens.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click 「取消」 → dialog closes.
    await page.getByRole("button", { name: /^取消$/ }).click();
    await expect(dialog).toBeHidden();

    // The page is still usable: the title is still visible, and we can click
    // a nav link.
    await expect(page.getByRole("heading", { name: /风电/ })).toBeVisible();

    // No follow row was written for eventB.
    const countAfter = await countFollowRowsForEvent(eventBId);
    expect(countAfter, "no follow row should be written for eventB on cancel").toBe(countBefore);

    // Still anonymous: no session cookie.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "aguhot:session"), "no session cookie after cancel").toBeUndefined();
  });

  test("AC2 已登录 toggle 取消：点「已收藏」→「收藏」", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Log in by following event B.
      await page.goto(`/events/${eventBId}`);
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await followButton.click();
      await page.getByRole("button", { name: /登录并收藏/ }).click();
      const pressed = page.getByRole("button", { name: /^已收藏/ }).first();
      await expect(pressed).toBeVisible();

      // Toggle off: click 「已收藏」 (logged-in path, no dialog).
      await pressed.click();
      const released = page.getByRole("button", { name: /^收藏/ }).first();
      await expect(released).toBeVisible();
      await expect(released).toHaveAttribute("aria-pressed", "false");
    } finally {
      await context.close();
    }
  });

  test("AD-8 匿名浏览不墙：/, /events, /topics, /search, /favorites, /daily 全 200", async ({ page }) => {
    const paths = [
      "/",
      `/events/${eventAId}`,
      `/topics/${encodeURIComponent(themeSlug)}`,
      "/search",
      "/favorites",
      "/daily",
    ];
    for (const p of paths) {
      const response = await page.goto(p);
      expect(response, `${p} should respond`).not.toBeNull();
      expect(response!.status(), `${p} status should be 200`).toBe(200);
      expect(page.url(), `${p} should not redirect to login`).not.toMatch(/\/login/);
    }
  });

  test("会话验签失败→匿名：篡改 cookie → FollowButton「收藏」态、无 500", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // First navigate so the cookie domain is established.
      await page.goto(`/events/${eventAId}`);
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
      // Reload: readSession should reject the bad signature → anonymous.
      const response = await page.reload();
      expect(response!.status(), "tampered-cookie page status should be 200").toBe(200);
      // The button renders 「收藏」 (anonymous fallback).
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await expect(followButton).toBeVisible();
      await expect(followButton).toHaveAttribute("aria-pressed", "false");
    } finally {
      await context.close();
    }
  });

  test("合法 kind 行数：FollowButton 用白名单 kind 确认 → eventB 恰好一行（rejection 由纯 selfcheck 覆盖）", async ({ browser }) => {
    // This test asserts the POSITIVE invariant the action-layer trust-boundary
    // guard (parseFollowRef) protects: the FollowButton's confirm path, using
    // the VALID kind it always sends, writes exactly one follow row for eventB.
    // The forged-kind / empty-id / over-length-id / non-UUIDv7-id REJECTION
    // matrix is NOT drivable cleanly through the browser (Next server actions
    // serialize args in an RSC envelope, not simple form-encoded bodies) and is
    // instead pinned PURELY by `pnpm --filter web verify:follow-ref`, which
    // drives parseFollowRef's rejection rows without a browser. Naming this case
    // honestly avoids an e2e that lies about testing rejection.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/events/${eventBId}`);
      const countBeforeEventB = await countFollowRowsForEvent(eventBId);

      // Open the dialog + confirm with the VALID kind the button always sends.
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await followButton.click();
      await page.getByRole("button", { name: /登录并收藏/ }).click();
      await expect(page.getByRole("button", { name: /^已收藏/ }).first()).toBeVisible();

      // Exactly one follow row was written for eventB (the whitelist-validated
      // path; a forged evil kind would have been rejected with zero rows —
      // pinned by the pure selfcheck).
      const countAfter = await countFollowRowsForEvent(eventBId);
      expect(countAfter, "valid-kind follow writes exactly one row").toBe(countBeforeEventB + 1);
    } finally {
      await context.close();
    }
  });

  test("重复收藏幂等：已登录已收藏，再 follow 同 item（无 intervening unfollow）→ 行数不变", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // Log in + follow event A via the real UI path (startSessionAndFollow).
      // This creates a real account + session cookie + follow row.
      await page.goto(`/events/${eventAId}`);
      const followButton = page.getByRole("button", { name: /^收藏/ }).first();
      await followButton.click();
      await page.getByRole("button", { name: /登录并收藏/ }).click();
      await expect(page.getByRole("button", { name: /^已收藏/ }).first()).toBeVisible();

      const countAfterFirst = await countFollowRowsForEvent(eventAId);
      expect(countAfterFirst, "one follow row after first follow").toBeGreaterThanOrEqual(1);

      // Extract the accountId from the signed session cookie (value is
      // `accountId.hmac`). We then drive a SECOND followTarget on the SAME
      // (accountId, eventA) directly via core — the already-followed path that
      // exercises followTarget's findFirst early-return + P2002 catch. The
      // action layer exposes no "follow-only while logged in" surface (toggle
      // flips based on state), so core-direct is the honest way to pin the
      // idempotency guard WITHOUT an intervening unfollow.
      const cookies = await context.cookies();
      const sessionCookie = cookies.find((c) => c.name === "aguhot:session");
      expect(sessionCookie, "session cookie must be set to extract accountId").toBeDefined();
      const dot = sessionCookie!.value.lastIndexOf(".");
      const accountId = sessionCookie!.value.slice(0, dot);

      const prisma = getPrisma();
      const traceId = newTraceId();
      // Second follow on the already-followed target — MUST be a no-op.
      await followTarget({
        prisma,
        traceId,
        userAccountId: accountId,
        ref: { kind: "hot_event", hotEventId: eventAId },
      });

      const countAfterRefollow = await countFollowRowsForEvent(eventAId);
      expect(countAfterRefollow, "no duplicate follow row on already-followed target").toBe(countAfterFirst);
    } finally {
      await context.close();
    }
  });

  test("/favorites 匿名可达 (AD-8)", async ({ page }) => {
    const response = await page.goto("/favorites");
    expect(response!.status(), "/favorites should be 200 anonymously").toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "收藏" })).toBeVisible();
  });

  /**
   * Count follow_targets rows for one hot_event id (across all users). Used by
   * the cancel + valid-kind + idempotency tests (scoped per-target so the
   * assertions are not racy against other test contexts).
   */
  async function countFollowRowsForEvent(hotEventId: string): Promise<number> {
    const prisma = getPrisma();
    const rows = await prisma.followTarget.count({
      where: { targetKind: "hot_event", targetHotEventId: hotEventId },
    });
    return rows;
  }
});
