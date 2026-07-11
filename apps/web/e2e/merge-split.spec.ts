import { expect, test } from "@playwright/test";

import { authenticateOperator } from "./_operator-auth";
import { seedMergeSplitEvents } from "./seed-merge-split";

/**
 * Published-event merge / split / re-publish e2e — Story 1.10. Tagged
 * @merge-split so it runs only under `pnpm --filter web e2e:merge-split`
 * (DB-backed + seed) and does NOT run under the public `pnpm --filter web e2e`
 * (whose --grep-invert excludes @console, @feed, @detail, @revision, AND
 * @merge-split).
 *
 * The beforeAll imports and runs seedMergeSplitEvents() to capture the two
 * dynamic published hotEventIds (A + B) needed to navigate to /console/{id} and
 * /events/{id}.
 *
 * Requires request-time DATABASE_URL: both the console detail route and the
 * public detail route are force-dynamic and read via getPrisma at request time.
 *
 * Covers:
 *   - /console/{A} renders the merge form (with B as a source option) + the
 *     split form (with evidence checkboxes) (operator entry).
 *   - Submit merge source=B → /events/{B} 404 (read model deleted), /events/{A}
 *     shows the UNION evidence count (4), /console/{B} audit chain has the
 *     takedown (merged into A).
 *   - Submit split (check a subset of A's evidence + title) → /console queue
 *     shows a new candidate, /events/{A} shows the REMAINING evidence count.
 *   - taken_down event detail shows a "重新发布" button; submit it → /events/{id}
 *     reappears (re-publish from taken_down).
 *
 * The full merge + split flow is split across tests that share the seeded state
 * (serial mode), so DB state mutations stay sequenced within one coherent page
 * session per test.
 */

