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
 * Covers:
 *   - AD-8: `/` is anonymously reachable (200, no /login redirect).
 *   - AC1: the published event title is visible on `/`.
 *   - AC2: the unpublished candidate title does NOT leak to `/` (public reads
 *     only published_hot_events; candidates never have a row).
 */

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

    // The source count renders (evidenceCount = 1 for the seeded single-record event).
    await expect(page.getByText("来源数").first()).toBeVisible();
  });

  test("AC2 未发布候选标题不泄漏到 /", async ({ page }) => {
    await page.goto("/");

    // The unpublished candidate must NOT appear on the public homepage.
    await expect(page.getByText("半导体出口同比下降")).toBeHidden();
  });
});
