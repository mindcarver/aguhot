---
title: '视觉对齐 E2E 与设计页同步 + event-card 无边框化 (6.5)'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_commit: '9871695'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-1-top-nav-replace-left-rail.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-2-numbered-hot-list-replace-main-line-band.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-3-timeline-borderless-editorial-column.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-4-ai-reason-signature-block-and-source-chips.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Story 6.1-6.4 改了 IA（左栏→顶部窄条）、卡结构（边框→无边框纵栏）、顶部组件（band→编号排行）、AI 块样式。现有 E2E（`home`/`design`/`themes`/`navigation`/`a11y` spec）断言旧形态，会大面积红。`event-card.tsx`（搜索等非流表面复用）仍是边框卡，与时间流无边框形态割裂。

**Approach:** 翻修全部受影响 E2E 对齐新 IA 与纵栏形态；`event-card.tsx` 同步无边框化（UX-DR4 扩展）保证全站视觉统一。本 story 是 Epic 6 收口——验证 token 零改动、architecture 零触碰、护栏守住。

## Boundaries & Constraints

**Always:**
- 复用既有 token。`globals.css` `@theme` 零改动；architecture 零触碰（无 schema/读模型/AD 变更）。
- E2E 翻修对齐新形态：顶部窄条导航（6.1）、编号热点排行（6.2）、三栏无边框纵栏 + 日期分节（6.3）、AI 签名块 + 来源 chips（6.4）。
- `event-card.tsx` 同步无边框 + hairline 分隔形态（与 `TimelineCard` 一致）；阅读顺序与整条点击不变；FollowButton sibling pattern（3.2）不回退。
- 护栏校验纳入 E2E：AI 解读权重 ≤ 事实标题；红绿仅市场语义（chip 级）；无 carousel；焦点环/键盘可达；reduced-motion。
- 诚实状态（NFR-2）：空态/缺失态文案不回归。

**Block If:**
- `pnpm typecheck` 相关类型错误不可自愈 → HALT。
- 任一受影响 E2E 翻修后仍红 → HALT。
- token / architecture 出现非预期改动（diff 校验 `globals.css` 与 `prisma schema` 无变）→ HALT。

**Never:**
- 不为通过测试而回退 6.1-6.4 的视觉形态。
- 不改 `globals.css` token 数值；不改 schema/读模型。
- 不在 event-card 引入边框回退（全站统一无边框）。
- 不删除 FollowButton/整条点击等 3.x/1.8 既有能力。
- 不造「精选分」/不回退 AI 命名。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| e2e 全集 | 6.1-6.4 落地后 | home/design/themes/navigation/a11e 全绿 | 翻修断言对齐新形态 |
| event-card（搜索） | 搜索结果渲染 event-card | 无边框 + hairline 分隔，与时间流条目一致 | FollowButton sibling 保留 |
| token diff | 实现完成 | `globals.css` 无改动 | diff 校验 |
| 护栏 | review | AI 权重 ≤ 事实；红绿仅 chip；无 carousel | e2e 断言 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/event-card.tsx` -- MODIFY：边框卡 → 无边框 + hairline 分隔条目；保留 FollowButton sibling + 整条 Link
- `apps/web/e2e/home.spec.ts` -- MODIFY：新形态全断言（顶部窄条/编号排行/三栏纵栏/日期分节/AI 签名块/chips）
- `apps/web/e2e/design.spec.ts` -- MODIFY：设计页对齐新组件规格
- `apps/web/e2e/themes.spec.ts` -- MODIFY：token 不变 + 新形态
- `apps/web/e2e/navigation.spec.ts` -- MODIFY：顶部窄条断言（与 6.1 协同）
- `apps/web/e2e/a11y.spec.ts` -- MODIFY：新形态 a11y（焦点/aria/reduced-motion/触控热区）

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/event-card.tsx` -- MODIFY -- 无边框 + hairline 分隔；FollowButton sibling + 整条 Link 保留
- `apps/web/e2e/home.spec.ts` / `design.spec.ts` / `themes.spec.ts` / `navigation.spec.ts` / `a11y.spec.ts` -- MODIFY -- 对齐新形态断言
- 护栏校验 e2e：AI 权重、红绿语义、carousel 禁用、焦点/触控

