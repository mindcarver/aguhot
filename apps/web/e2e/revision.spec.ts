import { expect, test } from "@playwright/test";

import { authenticateOperator } from "./_operator-auth";
import { seedRevisionEvent } from "./seed-revision";

/**
 * Published-event copy & tag revision e2e — Story 1.9. Tagged @revision so it
 * runs only under `pnpm --filter web e2e:revision` (DB-backed + seed) and does
 * NOT run under the public `pnpm --filter web e2e` (whose --grep-invert
 * excludes @console, @feed, @detail, AND @revision).
 *
 * The beforeAll imports and runs seedRevisionEvent() to capture the dynamic
 * published hotEventId needed to navigate to /console/{id} and /events/{id}.
 *
 * Requires request-time DATABASE_URL: both the console detail route and the
 * public detail route are force-dynamic (Story 1.6 + 1.8 + 1.9) and read via
 * getPrisma at request time. Same AD-3 evolution as 1.7/1.8.
 *
 * The full revision flow (submit revision → public shows old → republish →
 * public shows new + no AiLabel) is one coherent end-to-end test so the DB
 * state mutations are sequenced within a single page session (no cross-test
 * DB-state coupling). A separate read-only test covers the initial console
 * render (AC1 operator entry).
 *
 * Covers:
 *   - /console/{publishedId} renders the revision form + the current published
 *     version (AC1 operator entry).
 *   - Fill new title/tags/explanation + submitRevision (AC1 operator revision).
 *   - After revision but BEFORE republish: /events/{publishedId} still shows the
 *     OLD title/empty tags/template explanation (AC2 pending — public shows the
 *     last published version until republish).
 *   - Operator console shows the pending diff ("待发布修改" lists title/tags/
 *     explanation).
 *   - Submit republish (outcome=republish) → /events/{publishedId} shows the NEW
 *     title + new tag chips + human explanation, and the human explanation has
 *     NO <AiLabel> (AC3 + 1.8 defer: source="human" drops the AI label,
 *     uniform on public and operator).
 *   - /console/{publishedId} audit chain contains the republish decision.
 */

