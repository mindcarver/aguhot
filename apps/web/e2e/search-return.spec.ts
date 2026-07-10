import { expect, test } from "@playwright/test";

import { seedSearchContext } from "./seed-search";

/**
 * Search → detail → search return-loop e2e — Story 3.4 (AC2 explicit entry +
 * AC1 return + bfcache-miss fallback). Tagged @search-return so it runs only
 * under `pnpm --filter web e2e:search-return` (DB-backed + seed) and does NOT
 * run under the public `pnpm --filter web e2e` (whose --grep-invert excludes
 * @console, @feed, @detail, @revision, @merge-split, @market-reaction,
 * @associations, @themes, @daily, @loop, @search, @follow, @watchlist, AND
 * @search-return).
 *
 * The beforeAll imports and runs seedSearchContext() (the SAME function
 * `pnpm --filter web seed:search` runs, the same seed search.spec.ts uses) to
 * capture the dynamic title-hit hotEventId + the deterministic query string.
 * No new seed script is introduced (zero new test fixtures — Story 3.4 is a
 * pure web-layer change).
 *
 * Requires request-time DATABASE_URL: /search + /events/[hotEventId] are both
 * force-dynamic and read the published read models at request time.
 *
 * Covers:
 *   - AC2 explicit entry: /search?q={titleQuery} → click EventCard →
 *     /events/{titleHitId} → after hydration a real `<a>` labeled 「返回搜索结果」
 *     is visible, its href contains `/search` AND the encoded original query
 *     (NOT a bare `/search`, NOT `/`). The same page does NOT render a
 *     「返回首页」 link (the source-aware label replaced it — no ambiguity).
 *   - AC1 click-back: click 「返回搜索结果」 → the URL contains
 *     `q={titleQuery}` (original query preserved) AND the result EventCard
 *     re-renders (same query → same deterministic ranking).
 *   - AC2 reload fallback: on the detail page, `page.reload()` proves the
 *     「返回搜索结果」 entry is a page-level real `<a>` independent of bfcache /
 *     history state — sessionStorage RETURN_CONTEXT survives the reload, so the
 *     entry is STILL visible and STILL carries the query. (A reload is not a
 *     literal bfcache/browser-back simulation; it proves history-independence of
 *     the on-page entry, which is 3.4's scope. Browser-back scroll restoration is
 *     a separate 2.5 generic-history mechanism.)
 *   - Direct visit / no source (honest fallback): a FRESH context (no prior
 *     click, no RETURN_CONTEXT) visits /events/{titleHitId} directly → label is
 *     「返回首页」 + href `/` (no fabricated query); 「返回搜索结果」 does NOT
 *     render (toHaveCount 0 — we do not forge a source we don't have).
 *   - AC2 trust boundary: tampering sessionStorage[aguhot:returnContext] with
 *     `/search//evil.com` and `/search/../console` → after reload, label falls
 *     back to 「返回首页」 and href `/` (isSearchReturn rejects non-exact
 *     pathnames; no off-site jump, no mislabel).
 *   - No-regression: the detail page's six partitions + title still render
 *     when the reader came from search (search origin does not break the detail
 *     body). Anonymous 200 throughout.
 */
