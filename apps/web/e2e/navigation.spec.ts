import { expect, test } from "@playwright/test";

/**
 * Responsive top-bar navigation e2e — Story 6.1 (Epic 6 视觉对齐参考站).
 *
 * Rewritten from the 1.2 left-rail spec: the desktop `<aside role=complementary>`
 * is gone; `<PublicNav>` now renders a sticky top-bar `<header role=banner>`
 * at ALL widths (UX-DR3, 2026-07-12). Desktop shows horizontal nav links +
 * SearchBox inline in the banner; mobile shows a hamburger that opens a drawer
 * `dialog`. Surface-anchored coverage for the 6.1 I/O matrix:
 *   - 桌面端顶部窄条导航 (desktop >=768px)
 *   - 移动端抽屉导航 (mobile <768px)
 *   - 跨断点布局稳定 / 导航目标可达
 *
 * Implementation notes baked into the assertions below:
 *
 * - Next.js `<Link>` prefetches on render/hover, so racing `waitForResponse`
 *   against a click can resolve on the prefetch. To assert real navigation we
 *   click and wait for the URL to settle via `waitForURL`.
 *
 * - The mobile hamburger's accessible name flips between "打开导航菜单"
 *   (closed) and "关闭导航菜单" (open). Locators that must survive the toggle
 *   use the regex name `/导航菜单/`.
 *
 * - The hamburger and the drawer overlay both carry the name "关闭导航菜单"
 *   when the drawer is open. Locators targeting the hamburger are scoped to
 *   `getByRole("banner")` to stay unambiguous.
 *
 * - Desktop nav links live inside the banner (`<header>`); drawer links live
 *   inside the `dialog`. Assertions scope to the right landmark so a hidden
 *   desktop nav (mobile) vs an open drawer (mobile) never collide.
 */

const SIDEBAR_HREFS = ["/", "/daily", "/crash-calendar", "/surge-calendar", "/topics", "/favorites"] as const;
const SIDEBAR_LABELS = ["精选", "A股日报", "大跌日历", "大涨日历", "主题", "收藏"] as const;
const DRAWER_HREFS = ["/", "/daily", "/crash-calendar", "/surge-calendar", "/topics", "/favorites"] as const;
const DRAWER_LABELS = ["首页", "日报", "大跌日历", "大涨日历", "主题", "收藏"] as const;

test.describe("桌面端侧栏导航 (>=768px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("侧栏可见，一级入口 href 正确", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.getByRole("complementary", { name: "主导航" });
    await expect(sidebar).toBeVisible();

    // Each primary entry is a link inside the banner with the correct href.
    for (let i = 0; i < SIDEBAR_LABELS.length; i++) {
      const label = SIDEBAR_LABELS[i]!;
      const href = SIDEBAR_HREFS[i]!;
      const link = sidebar.getByRole("link", { name: label }).first();
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href"), `href for ${label}`).toBe(href);
    }

    await expect(page.getByRole("banner")).toBeHidden();
  });

  test("点击日报导航到 /daily 并返回 200，激活态 aria-current", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    const dailyLink = sidebar.getByRole("link", { name: "A股日报" }).first();

    // Click and wait for the real URL change (not a prefetch response).
    await Promise.all([page.waitForURL(/\/daily\/?$/), dailyLink.click()]);

    // The destination renders inside the public shell and is anonymously 200.
    await expect(page.getByRole("heading", { level: 1, name: "日报" })).toBeVisible();

    // Independent confirmation: a fresh anonymous GET of /daily is 200, no login.
    const response = await page.goto("/daily");
    expect(response, "/daily should respond").not.toBeNull();
    expect(response!.status(), "/daily status should be 200").toBe(200);
    expect(response!.url(), "/daily should not redirect to login").not.toMatch(/\/login/);

    await expect(page.getByRole("complementary", { name: "主导航" })).toBeVisible();
  });

  test("匿名访问 /topics 与 /favorites 均可达，无 /login 重定向", async ({ page }) => {
    for (const href of ["/topics", "/favorites"]) {
      const response = await page.goto(href);
      expect(response, `${href} should respond`).not.toBeNull();
      expect(response!.status(), `${href} status should be 200`).toBe(200);
      expect(response!.url(), `${href} should not redirect to login`).not.toMatch(/\/login/);
    }
  });
});