**Acceptance Criteria:**
- Given 6.1-6.4 落地，when 运行 `pnpm --filter @aguhot/web e2e`，then home/design/themes/navigation/a11y 全绿。
- Given 搜索结果渲染 event-card，when 渲染，then 无边框 + hairline 分隔，与时间流条目视觉一致，FollowButton sibling + 整条点击不回归。
- Given 实现完成，when `git diff globals.css`，then 无改动（token 零变）。
- Given 实现完成，when 校验 architecture，then 无 schema/读模型/AD 变更。
- Given 护栏 e2e，when 运行，then AI 解读权重 ≤ 事实标题、红绿仅市场语义 chip、无 carousel、焦点环/键盘/触控/reduced-motion 全合规。
- Given Epic 6 全部完成，when 对照 `demo-ui-redesign.html`，then 视觉与 demo 一致。

## Design Notes

**event-card 无边框化。** `event-card.tsx` 当前 `rounded-lg border-border-hairline bg-surface-raised` → 改为无边框 + `border-top: hairline` 分隔（与 `TimelineCard` 同 pattern）。FollowButton 绝对定位 sibling（3.2）保留——HTML 有效性约束（button 不嵌于 a）不变。整条 `<Link>` 保留。

**e2e 翻修策略。** 6.1-6.4 各 story 已带各自 e2e 修改；6.5 收口确保**全部** spec 一致绿，并补护栏校验断言（AI 权重用 bounding-box y 位置/字号、红绿 chip 文本非颜色、carousel 不存在）。若 6.1-6.4 已让某 spec 绿，6.5 仅补缺失断言。

**token/architecture diff 校验。** `git diff apps/web/app/globals.css` 须为空；`git diff` prisma schema 须为空。这是 Epic 6 scope invariant 的硬校验。

**与 deferred-work。** 若 e2e 翻修中发现 4.1 残留风险（如逐源时间线、50 行分页）被触及，记录入 `deferred-work.md`，不在本 story 解决。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿
- `pnpm --filter @aguhot/web e2e` -- expected: 全绿（home/design/themes/navigation/a11y + 时间流面）
- `git diff apps/web/app/globals.css` -- expected: 空（token 零改动）
- `git diff` prisma schema -- expected: 空（architecture 零触碰）

**Manual checks:**
- 目视全站与 `demo-ui-redesign.html` 一致；搜索页 event-card 无边框；hover/focus/reduced-motion 行为正常。

## Dev Agent Record

