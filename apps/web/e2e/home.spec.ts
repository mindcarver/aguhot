import { expect, test } from "@playwright/test";

/**
 * Anonymous homepage smoke test — Story 1.1.
 *
 * Covers the I/O matrix row "首页匿名渲染":
 *   - GET / returns 200
 *   - the public shell + default entry copy renders
 *   - no /login redirect (AD-8: public paths are anonymously usable)
 *
 * No DB/Redis is required: the homepage is a static server component.
 */
test.describe("匿名公共首页 (Story 1.1)", () => {
  test("访问 / 返回 200 且渲染公共骨架文案", async ({ page }) => {
    const response = await page.goto("/");

    // 1. HTTP 200
    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);

    // 2. Public shell + default entry copy renders (surface-anchored text).
    await expect(
      page.getByRole("heading", { level: 1, name: "AGUHOT" }),
    ).toBeVisible();
    await expect(page.getByText("可信热点发布闭环")).toBeVisible();
  });

  test("匿名访问不触发任何 /login 重定向 (AD-8)", async ({ page }) => {
    const response = await page.goto("/");

    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.url(), "should remain on public homepage").toMatch(/\/$/);
    expect(response!.status(), "should be 200, not redirected to login").toBe(200);

    // No auth wall: the public shell copy is visible without any session.
    await expect(
      page.getByRole("heading", { level: 1, name: "AGUHOT" }),
    ).toBeVisible();
  });
});
