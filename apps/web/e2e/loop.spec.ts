import { expect, test } from "@playwright/test";

import { MIN_FILLER_COUNT, seedLoopContext } from "./seed-loop";

/**
 * Public cross-surface return-loop e2e — Story 2.5 (UX-DR12 reading-context
 * restoration). Tagged @loop so it runs only under
 * `pnpm --filter web e2e:loop` (DB-backed + seed) and does NOT run under the
 * public `pnpm --filter web e2e` (whose --grep-invert excludes @console, @feed,
 * @detail, @revision, @merge-split, @market-reaction, @associations, @themes,
 * @daily, AND @loop).
 *
 * The beforeAll imports and runs seedLoopContext() (the same function
 * `pnpm --filter web seed:loop` runs) to capture the dynamic loopHotEventId +
 * loopTitle + themeSlug + coverageDate. The seed produces the loop target event
 * PLUS >=10 filler events that ALL share the stub theme slug AND the daily
 * coverageDate — so the homepage feed, the theme page, and the daily page each
 * list >=10 entries and are naturally tall enough to scroll past 1000px on the
 * pinned 1280x720 viewport (no injected spacer; the natural height survives
 * client-side navigation, unlike a React-reconciled-away spacer).
 *
 * Requires request-time DATABASE_URL: the /, /topics/{slug}, /daily, and
 * /events/{id} routes are all force-dynamic and read the published read models
 * via getPrisma at request time.
 *
 * Covers UX-DR12 (AC1–AC7):
 *   - AC2/AC3 home return: from `/?window=today` scrolled, click the feed card
 *     into detail, BackLink href hydrates to `/?window=today`, click → URL +
 *     scroll restored.
 *   - AC2/AC3 theme return: from `/topics/{slug}` scrolled, click the member
 *     into detail, BackLink href = `/topics/{slug}`, click → URL + scroll
 *     restored.
 *   - AC2/AC3 daily return: from `/daily?date={D}` scrolled, click the entry
 *     into detail, BackLink href contains `date=`, click → URL + scroll
 *     restored.
 *   - AC4 fallback: direct-visit `/events/{id}` (no prior list click) →
 *     BackLink href = `/` (fallback).
 *   - AC6 open-redirect guard: tampered sessionStorage returnContext
 *     (`https://evil.com`, `//evil.com`, `/\evil.com`, `/console/123`) →
 *     BackLink falls back to `/`.
 *   - AC5 refresh no-jump: a fresh load of `/?window=today` (no marker) does
 *     not scroll to a stale position.
 *   - NFR no-regression: the detail six-partition layout + evidence timeline
 *     still render.
 *
 * Viewport: pinned to 1280x720 (P5) so the scroll assertions are deterministic
 * across CI/local viewports.
 */