test.describe("已发布热点的文案与标签修正 (Story 1.9) @revision", () => {
  // Serial mode: beforeAll seeds the DB exactly once and the tests share the
  // captured id. The full-flow test does revision + republish in one page
  // session so DB state mutations stay sequenced.
  test.describe.configure({ mode: "serial" });

  let published: { hotEventId: string; title: string };

  test.beforeAll(async () => {
    const seeded = await seedRevisionEvent();
    published = { hotEventId: seeded.publishedHotEventId, title: seeded.publishedTitle };
  });

  test("AC1 /console/{publishedId} 渲染修订表单与当前发布版", async ({ page, context }) => {
    await authenticateOperator(context);
    await page.goto(`/console/${published.hotEventId}`);

    // The revision branch heading renders.
    await expect(
      page.getByRole("heading", { level: 2, name: "已发布版本与修订" }),
    ).toBeVisible();

    // The revision form heading renders (title/tags/explanation form).
    await expect(page.getByText("修订标题 / 标签 / 解释")).toBeVisible();

    // The current published version section renders.
    await expect(page.getByText("当前发布版")).toBeVisible();

    // The republish button is present (disabled until there is pending work).
    await expect(page.getByRole("button", { name: "重新发布" })).toBeVisible();
  });

  test("AC1/AC2/AC3 修订 → 公开仍显旧 → 重新发布 → 公开显新且无 AiLabel", async ({ page, context }) => {
    // Authenticate as operator once for the whole test session. The cookie
    // persists across navigations within this context, so the subsequent
    // /console/{id} re-visits (Step 3) stay authenticated; the public /events/
    // visits are unaffected (the operator cookie is a no-op on public routes).
    await authenticateOperator(context);
    // --- Step 1: submit the revision on /console/{id} ------------------------
    await page.goto(`/console/${published.hotEventId}`);

    // Scope to #title (the revision form's title input has id="title"). Story
    // 1.10 added a MergeSplitBranch to the published page whose split form also
    // has an input[name="title"] (id="splitTitle"), so the generic name selector
    // is now ambiguous — the id scopes to the revision form unambiguously.
    const titleInput = page.locator("#title");
    await titleInput.fill("新能源车销量再创新高（运营修订标题）");

    const tagsInput = page.locator('textarea[name="tags"]');
    await tagsInput.fill("新能源,汽车,销量");

    await page.locator('textarea[name="summary"]').fill("人工修订：新能源车销量连续刷新历史高位。");
    await page
      .locator('textarea[name="whyItMatters"]')
      .fill("人工修订：关注产业链上下游景气度（运营手输，非投资建议）。");
    await page
      .locator('textarea[name="uncertainties"]')
      .fill("人工修订：补贴退坡节奏与结构变化仍需观察。");

    await page.getByRole("button", { name: "保存修订（不立即公开）" }).click();
    // The action redirects back to the console detail.
    await expect(page).toHaveURL(new RegExp(`/console/${published.hotEventId}`));

    // The pending diff now lists all three modified fields.
    const pendingSection = page.locator("text=待发布修改").locator("xpath=ancestor::div[1]");
    await expect(pendingSection.getByText("标题已修改")).toBeVisible();
    await expect(pendingSection.getByText("标签已修改")).toBeVisible();
    await expect(pendingSection.getByText("解释已修改")).toBeVisible();

    // The republish button is now ENABLED.
    const republishBtn = page.getByRole("button", { name: "重新发布" });
    await expect(republishBtn).toBeEnabled();

    // --- Step 2 (AC2): public /events/{id} still shows the OLD version -------
    await page.goto(`/events/${published.hotEventId}`);

    // Old title still public (pending not yet republished).
    await expect(
      page.getByRole("heading", { level: 1, name: published.title }),
    ).toBeVisible();

    // No tag chips (published tags still empty). Scope to the chip container
    // under the title (TagChip renders span.rounded-full.bg-surface-muted); the
    // original title contains "新能源" as a substring so a plain getByText would
    // false-match the title — targeting the chip class avoids that collision.
    await expect(page.locator("h1 + div .bg-surface-muted")).toHaveCount(0);

    // Explanation still template-sourced → AiLabel shown (uniform AI label on
    // system-derived content; the human revision is not public yet).
    const whyOld = page.locator("section", { hasText: "为什么重要" }).first();
    await expect(whyOld.locator(".bg-accent-warm")).toBeVisible();

    // --- Step 3 (AC1): republish from /console/{id} --------------------------
    await page.goto(`/console/${published.hotEventId}`);
    await page.getByRole("button", { name: "重新发布" }).click();
    // The action redirects back to the console detail.
    await expect(page).toHaveURL(new RegExp(`/console/${published.hotEventId}`));

    // The audit chain now lists the republish review decision + the
    // published→published publication decision.
    const auditSection = page.locator("text=决策审计链").locator("xpath=ancestor::section[1]");
    await expect(auditSection.getByText(/republish/)).toBeVisible();
    await expect(auditSection.getByText(/published → published/)).toBeVisible();

    // --- Step 4 (AC1/AC3): public /events/{id} now shows the NEW version -----
    await page.goto(`/events/${published.hotEventId}`);

    // New title (from the revision).
    await expect(
      page.getByRole("heading", { level: 1, name: "新能源车销量再创新高（运营修订标题）" }),
    ).toBeVisible();

    // Tag chips render (revised tags projected on republish). Scope to the chip
    // container under the title so the assertion is precise.
    const tagChips = page.locator("h1 + div .bg-surface-muted");
    await expect(tagChips).toHaveCount(3);
    await expect(tagChips.nth(0)).toHaveText("新能源");
    await expect(tagChips.nth(1)).toHaveText("汽车");
    await expect(tagChips.nth(2)).toHaveText("销量");

    // The explanation is now HUMAN-sourced → NO AiLabel on the explanation
    // partitions (AC3 + 1.8 defer: source="human" drops the label, uniform on
    // public and operator). Target the AiLabel by its distinctive class, not
    // by the text "AI" (a substring match would false-positive on copy that
    // happens to contain "AI").
    const whyNew = page.locator("section", { hasText: "为什么重要" }).first();
    await expect(whyNew.getByText("人工修订：关注产业链上下游景气度")).toBeVisible();
    await expect(whyNew.locator(".bg-accent-warm")).toHaveCount(0);
  });
});
