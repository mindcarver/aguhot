import { expect, test } from "@playwright/test";

import { seedMarketReactionEvents } from "./seed-market-reaction";

/**
 * Public hot-event detail market-reaction e2e — Story 2.1. Tagged @market-reaction
 * so it runs only under `pnpm --filter web e2e:market-reaction` (DB-backed +
 * seed) and does NOT run under the public `pnpm --filter web e2e` (whose
 * --grep-invert excludes @console, @feed, @detail, @revision, @merge-split, AND
 * @market-reaction).
 *
 * The beforeAll imports and runs seedMarketReactionEvents() (the same function
 * `pnpm --filter web seed:market-reaction` runs) to capture the dynamic
 * withReaction + withoutReaction hotEventIds.
 *
 * Requires request-time DATABASE_URL: the detail route is force-dynamic (Story
 * 1.8) and reads the published read models via getPrisma at request time.
 *
 * Covers:
 *   - AC2: /events/{withReactionId} is 200, the "市场反应" heading renders, the
 *     two reaction chips are visible (涨 label + value), and the tradingSession
 *     time context renders.
 *   - AC3: /events/{withoutReactionId} is 200, the "市场反应" block renders the
 *     honest "市场反应数据暂不可用。" degraded line, and NO reaction chips appear.
 *   - NFR5 no-regression: the existing three partitions (发生了什么 / 为什么
 *     重要 / 当前仍不确定什么) + evidence timeline still render for both events.
 */

test.describe("市场反应信号展示 (Story 2.1) @market-reaction", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let withReaction: { hotEventId: string; title: string };
  let withoutReaction: { hotEventId: string; title: string };

  test.beforeAll(async () => {
    const seeded = await seedMarketReactionEvents();
    withReaction = { hotEventId: seeded.withReactionHotEventId, title: seeded.withReactionTitle };
    withoutReaction = {
      hotEventId: seeded.withoutReactionHotEventId,
      title: seeded.withoutReactionTitle,
    };
  });

  test("AC2 已发布+reaction：市场反应区块显两类 chip + tradingSession 时间语境", async ({ page }) => {
    const response = await page.goto(`/events/${withReaction.hotEventId}`);
    expect(response, "with-reaction detail should respond").not.toBeNull();
    expect(response!.status(), "with-reaction detail status should be 200").toBe(200);

    // The market-reaction heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: "市场反应" }),
    ).toBeVisible();

    // The reaction section.
    const reactionSection = page.locator("section", { hasText: "市场反应" }).first();

    // AC2: both reaction chips carry the 涨 label (the stub fixture is all-up).
    // The ReactionChip renders the label inside a <span> + the value in a
    // font-mono <span>. We assert the 涨 labels are present (one per chip).
    // The price/volume chip value is "+3.42%" and the sector/limit-up chip value
    // contains "半导体" + "涨停 5 家" (from the stub fixture).
    await expect(reactionSection.getByText("涨").first()).toBeVisible();
    await expect(reactionSection.getByText(/\+3\.42%/)).toBeVisible();
    await expect(reactionSection.getByText(/半导体/)).toBeVisible();
    await expect(reactionSection.getByText(/涨停/)).toBeVisible();

    // The tradingSession time context renders (prefixed by 交易时段).
    await expect(reactionSection.getByText(/交易时段/)).toBeVisible();

    // The degraded line must NOT appear (a reaction was projected).
    await expect(reactionSection.getByText("市场反应数据暂不可用。")).toHaveCount(0);
  });

  test("AC3 已发布无 reaction：市场反应区块显降级文案、无 chip", async ({ page }) => {
    const response = await page.goto(`/events/${withoutReaction.hotEventId}`);
    expect(response, "without-reaction detail should respond").not.toBeNull();
    expect(response!.status(), "without-reaction detail status should be 200").toBe(200);

    // The market-reaction heading still renders (the block is present, just
    // degraded — NFR5: absence is shown as absence, never silent omission).
    await expect(
      page.getByRole("heading", { level: 2, name: "市场反应" }),
    ).toBeVisible();

    const reactionSection = page.locator("section", { hasText: "市场反应" }).first();

    // AC3: the honest degraded line renders.
    await expect(reactionSection.getByText("市场反应数据暂不可用。")).toBeVisible();

    // AC3: NO reaction chips appear (the 涨/跌/平 labels must not render in the
    // degraded block — they only exist inside ReactionChip).
    await expect(reactionSection.getByText("涨")).toHaveCount(0);
    await expect(reactionSection.getByText("跌")).toHaveCount(0);
    await expect(reactionSection.getByText("平")).toHaveCount(0);
  });

  test("NFR5 不回归：既有三分区 + 证据时间线在两个事件上均照常渲染", async ({ page }) => {
    // with-reaction event: three partitions + evidence timeline intact.
    await page.goto(`/events/${withReaction.hotEventId}`);
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
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();

    // without-reaction event: three partitions + evidence timeline intact.
    await page.goto(`/events/${withoutReaction.hotEventId}`);
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
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();
  });
});
