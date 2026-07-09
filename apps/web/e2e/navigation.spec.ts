import { expect, test } from "@playwright/test";

/**
 * Responsive navigation e2e — Story 1.2.
 *
 * Surface-anchored coverage for the first three rows of the 1.2 I/O matrix:
 *   - 桌面端导航渲染 (desktop >=768px)
 *   - 移动端抽屉导航 (mobile <768px)
 *   - 跨断点布局稳定 / 导航目标可达
 *
 * Desktop and mobile are split into `describe` blocks, each pinning a
 * viewport via `test.use({ viewport })` so the responsive variants render as
 * intended. Both blocks assert anonymous reachability (AD-8: no `/login`
 * redirect) for the new placeholder routes.
 *
 * Implementation notes baked into the assertions below:
 *
 * - Next.js `<Link>` prefetches the destination on render/hover, so racing
 *   `waitForResponse` against a click can resolve on the prefetch (a 200 that
 *   precedes the actual URL change). To assert real navigation we click and
 *   wait for the URL to settle via `waitForURL`.
 *
 * - The mobile hamburger's accessible name flips between "打开导航菜单"
 *   (closed) and "关闭导航菜单" (open). Locators that must survive the toggle
 *   use the regex name `/导航菜单/`, which matches both labels, instead of a
 *   literal that would go stale.
 *
 * - The hamburger and the drawer overlay both carry the name "关闭导航菜单"
 *   when the drawer is open (the overlay is a `<button>` so it is
 *   keyboard-dismissable). Locators targeting the hamburger are scoped to
 *   `getByRole("banner")` to stay unambiguous.
 *
 * - The drawer panel (left-anchored, w-72 = 288px) and the sticky top header
 *   (h-16 = 64px, z-40) both sit above the overlay. The overlay-only click
 *   target therefore lands below the header and right of the panel.
 */

const PRIMARY_HREFS = ["/", "/daily", "/topics", "/favorites"] as const;
const PRIMARY_LABELS = ["首页", "日报", "主题", "收藏"] as const;

test.describe("桌面端导航 (>=768px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("左侧一级导航可见，四个一级入口 href 正确", async ({ page }) => {
    await page.goto("/");

    // The left-rail <aside> is visible at desktop widths.
    const aside = page.getByRole("complementary");
    await expect(aside).toBeVisible();

    // Each primary entry is a link with the correct href and label.
    for (let i = 0; i < PRIMARY_LABELS.length; i++) {
      const label = PRIMARY_LABELS[i]!;
      const href = PRIMARY_HREFS[i]!;
      const link = aside.getByRole("link", { name: label }).first();
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href"), `href for ${label}`).toBe(href);
    }

    // Internal entry 运营台 is also present.
    await expect(aside.getByRole("link", { name: "运营台" }).first()).toBeVisible();

    // At desktop widths the mobile header / hamburger must NOT be visible.
    const hamburger = page.getByRole("banner").getByRole("button", { name: /导航菜单/ });
    await expect(hamburger).toBeHidden();
  });

  test("点击日报导航到 /daily 并返回 200", async ({ page }) => {
    await page.goto("/");
    const dailyLink = page.getByRole("complementary").getByRole("link", { name: "日报" }).first();

    // Click and wait for the real URL change (not a prefetch response).
    await Promise.all([page.waitForURL(/\/daily\/?$/), dailyLink.click()]);

    // The destination renders inside the public shell and is anonymously 200.
    await expect(page.getByRole("heading", { level: 1, name: "日报" })).toBeVisible();

    // Independent confirmation: a fresh anonymous GET of /daily is 200, no login.
    const response = await page.goto("/daily");
    expect(response, "/daily should respond").not.toBeNull();
    expect(response!.status(), "/daily status should be 200").toBe(200);
    expect(response!.url(), "/daily should not redirect to login").not.toMatch(/\/login/);

    // Active-link state (aria-current): 日报 is the current page; 首页 is not
    // (home uses exact-match, every other entry startsWith for sub-routes).
    await expect(
      page.getByRole("complementary").getByRole("link", { name: "日报" }).first(),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("complementary").getByRole("link", { name: "首页" }).first(),
    ).not.toHaveAttribute("aria-current", "page");
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

  test("顶部栏与汉堡按钮可见，左侧栏隐藏", async ({ page }) => {
    await page.goto("/");

    // Mobile hamburger toggle is visible; it controls the drawer.
    const hamburger = page.getByRole("banner").getByRole("button", { name: /导航菜单/ });
    await expect(hamburger).toBeVisible();

    // The desktop left-rail <aside> is NOT visible at mobile widths.
    const aside = page.getByRole("complementary");
    await expect(aside).toBeHidden();
  });

  test("展开抽屉含四个一级入口，点击日报导航后抽屉关闭", async ({ page }) => {
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
    for (let i = 0; i < PRIMARY_LABELS.length; i++) {
      const label = PRIMARY_LABELS[i]!;
      const href = PRIMARY_HREFS[i]!;
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
    // <button> (tabindex -1) sitting below the sticky header (h-16 = 64px,
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
  test("768px 切桌面侧栏，767px 切移动顶部栏，二者不并存", async ({ page }) => {
    await page.goto("/");

    // `md:` is min-width 768px: at >=768 the desktop rail shows and the
    // hamburger hides.
    await page.setViewportSize({ width: 768, height: 800 });
    await expect(page.getByRole("complementary")).toBeVisible();
    await expect(
      page.getByRole("banner").getByRole("button", { name: /导航菜单/ }),
    ).toBeHidden();

    // At <768 the mobile header shows and the rail hides — exactly one nav
    // surface is present across the breakpoint flip (no overlap, no lost nav),
    // covering the matrix row "跨断点布局稳定" at its most fragile width.
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(page.getByRole("complementary")).toBeHidden();
    await expect(
      page.getByRole("banner").getByRole("button", { name: /导航菜单/ }),
    ).toBeVisible();
  });
});
