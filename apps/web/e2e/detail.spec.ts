import { expect, test } from "@playwright/test";

import { seedDetailEvents } from "./seed-detail";

/**
 * Public hot-event detail e2e — Story 1.8. Tagged @detail so it runs only under
 * `pnpm --filter web e2e:detail` (DB-backed + seed) and does NOT run under the
 * public `pnpm --filter web e2e` (whose --grep-invert excludes @console, @feed,
 * AND @detail).
 *
 * The beforeAll imports and runs seedDetailEvents() (the same function
 * `pnpm --filter web seed:detail` runs) to capture the dynamic published +
 * unpublished hotEventIds — the published id is needed to navigate to
 * /events/{id}, and the unpublished id is needed to assert the 404 (it cannot be
 * discovered via the UI since it is correctly hidden).
 *
 * Requires request-time DATABASE_URL: the detail route is force-dynamic (Story
 * 1.8) and reads the published read models via getPrisma at request time. This
 * is the same AD-3 evolution as the 1.7 homepage (Design Notes in spec-1-7).
 *
 * Covers:
 *   - AD-8: /events/{publishedId} is anonymously reachable (200, no /login).
 *   - AC1: the three partition headings render (发生了什么 / 为什么重要 /
 *     当前仍不确定什么).
 *   - AC3: the system-derived explanation partitions carry the uniform AI label.
 *   - AC2: the evidence timeline renders rows with source name + time, and both
 *     "原文链接 ↗" and the "无原始链接" badge appear (the url-missing row is NOT
 *     silently dropped).
 *   - AD-8 / unpublished: /events/{unpublishedId} returns 404 (no leak).
 *   - NFR degraded state: a published event WITHOUT a generated explanation
 *     renders the honest "系统解释生成中。" line (never fabricated text) while the
 *     facts partition still shows title + source count.
 *   - Whole-card link (1.7 defer landed): the feed card on `/` links to
 *     /events/{publishedId}.
 */

