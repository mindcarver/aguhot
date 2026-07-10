import { expect, test } from "@playwright/test";

import { getPrisma, newTraceId, refreshPublishedReadModel } from "@aguhot/core";

import { seedSearchContext } from "./seed-search";

/**
 * Public hot-event + theme search e2e — Story 3.1 (FR12). Tagged @search so it
 * runs only under `pnpm --filter web e2e:search` (DB-backed + seed) and does NOT
 * run under the public `pnpm --filter web e2e` (whose --grep-invert excludes
 * @console, @feed, @detail, @revision, @merge-split, @market-reaction,
 * @associations, @themes, @daily, @loop, AND @search).
 *
 * The beforeAll imports and runs seedSearchContext() (the same function
 * `pnpm --filter web seed:search` runs) to capture the dynamic title-hit +
 * summary-hit hotEventIds + titles + the stub theme slug/label + the
 * deterministic query strings.
 *
 * Requires request-time DATABASE_URL: the /search route is force-dynamic and
 * reads the published read models via searchPublished → getPrisma at request
 * time.
 *
 * Covers:
 *   - AC1 title hit: GET /search?q={titleQuery} → 200, the 「热点事件」 section
 *     renders an EventCard linking /events/{titleHitId}.
 *   - AC1 summary hit: GET /search?q={summaryQuery} → EventCard linking
 *     /events/{summaryHitId} (the event whose title excludes the word but whose
 *     explanation summary contains it).
 *   - AC1 theme hit: GET /search?q={themeQuery} → the 「主题」 section renders a
 *     FilterPill linking /topics/{themeSlug}.
 *   - AC1 relevance tiering: GET /search?q={tieringQuery} (「稀土」) hits event
 *     X in its TITLE (tier 0, OLDER) AND event Y only in its explanation SUMMARY
 *     (tier 1, NEWER) — asserts X renders BEFORE Y in DOM order, proving the
 *     title tier overrides recency (real DOM-order assertion, not a single-hit
 *     proxy).
 *   - AC1 within-tier recency (T1): GET /search?q={withinTierQuery} (「电池」)
 *     hits TWO title-tier-0 events (F OLDER + G NEWER); both are in the SAME
 *     tier so the ONLY ordering signal is within-tier latestEvidenceAt DESC.
 *     Asserts the NEWER event renders BEFORE the OLDER one — a recency
 *     reversal WITHIN a tier would be invisible to the cross-tier test above.
 *   - AC1 theme ranking (T2): GET /search?q={themeRankingQuery} (「芯片」) hits
 *     TWO theme slugs (slug A memberCount=1, slug B memberCount=2); asserts the
 *     higher-memberCount slug renders FIRST (memberCount DESC), proving theme
 *     ranking — invisible to the existing single-theme test.
 *   - Latin case-insensitive: GET /search?q=gpu and q=GPU both hit the event
 *     whose title contains 「GPU」 (toLowerCase normalization; Chinese has no
 *     case so a Latin token is required to exercise this).
 *   - Overlong query truncation (trust boundary): GET /search?q= + 200 chars →
 *     200, no-match feedback renders, and the echoed query in the 「未找到与「{q}」
 *     相关的...」 text is ≤ 128 chars (parseSearchQuery truncated it). Also
 *     boundary cases (T4): a 128-char query passes through UNTRUNCATED (echoed
 *     length === 128), and a 129-char query is cut to 128 (off-by-one guard).
 *   - Takedown event (AD-3/AD-8): GET /search?q={takedownQuery} hits the
 *     dedicated event; after refreshPublishedReadModel({ action:"takedown" })
 *     deletes its published_* rows, re-searching returns no such link. Run LAST
 *     (mutates DB; only removes its own target).
 *   - AC2 no-match: GET /search?q={bogus} → the 「未找到」 feedback renders +
 *     a 「返回首页」 link renders + a SearchBox renders (to change keywords).
 *   - Empty query: GET /search (no q) → the guide text renders + NO 「未找到」
 *     text + NO results sections.
 *   - AC3 desktop keyboard: focus the aside SearchBox → type → Enter → native
 *     form submit lands on /search?q=… with results.
 *   - AC3 mobile touch: open the mobile drawer → the SearchBox is visible and
 *     submittable (the input + button meet min-h-11 hit targets).
 *   - Return-path restore (2.5 defer honored): /search?q={titleQuery} → click
 *     event card → detail → click BackLink → the URL contains q={titleQuery}
 *     (NOT the bare homepage).
 *   - /search open-redirect guard (T3): tampering sessionStorage returnContext
 *     with /search-prefixed traversal (/search/../console, /search//evil.com)
 *     must fall back to / (NOT the tampered value) — locks that the allowlist
 *     entry is an EXACT pathname match, not a prefix.
 *   - Anonymous reachability (AD-8): the entire flow is 200 with no /login
 *     redirect.
 *   - No-regression: /search renders inside the public shell (the nav is
 *     present).
 */

