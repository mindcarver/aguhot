import { expect, test } from "@playwright/test";

/**
 * Design-system preview e2e — Story 1.3.
 *
 * Surface-anchored coverage for the 1.3 I/O matrix rows:
 *   - 暖底画布落地 (canvas token on <body>)
 *   - 排版三层可读 (display serif title visible)
 *   - chip 语义统一 (AI label / filter pill / reaction chips)
 *   - 深色死代码清理 (warm-light canvas holds under prefers-color-scheme: dark)
 *
 * `/design` is an anonymous server component (AD-8): GET returns 200 and never
 * redirects to `/login`. It carries no business data — only token samples — so
 * it needs no DB/Redis.
 *
 * The canvas-token assertion pins the literal DESIGN value: the browser
 * serializes `#F5F1E8` to `rgb(245, 241, 232)`. If a future token change
 * breaks the warm canvas, this assertion fails loudly rather than silently
 * drifting to pure white.
 */

// DESIGN `canvas` = #F5F1E8 — browsers serialize the computed value to this
// rgb() string. Asserting it pins AC1's "warm canvas, not pure white".
const CANVAS_RGB = "rgb(245, 241, 232)";

// DESIGN chip-token RGBs (hex → browser-serialized rgb()). Pinning these nails
// AC2: the chips consume the right @theme tokens AND the brand/market
// decoupling (brand is never a market color; up=red / down=green per A-share
// convention). A wrong token (e.g. tone "up" rendered green) fails loudly.
const ACCENT_WARM_RGB = "rgb(184, 102, 51)"; // accent-warm #B86633 (AI label bg)
const BRAND_RGB = "rgb(33, 59, 99)"; // brand #213B63 (active filter-pill bg)
const MARKET_UP_RGB = "rgb(196, 60, 50)"; // market-up #C43C32
const MARKET_UP_SOFT_RGB = "rgb(248, 224, 221)"; // market-up-soft #F8E0DD
const MARKET_DOWN_RGB = "rgb(14, 139, 91)"; // market-down #0E8B5B
const MARKET_DOWN_SOFT_RGB = "rgb(221, 242, 233)"; // market-down-soft #DDF2E9
const MARKET_FLAT_RGB = "rgb(142, 119, 89)"; // market-flat #8E7759
const MARKET_FLAT_SOFT_RGB = "rgb(239, 231, 218)"; // market-flat-soft #EFE7DA

