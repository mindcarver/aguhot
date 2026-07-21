import { expect, test } from "@playwright/test";

import {
  clearSurgeCalendarFixture,
  seedSurgeCalendar,
  SURGE_FIXTURE,
} from "./seed-surge-calendar";

test.describe("大涨日历 @surge-calendar", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(seedSurgeCalendar);
  test.afterAll(clearSurgeCalendarFixture);

  test("日历展示已发布的大涨日，并声明 noindex 与非投资建议", async ({ page }) => {
    const response = await page.goto("/surge-calendar");
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: "大涨日历" })).toBeVisible();
    await expect(page.getByText("历史统计回顾，非预测、非投资建议")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
    const day = page.getByRole("link", {
      name: `${SURGE_FIXTURE.completeDate} 大涨日，查看详情`,
    });
    await expect(day).toHaveAttribute("href", `/surge-calendar/${SURGE_FIXTURE.completeDate}`);
  });

  test("完整事实详情展示触发宽基、领涨板块、市场广度与实际收益", async ({ page }) => {
    const response = await page.goto(`/surge-calendar/${SURGE_FIXTURE.completeDate}`);
    expect(response?.status()).toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: `${SURGE_FIXTURE.completeDate} 大涨日回顾` })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "当日宽基" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "领涨板块（申万一级）" })).toBeVisible();
    await expect(page.getByText("电子")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "上涨后历史实际收益" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "市场广度" })).toBeVisible();
    await expect(page.getByText("38 家涨停")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
  });

  test("缺失的可选事实仅显示所在分区的诚实空态", async ({ page }) => {
    await page.goto(`/surge-calendar/${SURGE_FIXTURE.incompleteDate}`);

    await expect(page.getByRole("heading", { level: 2, name: "当日宽基" })).toBeVisible();
    await expect(page.getByText("该日领涨板块数据暂不可用。")).toBeVisible();
    await expect(page.getByText("该日广度数据暂不可用。")).toBeVisible();
    await expect(page.getByText("深证成指").first()).toBeVisible();
    await expect(page.getByText("数据暂不可用").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "上涨后历史实际收益" })).toBeVisible();
    await expect(page.getByText("—").first()).toBeVisible();
  });

  test("无效日期及没有已发布行的日期均严格返回 404", async ({ page }) => {
    const malformed = await page.goto("/surge-calendar/not-a-date");
    expect(malformed?.status()).toBe(404);

    const absent = await page.goto("/surge-calendar/2031-06-20");
    expect(absent?.status()).toBe(404);
  });

  test("桌面侧栏与移动抽屉均可进入日历", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("complementary", { name: "主导航" }).getByRole("link", { name: "大涨日历" }).click();
    await expect(page).toHaveURL(/\/surge-calendar\/?$/);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: /导航菜单/ }).click();
    const drawer = page.getByRole("dialog", { name: "导航菜单" });
    await drawer.getByRole("link", { name: "大涨日历" }).click();
    await expect(page).toHaveURL(/\/surge-calendar\/?$/);
  });
});