test.describe("热点与主题搜索 (Story 3.1) @search", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let titleHitId: string;
  let titleHitTitle: string;
  let summaryHitId: string;
  let tieringTitleHitId: string;
  let tieringSummaryHitId: string;
  let tieringQuery: string;
  let latinToken: string;
  let latinHitId: string;
  let takedownHitId: string;
  let takedownQuery: string;
  let themeSlug: string;
  let titleQuery: string;
  let summaryQuery: string;
  let themeQuery: string;
  let withinTierOlderId: string;
  let withinTierNewerId: string;
  let withinTierQuery: string;
  let themeRankingSlugA: string;
  let themeRankingSlugB: string;
  let themeRankingMemberCountA: number;
  let themeRankingMemberCountB: number;
  let themeRankingQuery: string;

  test.beforeAll(async () => {
    const seeded = await seedSearchContext();
    titleHitId = seeded.titleHitId;
    titleHitTitle = seeded.titleHitTitle;
    summaryHitId = seeded.summaryHitId;
    tieringTitleHitId = seeded.tieringTitleHitId;
    tieringSummaryHitId = seeded.tieringSummaryHitId;
    tieringQuery = seeded.tieringQuery;
    latinToken = seeded.latinToken;
    latinHitId = seeded.latinHitId;
    takedownHitId = seeded.takedownHitId;
    takedownQuery = seeded.takedownQuery;
    themeSlug = seeded.themeSlug;
    titleQuery = seeded.titleQuery;
    summaryQuery = seeded.summaryQuery;
    themeQuery = seeded.themeQuery;
    withinTierOlderId = seeded.withinTierOlderId;
    withinTierNewerId = seeded.withinTierNewerId;
    withinTierQuery = seeded.withinTierQuery;
    themeRankingSlugA = seeded.themeRankingSlugA;
    themeRankingSlugB = seeded.themeRankingSlugB;
    themeRankingMemberCountA = seeded.themeRankingMemberCountA;
    themeRankingMemberCountB = seeded.themeRankingMemberCountB;
    themeRankingQuery = seeded.themeRankingQuery;
  });

  test("AC1 标题命中：/search?q={titleQuery} 含 EventCard 链 /events/{titleHitId}", async ({ page }) => {
    const response = await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
    expect(response, "/search should respond").not.toBeNull();
    expect(response!.status(), "/search status should be 200").toBe(200);

    // The 「热点事件」 section heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: /热点事件/ }),
    ).toBeVisible();

    // The title-hit event's EventCard link is present.
    const eventLink = page.locator(`a[href="/events/${titleHitId}"]`);
    await expect(eventLink).toBeVisible();

    // The title-hit event title is visible (the card body).
    await expect(page.getByText(titleHitTitle).first()).toBeVisible();
  });

  test("AC1 摘要命中：/search?q={summaryQuery} 含 EventCard 链 /events/{summaryHitId}", async ({ page }) => {
    const response = await page.goto(`/search?q=${encodeURIComponent(summaryQuery)}`);
    expect(response!.status(), "summary-hit search status should be 200").toBe(200);

    // The summary-hit event's EventCard link is present (title does NOT contain
    // the query, but the explanation summary does).
    const eventLink = page.locator(`a[href="/events/${summaryHitId}"]`);
    await expect(eventLink).toBeVisible();
  });

  test("AC1 主题命中：/search?q={themeQuery} 含 FilterPill 链 /topics/{themeSlug}", async ({ page }) => {
    const response = await page.goto(`/search?q=${encodeURIComponent(themeQuery)}`);
    expect(response!.status(), "theme-hit search status should be 200").toBe(200);

    // The 「主题」 section heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: /主题/ }),
    ).toBeVisible();

    // The theme FilterPill link to /topics/{slug} is present.
    const themeLink = page.locator(
      `a[href="/topics/${encodeURIComponent(themeSlug)}"]`,
    );
    await expect(themeLink).toBeVisible();
  });

  test("AC1 相关性分层排序：tieringQuery 同时命中标题（旧）+ 摘要（新）→ 标题层在前", async ({ page }) => {
    // The shared tiering word 「稀土」 hits event X (tieringTitleHitId) in its
    // TITLE (tier 0) AND event Y (tieringSummaryHitId) only in its explanation
    // SUMMARY (tier 1). X is OLDER than Y. Relevance tiering must render X
    // BEFORE Y in DOM order — title tier overrides recency.
    const response = await page.goto(`/search?q=${encodeURIComponent(tieringQuery)}`);
    expect(response!.status(), "tiering search status should be 200").toBe(200);

    // BOTH event links must be present (the query genuinely matches both tiers).
    const main = page.getByRole("main");
    const titleTierLink = main.locator(`a[href="/events/${tieringTitleHitId}"]`);
    const summaryTierLink = main.locator(`a[href="/events/${tieringSummaryHitId}"]`);
    await expect(titleTierLink, "title-tier event link should render").toHaveCount(1);
    await expect(summaryTierLink, "summary-tier event link should render").toHaveCount(1);

    // Read the hrefs of every event link inside <main> in DOM order, then assert
    // the title-tier event's index is strictly less than the summary-tier one's.
    // This is the real tiering assertion: relevance tier overrides recency even
    // though the summary-tier event is NEWER.
    const hrefs = await main
      .locator('a[href^="/events/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
    const titleIdx = hrefs.indexOf(`/events/${tieringTitleHitId}`);
    const summaryIdx = hrefs.indexOf(`/events/${tieringSummaryHitId}`);
    expect(titleIdx, "title-tier event must be in DOM").toBeGreaterThanOrEqual(0);
    expect(summaryIdx, "summary-tier event must be in DOM").toBeGreaterThanOrEqual(0);
    expect(
      titleIdx,
      `title-tier (idx=${titleIdx}) must render BEFORE summary-tier (idx=${summaryIdx})`,
    ).toBeLessThan(summaryIdx);
  });

  test("AC1 同层时间序 (T1)：withinTierQuery 同层标题命中 → 新者在前", async ({ page }) => {
    // T1: the shared within-tier word 「电池」 hits TWO events in their TITLES
    // (both tier 0). The ONLY ordering signal left is within-tier recency
    // (latestEvidenceAt DESC). withinTierOlderId is OLDER, withinTierNewerId is
    // NEWER; the newer one MUST render first. A recency reversal WITHIN a tier
    // would be invisible to the cross-tier test above (which only places events
    // in DIFFERENT tiers).
    const response = await page.goto(`/search?q=${encodeURIComponent(withinTierQuery)}`);
    expect(response!.status(), "within-tier search status should be 200").toBe(200);

    const main = page.getByRole("main");
    const olderLink = main.locator(`a[href="/events/${withinTierOlderId}"]`);
    const newerLink = main.locator(`a[href="/events/${withinTierNewerId}"]`);
    await expect(olderLink, "older within-tier event link should render").toHaveCount(1);
    await expect(newerLink, "newer within-tier event link should render").toHaveCount(1);

    // Read event-link hrefs in DOM order; the newer event must come first.
    const hrefs = await main
      .locator('a[href^="/events/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
    const olderIdx = hrefs.indexOf(`/events/${withinTierOlderId}`);
    const newerIdx = hrefs.indexOf(`/events/${withinTierNewerId}`);
    expect(olderIdx, "older within-tier event must be in DOM").toBeGreaterThanOrEqual(0);
    expect(newerIdx, "newer within-tier event must be in DOM").toBeGreaterThanOrEqual(0);
    expect(
      newerIdx,
      `newer within-tier (idx=${newerIdx}) must render BEFORE older (idx=${olderIdx})`,
    ).toBeLessThan(olderIdx);
  });

  test("AC1 主题排序 (T2)：themeRankingQuery 两主题命中 → memberCount 高者在前", async ({ page }) => {
    // T2: the shared theme word 「芯片」 hits TWO theme slugs — slug A
    // (chip-supply-chain, memberCount=1) and slug B (chip-design, memberCount=2).
    // memberCount DESC ranking is the ONLY observable signal (both match the
    // query); slug B must render FIRST. This is invisible to the existing
    // single-theme test (which seeds only one theme hit).
    const response = await page.goto(`/search?q=${encodeURIComponent(themeRankingQuery)}`);
    expect(response!.status(), "theme-ranking search status should be 200").toBe(200);

    const main = page.getByRole("main");
    const slugALink = main.locator(
      `a[href="/topics/${encodeURIComponent(themeRankingSlugA)}"]`,
    );
    const slugBLink = main.locator(
      `a[href="/topics/${encodeURIComponent(themeRankingSlugB)}"]`,
    );
    await expect(
      slugALink,
      `theme slug A (${themeRankingSlugA}, members=${themeRankingMemberCountA}) should render`,
    ).toHaveCount(1);
    await expect(
      slugBLink,
      `theme slug B (${themeRankingSlugB}, members=${themeRankingMemberCountB}) should render`,
    ).toHaveCount(1);

    // Read theme-link hrefs in DOM order; the higher-memberCount slug must come
    // first (memberCount DESC).
    const hrefs = await main
      .locator('a[href^="/topics/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
    const idxA = hrefs.indexOf(`/topics/${encodeURIComponent(themeRankingSlugA)}`);
    const idxB = hrefs.indexOf(`/topics/${encodeURIComponent(themeRankingSlugB)}`);
    expect(idxA, "theme slug A must be in DOM").toBeGreaterThanOrEqual(0);
    expect(idxB, "theme slug B must be in DOM").toBeGreaterThanOrEqual(0);
    expect(
      idxB,
      `higher-memberCount slug B (idx=${idxB}, members=${themeRankingMemberCountB}) must render BEFORE slug A (idx=${idxA}, members=${themeRankingMemberCountA})`,
    ).toBeLessThan(idxA);
  });

  test("AC2 无结果反馈：/search?q={bogus} 含「未找到」+ 返回首页链 + SearchBox", async ({ page }) => {
    // Use a query that will not match any seeded corpus.
    const response = await page.goto("/search?q=不存在的词xyz123");
    expect(response!.status(), "no-match search status should be 200").toBe(200);

    // The no-match feedback text renders (contains the query for context).
    await expect(page.getByText(/未找到/)).toBeVisible();

    // A link back home renders.
    const homeLink = page.getByRole("link", { name: "返回首页" });
    await expect(homeLink).toBeVisible();
    expect(await homeLink.getAttribute("href")).toBe("/");

    // The page-content SearchBox renders (so the reader can try a different
    // keyword in place). Scope to <main> so this does NOT match the nav
    // SearchBox (aside) — there are two SearchBox instances on /search: one in
    // the nav (always present) and one in the page content (prefilled with the
    // failed query). The main one is the prefilled in-place refine box.
    const main = page.getByRole("main");
    const searchInput = main.locator('input[name="q"]');
    await expect(searchInput).toBeVisible();
    expect(await searchInput.inputValue()).toContain("不存在");

    // No EventCard / theme links should render in the page content (zero hits).
    // Scope to main to exclude the nav links.
    await expect(main.locator('a[href^="/events/"]')).toHaveCount(0);
    await expect(main.locator('a[href^="/topics/"]')).toHaveCount(0);
  });

  test("空 query 引导态：/search（无 q）含引导文案、不含「未找到」", async ({ page }) => {
    const response = await page.goto("/search");
    expect(response!.status(), "empty-query search status should be 200").toBe(200);

    // The guide text renders.
    await expect(page.getByText("输入关键词搜索热点事件与主题。")).toBeVisible();

    // The page-content SearchBox renders (empty — no prefill). Scope to main to
    // distinguish from the nav SearchBox (both render on /search).
    const main = page.getByRole("main");
    const searchInput = main.locator('input[name="q"]');
    await expect(searchInput).toBeVisible();
    expect(await searchInput.inputValue()).toBe("");

    // The no-match text must NOT render (empty query ≠ no match).
    await expect(page.getByText(/未找到/)).toHaveCount(0);

    // No results sections render.
    await expect(
      page.getByRole("heading", { level: 2, name: /热点事件/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: /^主题/ }),
    ).toHaveCount(0);
  });

  test("大小写不敏感（拉丁）：q=gpu 与 q=GPU 均命中 latinHitId 事件", async ({ page }) => {
    // The seeded event's title contains the Latin token 「GPU」. Chinese has no
    // case, so a Latin token is required to exercise toLowerCase normalization.
    // Lowercase query must hit it.
    const lower = await page.goto(`/search?q=${latinToken.toLowerCase()}`);
    expect(lower!.status(), "lowercase latin search status should be 200").toBe(200);
    await expect(
      page.locator(`a[href="/events/${latinHitId}"]`),
      "lowercase gpu should hit the GPU-titled event",
    ).toBeVisible();

    // Uppercase query must hit the same event.
    const upper = await page.goto(`/search?q=${latinToken}`);
    expect(upper!.status(), "uppercase latin search status should be 200").toBe(200);
    await expect(
      page.locator(`a[href="/events/${latinHitId}"]`),
      "uppercase GPU should hit the same event",
    ).toBeVisible();
  });

  test("超长 query 截断（信任边界）：200 字符 → 200 + 无结果反馈 + 回显 ≤ 128 字符", async ({ page }) => {
    // parseSearchQuery truncates to MAX_QUERY_LEN (128) before matching. A
    // 200-char query of a repeated uncommon character yields zero hits (the
    // truncated 128-char string is still gibberish) AND the echoed query in the
    // 「未找到与「{q}」相关的...」text must be ≤ 128 chars (proving truncation
    // happened at the trust boundary, not just at match time).
    const longQuery = "钋".repeat(200);
    const response = await page.goto(`/search?q=${encodeURIComponent(longQuery)}`);
    expect(response!.status(), "overlong query status should be 200").toBe(200);

    // The no-match feedback renders (the overlong query has zero hits).
    await expect(page.getByText(/未找到/)).toBeVisible();

    // Extract the echoed query from the feedback text. The page renders:
    //   未找到与「{q}」相关的热点或主题。
    // The text inside the corner brackets is the echoed (truncated) query.
    const feedback = page.getByText(/未找到与「/);
    await expect(feedback).toBeVisible();
    const feedbackText = (await feedback.textContent()) ?? "";
    const match = feedbackText.match(/未找到与「([^」]*)」/);
    expect(match, "feedback text should contain the echoed query in corner brackets").not.toBeNull();
    // match[1] is `string | undefined` under noUncheckedIndexedAccess; guard with
    // a TS-visible runtime check so the narrowing flows to the assertions below.
    const echoed = match?.[1];
    if (echoed === undefined) {
      throw new Error("feedback text matched but the echoed-query capture group was undefined");
    }
    expect(
      echoed.length,
      `echoed query must be truncated to ≤ 128 chars (got ${echoed.length})`,
    ).toBeLessThanOrEqual(128);

    // The echoed query is the first 128 chars of the submitted 200-char string.
    expect(echoed).toBe(longQuery.slice(0, 128));
  });

  test("截断边界 off-by-one (T4)：128 字符原样、129 字符截到 128", async ({ page }) => {
    // T4: pin the truncation BOUNDARY exactly. A 128-char query (== MAX_QUERY_LEN)
    // must pass through UNTRUNCATED (echoed length === 128); a 129-char query must
    // be cut to 128. Together these lock the off-by-one: `<` vs `<=` at the
    // boundary would let a 129-char query slip through or wrongly truncate a
    // 128-char one. The existing 200-char test only asserts the upper bound.
    // Repeated 「钋」 (BMP CJK, one code point = one code unit) keeps the code-unit
    // vs code-point distinction moot so the assertion targets the boundary alone.
    const char = "钋";

    // (1) 128 chars → untruncated (echoed length === 128).
    const exact = char.repeat(128);
    const res128 = await page.goto(`/search?q=${encodeURIComponent(exact)}`);
    expect(res128!.status(), "128-char query status should be 200").toBe(200);
    await expect(page.getByText(/未找到/)).toBeVisible();
    const feedback128 = page.getByText(/未找到与「/);
    await expect(feedback128).toBeVisible();
    const text128 = (await feedback128.textContent()) ?? "";
    const m128 = text128.match(/未找到与「([^」]*)」/);
    const echoed128 = m128?.[1];
    if (echoed128 === undefined) {
      throw new Error("128-char feedback matched but the echoed-query capture group was undefined");
    }
    expect(
      echoed128.length,
      `128-char query must pass through UNTRUNCATED (got ${echoed128.length})`,
    ).toBe(128);
    expect(echoed128, "128-char echoed query must equal the submitted 128 chars").toBe(exact);

    // (2) 129 chars → truncated to 128 (echoed length === 128, equals the first
    // 128 chars of the submitted string).
    const overByOne = char.repeat(129);
    const res129 = await page.goto(`/search?q=${encodeURIComponent(overByOne)}`);
    expect(res129!.status(), "129-char query status should be 200").toBe(200);
    await expect(page.getByText(/未找到/)).toBeVisible();
    const feedback129 = page.getByText(/未找到与「/);
    await expect(feedback129).toBeVisible();
    const text129 = (await feedback129.textContent()) ?? "";
    const m129 = text129.match(/未找到与「([^」]*)」/);
    const echoed129 = m129?.[1];
    if (echoed129 === undefined) {
      throw new Error("129-char feedback matched but the echoed-query capture group was undefined");
    }
    expect(
      echoed129.length,
      `129-char query must be truncated to exactly 128 (got ${echoed129.length})`,
    ).toBe(128);
    expect(echoed129, "129-char echoed query must equal the first 128 chars").toBe(overByOne.slice(0, 128));
  });

  test("AC3 桌面键盘提交：aside SearchBox 输入 → Enter → /search?q=… 含结果", async ({ page }) => {
    // Desktop viewport so the left-rail aside + its SearchBox are visible.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // The desktop aside SearchBox input is visible.
    const aside = page.getByRole("complementary");
    const searchInput = aside.locator('input[name="q"]').first();
    await expect(searchInput).toBeVisible();

    // Type the title query + submit via Enter (native form submission).
    await searchInput.fill(titleQuery);
    await searchInput.press("Enter");

    // Landed on /search?q=… and the result rendered.
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${encodeURIComponent(titleQuery)}`));
    await expect(
      page.locator(`a[href="/events/${titleHitId}"]`),
    ).toBeVisible();
  });

  test("AC3 移动触控提交：抽屉内 SearchBox 可见、输入 + 提交可达 /search?q=…", async ({ page }) => {
    // Mobile viewport so the desktop aside is hidden + the drawer is the nav.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // Open the mobile drawer.
    const hamburger = page.getByRole("banner").getByRole("button", { name: /导航菜单/ });
    await hamburger.click();
    const drawer = page.getByRole("dialog", { name: "导航菜单" });
    await expect(drawer).toBeVisible();

    // The drawer SearchBox input + submit button are visible. Both meet min-h-11
    // touch targets (CSS class assertion is impractical in e2e; visibility +
    // submittability is the observable proxy).
    const drawerInput = drawer.locator('input[name="q"]').first();
    await expect(drawerInput).toBeVisible();
    const drawerSubmit = drawer.getByRole("button", { name: "搜索" });
    await expect(drawerSubmit).toBeVisible();

    // Type the title query + click submit (touch-style click).
    await drawerInput.fill(titleQuery);
    await drawerSubmit.click();

    // Landed on /search?q=… and the result rendered.
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${encodeURIComponent(titleQuery)}`));
    await expect(
      page.locator(`a[href="/events/${titleHitId}"]`),
    ).toBeVisible();
  });

  test("返回恢复：/search?q={titleQuery} → event → BackLink 落回含 q= 的 URL", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);

    // Click the title-hit event card to enter the detail page.
    await page.locator(`a[href="/events/${titleHitId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

    // The detail page BackLink is present. After hydration it should resolve to
    // the originating /search?q=… URL (the 2.5 capture listener wrote it on the
    // click, and /search is now in the allowlist).
    // Poll for the hydrated href (useSyncExternalStore reads sessionStorage
    // post-mount; allow a brief retry for the effect to settle).
    const backLink = page.getByRole("link", { name: /返回首页/ }).first();
    await expect(backLink).toBeVisible();
    await expect
      .poll(async () => backLink.getAttribute("href"), {
        timeout: 5000,
        message: "BackLink href should hydrate to /search?q=…",
      })
      .toContain("/search");

    // Click BackLink → the URL restored contains the original q= (NOT the bare
    // homepage).
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(titleQuery)}`));
    // Sanity: it's NOT just the homepage.
    expect(page.url(), "should not fall back to bare /").not.toMatch(/\/$/);
  });

  test("/search 开放重定向守卫 (T3)：/search 前缀篡改 → BackLink 回退 /", async ({ page }) => {
    // T3: now that /search is in the isValidListReturn allowlist (LIST_PATH_EXACT),
    // lock that the entry is an EXACT pathname match, NOT a prefix. Each tampered
    // value starts with "/search" but must be REJECTED:
    //   - "/search/../console" → new URL normalizes the pathname to "/console"
    //     (not in allowlist) → reject.
    //   - "/search//evil.com" → pathname is "/search//evil.com" (not exactly
    //     "/search", not under "/topics/") → reject.
    // For each, write it to sessionStorage[aguhot:returnContext], navigate to a
    // detail page, reload (so BackLink re-mounts and useSyncExternalStore re-reads
    // the tampered context on mount), and assert the BackLink href falls back to
    // "/" (NOT the tampered value). This mirrors the 2.5 AC6 tamper test in
    // loop.spec.ts but covers /search-prefixed traversal specifically.
    const tamperedValues = ["/search/../console", "/search//evil.com"];
    for (const tampered of tamperedValues) {
      await page.goto(`/events/${titleHitId}`);
      await page.evaluate((v) => {
        window.sessionStorage.setItem("aguhot:returnContext", v);
      }, tampered);
      // Reload so BackLink re-mounts and reads the tampered context on mount
      // (BackLink uses useSyncExternalStore with a no-op subscribe; the reload
      // remounts it so the tampered value is observed).
      await page.reload();
      const backLink = page.getByRole("link", { name: /返回首页/ }).first();
      await expect(
        backLink,
        `tampered returnContext "${tampered}" must fall back to /`,
      ).toHaveAttribute("href", "/");
    }
  });

  test("匿名可达：全程未登录、无 /login 重定向", async ({ page }) => {
    const response = await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
    expect(response!.status(), "anonymous search status should be 200").toBe(200);
    expect(page.url(), "search should not redirect to login").not.toMatch(/\/login/);
  });

  test("不回归：/search 在公共壳内（nav 可见）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);

    // The public shell nav (aside) is present — /search is inside the (public)
    // route group.
    const aside = page.getByRole("complementary");
    await expect(aside).toBeVisible();

    // The primary nav entries are reachable from /search.
    await expect(aside.getByRole("link", { name: "首页" }).first()).toBeVisible();
    await expect(aside.getByRole("link", { name: "日报" }).first()).toBeVisible();
    await expect(aside.getByRole("link", { name: "主题" }).first()).toBeVisible();
  });

  test("下线事件不命中（AD-3/AD-8）：takedown 后再搜该事件链接消失 [LAST — 修改 DB]", async ({ page }) => {
    // This test is run LAST in the serial describe because it MUTATES the DB:
    // it takes down a DEDICATED seeded event (takedownHitId) used by no other
    // test. refreshPublishedReadModel({ action: "takedown" }) deletes all of its
    // published_* rows, so subsequent searches can no longer find it. Reset is
    // unnecessary — the seed runs once in beforeAll and this test only removes
    // its own target.

    // (1) Before takedown: the dedicated event is published and searchable.
    const before = await page.goto(`/search?q=${encodeURIComponent(takedownQuery)}`);
    expect(before!.status(), "pre-takedown search status should be 200").toBe(200);
    const mainBefore = page.getByRole("main");
    const linkBefore = mainBefore.locator(`a[href="/events/${takedownHitId}"]`);
    await expect(linkBefore, "dedicated event link should render before takedown").toHaveCount(1);

    // (2) Take the event down via the core publish-orchestrator. This deletes its
    // published_hot_event / published_hot_event_explanations / ... rows, so it
    // falls out of the published_* read models search reads (AD-3 + AD-8).
    const prisma = getPrisma();
    await refreshPublishedReadModel({
      prisma,
      traceId: newTraceId(),
      hotEventId: takedownHitId,
      action: "takedown",
    });

    // (3) After takedown: re-searching the same query no longer surfaces the
    // event's link in <main>. (A fresh page load is used so the response is
    // re-rendered against the now-mutated read model.)
    const after = await page.goto(`/search?q=${encodeURIComponent(takedownQuery)}`);
    expect(after!.status(), "post-takedown search status should be 200").toBe(200);
    const mainAfter = page.getByRole("main");
    await expect(
      mainAfter.locator(`a[href="/events/${takedownHitId}"]`),
      "taken-down event link must NOT render after takedown",
    ).toHaveCount(0);
  });
});