test.describe("热点事件详情与证据时间线 (Story 1.8) @detail", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let published: { hotEventId: string; title: string };
  let unpublished: { hotEventId: string; title: string };
  let degraded: { hotEventId: string; title: string };

  test.beforeAll(async () => {
    const seeded = await seedDetailEvents();
    published = { hotEventId: seeded.publishedHotEventId, title: seeded.publishedTitle };
    unpublished = { hotEventId: seeded.unpublishedHotEventId, title: seeded.unpublishedTitle };
    degraded = { hotEventId: seeded.degradedHotEventId, title: seeded.degradedTitle };
  });

  test("AD-8 匿名访问 /events/{publishedId} 返回 200 且无 /login 重定向", async ({ page }) => {
    const response = await page.goto(`/events/${published.hotEventId}`);

    expect(response, "detail page should respond").not.toBeNull();
    expect(response!.status(), "detail page status should be 200").toBe(200);
    expect(response!.url(), "should remain on the detail page").toContain(
      `/events/${published.hotEventId}`,
    );
  });

  test("AC1 三个分区标题可见（发生了什么 / 为什么重要 / 当前仍不确定什么）", async ({ page }) => {
    await page.goto(`/events/${published.hotEventId}`);

    await expect(page.getByRole("heading", { level: 2, name: "发生了什么" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "为什么重要" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "当前仍不确定什么" })).toBeVisible();

    // The title (h1) renders the published event title.
    await expect(
      page.getByRole("heading", { level: 1, name: published.title}),
    ).toBeVisible();
  });

  test("AC3 系统解释分区挂统一 AI 标识", async ({ page }) => {
    await page.goto(`/events/${published.hotEventId}`);

    // The AiLabel chip is targeted by its distinctive `bg-accent-warm` class,
    // NOT by the literal text "AI" — a substring match would false-positive on
    // any explanation/summary copy that happens to contain "AI" (e.g. an
    // "AI芯片" hot-event topic).
    const whyItMattersSection = page.locator("section", { hasText: "为什么重要" }).first();
    await expect(whyItMattersSection.locator(".bg-accent-warm")).toBeVisible();

    const uncertaintiesSection = page.locator("section", { hasText: "当前仍不确定什么" }).first();
    await expect(uncertaintiesSection.locator(".bg-accent-warm")).toBeVisible();
  });

  test("AC2 证据时间线渲染来源名/时间，原文链接与无原始链接徽标均出现", async ({ page }) => {
    await page.goto(`/events/${published.hotEventId}`);

    // The evidence timeline heading renders.
    await expect(page.getByRole("heading", { level: 2, name: "证据时间线" })).toBeVisible();

    // The seeded source name appears on each evidence row.
    await expect(page.getByText("detail-e2e-source").first()).toBeVisible();

    // The url-present row renders the "原文链接 ↗" external link.
    await expect(page.getByRole("link", { name: /原文链接/ }).first()).toBeVisible();

    // The url-missing row renders the "无原始链接" badge — and the row is NOT
    // silently dropped (the badge is visible alongside the other rows).
    await expect(page.getByText("无原始链接").first()).toBeVisible();
  });

  test("NFR 解释缺失降级：发布但无解释时显诚实降级文案、不伪造、事实仍渲染", async ({ page }) => {
    // Matrix row "解释缺失降级": a published event whose explain job never ran
    // has a summary row but NO explanation projection. The page must keep the
    // three-partition structure, render the honest "系统解释生成中。" line in the
    // explanation partitions (NOT fabricated explanation text), drop the AI
    // label on those partitions, and still render the facts (title + 来源数).
    const response = await page.goto(`/events/${degraded.hotEventId}`);
    expect(response, "degraded detail should respond").not.toBeNull();
    expect(response!.status(), "degraded detail status should be 200").toBe(200);

    // The three partition headings still render (structure intact).
    await expect(page.getByRole("heading", { level: 2, name: "发生了什么" })).toBeVisible();
    const whyItMatters = page.locator("section", { hasText: "为什么重要" }).first();
    const uncertainties = page.locator("section", { hasText: "当前仍不确定什么" }).first();

    // Honest degraded copy (NOT fabricated explanation) in both partitions.
    await expect(whyItMatters.getByText("系统解释生成中。")).toBeVisible();
    await expect(uncertainties.getByText("系统解释生成中。")).toBeVisible();

    // No AI label on the degraded partitions (hasExplanation === false).
    await expect(whyItMatters.getByText("AI")).toHaveCount(0);
    await expect(uncertainties.getByText("AI")).toHaveCount(0);

    // The degraded event's title (a fact) still renders.
    await expect(
      page.getByRole("heading", { level: 1, name: degraded.title }),
    ).toBeVisible();
  });

  test("未发布 id 访问 /events/{unpublishedId} 返回 404（不泄漏）", async ({ page }) => {
    const response = await page.goto(`/events/${unpublished.hotEventId}`);

    expect(response, "unpublished detail should respond").not.toBeNull();
    expect(response!.status(), "unpublished detail should 404").toBe(404);

    // The unpublished candidate title must NOT appear anywhere on the 404 page.
    await expect(page.getByText(unpublished.title)).toHaveCount(0);
  });

  test("整卡进详情：首页卡片为指向 /events/{id} 的链接", async ({ page }) => {
    await page.goto("/");

    // The feed card links to the published event's detail page.
    const detailLink = page.getByRole("link", { name: new RegExp(published.title) });
    await expect(detailLink.first()).toBeVisible();
    await expect(detailLink.first()).toHaveAttribute(
      "href",
      `/events/${published.hotEventId}`,
    );

    // Clicking the card navigates to the detail page.
    await detailLink.first().click();
    await expect(page).toHaveURL(new RegExp(`/events/${published.hotEventId}`));
    await expect(
      page.getByRole("heading", { level: 1, name: published.title }),
    ).toBeVisible();
  });
});
