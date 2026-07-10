import { expect, test } from "@playwright/test";

import { seedDailyDigest, seedDailyEmpty } from "./seed-daily";

/**
 * Public daily-digest e2e — Story 2.4. Tagged @daily so it runs only under
 * `pnpm --filter web e2e:daily` (DB-backed + seed) and does NOT run under the
 * public `pnpm --filter web e2e` (whose --grep-invert excludes @console, @feed,
 * @detail, @revision, @merge-split, @market-reaction, @associations, @themes,
 * AND @daily).
 *
 * The beforeAll imports and runs seedDailyDigest() (the same function
 * `pnpm --filter web seed:daily` runs) to capture the dynamic coverageDate +
 * digest entry ids + titles + generatedAt.
 *
 * Requires request-time DATABASE_URL: the /daily route is force-dynamic and
 * reads the published read models via getPrisma at request time.
 *
 * Covers:
 *   - AC2: GET /daily is 200, the editorial-serif title renders, the coverage
 *     date renders, the generation time renders, <AiLabel> renders, >=2 entries
 *     render (sorted by evidenceCount DESC), each entry is a clickable link to
 *     /events/{hotEventId} (FR10).
 *   - AC2 closed loop (daily→detail): clicking an entry link lands on the detail
 *     page (200, non-dead-link).
 *   - AC2 date selector: GET /daily?date={coverageDate} renders that date's
 *     digest.
 *   - AC2 bogus date: GET /daily?date=bogus 200s and falls back to the latest
 *     digest (does not crash).
 *   - AC3 degraded (no digest for the coverageDate): seeded by seedDailyEmpty()
 *     (resets the DB → one published hot event with NO digest). /daily renders
 *     the degraded text「该覆盖日期的日报尚未生成。」+ the coverage scope, never
 *     blank. Placed LAST in the serial suite: the earlier tests have already
 *     run against the populated seed, and serial mode guarantees in-file
 *     ordering. The DB is intentionally left in the empty-digest state after
 *     this test (no restore needed).
 */