test.describe("设计系统预览 /design (Story 1.3)", () => {
  test("匿名访问返回 200，无 /login 重定向 (AD-8)", async ({ page }) => {
    const response = await page.goto("/design");

    expect(response, "/design should respond").not.toBeNull();
    expect(response!.status(), "/design status should be 200").toBe(200);
    expect(response!.url(), "/design should not redirect to login").not.toMatch(/\/login/);
  });

  test("AI 标签、筛选胶囊默认+激活、市场反应涨/跌/平 均可见", async ({ page }) => {
    await page.goto("/design");

    // AI label (accent-warm) text "AI" is visible.
    await expect(page.getByText("AI", { exact: true })).toBeVisible();

    // Filter pill — default and active states are both rendered with their
    // labels so either state can be asserted independently.
    await expect(page.getByText("全部", { exact: true })).toBeVisible();
    await expect(page.getByText("市场反应", { exact: true })).toBeVisible();

    // Market-reaction chips carry BOTH a Chinese text label (涨/跌/平) and a
    // numeric value — color is never the sole signal (a11y floor).
    await expect(page.getByText("涨", { exact: true })).toBeVisible();
    await expect(page.getByText("跌", { exact: true })).toBeVisible();
    await expect(page.getByText("平", { exact: true })).toBeVisible();
  });

  test("display 衬线标题可见", async ({ page }) => {
    await page.goto("/design");

    // The display sample heading is the page's Chinese H1 in font-display.
    await expect(
      page.getByRole("heading", { level: 1, name: "设计系统预览" }),
    ).toBeVisible();
  });

  test("body 背景为 canvas 暖底 token（非纯白）", async ({ page }) => {
    await page.goto("/design");

    // Pin the warm canvas token on the <body> element. The root layout sets
    // bg-canvas via className; the computed value is the DESIGN hex serialized
    // to rgb() by the browser.
    await expect(page.locator("body")).toHaveCSS("background-color", CANVAS_RGB);
  });

  test("chip 颜色锚定 @theme token 与品牌/市场解耦 (AC2)", async ({ page }) => {
    await page.goto("/design");

    // AI label — accent-warm background (DESIGN: reserved AI-marker color).
    await expect(page.getByText("AI", { exact: true })).toHaveCSS(
      "background-color",
      ACCENT_WARM_RGB,
    );

    // Active filter pill — brand background (brand is NEVER a market color per
    // DESIGN). The default pill "全部" stays on surface-base, so the brand bg
    // uniquely identifies the active state.
    await expect(page.getByText("市场反应", { exact: true })).toHaveCSS(
      "background-color",
      BRAND_RGB,
    );

    // Market-reaction chips: the tone label (涨/跌/平) is a direct child span,
    // so its parent IS the chip span carrying bg-*-soft + text-market-*. Assert
    // BOTH the soft background and the solid market text color on that chip,
    // pinning up=red / down=green / flat=neutral (A-share semantics + the
    // DESIGN decoupling a visibility-only test could not catch).
    const upChip = page.getByText("涨", { exact: true }).locator("xpath=..");
    await expect(upChip).toHaveCSS("background-color", MARKET_UP_SOFT_RGB);
    await expect(upChip).toHaveCSS("color", MARKET_UP_RGB);

    const downChip = page.getByText("跌", { exact: true }).locator("xpath=..");
    await expect(downChip).toHaveCSS("background-color", MARKET_DOWN_SOFT_RGB);
    await expect(downChip).toHaveCSS("color", MARKET_DOWN_RGB);

    const flatChip = page.getByText("平", { exact: true }).locator("xpath=..");
    await expect(flatChip).toHaveCSS("background-color", MARKET_FLAT_SOFT_RGB);
    await expect(flatChip).toHaveCSS("color", MARKET_FLAT_RGB);
  });

  test("排版三层 font-display / font-sans / font-mono 互异 (AC1)", async ({ page }) => {
    await page.goto("/design");

    // AC1 requires three DISTINCT type layers. Visibility alone cannot catch a
    // regression where the layers collapse to one face, so assert the computed
    // font-family of each sample differs. We compare the CSS list strings the
    // tokens resolve to (not the rendered glyph) — that is what proves a
    // distinct font-family token is applied per layer.
    const displayFF = await page
      .getByText("热点驱动判断")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    const bodyFF = await page
      .getByText("每一个公开呈现的热点事件")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    const numericFF = await page
      .getByText("12,847.50")
      .evaluate((el) => getComputedStyle(el).fontFamily);

    expect(displayFF, "display must differ from body").not.toBe(bodyFF);
    expect(numericFF, "numeric must differ from body").not.toBe(bodyFF);
    expect(displayFF, "display must differ from numeric").not.toBe(numericFF);
  });
});

test.describe("深色 OS 偏好下公共页面保持暖底亮色 (AC3)", () => {
  // Pin AC3: DESIGN V1 is warm-light only — there are no dark tokens, no theme
  // provider, and all `dark:` variants have been removed. Emulating
  // prefers-color-scheme: dark must NOT darken the page; the canvas stays the
  // warm-light token. This nails down the 1.1/1.2 deferred "dark OS makes the
  // homepage unreadable" item that 1.3 owns.
  test.use({ colorScheme: "dark" });

  test("/design body 背景仍为 canvas 暖底 token", async ({ page }) => {
    await page.goto("/design");
    await expect(page.locator("body")).toHaveCSS("background-color", CANVAS_RGB);
  });

  test("/ body 背景仍为 canvas 暖底 token", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", CANVAS_RGB);
  });
});
