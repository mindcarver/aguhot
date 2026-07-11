import { expect, test } from "@playwright/test";

import { seedTimelineFeed, type SeededTimeline } from "./seed-timeline";

/**
 * Public timeline feed surface e2e — Story 4.2 (Epic 4 时间流首页).
 *
 * Surface-anchored structure + empty-state assertions for the post-pivot home
 * page. NO seed step required (per spec Code Map): the assertions target the
 * always-present shell + the regions that render regardless of whether the read
 * model has rows. This mirrors home.spec.ts's strategy (assert the surface, not
 * the content) so the test holds whether the local PG is empty or holds prior-
 * seed data.
 *
 * The homepage is `force-dynamic` and reads `published_timeline` +
 * `published_hot_events` via getPrisma at request time (AD-3 / AD-3b evolution).
 * Like home.spec.ts, this test needs request-time DATABASE_URL — the dev/CI
 * environment runs local PG, so `goto("/")` resolves. An unreachable DB surfaces
 * as a loud route error (NFR-2: DB is core infra, not graceful-degradation
 * territory); the test does NOT assert that error path.
 *
 * Covers (per spec Acceptance Criteria):
 *   - Masthead non-regression: H1「AGUHOT」+「可信热点发布闭环」still render
 *     (home.spec.ts's contract preserved — the 4.2 rewrite keeps the header
 *     byte-for-byte).
 *   - AD-8: anonymous GET / returns 200, no /login redirect.
 *   - Timeline region structure: the `<section aria-label="时间流">` region is
 *     present on every render (empty or populated).
 *   - No residual priority-filter UI: the V1 `FeedFilters` (`<nav
 *     aria-label="筛选">`) was removed in 4.2 (4.3 owns the new session/category
 *     filter UI). The old priority filter pills (今日 / 近7天 / 近30天 / 全部)
 *     must NOT render on the home anymore.
 *
 * NOT covered here (deferred to the @timeline seeded block below):
 *   - Empty-state copy + 最近更新 — needs a deterministic empty DB, covered by
 *     the @timeline block (which clears published_timeline_entries then asserts).
 *   - Populated timeline cards / fold disclosure / reading order / AI 解读 slot
 *     / main-line-band items — all covered by the @timeline seeded block.

test.describe("时间流首页 (Story 4.2)", () => {
  test("匿名访问 / 仍渲染 masthead 且不触发 /login 重定向 (AD-8, masthead 不回归)", async ({
    page,
  }) => {
    const response = await page.goto("/");

    // 1. HTTP 200, no /login redirect (AD-8: public paths stay anonymous).
    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);
    expect(response!.url(), "should remain on public homepage").toMatch(/\/$/);

    // 2. Masthead preserved byte-for-byte from 1.1 (home.spec.ts contract).
    await expect(
      page.getByRole("heading", { level: 1, name: "AGUHOT" }),
    ).toBeVisible();
    await expect(page.getByText("可信热点发布闭环")).toBeVisible();
  });

  test("时间流区块结构存在 (section[aria-label=时间流] 始终渲染)", async ({ page }) => {
    await page.goto("/");

    // The timeline region is present on every render (empty or populated).
    // This is the structural anchor for the post-pivot home body.
    await expect(page.locator("section[aria-label='时间流']")).toBeVisible();
  });

  test("无残留优先级 filter pill (V1 FeedFilters 已从首页移除)", async ({ page }) => {
    await page.goto("/");

    // The V1 priority-feed filter UI (FeedFilters, `<nav aria-label="筛选">`)
    // was removed in 4.2. The old window pills (今日 / 近7天 / 近30天 / 全部)
    // must NOT render on the home anymore — 4.3 owns the new session/category
    // filter UI. Asserting the filter nav is absent pins this removal.
    await expect(
      page.locator("nav[aria-label='筛选']"),
      "V1 priority filter nav should be removed from the home",
    ).toHaveCount(0);
  });
});

/**
 * Populated-feed e2e — Story 4.2 (Epic 4 时间流首页) @timeline.
 *
 * Tagged @timeline so it runs only under `pnpm --filter web e2e:timeline` (DB-
 * backed + seed) and is excluded from the public `pnpm --filter web e2e` run
 * (whose --grep-invert list now includes @timeline). The beforeAll seeds TWO
 * published events via the real publish pipeline (seed-timeline.ts):
 *   - folded: 半导体 event with 2 member evidence records → evidenceCount 2 →
 *     foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD(2) → 「同事件精选」.
 *   - single: 稀土 event with 1 member evidence record → single-source card.
 *
 * This block covers the I/O & Edge-Case Matrix rows the surface-anchored tests
 * above cannot (they need a populated read model):
 *   - 时间流默认视图 (cards render in the fixed reading order)
 *   - 折叠条目 (fold tag + disclosure of N sources)
 *   - 单源条目 (no fold tag, no reason tag — FR-3 revised)
 *   - main-line-band 置顶项 (top-N saliency band renders + links)
 *   - AI 解读槽 null (recommendationReason stays NULL pre-5.1 → no AiLabel)
 *
 * Requires request-time DATABASE_URL (the home is force-dynamic). The seed
 * clears the full table set so re-runs are deterministic.
 */
