import { expect, test } from "@playwright/test";

import { seedThemeEvents, seedTopicsEmpty } from "./seed-themes";

/**
 * Public theme continuity e2e — Story 2.3. Tagged @themes so it runs only
 * under `pnpm --filter web e2e:themes` (DB-backed + seed) and does NOT run under
 * the public `pnpm --filter web e2e` (whose --grep-invert excludes @console,
 * @feed, @detail, @revision, @merge-split, @market-reaction, @associations, AND
 * @themes).
 *
 * The beforeAll imports and runs seedThemeEvents() (the same function
 * `pnpm --filter web seed:themes` runs) to capture the dynamic themed + noTheme
 * hotEventIds + the stub slug/label.
 *
 * Requires request-time DATABASE_URL: the /topics, /topics/[slug], and detail
 * routes are force-dynamic and read the published read models via getPrisma at
 * request time.
 *
 * Covers:
 *   - AC1: /topics/{slug} is 200, the editorial-serif title renders the theme
 *     label, >=2 member events render in chronological order (latestEvidenceAt
 *     ASC), each member is a clickable link to /events/{id} (FR11).
 *   - AC1 closed loop (theme→detail): clicking a member link lands on the detail
 *     page (200).
 *   - AC2/AC4: /events/{themedId} is 200, the "主题" section renders, each theme
 *     is a clickable FilterPill link to /topics/{slug} (FR9), the provenance
 *     line "关联依据：系统映射" renders.
 *   - AC4 closed loop (detail→theme): clicking the theme link lands on the theme
 *     page (200, non-dead-link).
 *   - AC1 /topics directory: /topics lists the theme as a link to
 *     /topics/{slug}.
 *   - AC3: /topics/{unknown-slug} 404s (never fabricates a theme page).
 *   - AC3: /events/{noThemeId} renders the "暂无已确认的主题关联。" degraded line
 *     and NO theme pills.
 *   - NFR5 no-regression: the existing partitions (发生了什么 / 为什么重要 /
 *     当前仍不确定什么) + market-reaction + associations + evidence timeline
 *     still render for themed events.
 *   - AC1 /topics directory degraded row "无任何主题→目录降级": when NO
 *     published hot event has any theme membership, /topics renders the
 *     degraded text「暂无已确认的主题。」 and NO /topics/{slug} links. Seeded by
 *     seedTopicsEmpty() (resets the DB → one published hot event with NO theme
 *     memberships as the sole state). Placed LAST in the serial suite: the
 *     earlier tests have already run against the populated seed, and serial
 *     mode guarantees in-file ordering. The DB is intentionally left in the
 *     empty-topics state after this test (no restore needed).
 */

