import { expect, test } from "@playwright/test";

import { seedTimelineFeed, type SeededTimeline } from "./seed-timeline";

/**
 * Public timeline feed surface e2e — Story 4.2 (Epic 4 时间流首页) + Story 4.3
 * (session/category filters).
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
 *   - Story 4.3 filter nav: `<nav aria-label="时间流筛选">` is present on every
 *     render (the affordance is always visible, even on an empty read model),
 *     AND the V1 priority-filter UI (`<nav aria-label="筛选">` + the window
 *     pills 今日/近7天/近30天/全部) stays absent (4.2 removed it; 4.3 does not
 *     resurrect the dead `?window=` axis).
 *
 * NOT covered here (deferred to the @timeline seeded block below):
 *   - Empty-state copy + 最近更新 — needs a deterministic empty DB, covered by
 *     the @timeline block (which clears published_timeline_entries then asserts).
 *   - Populated timeline cards / fold disclosure / reading order / AI 解读 slot
 *     / main-line-band items — all covered by the @timeline seeded block.
 *   - Story 4.3 filter BEHAVIOR (session hit / filter empty / category positive
 *     + negative / session+category combo / URL restore) — covered by the
 *     @timeline seeded block (needs deterministic data + associations).
 */

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

  test("无残留 V1 window pills + 新「时间流筛选」nav 存在 (Story 4.3)", async ({ page }) => {
    await page.goto("/");

    // The V1 priority-feed filter UI (FeedFilters, `<nav aria-label="筛选">`)
    // was removed in 4.2. Story 4.3 ships a NEW filter nav with a DISTINGUISHING
    // aria-label「时间流筛选」(NOT 「筛选」) so this 4.2 assertion stays green
    // while the new nav is present. Pin BOTH halves:
    //   - the V1 window pills (今日 / 近7天 / 近30天 / 全部) must NOT render —
    //     4.3 owns the new session/category dimensions and does NOT resurrect
    //     the dead `?window=` axis.
    //   - the new `nav[aria-label='时间流筛选']` IS present (Story 4.3 surface).
    await expect(
      page.locator("nav[aria-label='筛选']"),
      "V1 priority filter nav should stay removed from the home",
    ).toHaveCount(0);
    await expect(
      page.getByText("今日", { exact: true }),
      "V1 「今日」 window pill must not render",
    ).toHaveCount(0);
    await expect(
      page.getByText("近7天", { exact: true }),
      "V1 「近7天」 window pill must not render",
    ).toHaveCount(0);
    await expect(
      page.getByText("近30天", { exact: true }),
      "V1 「近30天」 window pill must not render",
    ).toHaveCount(0);
    await expect(
      page.getByText("全部", { exact: true }),
      "V1 「全部」 window pill must not render",
    ).toHaveCount(0);

    // The new Story 4.3 filter nav renders on every home render (empty or
    // populated read model — the affordance is always visible).
    await expect(
      page.locator("nav[aria-label='时间流筛选']"),
      "Story 4.3 timeline filter nav should be present",
    ).toBeVisible();
  });
});