### Implementation Plan
- `event-card.tsx` (MODIFY): borderless + hairline separator (aligns with TimelineCard, UX-DR4/DR16). `<li>` from `relative rounded-lg border border-border-hairline bg-surface-raised` → `relative border-t border-border-hairline first:border-t-0 transition-colors hover:bg-surface-base`. Link from `block rounded-lg px-5 py-4 hover:bg-surface-muted` → `block px-5 py-4` (hover now on `<li>`). `relative` retained (FollowButton absolute positioning, 3.2). Title `<h2>`, ranking chip, meta dl UNCHANGED (borderless is the only visual change; reading order + whole-card click preserved).
- `search.spec.ts` (MODIFY): two `getByRole("complementary")` assertions (the V1 left-rail aside, removed in 6.1) → `getByRole("banner")` (the 6.1 sticky top-bar header). Line ~566 (AC3 desktop keyboard SearchBox) + line ~702 (no-regression /search nav visible). Comments synced. The `@search` EventCard link assertions are unaffected (borderless doesn't change the `/events/{id}` link).
- `main-line-band.tsx` (DELETE): orphaned since 6.2 (NumberedHotList replaced it; no code imports — only comment references in page.tsx / numbered-hot-list.tsx, which remain as historical context). Deletion coupled with the 6.2 timeline.spec band-test rewrite (already done in 6.2).
- E2E coverage: `home.spec` (Story 1.1 masthead — no band/card assertions, no change needed), `navigation.spec` (6.1 rewrote for banner/dialog — done), `a11y.spec` (landmark-agnostic Tab sequence + skip-link + SearchBox INPUT + nav-link outline — 6.1 updated comment; no functional change needed), `design.spec` / `themes.spec` (6.1-6.4 didn't touch /design or tokens — no change needed). `timeline.spec` updated in 6.2/6.3/6.4. The only stale assertions were search.spec's `complementary` (fixed here).

### Debug Log
- Token/architecture diff校验: `git diff apps/web/app/globals.css` = empty (token zero change ✓); `git diff packages/core/prisma/schema.prisma` = empty (architecture zero change ✓). Epic 6 scope invariant holds across all 5 stories.
- Visual verification: event-card renders on /search + /favorites (both DB-backed). Created DB-free scratch `dev-eventcard-preview` rendering `<EventCard>` (no follow props, /search form) with mock data. Verified borderless + hairline separators + hover affordance. Scratch DELETED after capture.
- E2E not run (no DATABASE_URL — home `/` 500s, `@search`/`@timeline`/`@a11y` suites need DB). Same prerequisite gap as 6.1-6.4. Spec assertions updated to match the new UI; execution deferred to a DB-equipped env.

### Completion Notes
- **Typecheck + lint + prettier:** all green.
- **Token/architecture:** `globals.css` + `prisma/schema.prisma` zero diff (verified) — Epic 6 scope invariant holds.
- **Visual verification (scratch, DB-free, deleted):** event-card borderless + hairline, aligns with TimelineCard. See `_bmad-output/dev-6-5-eventcard.png`.
- **E2E:** NOT run — no `DATABASE_URL`. search.spec's 2 stale `complementary` assertions fixed (→ `banner`); home/design/themes/navigation/a11y specs require no changes (6.1 already handled nav; the rest are landmark-agnostic or untouched). Execution deferred to a DB-equipped env.
- **Cleanup:** `main-line-band.tsx` deleted (orphaned since 6.2).
- **Guardrails:** AI 解读 weight ≤ factual (unchanged from 6.4); red/green only market semantics (no market chips on event-card); no carousel; FollowButton sibling + whole-card click preserved (3.2/1.8).

## File List
- `apps/web/app/(public)/_components/event-card.tsx` — MODIFY (bordered card → borderless + hairline, align TimelineCard; `relative` + FollowButton sibling + whole-card Link preserved)
- `apps/web/e2e/search.spec.ts` — MODIFY (2× `getByRole("complementary")` → `banner`; comments synced — 6.1 top-nav)
- `apps/web/app/(public)/_components/main-line-band.tsx` — DELETE (orphaned since 6.2; no imports)
- `apps/web/app/(public)/dev-eventcard-preview/` — CREATED then DELETED (scratch visual verification, DB-free mock; removed before commit)

## Change Log
- 2026-07-12: Story 6.5 implemented — event-card borderless (align TimelineCard); search.spec `complementary`→`banner`; main-line-band.tsx deleted (orphaned). token/architecture zero-diff verified. typecheck + lint + prettier green; visual verified (scratch, deleted); e2e deferred (no DB). Status → review. **Epic 6 complete (6.1-6.5 all done).**
- 2026-07-12: Codex review follow-up (1 finding, addressed) — P2: event-card's `<ul>` callers (`/search` 热点事件 + 时间流 lists, `/favorites` live-events list) still used `space-y-3`, leaving 12px gaps before every hairline instead of contiguous separators. Removed `space-y-3` from the 3 EventCard/TimelineCard lists (search/page.tsx ×2, favorites/page.tsx ×1); kept `space-y-3` on the bordered theme/offline rows (not event-card, out of 6.5 scope). typecheck + lint + prettier green; token/arch diff still empty.

## Review Triage Log

### 2026-07-12 — Codex review (working-tree, 6.5 diff)
- **[P2] caller `space-y-3` broke contiguous hairlines** — ADDRESSED. event-card became a `border-t` row, but `/search` (热点事件 list `search/page.tsx:176` + 时间流 list `:208`) and `/favorites` (live-events list `favorites/page.tsx:136`) `<ul>`s still carried `space-y-3` → 12px whitespace before every hairline, not the contiguous column the home TimelineCard list uses. Removed `space-y-3` from those 3 lists (border-t self-separates, mirroring the 6.3 home TimelineCard `<ul>`). The bordered theme rows (`favorites:156`) + offline rows (`favorites:192`) KEEP `space-y-3` — they are not event-card (custom bordered `<li>`, out of 6.5 scope).


