import { expect, test } from "@playwright/test";

import { seedAssociationEvents } from "./seed-associations";

/**
 * Public hot-event detail association e2e — Story 2.2. Tagged @associations so
 * it runs only under `pnpm --filter web e2e:associations` (DB-backed + seed)
 * and does NOT run under the public `pnpm --filter web e2e` (whose
 * --grep-invert excludes @console, @feed, @detail, @revision, @merge-split,
 * @market-reaction, AND @associations).
 *
 * The beforeAll imports and runs seedAssociationEvents() (the same function
 * `pnpm --filter web seed:associations` runs) to capture the dynamic withAssoc
 * + withoutAssoc hotEventIds + the stub concept label.
 *
 * Requires request-time DATABASE_URL: the detail route is force-dynamic (Story
 * 1.8) and reads the published read models via getPrisma at request time.
 *
 * Covers:
 *   - AC1: /events/{withAssocId} is 200, the "关联" heading renders, the
 *     concept/industry/stock groups render their confirmed items, each item is a
 *     clickable link to `/?<kind>=<label>`, and clicking a concept link lands on
 *     a filtered feed that includes the source event (non-dead-link).
 *   - AC2: the "关联依据：系统映射" provenance line renders.
 *   - AC3: /events/{withoutAssocId} is 200, the "关联" block renders the honest
 *     "暂无已确认的概念 / 行业 / 个股关联。" degraded line, and NO association
 *     pills appear.
 *   - NFR5 no-regression: the existing partitions (发生了什么 / 为什么重要 /
 *     当前仍不确定什么) + market-reaction + evidence timeline still render for
 *     both events.
 */