test.describe("搜索结果到详情页的回访闭环 (Story 3.4) @search-return", () => {
  // Serial mode: beforeAll seeds the DB once and the tests share the captured
  // id. The trust-boundary and reload tests mutate sessionStorage on the page
  // but do NOT touch the DB, so order within the describe does not matter for
  // seed state.
  test.describe.configure({ mode: "serial" });

  let titleHitId: string;
  let titleHitTitle: string;
  let titleQuery: string;

  test.beforeAll(async () => {
    const seeded = await seedSearchContext();
    titleHitId = seeded.titleHitId;
    titleHitTitle = seeded.titleHitTitle;
    titleQuery = seeded.titleQuery;
  });

  test("AC2 显式入口：搜索来源详情页渲染「返回搜索结果」且 href 带原 query", async ({ page }) => {
    // Enter search first so the ListContextMemory capture listener records the
    // search URL as the originating context.
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);

    // Click the title-hit EventCard to navigate into the detail page. The
    // capture listener (document-level, capture phase) fires BEFORE the Next
    // <Link> client routing and writes RETURN_CONTEXT="/search?q=…".
    await page.locator(`a[href="/events/${titleHitId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

    // After hydration, the BackLink label is 「返回搜索结果」 (source-aware:
    // isSearchReturn(fromHref) true → searchLabel renders). Poll for the
    // post-hydration state (useSyncExternalStore reads sessionStorage on mount).
    const searchReturnLink = page.getByRole("link", { name: /返回搜索结果/ }).first();
    await expect(searchReturnLink).toBeVisible();

    // The href carries `/search` AND the encoded original query (NOT a bare
    // `/search`, NOT `/`). This is the AC2 explicit entry: page-level,
    // history-independent, carries the original query.
    await expect
      .poll(async () => searchReturnLink.getAttribute("href"), {
        timeout: 5000,
        message: "search-return link href should hydrate to /search?q=…",
      })
      .toContain("/search");
    await expect
      .poll(async () => searchReturnLink.getAttribute("href"), {
        timeout: 5000,
        message: "search-return link href should contain the encoded query",
      })
      .toContain(encodeURIComponent(titleQuery));

    // AC2 — the page does NOT render a competing 「返回首页」 link (the
    // source-aware label REPLACED the default label). This locks the
    // single-return-surface property: from search, the reader sees exactly one
    // return entry and it says 「返回搜索结果」 (no ambiguity between two links).
    await expect(page.getByRole("link", { name: /返回首页/ })).toHaveCount(0);
  });

  test("AC1 点回：点「返回搜索结果」落回含 q= 的搜索结果页", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
    await page.locator(`a[href="/events/${titleHitId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

    // Wait for the search-return label to render (post-hydration).
    const searchReturnLink = page.getByRole("link", { name: /返回搜索结果/ }).first();
    await expect(searchReturnLink).toBeVisible();

    // Click it → the URL restored contains the original q= (search server-side
    // re-renders the same deterministic ranking for the same q). AC1: original
    // keyword / ranking / context preserved.
    await searchReturnLink.click();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(titleQuery)}`));

    // The search result EventCard re-renders (same query ⇒ same ranking ⇒ the
    // title-hit event is present again). This is the AC1 "results list
    // re-produces" half.
    await expect(page.locator(`a[href="/events/${titleHitId}"]`)).toBeVisible();
    // Sanity: it's NOT the bare homepage.
    expect(page.url(), "should not fall back to bare /").not.toMatch(/\/$/);
  });

  test("AC2 兜底：详情页 reload 后「返回搜索结果」仍在、仍带 query（页面级、history 无关）", async ({ page }) => {
    // Enter from search so RETURN_CONTEXT is set in sessionStorage.
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
    await page.locator(`a[href="/events/${titleHitId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

    // Reload the detail page (a reader who refreshed / re-opened the tab).
    // NOTE: a reload is NOT a literal bfcache/browser-back simulation — it does
    // not exercise history.back or pageshowpersisted. What it DOES prove is the
    // AC2 property that matters for THIS story's explicit entry: the entry is a
    // page-level real `<a>` whose href is derived from sessionStorage
    // RETURN_CONTEXT, which PERSISTS across a same-origin same-tab reload. So
    // after a reload (or any history state that does not restore the prior
    // search page), the reader still has an on-page, query-carrying way back to
    // search that does not depend on bfcache. (Browser-back scroll restoration
    // is a separate 2.5 generic-history mechanism, out of scope for 3.4.)
    await page.reload();

    // The 「返回搜索结果」 entry is STILL visible after reload, and its href
    // STILL carries the original query. This is the AC2 fallback: the entry
    // survives histories that browser-back cannot restore.
    const searchReturnLink = page.getByRole("link", { name: /返回搜索结果/ }).first();
    await expect(searchReturnLink).toBeVisible();
    await expect
      .poll(async () => searchReturnLink.getAttribute("href"), {
        timeout: 5000,
        message: "post-reload search-return href should still contain /search",
      })
      .toContain("/search");
    await expect
      .poll(async () => searchReturnLink.getAttribute("href"), {
        timeout: 5000,
        message: "post-reload search-return href should still contain the query",
      })
      .toContain(encodeURIComponent(titleQuery));
  });

  test("直访无来源：新 context 直接 GET /events/{id} → 「返回首页」、href /、无「返回搜索结果」", async ({ browser }) => {
    // A FRESH context (no prior navigation, no sessionStorage) simulates a
    // direct visit / external referrer / copy-pasted link. There is NO
    // RETURN_CONTEXT, so the honest fallback is 「返回首页」 + href `/`. We do
    // NOT forge a query or a search-origin label we don't have.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/events/${titleHitId}`);
      await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

      // The label is the default 「返回首页」 (fromHref null → isSearchReturn
      // false → children render).
      const homeLink = page.getByRole("link", { name: /返回首页/ }).first();
      await expect(homeLink).toBeVisible();
      expect(await homeLink.getAttribute("href")).toBe("/");

      // The search-return label does NOT render (no source → no forge).
      await expect(page.getByRole("link", { name: /返回搜索结果/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("信任边界：/search 前缀篡改 → isSearchReturn 拒、label 回退「返回首页」、href /", async ({ page }) => {
    // Tampered values start with "/search" but must be REJECTED by
    // isSearchReturn (exact pathname match, not prefix):
    //   - "/search//evil.com" → pathname stays "/search//evil.com" (not exact
    //     "/search") → reject → label 「返回首页」 + href `/`.
    //   - "/search/../console" → new URL normalizes the pathname to "/console"
    //     (not "/search") → reject → label 「返回首页」 + href `/`.
    // For each, write the tampered value to sessionStorage, reload the detail
    // page (so BackLink re-mounts and useSyncExternalStore re-reads on mount),
    // and assert the label falls back to 「返回首页」 and href `/`.
    const tamperedValues = ["/search//evil.com", "/search/../console"];
    for (const tampered of tamperedValues) {
      await page.goto(`/events/${titleHitId}`);
      await page.evaluate((v) => {
        window.sessionStorage.setItem("aguhot:returnContext", v);
      }, tampered);
      // Reload so BackLink re-mounts and reads the tampered context on mount.
      await page.reload();

      // The label falls back to 「返回首页」 (isSearchReturn rejected the
      // tampered value → searchLabel did not render → children rendered).
      const homeLink = page.getByRole("link", { name: /返回首页/ }).first();
      await expect(
        homeLink,
        `tampered returnContext "${tampered}" must render the 返回首页 label`,
      ).toBeVisible();
      // And href is `/` (isValidListReturn ALSO rejects these → fallback).
      expect(await homeLink.getAttribute("href")).toBe("/");

      // The search-return label must NOT render (we never mislabel a tampered
      // origin as search).
      await expect(
        page.getByRole("link", { name: /返回搜索结果/ }),
        `tampered returnContext "${tampered}" must NOT render the 返回搜索结果 label`,
      ).toHaveCount(0);
    }
  });

  test("不回归：搜索来源详情页六分区 + 标题仍渲、匿名 200", async ({ page }) => {
    // Enter from search so the BackLink shows the search-return label, then
    // assert the detail body is intact (search origin does not break the
    // detail page).
    await page.goto(`/search?q=${encodeURIComponent(titleQuery)}`);
    await page.locator(`a[href="/events/${titleHitId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/events/${titleHitId}`));

    // Anonymous 200 throughout (AD-8: no /login redirect).
    const response = page.url();
    expect(response, "detail page URL should not redirect to login").not.toMatch(/\/login/);

    // The title (a fact, not system-derived) renders.
    await expect(page.getByText(titleHitTitle).first()).toBeVisible();

    // The six partitions render (1.8 detail + 2.1 market reaction + 2.2
    // associations + 2.3 themes). These are the structural partitions the
    // detail page has always rendered — asserting their headings locks that
    // the search-origin label change did not break the body.
    await expect(
      page.getByRole("heading", { level: 2, name: /发生了什么/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /为什么重要/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /当前仍不确定什么/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /市场反应/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /关联/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /主题/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: /证据时间线/ }),
    ).toBeVisible();

    // The search-return label coexists with the intact body (AC2 entry does
    // not displace any partition).
    await expect(page.getByRole("link", { name: /返回搜索结果/ }).first()).toBeVisible();
  });
});