test.describe("主题页连续追踪 (Story 2.3) @themes", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let themeSlug: string;
  let themeLabel: string;
  let themedIds: string[];
  let themedTitles: string[];
  let noThemeId: string;

  test.beforeAll(async () => {
    const seeded = await seedThemeEvents();
    themeSlug = seeded.themeSlug;
    themeLabel = seeded.themeLabel;
    themedIds = seeded.themedHotEventIds;
    themedTitles = seeded.themedTitles;
    noThemeId = seeded.noThemeHotEventId;
  });

  test("AC1 主题页：标题可见、≥2 成员按时间序可见、每成员为可点击链 /events/{id}", async ({ page }) => {
    const response = await page.goto(`/topics/${themeSlug}`);
    expect(response, "theme page should respond").not.toBeNull();
    expect(response!.status(), "theme page status should be 200").toBe(200);

    // AC1: the editorial-serif title renders the theme label.
    await expect(
      page.getByRole("heading", { level: 1, name: themeLabel }),
    ).toBeVisible();

    // AC1: the member-events heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: "成员事件" }),
    ).toBeVisible();

    // AC1: each themed member title is visible (>=2 members).
    for (const title of themedTitles) {
      await expect(page.getByText(title).first()).toBeVisible();
    }

    // AC1 (FR11): each member is a clickable link to /events/{id}.
    for (const id of themedIds) {
      const memberLink = page.locator(`a[href="/events/${id}"]`);
      await expect(memberLink).toBeVisible();
    }

    // AC1: pin ASC chronological DOM order (latestEvidenceAt ASC, earliest→latest).
    // The seed (seed-themes.ts) designates themedTitles[0] (芯片短缺加剧, evidence
    // ~1 day ago) as the EARLIER member and themedTitles[1] (芯片代工产能紧张,
    // evidence ~2 hours ago) as the LATER member. In ASC order the earlier member
    // must precede the later member in the DOM. Read the member <li> titles in DOM
    // order and assert themedTitles[0]'s index < themedTitles[1]'s index.
    const memberTitles = await page
      .locator('section h2:has-text("成员事件") + ol li')
      .allInnerTexts();
    const earlierIdx = memberTitles.findIndex((t) =>
      t.includes(themedTitles[0]!),
    );
    const laterIdx = memberTitles.findIndex((t) =>
      t.includes(themedTitles[1]!),
    );
    expect(earlierIdx, "earlier-evidence member should be present in DOM").not.toBe(-1);
    expect(laterIdx, "later-evidence member should be present in DOM").not.toBe(-1);
    expect(
      earlierIdx,
      "ASC chronological order: earlier-evidence member must precede later-evidence member in DOM",
    ).toBeLessThan(laterIdx);
  });

  test("AC1 主题→详情闭环：点成员链到达 /events/{id} 200", async ({ page }) => {
    await page.goto(`/topics/${themeSlug}`);
    // Click the first member link.
    const firstMember = page.locator(`a[href="/events/${themedIds[0]}"]`);
    await firstMember.click();
    await expect(page).toHaveURL(new RegExp(`/events/${themedIds[0]}$`));
    // The detail page loads (200 — not a dead link).
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
  });

  test("AC2/AC4 详情主题 section：链 /topics/{slug} 可见、provenance 可见", async ({ page }) => {
    const response = await page.goto(`/events/${themedIds[0]}`);
    expect(response, "themed detail should respond").not.toBeNull();
    expect(response!.status(), "themed detail status should be 200").toBe(200);

    // The "主题" heading renders.
    const themeSection = page.locator("section", { hasText: "主题" }).first();
    await expect(themeSection).toBeVisible();

    // AC4 (FR9): the theme is a clickable FilterPill link to /topics/{slug}.
    const themeLink = themeSection.getByRole("link", { name: themeLabel });
    await expect(themeLink).toBeVisible();
    await expect(themeLink).toHaveAttribute(
      "href",
      `/topics/${encodeURIComponent(themeSlug)}`,
    );

    // AC2: the provenance line renders.
    await expect(themeSection.getByText("关联依据：系统映射")).toBeVisible();

    // The degraded line must NOT appear (themes were projected).
    await expect(
      themeSection.getByText("暂无已确认的主题关联。"),
    ).toHaveCount(0);
  });

  test("AC4 详情→主题闭环：点主题链到达 /topics/{slug} 200（非死链）", async ({ page }) => {
    await page.goto(`/events/${themedIds[0]}`);
    const themeSection = page.locator("section", { hasText: "主题" }).first();
    const themeLink = themeSection.getByRole("link", { name: themeLabel });
    await themeLink.click();

    await expect(page).toHaveURL(new RegExp(`/topics/${encodeURIComponent(themeSlug)}$`));
    // The theme page loads (200 — non-dead-link).
    await expect(
      page.getByRole("heading", { level: 1, name: themeLabel }),
    ).toBeVisible();
  });

  test("AC1 /topics 目录：列该主题链 /topics/{slug}", async ({ page }) => {
    const response = await page.goto("/topics");
    expect(response, "/topics should respond").not.toBeNull();
    expect(response!.status(), "/topics status should be 200").toBe(200);

    // The directory lists the theme as a link to /topics/{slug}.
    const themeLink = page.locator(
      `a[href="/topics/${encodeURIComponent(themeSlug)}"]`,
    );
    await expect(themeLink).toBeVisible();
    await expect(themeLink).toHaveText(themeLabel);

    // The degraded line must NOT appear (themes exist).
    await expect(page.getByText("暂无已确认的主题。")).toHaveCount(0);
  });

  test("AC3 未知主题 slug → 404（不造假主题页）", async ({ page }) => {
    const response = await page.goto("/topics/this-slug-does-not-exist-xyz");
    expect(response!.status(), "unknown slug should be 404").toBe(404);
  });

  test("AC3 已发布无主题：主题 section 显降级文案、无主题项", async ({ page }) => {
    const response = await page.goto(`/events/${noThemeId}`);
    expect(response, "no-theme detail should respond").not.toBeNull();
    expect(response!.status(), "no-theme detail status should be 200").toBe(200);

    // The "主题" heading still renders (the block is present, just degraded).
    const themeSection = page.locator("section", { hasText: "主题" }).first();
    await expect(themeSection).toBeVisible();

    // AC3: the honest degraded line renders.
    await expect(
      themeSection.getByText("暂无已确认的主题关联。"),
    ).toBeVisible();

    // AC3: the provenance line must NOT appear (no themes were projected).
    await expect(themeSection.getByText("关联依据：系统映射")).toHaveCount(0);

    // AC3: NO theme link to /topics/{slug} should appear.
    await expect(
      themeSection.locator(`a[href^="/topics/"]`),
    ).toHaveCount(0);
  });

  test("NFR5 不回归：既有六分区 + 证据时间线在主题事件上照常渲染", async ({ page }) => {
    await page.goto(`/events/${themedIds[0]}`);
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
      page.getByRole("heading", { level: 2, name: "证据时间线" }),
    ).toBeVisible();
  });

  test("AC1 /topics 目录降级行：无任何主题时显降级文案、无主题链（无任何主题→目录降级）", async ({ page }) => {
    // Reseed the DB to the empty-topics state: ONE published hot event with NO
    // theme memberships. Runs LAST in the serial suite so the populated-state
    // tests above have already executed. Serial mode guarantees ordering.
    await seedTopicsEmpty();

    const response = await page.goto("/topics");
    expect(response, "/topics (empty) should respond").not.toBeNull();
    expect(response!.status(), "/topics (empty) status should be 200").toBe(200);

    // The degraded directory text must render (no published themes exist).
    await expect(page.getByText("暂无已确认的主题。")).toBeVisible();

    // NO theme link to /topics/{slug} should appear anywhere on the page.
    await expect(page.locator(`a[href^="/topics/"]`)).toHaveCount(0);
  });
});
