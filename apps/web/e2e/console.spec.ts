import { expect, test } from "@playwright/test";

import { authenticateOperator } from "./_operator-auth";

/**
 * Operator console e2e — Story 1.6. Tagged @console so it runs only under
 * `pnpm --filter web e2e:console` (DB-backed) and does NOT run under the public
 * `pnpm --filter web e2e` (which must stay DATABASE_URL-free).
 *
 * Prerequisite: `pnpm --filter web seed:console` must have been run to seed 2
 * deterministic candidates. The playwright config's e2e:console project runs the
 * seed as a globalSetup step.
 *
 * Covers:
 *   - AC1: /console renders the candidate list (title, source count, status).
 *   - AC2: entering detail and submitting approve → status becomes published +
 *     audit chain shows the decision.
 *   - AC2: rejecting another candidate → status becomes rejected.
 *   - AC3: the public homepage `/` still renders the static empty state and the
 *     candidate titles do NOT leak (public reads only published_hot_events,
 *     which is empty until publish, and candidates are never published without a
 *     decision).
 */

test.describe("运营复核台 (Story 1.6) @console", () => {
  test("AC1 /console 渲染待复核候选列表", async ({ page, context }) => {
    await authenticateOperator(context);
    const response = await page.goto("/console");

    expect(response, "/console should respond").not.toBeNull();
    expect(response!.status(), "/console status should be 200").toBe(200);

    // The page heading + candidate count render.
    await expect(page.getByRole("heading", { level: 1, name: "运营复核台" })).toBeVisible();

    // Each seeded candidate title appears in the list (surface-anchored).
    await expect(page.getByText("央行宣布降准0.5个百分点").first()).toBeVisible();
    await expect(page.getByText("美股大跌三大股指重挫").first()).toBeVisible();

    // Each candidate row shows the evidence count.
    await expect(page.getByText("1 来源").first()).toBeVisible();
  });

  test("AC2 进入候选详情并提交通过 → 状态变 published + 审计链显示", async ({ page, context }) => {
    await authenticateOperator(context);
    await page.goto("/console");

    // Click into the 降准 candidate detail.
    const approveLink = page.getByRole("link", { name: /央行宣布降准0.5个百分点/ }).first();
    await approveLink.click();

    // Detail page renders the title + evidence list.
    await expect(
      page.getByRole("heading", { level: 1, name: "央行宣布降准0.5个百分点" }),
    ).toBeVisible();
    await expect(page.getByText("证据来源（1）")).toBeVisible();

    // Submit the approve decision.
    const approveButton = page.getByRole("button", { name: "通过并发布" });
    await approveButton.click();

    // After the action, the page re-renders (server action redirect) showing
    // the updated status + audit chain. The status line should now be published.
    await expect(page.getByText(/状态 · published/)).toBeVisible();

    // The audit chain now contains a review decision (approve) and a
    // publication decision (candidate → published).
    await expect(page.getByText(/复核决策 · approve/)).toBeVisible();
    await expect(page.getByText(/发布决策 · candidate → published/)).toBeVisible();

    // The approve/reject buttons are gone (status is no longer candidate).
    await expect(page.getByRole("button", { name: "通过并发布" })).toBeHidden();
  });

  test("AC2 驳回另一候选 → 状态变 rejected", async ({ page, context }) => {
    await authenticateOperator(context);
    await page.goto("/console");

    const rejectLink = page.getByRole("link", { name: /美股大跌三大股指重挫/ }).first();
    await rejectLink.click();

    await expect(
      page.getByRole("heading", { level: 1, name: "美股大跌三大股指重挫" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "驳回" }).click();

    // The status is now rejected.
    await expect(page.getByText(/状态 · rejected/)).toBeVisible();
    await expect(page.getByText(/复核决策 · reject/)).toBeVisible();
  });

  test("AC3 公共首页仍为静态空态，候选标题不泄漏", async ({ page }) => {
    const response = await page.goto("/");

    expect(response, "homepage should respond").not.toBeNull();
    expect(response!.status(), "homepage status should be 200").toBe(200);

    // The public shell renders (anonymous, no DB).
    await expect(
      page.getByRole("heading", { level: 1, name: "AGUHOT" }),
    ).toBeVisible();

    // Candidate titles must NOT appear on the public homepage (AC3: public
    // reads only published_hot_events; candidates are never published without a
    // decision, and even published ones would be in the read model — but the
    // public stream UI is 1.7, not yet built, so the homepage stays empty).
    await expect(page.getByText("央行宣布降准0.5个百分点")).toBeHidden();
    await expect(page.getByText("美股大跌三大股指重挫")).toBeHidden();
  });
});
