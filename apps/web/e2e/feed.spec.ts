import { expect, test } from "@playwright/test";

/**
 * Public hot-event feed e2e — Story 1.7. Tagged @feed so it runs only under
 * `pnpm --filter web e2e:feed` (DB-backed + seed) and does NOT run under the
 * public `pnpm --filter web e2e` (which must stay DATABASE_URL-free — its
 * --grep-invert excludes both @console and @feed).
 *
 * Prerequisite: `pnpm --filter web seed:feed` must have been run to seed one
 * PUBLISHED hot event ("新能源汽车销量再创新高") and leave one UNPUBLISHED
 * candidate ("半导体出口同比下降"). The e2e:feed npm script runs the seed first.
 *
 * Requires request-time DATABASE_URL: the homepage is force-dynamic (Story 1.7)
 * and reads published_hot_events via getPrisma at request time. The public e2e
 * (home/navigation/design) also now needs DATABASE_URL at request time because
 * `goto("/")` hits the force-dynamic homepage — this is the intentional AD-3
 * evolution (Design Notes in spec-1-7), noted in home.spec.ts.
 *
 * Seed timestamp contract (AC3 date-window coverage): the single PUBLISHED
 * event is seeded at latestEvidenceAt = now - 2h (seed-feed.ts:62). That means
 * all three windows include it:
 *   - today (>= start of current UTC day): 2h ago is today.
 *   - 7d / 30d (>= now - 7d / 30d): 2h ago is well within both.
 * So the window tests assert the event VISIBLE under each window, plus the
 * active pill highlight per window. The "filter no-result" branch cannot be
 * reached by window alone on this seed; it is reached by combining a window
 * with an association concept that matches no event (the event has no
 * association row) — the same empty-state technique associations.spec.ts uses.
 *
 * Covers:
 *   - AD-8: `/` is anonymously reachable (200, no /login redirect).
 *   - AC1: the published event title is visible on `/`.
 *   - AC2: the unpublished candidate title does NOT leak to `/`.
 *   - AC3: date-window filter `?window=today|7d|30d` behavior, active pill
 *     highlight, and the "筛选无结果" empty-state branch.
 */

// Active filter-pill background — the brand token serialized to rgb() (matches
// design.spec.ts:31). The active pill uniquely carries bg-brand; default pills
// carry bg-surface-base. Pinning the rgb asserts the highlight is real, not a
// no-op className that resolved to nothing.
const BRAND_RGB = "rgb(33, 59, 99)"; // brand #213B63 (active filter-pill bg)

test.describe("公开热点事件流 (Story 1.7) @feed", () => {
  test("AD-8 匿名访问 / 返回 200 且无 /login 重定向", async ({ page }) => {
    const response = await page.goto("/");

    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);
    expect(response!.url(), "should remain on public homepage").toMatch(/\/$/);

    // The masthead renders (H1 + subtitle, unchanged from 1.1).
    await expect(
      page.getByRole("heading", { level: 1, name: "AGUHOT" }),
    ).toBeVisible();
    await expect(page.getByText("可信热点发布闭环")).toBeVisible();
  });

  test("AC1 已发布事件标题在 / 可见", async ({ page }) => {
    await page.goto("/");

    // The seeded published title surfaces on the public feed.
    await expect(
      page.getByText("新能源汽车销量再创新高").first(),
    ).toBeVisible();

    // The source count renders WITH its numeric value (seeded single-record
    // event → evidenceCount = 1). Assert the full "来源数 1" string so a
    // regression that renders the label without the number (or the wrong
    // number) fails loudly — not just the bare "来源数" label text.
    await expect(page.getByText("来源数 1").first()).toBeVisible();
  });

  test("AC2 未发布候选标题不泄漏到 /", async ({ page }) => {
    await page.goto("/");

    // The unpublished candidate must NOT appear on the public homepage.
    await expect(page.getByText("半导体出口同比下降")).toBeHidden();
  });

  test("AC3 ?window=today：今日窗口包含近期事件、pill 高亮", async ({ page }) => {
    // The seeded published event is 2h old (seed-feed.ts:62), so it falls
    // within the "今日" window (>= start of current UTC day).
    await page.goto("/?window=today");

    // The published event is still visible under the today window.
    await expect(
      page.getByText("新能源汽车销量再创新高").first(),
    ).toBeVisible();

    // The "今日" pill is the active one (brand background). The "全部" pill is
    // NOT active under ?window=today. This pins the highlight state for the
    // currently-selected window (AC3 active-pill).
    await expect(page.getByText("今日", { exact: true })).toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
    await expect(page.getByText("全部", { exact: true })).not.toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
  });

  test("AC3 ?window=7d：近7天窗口包含近期事件、pill 高亮", async ({ page }) => {
    // 2h-old event is within the 7d window.
    await page.goto("/?window=7d");

    await expect(
      page.getByText("新能源汽车销量再创新高").first(),
    ).toBeVisible();

    // The "近7天" pill is active; "今日" is not. Asserting a different pill
    // than the today test proves the highlight follows the URL, not a hard-
    // coded default.
    await expect(page.getByText("近7天", { exact: true })).toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
    await expect(page.getByText("今日", { exact: true })).not.toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
  });

  test("AC3 ?window=30d：近30天窗口包含近期事件、pill 高亮", async ({ page }) => {
    // 2h-old event is within the 30d window.
    await page.goto("/?window=30d");

    await expect(
      page.getByText("新能源汽车销量再创新高").first(),
    ).toBeVisible();

    // The "近30天" pill is active; "全部" is not.
    await expect(page.getByText("近30天", { exact: true })).toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
    await expect(page.getByText("全部", { exact: true })).not.toHaveCSS(
      "background-color",
      BRAND_RGB,
    );
  });

  test("AC3 筛选无结果：window + 无匹配 concept → 空态 + 查看全部清除", async ({
    page,
  }) => {
    // The seeded event has NO association row (seed-feed.ts seeds evidence only,
    // no associations). Combining a window with a concept that matches nothing
    // empties the visible list → the "当前筛选条件下无热点事件。" branch. This
    // is the same empty-state technique associations.spec.ts uses, here
    // combined with a window to also exercise the AND of the two filters.
    await page.goto(
      `/?window=today&concept=${encodeURIComponent("不存在的概念XYZ")}`,
    );

    // The published event is filtered out (concept matches no event).
    await expect(page.getByText("新能源汽车销量再创新高")).toHaveCount(0);

    // The empty-state copy renders (AC3 "筛选无结果" branch).
    await expect(
      page.getByText("当前筛选条件下无热点事件。"),
    ).toBeVisible();

    // The clear affordance renders and links to "/" (the bare href the C2 fix
    // mandates — not a querystring that would re-apply some filter).
    const clearLink = page.getByRole("link", { name: "查看全部" });
    await expect(clearLink).toBeVisible();
    await expect(clearLink).toHaveAttribute("href", "/");

    // Clicking it returns the feed to the unfiltered default (event reappears).
    await clearLink.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("新能源汽车销量再创新高").first(),
    ).toBeVisible();
  });
});