test.describe("跨首页、主题页、日报与详情页的主线浏览闭环 (Story 2.5) @loop", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  // P5: pin the viewport so the scroll-height + scroll-restore assertions are
  // deterministic across CI/local viewports. At 720px height, >=10 feed/theme/
  // daily cards yield >1500px of scrollable content.
  test.use({ viewport: { width: 1280, height: 720 } });

  let loopHotEventId: string;
  let loopTitle: string;
  let themeSlug: string;
  let themeLabel: string;
  let coverageDate: string;

  test.beforeAll(async () => {
    const seeded = await seedLoopContext();
    loopHotEventId = seeded.loopHotEventId;
    loopTitle = seeded.loopTitle;
    themeSlug = seeded.themeSlug;
    themeLabel = seeded.themeLabel;
    coverageDate = seeded.coverageDate;
  });

  test("seed 校验：feed/主题/日报三面均 >=10 条，可滚动", async ({ page }) => {
    // P5: a future drop in filler count fails here with a clear signal (the
    // scroll-restore tests below need a feed taller than 1500px to be
    // meaningful). Asserting once up front avoids a confusing "scroll did not
    // restore" failure downstream. MIN_FILLER_COUNT is the seed-side floor
    // (>=10 fillers share the stub slug + coverageDate); each surface must
    // list >= MIN_FILLER_COUNT+1 entries and be taller than 1500px.
    await page.goto("/?window=today");
    const feedCardCount = await page.locator('a[href^="/events/"]').count();
    expect(feedCardCount, "feed must list >= MIN_FILLER_COUNT+1 cards").toBeGreaterThanOrEqual(
      MIN_FILLER_COUNT + 1,
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight), {
        timeout: 5000,
        message: "feed must be tall enough to scroll (>1500px)",
      })
      .toBeGreaterThan(1500);

    await page.goto(`/topics/${themeSlug}`);
    const themeMemberCount = await page.locator('a[href^="/events/"]').count();
    expect(
      themeMemberCount,
      "theme page must list >= MIN_FILLER_COUNT+1 members",
    ).toBeGreaterThanOrEqual(MIN_FILLER_COUNT + 1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight), {
        timeout: 5000,
        message: "theme page must be tall enough to scroll (>1500px)",
      })
      .toBeGreaterThan(1500);

    await page.goto(`/daily?date=${coverageDate}`);
    const dailyEntryCount = await page.locator('a[href^="/events/"]').count();
    expect(
      dailyEntryCount,
      "daily page must list >= MIN_FILLER_COUNT+1 entries",
    ).toBeGreaterThanOrEqual(MIN_FILLER_COUNT + 1);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight), {
        timeout: 5000,
        message: "daily page must be tall enough to scroll (>1500px)",
      })
      .toBeGreaterThan(1500);
  });

  test("AC2/AC3 首页返回：window 查询 + scroll 位恢复", async ({ page }) => {
    // 1. Load the feed with a window filter. The seed produces the loop event
    //    + >=10 fillers sharing the stub slug + coverageDate, so the feed is
    //    naturally tall (>1500px on the pinned 720px viewport) — no spacer
    //    needed, and the natural height SURVIVES client-side navigation.
    await page.goto("/?window=today");
    // Clear any stale sessionStorage from prior tests in this browser context.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload();
    // Ensure the loop event card has rendered before scrolling.
    await expect(page.locator(`a[href="/events/${loopHotEventId}"]`).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(50);
    const capturedScroll = await page.evaluate(() => window.scrollY);
    expect(capturedScroll, "feed should be scrolled to ~1500").toBeGreaterThan(1000);

    // 2. Click the loop event card → navigates to /events/{id}. The
    //    ListContextMemory capture listener writes returnContext + scroll.
    //    NOTE: dispatch the click via page.evaluate rather than Playwright's
    //    .click() — Playwright's .click() auto-scrolls the element into view
    //    before dispatching, which resets window.scrollY to the card's
    //    position (not the user's reading position). In a real browser, the
    //    user clicks what they see at their current scroll position; the
    //    capture listener must read THAT scrollY. A DOM .click() on the
    //    anchor dispatches a genuine bubbling click event that triggers both
    //    the capture listener (capture phase) and Next's <Link> navigation,
    //    WITHOUT changing scrollY.
    const clickScrollY = await page.evaluate((id) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`a[href="/events/${id}"]`);
      if (anchor === null) throw new Error("card anchor not found");
      // Read scrollY BEFORE the click (the capture listener will read it
      // synchronously during the click dispatch).
      anchor.click();
      return window.scrollY;
    }, loopHotEventId);
    // Verify the page was still scrolled when the click fired.
    expect(clickScrollY, "scrollY at click time").toBeGreaterThan(1000);
    await expect(page).toHaveURL(new RegExp(`/events/${loopHotEventId}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: loopTitle }).first(),
    ).toBeVisible();

    // 3. The BackLink hydrates (useSyncExternalStore reads sessionStorage) to
    //    the captured `/?window=today`.
    const backLink = page.getByRole("link", { name: /返回首页/ });
    await expect(backLink).toHaveAttribute("href", /window=today/);

    // 4. Click BackLink → returns to the originating list URL.
    await backLink.click();
    await expect(page).toHaveURL(/window=today/);

    // 5. The scroll position is restored. The restore fires via rAF after the
    //    async route content paints, so poll until scrollY exceeds the
    //    threshold. The natural feed height means the target is reachable.
    await expect.poll(
      async () => page.evaluate(() => window.scrollY),
      {
        timeout: 5000,
        message: "scroll restored to captured position (>1000)",
      },
    ).toBeGreaterThan(1000);

    // P6: the one-shot marker + the scroll slot for this href must both be
    // cleared after a successful restore — so a subsequent refresh of the same
    // list page does not re-jump (AC5). This locks the one-shot contract:
    // remove clearRestore/clearScroll from the restore effect → this assertion
    // fails.
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem("aguhot:restoreMarker")))
      .toBeNull();
    await expect
      .poll(() =>
        page.evaluate(() => window.sessionStorage.getItem("aguhot:scroll:/?window=today")),
      )
      .toBeNull();

    // P6: a reload of the same list URL must NOT re-jump via OUR one-shot
    // restore (the marker is gone, so the restore effect is a no-op). To test
    // our mechanism in isolation, defeat the BROWSER's native scroll
    // restoration (browsers persist scrollY across reloads independently of
    // our code) by setting scrollRestoration="manual" before the reload. This
    // isolates the one-shot contract: remove clearRestore/clearScroll from the
    // restore effect → the marker survives → our effect re-jumps → this fails.
    await page.evaluate(() => {
      if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    });
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        timeout: 5000,
        message: "reload must not re-jump via our one-shot restore (<50)",
      })
      .toBeLessThan(50);
  });

  test("AC2/AC3 主题页返回：/topics/{slug} + scroll 位恢复", async ({ page }) => {
    // The theme page lists >=10 members sharing the stub slug (seed-loop
    // publishes the loop target + >=10 fillers as theme members), so it is
    // naturally tall (>1500px) — no spacer needed.
    await page.goto(`/topics/${themeSlug}`);
    // Clear any stale sessionStorage from prior tests.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: themeLabel }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.scrollY), "theme page scrolled").toBeGreaterThan(800);

    // Click the member → detail. Use a DOM .click() (not Playwright's .click())
    // for the same reason as the home test: Playwright's .click() auto-scrolls
    // the element into view first, which resets scrollY to the card's position
    // rather than the user's reading position. The capture listener must read
    // the user's actual scrollY (1200).
    await page.evaluate((id) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`a[href="/events/${id}"]`);
      if (anchor === null) throw new Error("theme member anchor not found");
      anchor.click();
    }, loopHotEventId);
    await expect(page).toHaveURL(new RegExp(`/events/${loopHotEventId}$`));

    // BackLink hydrates to /topics/{slug} (no query on theme pages).
    const backLink = page.getByRole("link", { name: /返回首页/ });
    await expect(backLink).toHaveAttribute(
      "href",
      new RegExp(`/topics/${encodeURIComponent(themeSlug)}$`),
    );

    // Click back → URL + scroll restored. The theme page is naturally tall, so
    // the scroll restore has a real target on return (unlike the old spacer
    // approach, which React reconciled away on route change).
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`/topics/${encodeURIComponent(themeSlug)}$`));
    await expect.poll(
      async () => page.evaluate(() => window.scrollY),
      {
        timeout: 5000,
        message: "theme scroll restored (>800)",
      },
    ).toBeGreaterThan(800);
  });

  test("AC2/AC3 日报返回：/daily?date= + scroll 位恢复", async ({ page }) => {
    // The daily page lists >=10 entries sharing the coverageDate (seed-loop
    // generates one digest covering the loop target + >=10 fillers), so it is
    // naturally tall (>1500px) — no spacer needed.
    await page.goto(`/daily?date=${coverageDate}`);
    // Clear any stale sessionStorage from prior tests.
    await page.evaluate(() => window.sessionStorage.clear());
    await page.reload();
    await expect(
      page.getByText(`覆盖日期 ${coverageDate}`).first(),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.scrollY), "daily page scrolled").toBeGreaterThan(800);

    // Click the daily entry → detail. Use a DOM .click() (same reason as the
    // home/theme tests: Playwright's .click() auto-scrolls and would corrupt
    // the captured scrollY).
    await page.evaluate((id) => {
      const anchor = document.querySelector<HTMLAnchorElement>(`a[href="/events/${id}"]`);
      if (anchor === null) throw new Error("daily entry anchor not found");
      anchor.click();
    }, loopHotEventId);
    await expect(page).toHaveURL(new RegExp(`/events/${loopHotEventId}$`));

    // BackLink hydrates to /daily?date={coverageDate}.
    const backLink = page.getByRole("link", { name: /返回首页/ });
    await expect(backLink).toHaveAttribute("href", new RegExp(`date=${coverageDate}`));

    // Click back → URL + scroll restored. The daily page is naturally tall, so
    // the scroll restore has a real target on return.
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`date=${coverageDate}`));
    await expect.poll(
      async () => page.evaluate(() => window.scrollY),
      {
        timeout: 5000,
        message: "daily scroll restored (>800)",
      },
    ).toBeGreaterThan(800);
  });

  test("AC4 直访无上下文：BackLink href=fallback /", async ({ page }) => {
    // Direct navigation to the detail page (no prior list click) → no
    // returnContext in sessionStorage → BackLink renders the fallback href.
    await page.goto(`/events/${loopHotEventId}`);

    const backLink = page.getByRole("link", { name: /返回首页/ });
    // SSR + first hydration render href=fallback="/"; the effect also finds no
    // context → stays at fallback.
    await expect(backLink).toHaveAttribute("href", "/");
  });

  test("AC6 开放重定向守卫：篡改 returnContext 全回退 /", async ({ page }) => {
    // Tamper sessionStorage with open-redirect candidates, then navigate to the
    // detail page. isValidListReturn must reject each → BackLink falls back.
    // Includes the backslash-trick (`/\evil.com`, `\evil.com`) which URL
    // parsing normalizes to a non-localhost origin → rejected (P9).
    const maliciousValues = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "\\evil.com",
      "/console/123",
      `/events/${loopHotEventId}`,
    ];
    for (const evil of maliciousValues) {
      await page.goto(`/events/${loopHotEventId}`);
      await page.evaluate((v) => {
        window.sessionStorage.setItem("aguhot:returnContext", v);
      }, evil);
      // Reload so BackLink re-mounts and useSyncExternalStore re-reads the
      // tampered context on mount (BackLink uses useSyncExternalStore with a
      // no-op subscribe and reads once on mount; the reload remounts it so the
      // tampered value is observed).
      await page.reload();
      const backLink = page.getByRole("link", { name: /返回首页/ });
      await expect(backLink, `tampered returnContext "${evil}" must fall back to /`).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("AC5 刷新列表不误跳：无 marker 时 scrollY 保持顶部", async ({ page }) => {
    // A fresh load of the list page (no prior detail return) must NOT scroll to
    // a stale position. seedLoopContext already ran; sessionStorage in this
    // fresh browser context has no restore marker for /?window=today.
    await page.goto("/?window=today");
    // The page should be at the top (no marker → no restore).
    await page.waitForTimeout(100);
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, "fresh list load must not jump to a stale scroll").toBeLessThan(50);
  });

  test("AC7 BackLink 为真实 <a>，键盘可达", async ({ page }) => {
    await page.goto(`/events/${loopHotEventId}`);
    const backLink = page.getByRole("link", { name: /返回首页/ });
    await expect(backLink).toBeVisible();
    // It is a real anchor (role=link), focusable, keyboard-reachable.
    await backLink.focus();
    await expect(backLink).toBeFocused();
  });

  test("捕获门：非 /events/ 点击不写 returnContext", async ({ page }) => {
    // P7 negative test: clicking a non-detail link (a feed filter pill, which
    // navigates same-page to /?window=7d) must NOT write returnContext. This
    // locks the `url.pathname.startsWith("/events/")` capture gate against
    // being widened (e.g. to all same-origin links).
    await page.goto("/?window=today");
    // Clear any stale context from prior tests.
    await page.evaluate(() => window.sessionStorage.removeItem("aguhot:returnContext"));
    // The "近7天" filter pill links to ?window=7d (same-page filter change).
    const pill = page.getByRole("link", { name: "近7天" });
    await pill.first().click();
    // After the same-page navigation, returnContext must still be absent.
    await expect
      .poll(() => page.evaluate(() => window.sessionStorage.getItem("aguhot:returnContext")))
      .toBeNull();
  });

  test("NFR 不回归：详情六分区 + 证据时间线照常渲染", async ({ page }) => {
    await page.goto(`/events/${loopHotEventId}`);
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
      page.getByRole("heading", { level: 2, name: "关联" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "主题" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();
  });
});