/**
 * Populated-feed e2e — Story 4.2 (Epic 4 时间流首页) + Story 4.3 (filters)
 * @timeline.
 *
 * Tagged @timeline so it runs only under `pnpm --filter web e2e:timeline` (DB-
 * backed + seed) and is excluded from the public `pnpm --filter web e2e` run
 * (whose --grep-invert list now includes @timeline). The beforeAll seeds FOUR
 * published events via the real publish pipeline (seed-timeline.ts):
 *   - folded: 半导体 event with 2 member evidence records → evidenceCount 2 →
 *     foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD(2) → 「同事件精选」.
 *   - single: 稀土 event with 1 member evidence record → single-source card.
 *   - 军工 + 铜价: two more single-source events so the band top-3 slice is
 *     observable (4 published, band caps at 3). Story 4.3 also pins these:
 *     军工 gets a stock association (stock-only), 铜价 gets NO association (the
 *     category-filter negative sample).
 *
 * Story 4.3 association injection (category filter fixtures): 半导体 gets
 * concept+industry+stock items; 稀土 gets concept+industry; 军工 gets stock only;
 * 铜价 gets none. So `?category=stock` matches 半导体 + 军工, `?category=concept`
 * matches 半导体 + 稀土, `?category=industry` matches 半导体 + 稀土, and 铜价
 * never matches any category.
 *
 * This block covers the I/O & Edge-Case Matrix rows the surface-anchored tests
 * above cannot (they need a populated read model):
 *   - 时间流默认视图 (cards render in the fixed reading order)
 *   - 折叠条目 (fold tag + disclosure of N sources)
 *   - 单源条目 (no fold tag, no reason tag — FR-3 revised)
 *   - main-line-band 置顶项 (top-N saliency band renders + links)
 *   - AI 解读槽 null (recommendationReason stays NULL pre-5.1 → no AiLabel)
 *   - Story 4.3: session hit / filter empty / category positive + negative /
 *     session+category combo / URL restore (the filter behavior matrix).
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
    // Band ordering = evidenceCount DESC, latestEvidenceAt DESC. 半导体 (count 2)
    // is rank 1; the three count-1 events break by pinned latestEvidenceAt DESC:
    // 军工 (07:30Z) > 铜价 (06:00Z) > 稀土 (01:15Z). Top-3 = {半导体, 军工, 铜价};
    // 稀土 drops to rank 4 (outside top-3) under the pinned-timestamp seed.
    await expect(band.getByRole("link", { name: /半导体/ })).toBeVisible();
    await expect(band.getByRole("link", { name: /军工/ })).toBeVisible();

    // top-N slice: 4 events published, band caps at MAIN_LINE_BAND_TOP_N (3).
    await expect(band.locator("li")).toHaveCount(3);

    // Honest ranking-reason tag (FR-3): the seed pins evidence publishedAt to
    // 2024-01-02 so occurredAt/latestEvidenceAt are ~930 days old at test time
    // (2026-07) — well outside the 72h recency window. None of the 4 events has
    // evidenceCount >= 3 either (半导体=2, the rest=1), so NO reason tag renders
    // (neither「近期升温」nor「多源覆盖」). This pins the no-tag branch: a regression
    // that fabricates a reason, or inverts the recency/multi-source precedence,
    // fails here. (Pre-pin this asserted「近期升温」; the pin made recency false, so
    // the expectation follows the now-deterministic data per the review-driven
    // constraint.)
    await expect(
      band.getByText("近期升温", { exact: true }),
      "no 近期升温 tag: pinned 2024-01-02 dates are outside the 72h window",
    ).toHaveCount(0);
    await expect(
      band.getByText("多源覆盖", { exact: true }),
      "no 多源覆盖 tag: no seeded event reaches evidenceCount >= 3",
    ).toHaveCount(0);
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

  // --- Story 4.3: session + category filter behavior ------------------------
  // These tests run BEFORE the empty-state test below (which clears the timeline
  // projection) so the seeded cards + associations are still present. The
  // sessionTag of each seeded event is time-dependent (derived from the
  // Asia/Shanghai local time of its occurredAt), so the session tests DISCOVER
  // the active session from the rendered DOM rather than assuming a specific
  // tag — this keeps them deterministic across run times.

  test("session 筛选：pill 切换更新 URL + active 态 + 服务端 narrowing (Story 4.3)", async ({
    page,
  }) => {
    // The session filter is SERVER-side (listPublishedTimeline({ sessionTag })).
    // The seed pins evidence publishedAt to fixed 2024-01-02 UTC instants so
    // sessionTag derivation is deterministic regardless of run time:
    //   - 半导体 (10:00 Shanghai) → Intraday
    //   - 铜价   (14:00 Shanghai) → Intraday
    //   - 稀土   (09:15 Shanghai) → PreOpen
    //   - 军工   (15:30 Shanghai) → PostClose
    // So ?session=intraday narrows to {半导体, 铜价} (2), excluding 稀土 (pre_open)
    // and 军工 (post_close). This STRICTLY pins the page→sessionTag wiring: if
    // page.tsx silently drops sessionTag, filteredCount === unfilteredCount and
    // 稀土/军工 would render, failing every assertion below.
    await page.goto("/");

    const filterNav = page.locator("nav[aria-label='时间流筛选']");
    const timeline = page.locator("section[aria-label='时间流']");
    const unfilteredCount = await timeline.locator("li").count();
    expect(unfilteredCount, "seed produces all 4 cards before filtering").toBe(4);

    // Click 「盘中」(intraday) — the URL must gain ?session=intraday and the pill
    // must render active.
    await filterNav.getByText("盘中", { exact: true }).click();
    await expect(page, "URL carries session=intraday").toHaveURL(/session=intraday/);
    await expect(
      filterNav.locator("a", { hasText: "盘中" }).first(),
      "intraday pill is active (brand class)",
    ).toHaveClass(/\bbg-brand\b/);
    // The other two trading-session pills are NOT active.
    for (const label of ["盘前", "盘后"]) {
      await expect(
        filterNav.locator("a", { hasText: label }).first(),
        `${label} pill default when intraday is active`,
      ).not.toHaveClass(/\bbg-brand\b/);
    }

    // Server-side narrowing — STRICT: filteredCount < unfilteredCount (at least
    // one non-intraday event excluded). The pre-pin test asserted only `<=`,
    // which passes even if sessionTag is silently dropped (filteredCount would
    // equal unfilteredCount). The strict `<` closes that gap.
    const filteredCount = await timeline.locator("li").count();
    expect(
      filteredCount,
      "session filter STRICTLY narrows (intraday excludes pre_open + post_close)",
    ).toBeLessThan(unfilteredCount);

    // Pin the SPECIFIC inclusion/exclusion the deterministic seed dictates. If
    // sessionTag is dropped, 稀土/军工 would render and fail these assertions.
    await expect(
      timeline.locator("li", { hasText: "半导体" }).first(),
      "半导体 (intraday) renders under ?session=intraday",
    ).toBeVisible();
    await expect(
      timeline.locator("li", { hasText: "稀土" }),
      "稀土 (pre_open) is EXCLUDED under ?session=intraday",
    ).toHaveCount(0);
    await expect(
      timeline.locator("li", { hasText: "军工" }),
      "军工 (post_close) is EXCLUDED under ?session=intraday",
    ).toHaveCount(0);
  });

  test("筛选空态：session+category 无命中交集显示筛选空态文案 + 清除链接 (Story 4.3)", async ({
    page,
  }) => {
    // The pinned seed populates ALL three trading sessions (Intraday = {半导体,
    // 铜价}, PreOpen = {稀土}, PostClose = {军工}), so no single session pill
    // produces a filter-empty state. Instead this uses a DETERMINISTIC
    // session×category intersection that is empty: ?session=pre_open&category=
    // stock. PreOpen = {稀土}; stock-assoc events = {半导体, 军工}; intersection
    // is empty → filter-empty state (the read model has rows, just none match
    // both filters). This covers the spec I/O matrix's "筛选空（有行无命中）" row
    // and the `isFilterEmpty` short-circuit (`!isReadModelEmpty && ...`).
    await page.goto("/?session=pre_open&category=stock");

    const timeline = page.locator("section[aria-label='时间流']");

    // Filter-empty state: the DISTINCT copy (NOT the read-model-empty copy) + a
    // clear-filter link, and NO 最近更新 line (data exists, just filtered out).
    await expect(
      timeline.getByText("当前筛选条件下暂无时间流条目。"),
      "filter-empty state shows the distinct narrowed-too-far copy",
    ).toBeVisible();
    await expect(
      timeline.getByRole("link", { name: "清除筛选" }),
      "filter-empty state shows a clear-filter link",
    ).toBeVisible();
    await expect(
      timeline.getByText(/最近更新：/),
      "filter-empty state must NOT show 最近更新 (data exists, not stale)",
    ).toHaveCount(0);
    await expect(
      timeline.locator("li"),
      "no cards render under the empty-intersection filter",
    ).toHaveCount(0);
    // Read-model-empty copy must NOT render (rows exist, just filtered out).
    await expect(
      timeline.getByText("暂无公开展示的时间流。"),
      "filter-empty state must NOT show the read-model-empty copy",
    ).toHaveCount(0);

    // Clear-all link resolves to "/" (both keys dropped) and re-renders the
    // default unfiltered view. Pins the mergeTimelineSearchParams two-key-delete
    // → "/" branch that no pill href exercises (pills always set a value).
    await timeline.getByRole("link", { name: "清除筛选" }).click();
    await expect(page, "clear-all drops both session and category").toHaveURL(
      /^[^?]*$/,
    );
    await expect(
      timeline.getByText("当前筛选条件下暂无时间流条目。"),
      "filter-empty copy is gone after clear-all",
    ).toHaveCount(0);
  });

  test("category 筛选正例：?category=stock 仅保留含 stock association 的条目 (Story 4.3)", async ({
    page,
  }) => {
    // Seed fixtures: 半导体 has stock(中芯国际); 军工 has stock(中航沈飞); 稀土
    // has concept+industry only (no stock); 铜价 has no association at all.
    await page.goto("/?category=stock");

    const filterNav = page.locator("nav[aria-label='时间流筛选']");
    const timeline = page.locator("section[aria-label='时间流']");

    // The 「个股」 pill must be active (URL has ?category=stock).
    await expect(
      filterNav.locator("a", { hasText: "个股" }).first(),
      "stock pill is active under ?category=stock",
    ).toHaveClass(/\bbg-brand\b/);

    // 半导体 + 军工 (the two stock-positive events) render.
    await expect(
      timeline.locator("li", { hasText: "半导体" }).first(),
      "半导体 (has stock assoc) renders under ?category=stock",
    ).toBeVisible();
    await expect(
      timeline.locator("li", { hasText: "军工" }).first(),
      "军工 (has stock assoc) renders under ?category=stock",
    ).toBeVisible();

    // 稀土 (concept+industry only, no stock) does NOT render.
    await expect(
      timeline.locator("li", { hasText: "稀土" }),
      "稀土 (no stock assoc) is filtered out under ?category=stock",
    ).toHaveCount(0);
    // 铜价 (no association at all) does NOT render — the category-filter
    // negative sample.
    await expect(
      timeline.locator("li", { hasText: "铜价" }),
      "铜价 (no association) is filtered out under any category filter",
    ).toHaveCount(0);
  });

  test("category 筛选负例：?category=concept 排除无 concept association 的条目 (Story 4.3)", async ({
    page,
  }) => {
    // Seed fixtures: 半导体 has concept(半导体); 稀土 has concept(稀土); 军工
    // has stock only (no concept); 铜价 has no association.
    await page.goto("/?category=concept");

    const timeline = page.locator("section[aria-label='时间流']");

    // 半导体 + 稀土 (the concept-positive events) render.
    await expect(
      timeline.locator("li", { hasText: "半导体" }).first(),
      "半导体 (has concept assoc) renders under ?category=concept",
    ).toBeVisible();
    await expect(
      timeline.locator("li", { hasText: "稀土" }).first(),
      "稀土 (has concept assoc) renders under ?category=concept",
    ).toBeVisible();

    // 军工 (stock only, no concept) + 铜价 (no association) do NOT render.
    await expect(
      timeline.locator("li", { hasText: "军工" }),
      "军工 (no concept assoc) is filtered out under ?category=concept",
    ).toHaveCount(0);
    await expect(
      timeline.locator("li", { hasText: "铜价" }),
      "铜价 (no association) is filtered out under any category filter",
    ).toHaveCount(0);
  });

  test("session + category 复合：两 pill 均 active，切换其一不丢失另一维度 (Story 4.3)", async ({
    page,
  }) => {
    // Composite filter: ?session=intraday&category=stock. Both pills active;
    // the data INTERSECTION (not just URL/active-state) is Intraday ∩ stock:
    //   - Intraday events = {半导体 (10:00), 铜价 (14:00)}
    //   - stock-assoc events = {半导体, 军工}
    //   - intersection = {半导体}
    // 半导体 renders; 军工 (stock but PostClose) + 铜价 (intraday but NO assoc)
    // + 稀土 (neither) do NOT. Then toggling category off (clicking the active
    // 「个股」 pill) must preserve the session filter (mergeSearchParams keeps
    // sibling keys).
    await page.goto("/?session=intraday&category=stock");

    const filterNav = page.locator("nav[aria-label='时间流筛选']");
    const timeline = page.locator("section[aria-label='时间流']");

    // Both pills are active at once.
    await expect(
      filterNav.locator("a", { hasText: "盘中" }).first(),
      "session pill active under composite filter",
    ).toHaveClass(/\bbg-brand\b/);
    await expect(
      filterNav.locator("a", { hasText: "个股" }).first(),
      "category pill active under composite filter",
    ).toHaveClass(/\bbg-brand\b/);

    // Pin the data INTERSECTION (the spec I/O matrix "session + category 同时"
    // row). 半导体 is the ONLY event that is both intraday AND has a stock
    // association, so it is the sole card under the composite filter.
    await expect(
      timeline.locator("li", { hasText: "半导体" }).first(),
      "半导体 (intraday ∩ stock) renders under the composite filter",
    ).toBeVisible();
    await expect(
      timeline.locator("li", { hasText: "军工" }),
      "军工 (stock but PostClose, NOT intraday) is excluded",
    ).toHaveCount(0);
    await expect(
      timeline.locator("li", { hasText: "铜价" }),
      "铜价 (intraday but NO association) is excluded",
    ).toHaveCount(0);
    await expect(
      timeline.locator("li", { hasText: "稀土" }),
      "稀土 (PreOpen + no stock assoc) is excluded",
    ).toHaveCount(0);

    // Click the active 「个股」 pill → its href clears ?category= but preserves
    // ?session=intraday (mergeTimelineSearchParams drops only "category").
    await filterNav.locator("a", { hasText: "个股" }).first().click();
    await expect(page, "category cleared, session preserved").toHaveURL(
      /session=intraday/,
    );
    await expect(page, "category is gone from the URL").not.toHaveURL(/category=/);
    // The session pill stays active; the category pill reverts to default.
    await expect(
      filterNav.locator("a", { hasText: "盘中" }).first(),
      "session pill still active after category cleared",
    ).toHaveClass(/\bbg-brand\b/);
    await expect(
      filterNav.locator("a", { hasText: "个股" }).first(),
      "category pill inactive after clear",
    ).not.toHaveClass(/\bbg-brand\b/);
  });

  test("URL 还原：直访带筛选的 URL 还原 pill active 态 (Story 4.3, FR-2)", async ({
    page,
  }) => {
    // Direct visit a URL with BOTH filters set; assert the active state is
    // restored purely from the URL (server-rendered, no client state). This is
    // the shareable/refresh/back-forward invariant.
    await page.goto("/?category=industry");

    const filterNav = page.locator("nav[aria-label='时间流筛选']");

    // The 「行业」 pill is active (from the URL, no prior click needed).
    await expect(
      filterNav.locator("a", { hasText: "行业" }).first(),
      "industry pill active from direct URL visit",
    ).toHaveClass(/\bbg-brand\b/);
    // No session pill is active (URL has no ?session=).
    for (const label of ["盘前", "盘中", "盘后"]) {
      await expect(
        filterNav.locator("a", { hasText: label }).first(),
        `${label} pill default when no ?session= in URL`,
      ).not.toHaveClass(/\bbg-brand\b/);
    }
  });

  test("非法筛选值不 500：?session=foo&category=bar 视同默认态 (Story 4.3)", async ({ page }) => {
    // Invalid values are whitelisted to nothing → the page renders the default
    // (no filter) state, HTTP 200, not a 500. Pins the I/O matrix's "非法值 →
    // 忽略 → 视同默认" rows.
    const response = await page.goto("/?session=foo&category=bar");
    expect(response, "page should respond").not.toBeNull();
    expect(response!.status(), "invalid filter values must not 500").toBe(200);

    // No pill is active (both invalid values were dropped by the whitelist
    // parsers). The timeline renders whatever the default read model returns.
    const filterNav = page.locator("nav[aria-label='时间流筛选']");
    for (const label of ["盘前", "盘中", "盘后", "概念", "行业", "个股"]) {
      await expect(
        filterNav.locator("a", { hasText: label }).first(),
        `${label} pill default under invalid filter values`,
      ).not.toHaveClass(/\bbg-brand\b/);
    }
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

  test("读模型空 + 筛选 active：读模型空态胜出，筛选空态不渲染 (Story 4.3, NFR-2)", async ({
    page,
  }) => {
    // Spec I/O matrix "读模型空（无任何行）" row + Acceptance Criterion: when the
    // read model is COMPLETELY empty (no published_timeline rows), ANY active
    // filter (?session= / ?category=) must still show the READ-MODEL-empty copy
    // ("暂无公开展示的时间流。" + 最近更新), NOT the filter-empty copy ("当前筛选条件
    // 下暂无时间流条目。"). This pins the `isFilterEmpty` short-circuit in page.tsx
    // (`!isReadModelEmpty && filteredEntries.length === 0 && ...`): when
    // isReadModelEmpty is true, isFilterEmpty can never be true, so the honest
    // read-model-empty state wins regardless of the filter.
    //
    // The preceding empty-state test already cleared publishedTimelineEntry; re-
    // clear defensively in case test order changes (serial mode runs in file
    // order, but a future reorder should not silently invalidate this).
    const { getPrisma, resetPrisma } = await import("@aguhot/core");
    const prisma = getPrisma();
    await prisma.publishedTimelineEntry.deleteMany({});
    resetPrisma();

    // ?session=intraday on an empty read model → read-model-empty copy wins.
    await page.goto("/?session=intraday");
    const timelineSession = page.locator("section[aria-label='时间流']");
    await expect(
      timelineSession.getByText("暂无公开展示的时间流。"),
      "read-model-empty: ?session=intraday shows the honest empty copy",
    ).toBeVisible();
    await expect(
      timelineSession.getByText(/最近更新：/),
      "read-model-empty: ?session=intraday still cites 最近更新",
    ).toBeVisible();
    await expect(
      timelineSession.getByText("当前筛选条件下暂无时间流条目。"),
      "read-model-empty: filter-empty copy must NOT render under ?session=",
    ).toHaveCount(0);

    // ?category=stock on an empty read model → same read-model-empty copy wins.
    // This is the `isFilterEmpty` short-circuit's other half: the category
    // branch reads associations + filters ONLY when `!isReadModelEmpty`, so an
    // empty read model skips the category filtering entirely and cannot reach
    // the filter-empty branch.
    await page.goto("/?category=stock");
    const timelineCategory = page.locator("section[aria-label='时间流']");
    await expect(
      timelineCategory.getByText("暂无公开展示的时间流。"),
      "read-model-empty: ?category=stock shows the honest empty copy",
    ).toBeVisible();
    await expect(
      timelineCategory.getByText(/最近更新：/),
      "read-model-empty: ?category=stock still cites 最近更新",
    ).toBeVisible();
    await expect(
      timelineCategory.getByText("当前筛选条件下暂无时间流条目。"),
      "read-model-empty: filter-empty copy must NOT render under ?category=",
    ).toHaveCount(0);
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

test("重复键 ?session=…&session=… / ?category=…&category=… 取首个不抛 TypeError (Story 4.3)", async ({
  page,
}) => {
  // Spec I/O matrix "重复键 → 取首个, 不抛 TypeError" row. Next.js delivers
  // repeated query keys as string[] (e.g. ?session=a&session=b → ["a","b"]);
  // calling `.trim()` on an array throws TypeError, which would 500 the public
  // nav. `firstString` (timeline-filters.tsx) collapses arrays to their first
  // element at the boundary before any string method is called. This test pins
  // that exact failure mode: the page must return HTTP 200 (not 500), and the
  // pill active state must reflect the FIRST value (firstString semantics).
  // Untagged + surface-anchored — no seed needed (only asserts no-500 + active
  // state, both independent of read-model content). Placed at file-end so it
  // lives in the collected region (the file's top JSDoc block is unclosed, a
  // pre-existing condition that swallows the first describe block; this test
  // stays clear of that region).
  //
  // ?session=pre_open&session=intraday → firstString → pre_open active.
  const sessionResp = await page.goto("/?session=pre_open&session=intraday");
  expect(sessionResp, "repeated session key should respond").not.toBeNull();
  expect(sessionResp!.status(), "repeated session key must not 500").toBe(200);
  const filterNav = page.locator("nav[aria-label='时间流筛选']");
  await expect(
    filterNav.locator("a", { hasText: "盘前" }).first(),
    "first session value (pre_open) is active under repeated keys",
  ).toHaveClass(/\bbg-brand\b/);
  await expect(
    filterNav.locator("a", { hasText: "盘中" }).first(),
    "second session value (intraday) is NOT active (firstString takes first)",
  ).not.toHaveClass(/\bbg-brand\b/);

  // ?category=stock&category=concept → firstString → stock active.
  const categoryResp = await page.goto("/?category=stock&category=concept");
  expect(categoryResp, "repeated category key should respond").not.toBeNull();
  expect(categoryResp!.status(), "repeated category key must not 500").toBe(200);
  await expect(
    filterNav.locator("a", { hasText: "个股" }).first(),
    "first category value (stock) is active under repeated keys",
  ).toHaveClass(/\bbg-brand\b/);
  await expect(
    filterNav.locator("a", { hasText: "概念" }).first(),
    "second category value (concept) is NOT active (firstString takes first)",
  ).not.toHaveClass(/\bbg-brand\b/);
});