test.describe("结构化日报生成与阅读 (Story 2.4) @daily", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. Without this, fullyParallel would run beforeAll per worker
  // and the concurrent seeds would race on the same DB.
  test.describe.configure({ mode: "serial" });

  let coverageDate: string;
  let digestEntryIds: string[];
  let digestTitles: string[];

  test.beforeAll(async () => {
    const seeded = await seedDailyDigest();
    coverageDate = seeded.coverageDate;
    digestEntryIds = seeded.digestEntryIds;
    digestTitles = seeded.digestTitles;
  });

  test("AC2 日报页：标题 + 覆盖日期 + 生成时间 + AiLabel + ≥2 entries 链 /events/{id}", async ({ page }) => {
    const response = await page.goto("/daily");
    expect(response, "/daily should respond").not.toBeNull();
    expect(response!.status(), "/daily status should be 200").toBe(200);

    // AC2: the editorial-serif title renders.
    await expect(
      page.getByRole("heading", { level: 1, name: "日报" }),
    ).toBeVisible();

    // AC2: the coverage date renders (YYYY-MM-DD).
    await expect(page.getByText(`覆盖日期 ${coverageDate}`).first()).toBeVisible();

    // AC2: the generation time renders (contains "生成时间" + a UTC timestamp).
    await expect(page.getByText(/生成时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/).first()).toBeVisible();

    // AC2 (UX-DR8): the <AiLabel> renders (the digest is system-derived).
    await expect(page.locator(".bg-accent-warm").first()).toBeVisible();

    // AC2: each digest entry title is visible (>=2 entries).
    expect(digestEntryIds.length, "expected >=2 digest entries").toBeGreaterThanOrEqual(2);
    for (const title of digestTitles) {
      await expect(page.getByText(title).first()).toBeVisible();
    }

    // AC2 (FR10): each entry is a clickable link to /events/{id}.
    for (const id of digestEntryIds) {
      const entryLink = page.locator(`a[href="/events/${id}"]`);
      await expect(entryLink).toBeVisible();
    }

    // AC2: entries render in evidenceCount DESC order (strongest signal first).
    // digestEntryIds is the generation-time sorted order (digest-service sorts
    // before append); the render must trust and preserve it. If a regression
    // re-sorted or dropped the sort, this DOM-order check fails — presence
    // checks alone (above) would not catch it.
    expect(digestEntryIds.length, "render-order check needs >=2 entries").toBeGreaterThanOrEqual(2);
    const topBox = await page.locator(`a[href="/events/${digestEntryIds[0]}"]`).boundingBox();
    const nextBox = await page.locator(`a[href="/events/${digestEntryIds[1]}"]`).boundingBox();
    expect(topBox && nextBox, "both entry links must be present for order check").toBeTruthy();
    expect(topBox!.y, "highest-evidence entry renders above lower-evidence entry").toBeLessThan(nextBox!.y);
  });

  test("AC2 daily→detail 闭环：点 entry 链到达 /events/{id} 200", async ({ page }) => {
    await page.goto("/daily");
    // Click the first entry link.
    const firstEntry = page.locator(`a[href="/events/${digestEntryIds[0]}"]`);
    await firstEntry.click();
    await expect(page).toHaveURL(new RegExp(`/events/${digestEntryIds[0]}$`));
    // The detail page loads (200 — not a dead link).
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
  });

  test("AC2 选日：GET /daily?date={coverageDate} 渲染该日日报", async ({ page }) => {
    const response = await page.goto(`/daily?date=${coverageDate}`);
    expect(response, "/daily?date= should respond").not.toBeNull();
    expect(response!.status(), "/daily?date= status should be 200").toBe(200);

    // The coverage date renders for the selected date.
    await expect(page.getByText(`覆盖日期 ${coverageDate}`).first()).toBeVisible();

    // The entries render (at least the first entry title).
    await expect(page.getByText(digestTitles[0]!).first()).toBeVisible();
  });

  test("AC2 非法 date：GET /daily?date=bogus 200 回退最新不崩", async ({ page }) => {
    const response = await page.goto("/daily?date=bogus");
    expect(response, "/daily?date=bogus should respond").not.toBeNull();
    expect(response!.status(), "/daily?date=bogus status should be 200").toBe(200);

    // Falls back to the latest digest (the coverage date renders for the latest
    // seeded date, not a crash/blank).
    await expect(page.getByText(`覆盖日期 ${coverageDate}`).first()).toBeVisible();
  });

  test("AC3 降级行：无日报时显降级文案 + 已发布 N 条，不空白", async ({ page }) => {
    // Reseed the DB to the empty-digest state: ONE published hot event with NO
    // digest for its coverageDate. Runs LAST in the serial suite so the
    // populated-state tests above have already executed. Serial mode guarantees
    // ordering.
    const emptySeeded = await seedDailyEmpty();

    // /daily (no ?date=) now has no digests at all → degrade. The degraded
    // coverageDate falls back to "today" (no coverageDate resolved), but the
    // degraded text + count still render.
    const response = await page.goto("/daily");
    expect(response, "/daily (empty) should respond").not.toBeNull();
    expect(response!.status(), "/daily (empty) status should be 200").toBe(200);

    // AC3: the honest degraded line renders.
    await expect(
      page.getByText("该覆盖日期的日报尚未生成。"),
    ).toBeVisible();

    // AC3: the coverage scope renders (mentions "已发布" + "条热点事件").
    await expect(
      page.getByText(/已发布 \d+ 条热点事件，日报生成中。/),
    ).toBeVisible();

    // AC3: NO entry links to /events/{id} should appear (no digest entries).
    await expect(page.locator('a[href^="/events/"]')).toHaveCount(0);

    // AC3: the specific emptyCoverageDate should also degrade when explicitly
    // requested via ?date=.
    const emptyResponse = await page.goto(
      `/daily?date=${emptySeeded.emptyCoverageDate}`,
    );
    expect(emptyResponse!.status()).toBe(200);
    await expect(
      page.getByText("该覆盖日期的日报尚未生成。"),
    ).toBeVisible();
  });
});