test.describe("概念/行业/个股关联展示 (Story 2.2) @associations", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let withAssoc: { hotEventId: string; title: string };
  let withoutAssoc: { hotEventId: string; title: string };
  let stubConcept: string;

  test.beforeAll(async () => {
    const seeded = await seedAssociationEvents();
    withAssoc = { hotEventId: seeded.withAssocHotEventId, title: seeded.withAssocTitle };
    withoutAssoc = {
      hotEventId: seeded.withoutAssocHotEventId,
      title: seeded.withoutAssocTitle,
    };
    stubConcept = seeded.stubConcept;
  });

  test("AC1/AC2 已发布+关联：分组项可见、每项可点击链、provenance 可见", async ({ page }) => {
    const response = await page.goto(`/events/${withAssoc.hotEventId}`);
    expect(response, "with-assoc detail should respond").not.toBeNull();
    expect(response!.status(), "with-assoc detail status should be 200").toBe(200);

    // The association heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: "关联" }),
    ).toBeVisible();

    const assocSection = page.locator("section", { hasText: "关联" }).first();

    // AC1: the three group titles render (概念 / 行业 / 个股).
    await expect(assocSection.getByText("概念")).toBeVisible();
    await expect(assocSection.getByText("行业")).toBeVisible();
    await expect(assocSection.getByText("个股")).toBeVisible();

    // AC1: the stub fixture labels render (半导体 concept / 芯片 industry /
    // 中芯国际 stock).
    await expect(assocSection.getByText("半导体")).toBeVisible();
    await expect(assocSection.getByText("芯片")).toBeVisible();
    await expect(assocSection.getByText("中芯国际")).toBeVisible();

    // AC1: each item is a clickable link to /?<kind>=<label>. The concept link
    // points to /?concept=半导体 (URL-encoded).
    const conceptLink = assocSection.getByRole("link", { name: "半导体" });
    await expect(conceptLink).toBeVisible();
    await expect(conceptLink).toHaveAttribute(
      "href",
      `/?concept=${encodeURIComponent("半导体")}`,
    );

    // AC2: the provenance line renders.
    await expect(assocSection.getByText("关联依据：系统映射")).toBeVisible();

    // The degraded line must NOT appear (associations were projected).
    await expect(
      assocSection.getByText("暂无已确认的概念 / 行业 / 个股关联。"),
    ).toHaveCount(0);
  });

  test("AC1 关联 chip 跳转命中过滤 feed（非死链）", async ({ page }) => {
    // Click the concept link from the detail page → lands on a filtered feed.
    await page.goto(`/events/${withAssoc.hotEventId}`);
    const assocSection = page.locator("section", { hasText: "关联" }).first();
    const conceptLink = assocSection.getByRole("link", { name: "半导体" });
    await conceptLink.click();

    // The URL now carries ?concept=半导体.
    await expect(page).toHaveURL(new RegExp(`\\?concept=${encodeURIComponent("半导体")}$`));

    // AC1 non-dead-link: the feed shows at least the source event (its title
    // must appear in the filtered list). The active filter pill renders the
    // concept dimension so it is clearable.
    await expect(page.getByText(withAssoc.title)).toBeVisible();
    await expect(page.getByText(`概念：${stubConcept}`)).toBeVisible();

    // V1: verify the filter's exclude branch — the non-matching seeded event
    // (no association row) must NOT appear under an active concept filter. This
    // is the load-bearing half of "non-dead-link": the filter actually narrows
    // the feed, not a no-op that shows everything.
    await expect(page.getByText(withoutAssoc.title)).toHaveCount(0);
  });

  test("AC1 关联过滤空态 + 清除返回正常 feed @associations", async ({ page }) => {
    // V2: a concept label that matches no event → empty-state + clear affordance.
    await page.goto(`/?concept=${encodeURIComponent("不存在的概念XYZ")}`);

    // The feed shows the empty-state text (filter is active but matches nothing).
    await expect(page.getByText("当前筛选条件下无热点事件。")).toBeVisible();

    // A clear affordance is visible (the 查看全部 link to /).
    const clearLink = page.getByRole("link", { name: "查看全部" });
    await expect(clearLink).toBeVisible();
    await expect(clearLink).toHaveAttribute("href", "/");

    // Click the clear link and assert the feed returns to showing events (the
    // published seeded event reappears → no longer empty).
    await clearLink.click();
    await expect(page).toHaveURL(/\//);
    await expect(page.getByText(withAssoc.title)).toBeVisible();
  });

  test("AC3 已发布无关联：关联区块显降级文案、无关联项", async ({ page }) => {
    const response = await page.goto(`/events/${withoutAssoc.hotEventId}`);
    expect(response, "without-assoc detail should respond").not.toBeNull();
    expect(response!.status(), "without-assoc detail status should be 200").toBe(200);

    // The association heading still renders (the block is present, just
    // degraded — NFR5: absence is shown as absence, never silent omission).
    await expect(
      page.getByRole("heading", { level: 2, name: "关联" }),
    ).toBeVisible();

    const assocSection = page.locator("section", { hasText: "关联" }).first();

    // AC3: the honest degraded line renders.
    await expect(
      assocSection.getByText("暂无已确认的概念 / 行业 / 个股关联。"),
    ).toBeVisible();

    // AC3: the provenance line must NOT appear (no associations were projected).
    await expect(assocSection.getByText("关联依据：系统映射")).toHaveCount(0);
  });

  test("NFR5 不回归：既有五分区 + 证据时间线在两个事件上均照常渲染", async ({ page }) => {
    // with-assoc event: existing partitions + market-reaction + evidence timeline intact.
    await page.goto(`/events/${withAssoc.hotEventId}`);
    await expect(
      page.getByRole("heading", { level: 2, name: "发生了什么" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "为什么重要" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "当前仍不确定什么" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "市场反应" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();

    // without-assoc event: existing partitions + market-reaction + evidence timeline intact.
    await page.goto(`/events/${withoutAssoc.hotEventId}`);
    await expect(
      page.getByRole("heading", { level: 2, name: "发生了什么" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "为什么重要" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "当前仍不确定什么" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "市场反应" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();
  });
});