test.describe("已发布热点的合并、拆分与下线重发布 (Story 1.10) @merge-split", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured ids. The merge test mutates B (retires it), so tests that depend
  // on B being published must run before the merge test.
  test.describe.configure({ mode: "serial" });

  let published: {
    a: { hotEventId: string; title: string; evidenceCount: number };
    b: { hotEventId: string; title: string; evidenceCount: number };
  };

  test.beforeAll(async () => {
    const seeded = await seedMergeSplitEvents();
    published = {
      a: {
        hotEventId: seeded.publishedA.hotEventId,
        title: seeded.publishedA.title,
        evidenceCount: seeded.publishedA.evidenceCount,
      },
      b: {
        hotEventId: seeded.publishedB.hotEventId,
        title: seeded.publishedB.title,
        evidenceCount: seeded.publishedB.evidenceCount,
      },
    };
  });

  test("AC1 /console/{A} 渲染合并与拆分表单", async ({ page, context }) => {
    await authenticateOperator(context);
    await page.goto(`/console/${published.a.hotEventId}`);

    // The merge/split branch heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: "合并 / 拆分" }),
    ).toBeVisible();

    // The merge form heading renders.
    await expect(page.getByText("合并（吸收另一已发布热点）")).toBeVisible();

    // The merge source <select> lists B as an option. A non-selected <option>
    // is not CSS-"visible" (only the selected one renders), so assert the option
    // EXISTS by its value rather than toBeVisible. selectOption below proves it
    // is selectable (the option is present and enabled).
    const sourceSelect = page.locator('select[name="sourceId"]');
    await expect(sourceSelect).toBeVisible();
    await expect(
      sourceSelect.locator(`option[value="${published.b.hotEventId}"]`),
    ).toHaveCount(1);

    // The split form heading renders.
    await expect(page.getByText("拆分（把勾选证据子集拆为新候选）")).toBeVisible();

    // The split form has evidence checkboxes (A has 2 records after seed).
    const splitCheckboxes = page.locator('input[name="evidenceRecordId"]');
    await expect(splitCheckboxes).toHaveCount(2);
  });

  test("AC1 合并 source=B → B 公开 404、A 显并集证据、B 审计链含 takedown", async ({ page, context }) => {
    // Authenticate as operator for the whole test session. The cookie persists
    // across navigations within this context, so subsequent /console/{B} re-
    // visits stay authenticated; public /events/ routes are unaffected.
    await authenticateOperator(context);
    // --- Step 1: submit the merge on /console/{A} ---------------------------
    await page.goto(`/console/${published.a.hotEventId}`);

    // Select B as the source.
    await page.locator('select[name="sourceId"]').selectOption(published.b.hotEventId);
    await page.getByRole("button", { name: "执行合并" }).click();
    // The action redirects back to A's detail.
    await expect(page).toHaveURL(new RegExp(`/console/${published.a.hotEventId}`));

    // --- Step 2: /events/{B} is now 404 (read model deleted by takedown) ----
    // Give Next.js a moment to settle the revalidation (the server action
    // revalidated /events/{B} but the dev server's route cache can lag by a
    // beat behind the redirect). A short wait + a fresh goto reliably observes
    // the post-takedown 404; a reload fallback defeats any stale route cache.
    await page.waitForTimeout(500);
    let bResponse = await page.goto(`/events/${published.b.hotEventId}`, { waitUntil: "networkidle" });
    if (bResponse?.status() !== 404) {
      await page.waitForTimeout(300);
      bResponse = await page.reload({ waitUntil: "networkidle" });
    }
    expect(bResponse?.status()).toBe(404);

    // --- Step 3: /events/{A} shows the UNION evidence count (2 + 2 = 4) ------
    // Reload to bypass the dev-server route cache (A was rendered pre-merge in
    // the AC1 test). The fresh render shows the post-merge union evidence.
    await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    // The evidence timeline lists 4 rows (union of A's original 2 + B's 2).
    // Each evidence row is a <li> inside the timeline section; count the source
    // links rendered as "原文链接 ↗".
    await expect(page.getByText("原文链接 ↗")).toHaveCount(4);

    // --- Step 4: /console/{B} audit chain has the takedown decision ----------
    await page.goto(`/console/${published.b.hotEventId}`);
    const auditSection = page.locator("text=决策审计链").locator("xpath=ancestor::section[1]");
    await expect(auditSection.getByText(/takedown/)).toBeVisible();
    // The note recording the merge intent is present.
    await expect(auditSection.getByText(new RegExp(`merged into ${published.a.hotEventId}`))).toBeVisible();
  });

  test("AC2 拆分子集 → 新 candidate 入队、A 显剩余证据", async ({ page, context }) => {
    await authenticateOperator(context);
    // After the merge test, A has 4 evidence records. Split off 2 into a new
    // candidate. /console/{A} re-rendered to get fresh checkboxes.
    await page.goto(`/console/${published.a.hotEventId}`);

    // Fill the split title. Scope to #splitTitle (the revision form also has an
    // input[name="title"], so the generic selector is ambiguous).
    await page.locator("#splitTitle").fill("拆分出的新候选（e2e）");

    // Check the first 2 evidence checkboxes (the subset).
    const checkboxes = page.locator('input[name="evidenceRecordId"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    await page.getByRole("button", { name: "执行拆分" }).click();
    // The action redirects back to A's detail.
    await expect(page).toHaveURL(new RegExp(`/console/${published.a.hotEventId}`));

    // --- /console queue now shows a new candidate (the split offspring) -------
    // The /console route was rendered earlier in this test session, so the dev
    // server may serve a stale cached copy. Reload once to bypass the route
    // cache and force a fresh render that includes the new candidate.
    await page.goto("/console");
    await page.reload({ waitUntil: "networkidle" });
    // The candidate queue lists the new candidate by the title we gave it.
    await expect(page.getByText("拆分出的新候选（e2e）")).toBeVisible();

    // --- /events/{A} shows the REMAINING evidence (4 - 2 = 2) ----------------
    await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    await expect(page.getByText("原文链接 ↗")).toHaveCount(2);
  });

  test("AC3 下线重发布 → 公开重现", async ({ page, context }) => {
    await authenticateOperator(context);
    // A is still published. Take it down via the console, then republish it via
    // the taken_down republish button, and assert it reappears publicly.
    await page.goto(`/console/${published.a.hotEventId}`);

    // Take down A (the takedown button lives in the revision branch).
    await page.getByRole("button", { name: "下线" }).click();
    await expect(page).toHaveURL(new RegExp(`/console/${published.a.hotEventId}`));

    // A is now taken_down → /events/{A} is 404. Wait for revalidation to settle
    // and reload to bypass the dev-server route cache (A was rendered as 200
    // earlier in this test session).
    await page.waitForTimeout(300);
    let takenDownResponse = await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    if (takenDownResponse?.status() !== 404) {
      takenDownResponse = await page.reload({ waitUntil: "networkidle" });
    }
    expect(takenDownResponse?.status()).toBe(404);

    // The taken_down detail page now shows a "重新发布" button (in the ReviewForm,
    // which renders for non-published statuses). Submit it. The console route
    // re-render after takedown can be slow in dev (revalidation settling); give
    // it a beat and use networkidle.
    await page.waitForTimeout(300);
    await page.goto(`/console/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "重新发布" })).toBeVisible();
    await page.getByRole("button", { name: "重新发布" }).click();
    await expect(page).toHaveURL(new RegExp(`/console/${published.a.hotEventId}`));

    // A is now published again → /events/{A} is visible (200, not 404). Wait
    // for revalidation and reload to bypass the route cache that still holds
    // the taken_down 404.
    await page.waitForTimeout(300);
    let republishedResponse = await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    if (republishedResponse?.status() !== 200) {
      republishedResponse = await page.reload({ waitUntil: "networkidle" });
    }
    expect(republishedResponse?.status()).toBe(200);
    // The audit chain contains the republish decision.
    await page.goto(`/console/${published.a.hotEventId}`);
    const auditSection = page.locator("text=决策审计链").locator("xpath=ancestor::section[1]");
    await expect(auditSection.getByText(/taken_down → published/)).toBeVisible();
  });

  test("AC4 合并非法：source 非 published 被前端守卫拒绝（无公开污染）", async ({ page, context }) => {
    // The submitMerge server action has a front-guard that rejects a merge whose
    // source is not currently published (it checks listPublishedHotEvents and
    // redirects back with NO module call). Without it, merging a taken_down/
    // candidate source would move that source's evidence into the target and the
    // target's republish would succeed BEFORE the source's takedown throws
    // IllegalTransitionError — i.e. it would publicly corrupt the target. This
    // test tampers the merge form to inject a non-published source id and asserts
    // the guard held (target's public evidence count unchanged).
    //
    // After the merge test, B is `taken_down` (its read model is deleted, its
    // evidence already absorbed into A). B is the most reliable non-published id
    // available — it is deterministically produced by the merge test that runs
    // before this one (serial mode). The target A is published (AC3 republished
    // it), so the merge form renders.

    // --- Step 1: capture A's public evidence count BEFORE the tampered merge --
    // Reload to bypass the dev-server route cache (A was rendered in AC3). The
    // fresh render reflects A's current published evidence (the union after merge
    // minus the split subset).
    await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const beforeCount = await page.getByText("原文链接 ↗").count();

    // --- Step 2: tamper-submit the merge form with the non-published source ----
    // The merge <select name="sourceId"> is populated only with published events,
    // so B (taken_down) is absent. Inject a new <option value="{B}"> into the
    // select and select it, then submit. This bypasses the UI's published-only
    // list and posts the bad id straight to submitMerge, where the server-side
    // guard must reject it.
    // Authenticate as operator now (the public /events/ read above ran first,
    // unauthenticated — the operator cookie is only needed for the /console
    // page access below).
    await authenticateOperator(context);
    await page.goto(`/console/${published.a.hotEventId}`);
    await page.evaluate(
      ({ sourceId }) => {
        const select = document.querySelector<HTMLSelectElement>('select[name="sourceId"]');
        if (!select) {
          throw new Error("merge source select not found");
        }
        const opt = document.createElement("option");
        opt.value = sourceId;
        opt.textContent = "tampered (taken_down)";
        select.appendChild(opt);
        select.value = sourceId;
      },
      { sourceId: published.b.hotEventId },
    );
    await page.getByRole("button", { name: "执行合并" }).click();
    // The guard redirects back to A's detail with no module call.
    await expect(page).toHaveURL(new RegExp(`/console/${published.a.hotEventId}`));

    // --- Step 3: assert the guard held — A's public evidence count UNCHANGED --
    // If the guard had failed, the absorbed evidence would have appeared in A's
    // read model via the republish (public corruption). Reload + wait fallback to
    // bypass the dev-server route cache, matching the existing merge test's
    // post-action read pattern.
    await page.waitForTimeout(500);
    await page.goto(`/events/${published.a.hotEventId}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("原文链接 ↗")).toHaveCount(beforeCount);
  });
});