test.describe("时间流首页 — 播种数据面 (Story 4.2) @timeline", () => {
  test.describe.configure({ mode: "serial" });

  let seeded: SeededTimeline;

  test.beforeAll(async () => {
    seeded = await seedTimelineFeed();
  });

  test("main-line-band 渲染 top-3 saliency、每项可点进详情、诚实理由标签 (FR-3)", async ({
    page,
  }) => {
    await page.goto("/");

    // The band is a region whose accessible name comes from its heading.
    const band = page.getByRole("region", { name: "今日重点 / 市场主线" });
    await expect(band, "main-line band renders when hot-events has data").toBeVisible();
    // The seeded events surface as band links.
    await expect(band.getByRole("link", { name: /半导体/ })).toBeVisible();
    await expect(band.getByRole("link", { name: /稀土/ })).toBeVisible();

    // top-N slice: 4 events published, band caps at MAIN_LINE_BAND_TOP_N (3).
    await expect(band.locator("li")).toHaveCount(3);

    // Honest ranking-reason tag: all seeded events are ~2h old (within 72h) →
    // each band item carries「近期升温」. Pins the positive reason branch (a
    // regression that drops the tag, or inverts recency-wins, fails here).
    await expect(
      band.getByText("近期升温", { exact: true }).first(),
      "近期升温 renders on a recent band item",
    ).toBeVisible();
  });

  test("时间流卡按固定阅读顺序渲染 + 整卡可点进详情（折叠卡）", async ({ page }) => {
    await page.goto("/");

    const timeline = page.locator("section[aria-label='时间流']");
    const foldedCard = timeline.locator("li", { hasText: "半导体" }).first();

    await expect(foldedCard, "folded timeline card renders").toBeVisible();

    // Reading order is ORDINAL (DESIGN timeline-card, UX-DR4b): timestamp →
    // source → title → summary → (AI) → evidence count. Assert vertical order
    // via bounding-box y positions, not just presence — a reorder that placed
    // the count above the title would otherwise pass.
    const tsY = await topY(foldedCard.getByText(/UTC$/));
    const srcY = await topY(foldedCard.getByText("timeline-e2e-半导体源").first());
    const titleY = await topY(foldedCard.getByRole("heading", { level: 2 }));
    // The count <dl> is unique (the disclosure's "精选自 N 条证据源" lives in a
    // <p>, not a dl), so scope by element rather than text to avoid an ambiguity.
    const countY = await topY(foldedCard.locator("dl"));
    expect(tsY, "timestamp above source").toBeLessThan(srcY);
    expect(srcY, "source above title").toBeLessThan(titleY);
    expect(titleY, "title above evidence count").toBeLessThan(countY);

    // The seed generates a template explanation → summary is non-empty and
    // renders between title and count.
    await expect(
      foldedCard.locator("p.text-sm.text-ink-secondary").first(),
      "summary paragraph renders (non-empty)",
    ).toBeVisible();

    // Whole-card click → detail page (1.8 pattern applied to the timeline card).
    await expect(foldedCard.getByRole("link")).toHaveAttribute(
      "href",
      `/events/${seeded.folded.hotEventId}`,
    );
  });

  test("折叠卡「同事件精选」<details> 可展开并披露 N 源 (FR-3 revised)", async ({ page }) => {
    await page.goto("/");

    const foldedCard = page
      .locator("section[aria-label='时间流'] li", { hasText: "半导体" })
      .first();

    // The fold tag (the <summary>) is always visible.
    await expect(foldedCard.getByText("同事件精选")).toBeVisible();

    // The disclosure is a SIBLING of the Link (review fix: a <summary> inside
    // an <a> navigates on toggle). Clicking the summary must TOGGLE the
    // disclosure, not navigate — assert the body becomes visible after click
    // and the page stays on /.
    const summary = foldedCard.locator("summary", { hasText: "同事件精选" });
    await summary.click();
    await expect(foldedCard.locator("details")).toContainText(/精选自 2 条证据源/);
    await expect(page).toHaveURL(/\/$/);
  });

  test("单源卡不带「同事件精选」标签，整卡仍可点进详情 (FR-3 revised)", async ({ page }) => {
    await page.goto("/");

    const singleCard = page
      .locator("section[aria-label='时间流'] li", { hasText: "稀土" })
      .first();

    await expect(singleCard, "single-source timeline card renders").toBeVisible();
    await expect(
      singleCard.getByText("同事件精选"),
      "single-source card has no fold tag",
    ).toHaveCount(0);
    // Every card is a whole-card link, not just the folded one.
    await expect(singleCard.getByRole("link")).toHaveAttribute(
      "href",
      `/events/${seeded.single.hotEventId}`,
    );
  });

  test("5.1 前 AI 解读槽不渲染（recommendationReason=null → 无 AiLabel）", async ({ page }) => {
    await page.goto("/");

    const timeline = page.locator("section[aria-label='时间流']");
    // AiLabel renders the exact uppercase text "AI"; pre-5.1 the slot is null on
    // every card, so no "AI" text node and no "AI 解读" copy render in the feed.
    await expect(
      timeline.getByText("AI", { exact: true }),
      "no AiLabel renders while recommendationReason is null",
    ).toHaveCount(0);
  });

  test("空态面：published_timeline 为空时渲染诚实空态 + 最近更新 (NFR-2)", async ({ page }) => {
    // Deterministic empty read model: clear the timeline projection directly,
    // then reload. (Runs after the populated tests in serial mode; the next
    // @timeline run re-seeds in beforeAll.) This is the only place the empty-
    // state copy is asserted unconditionally — the untagged suite cannot pin it
    // because its DB state is ambient.
    const { getPrisma, resetPrisma } = await import("@aguhot/core");
    const prisma = getPrisma();
    await prisma.publishedTimelineEntry.deleteMany({});
    resetPrisma();

    await page.goto("/");
    const timeline = page.locator("section[aria-label='时间流']");
    await expect(
      timeline.getByText("暂无公开展示的时间流。"),
      "empty read model renders honest empty copy",
    ).toBeVisible();
    await expect(
      timeline.getByText(/最近更新：/),
      "empty state cites a last-updated time",
    ).toBeVisible();

    // Independence invariant (spec I/O matrix): the band reads a SEPARATE read
    // model (published_hot_events), so clearing the timeline projection must NOT
    // hide the band. Only publishedTimelineEntry was cleared above — the hot-
    // events rows from the seed are still present, so the band still renders.
    // Pins that the two empty states are genuinely independent.
    await expect(
      page.getByRole("region", { name: "今日重点 / 市场主线" }),
      "band stays visible when only the timeline read model is empty",
    ).toBeVisible();
  });
});

/**
 * Vertical (top) position of a locator's bounding box, for asserting DOM/visual
 * reading order. Returns NaN if the box is unavailable.
 */
async function topY(locator: import("@playwright/test").Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box?.y ?? Number.NaN;
}