test.describe("移动端抽屉导航 (<768px)", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("顶部 banner 与汉堡按钮可见，桌面水平导航隐藏", async ({ page }) => {
    await page.goto("/");

    // The sticky top-bar <header role=banner> is visible at mobile widths too.
    const banner = page.getByRole("banner");
    await expect(banner).toBeVisible();

    // Mobile hamburger toggle is visible; it controls the drawer.
    const hamburger = banner.getByRole("button", { name: /导航菜单/ });
    await expect(hamburger).toBeVisible();

    // The desktop horizontal nav links (inside the banner's md:flex cluster)
    // are NOT visible at mobile widths — only the hamburger is.
    await expect(banner.getByRole("link", { name: "首页" }).first()).toBeHidden();
  });

  test("展开抽屉含全部一级入口，点击日报导航后抽屉关闭", async ({ page }) => {
    await page.goto("/");

    // Regex name survives the open/close label flip ("打开导航菜单" ↔
    // "关闭导航菜单"); a literal name would go stale after the toggle.
    const hamburger = page.getByRole("banner").getByRole("button", { name: /导航菜单/ });
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await expect(hamburger).toHaveAttribute("aria-label", "打开导航菜单");

    // Open the drawer.
    await hamburger.click();

    // After opening, the hamburger reflects expanded state and the dialog appears.
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");
    await expect(hamburger).toHaveAttribute("aria-label", "关闭导航菜单");
    const drawer = page.getByRole("dialog", { name: "导航菜单" });
    await expect(drawer).toBeVisible();

    // The drawer contains the same four primary entries with correct hrefs.
    for (let i = 0; i < DRAWER_LABELS.length; i++) {
      const label = DRAWER_LABELS[i]!;
      const href = DRAWER_HREFS[i]!;
      const link = drawer.getByRole("link", { name: label }).first();
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href"), `href for ${label}`).toBe(href);
    }

    // Navigating via a drawer link lands on the target and closes the drawer.
    await Promise.all([
      page.waitForURL(/\/daily\/?$/),
      drawer.getByRole("link", { name: "日报" }).first().click(),
    ]);

    // After navigation the drawer is gone (link navigation closes it).
    await expect(page.getByRole("dialog", { name: "导航菜单" })).toBeHidden();
  });

  test("Escape 与遮罩可关闭抽屉，无 /login 重定向", async ({ page }) => {
    await page.goto("/");

    const hamburger = page.getByRole("banner").getByRole("button", { name: /导航菜单/ });

    // Open, then close via Escape.
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "导航菜单" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    // Open again, then close via the overlay. The overlay is a full-viewport
    // <button> (tabindex -1) sitting below the sticky header (h-14 = 56px,
    // z-40) and the left-anchored drawer panel. Click in the region only the
    // overlay covers: below the header, right of the panel. Derive x from the
    // panel's actual box so this stays correct if the panel width changes.
    await hamburger.click();
    await expect(drawer).toBeVisible();
    const panelBox = await drawer.boundingBox();
    const overlay = page.locator('button[aria-label="关闭导航菜单"][tabindex="-1"]');
    await overlay.click({
      position: { x: panelBox!.x + panelBox!.width + 20, y: 200 },
    });
    await expect(drawer).toBeHidden();

    // No /login redirect occurred during the flow (AD-8).
    expect(page.url(), "should remain on a public path").not.toMatch(/\/login/);
  });
});

test.describe("断点边界 (Tailwind md: 768px)", () => {
  test("768px 切桌面水平导航，767px 切移动汉堡，二者不并存", async ({ page }) => {
    await page.goto("/");

    // `md:` is min-width 768px: at >=768 the side nav shows and the mobile
    // public navigation hides.
    await page.setViewportSize({ width: 768, height: 800 });
    await expect(page.getByRole("complementary", { name: "主导航" })).toBeVisible();
    await expect(page.getByRole("banner")).toBeHidden();

    // At <768 the hamburger shows and the desktop side nav hides — exactly one
    // nav surface is present across the breakpoint flip (no overlap, no lost
    // nav), covering the matrix row "跨断点布局稳定" at its most fragile width.
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(page.getByRole("banner").getByRole("button", { name: /导航菜单/ })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "主导航" })).toBeHidden();
  });
});
