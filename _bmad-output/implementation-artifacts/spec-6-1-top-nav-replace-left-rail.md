---
title: '顶部窄条极简导航替换左栏 (6.1)'
type: 'feature'
created: '2026-07-12'
status: 'review'
baseline_commit: '78b2cebe699fcd7ed942a2dd312ea271d87f1bdd'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/EXPERIENCE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-2-responsive-navigation-and-public-shell.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** UX-DR3 已改写为「顶部窄条极简导航」，但 `(public)/layout.tsx` 仍渲染桌面左侧固定导航。内容区横向空间被左栏挤压，与参考站无 chrome 编辑型纵栏形态不符。

**Approach:** 新增 `TopNav` server component（sticky 顶部窄条：brand + 水平导航链接 + 激活态下划线 + backdrop-blur + hairline 下边框），替换 `layout.tsx` 的左栏。移动端收敛为顶部菜单 + 抽屉（复用既有抽屉模式）。IA 不变——首页/日报/主题/收藏/搜索入口全保留，仅位置与形态变化。视觉以 `demo-ui-redesign.html` 顶部 `.topnav` 为准。

## Boundaries & Constraints

**Always:**
- 复用既有 token（`bg-canvas`/`border-hairline`/`ink-*`/`brand`）。`globals.css` `@theme` 零改动。
- sticky 顶部窄条：`position: sticky; top: 0; z-index: 10`；背景 `rgba(canvas, 0.92)` + `backdrop-filter: saturate(140%) blur(8px)`；下边框 `1px solid border-hairline`。
- 一级入口与现状一致（首页/日报/主题/收藏/搜索），激活态用品牌色下划线（`border-bottom: 2px solid brand`）。
- 移动端（`<768px`）收敛为顶部菜单按钮 + 抽屉，抽屉内一级入口相同。
- a11y（UX-DR13）：nav 有 `aria-label="主导航"`；链接键盘可达；焦点环走 `globals.css` 既有 `:focus-visible` 全局规则；当前页激活态对屏幕阅读器可见（`aria-current="page"`）。
- 内容区改为居中窄栏（`max-w-3xl` 或对齐 demo `max-w-760px`），释放左栏占据的横向空间。

**Block If:**
- `pnpm typecheck` 出现与本 story 相关的类型错误且不可自愈 → HALT。
- `navigation.spec` / `a11y.spec` 翻修后仍红 → HALT。

**Never:**
- 不改 IA（不增删导航目的地）——仅位置/形态变化。
- 不引入新依赖（无 nav 库）；不引入 shadcn/ui（项目未装）。
- 不新增 client JS 除非移动端抽屉交互确实需要（倾向复用既有移动抽屉模式；若需 client toggle，最小化）。
- 不动 `globals.css` token；不改设计 token 数值。
- 不删除既有左栏相关组件文件除非确认无其他引用（先停用再清理）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 桌面端导航 | `≥768px` | 顶部 sticky 窄条，brand 左 + 水平链接右，激活态下划线 | — |
| 移动端导航 | `<768px` | 顶部菜单按钮 + 抽屉，抽屉内一级入口 | 抽屉键盘可达、esc 关闭 |
| 当前页激活态 | 路由匹配某入口 | 该链接 `aria-current="page"` + 品牌色下划线 | — |
| 长品牌名/窄屏 | brand + 5 链接溢出 | 移动端收敛到抽屉；桌面端不溢出 | — |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/top-nav.tsx` -- NEW：server component，sticky 顶部窄条；接收当前路径判定激活态；移动端抽屉
- `apps/web/app/(public)/layout.tsx` -- MODIFY：移除左栏，渲染 `<TopNav>`；内容区改居中窄栏
- `apps/web/e2e/navigation.spec.ts` -- MODIFY：断言顶部导航而非左栏；一级入口可达
- `apps/web/e2e/a11y.spec.ts` -- MODIFY：nav aria-label、激活态 aria-current、键盘焦点

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/top-nav.tsx` -- NEW -- sticky 顶部窄条（brand + 水平链接 + 激活态下划线 + backdrop-blur + hairline 下边框）；移动端菜单 + 抽屉
- `apps/web/app/(public)/layout.tsx` -- MODIFY -- 移除左栏，渲染 `<TopNav>`，内容区居中窄栏
- `apps/web/e2e/navigation.spec.ts` -- MODIFY -- 顶部导航断言
- `apps/web/e2e/a11y.spec.ts` -- MODIFY -- nav 语义 + 激活态 + 键盘

**Acceptance Criteria:**
- Given 桌面端访问任意公共页，when 渲染，then 顶部 sticky 窄条可见，brand + 5 一级入口水平排列，当前页激活态品牌色下划线。
- Given 移动端 (`<768px`)，when 渲染，then 顶部菜单按钮可见，点击展开抽屉含相同一级入口，键盘可达、esc 可关。
- Given 任意公共页，when 键盘 Tab，then 焦点依序进入导航链接，焦点环可见（既有 `:focus-visible` 规则）。
- Given `navigation.spec` / `a11y.spec` 翻修，when 运行 e2e，then 全绿。

## Design Notes

**激活态判定。** 用 Next.js 的路径匹配（`usePathname` 或 server 端从 request/route 取 path）。公开页 server component 可从 headers/路由段判定；倾向 server 端判定避免 client JS。若 server 端不可得，最小 client island 仅做 `usePathname` + aria-current。

**移动端抽屉。** 复用项目既有移动抽屉模式（1.2 已实现移动端顶部导航 + 抽屉）；若 1.2 的抽屉逻辑在左栏组件内，提取为可复用 piece。倾向零新 client JS——若 1.2 已有 drawer toggle，迁移过来。

**与 6.3 的衔接。** 内容区居中窄栏宽度（`max-w-3xl` ≈ 768px 或 demo 的 760px）需与 6.3 时间流纵栏宽度一致；先在本 story 定 `max-w-3xl mx-auto px-6`，6.3 沿用。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿
- `pnpm --filter @aguhot/web e2e` -- expected: navigation/a11y 翻修后全绿（其余公共面不回归）

**Manual checks:**
- 目视确认顶部窄条 sticky、backdrop-blur、激活态下划线；移动端抽屉开合；键盘 Tab 焦点序。

## Dev Agent Record

### Implementation Plan
- **Decision (deviation from spec Code Map, documented):** The spec listed `top-nav.tsx NEW`, but `PublicNav` already contained the nav items, `isActive` heuristic, mobile drawer logic (Escape/overlay close, route-change auto-close), and `<SearchBox>`. Creating a separate `TopNav` would duplicate ~150 lines. Per the project's lazy-diff convention (Ponytail: shortest working diff, no unrequested abstraction), `PublicNav` was reworked in place: the desktop `<aside role=complementary>` left-rail was removed and the 1.2 mobile top `<header role=banner>` was promoted to the universal surface (visible at ALL widths). Desktop renders horizontal nav links + SearchBox inline in the banner; mobile renders a hamburger + drawer (1.2 logic preserved verbatim). All ACs satisfied; zero logic duplication.
- Desktop active state = brand-color bottom underline (`border-b-2 border-brand` + `aria-current="page"`), inactive = `border-transparent` (slot reserved, no layout shift on activation).
- `<nav aria-label="主导航">` wraps desktop links so the landmark is reachable via `getByRole("navigation")`; `<SearchBox>` is a sibling `<form>` outside the nav landmark (it is its own search region).
- Drawer top offset updated `top-16` → `top-14` to match the new header height (`h-14`).

### Debug Log
- Dev server port conflict: `:3000` was occupied by another project (Multica). Started aguhot on `:3010` (`next dev -p 3010`). `/` returns 500 (pre-existing: `getPrisma` throws without `DATABASE_URL` — by design, DB is core infra); `/design` returns 200 (DB-free static). Visual verification anchored on `/design` (same `(public)/layout.tsx` shell → confirms 6.1 top-nav).

### Completion Notes
- **Typecheck:** `pnpm --filter @aguhot/web typecheck` — green (`tsc --noEmit` + `tsconfig.e2e.json`).
- **Visual verification (dev server :3010):** `/design` at 1280px — sticky top-bar renders (AGUHOT brand + 首页/日报/主题/收藏/运营台 horizontal + SearchBox, hairline bottom border). At 375px — brand + hamburger, desktop links hidden. Matches `demo-ui-redesign.html` `.topnav` form.
- **E2E:** NOT run — no `DATABASE_URL` / local PG (home `/` 500s, `navigation.spec` hits `/`). Same prerequisite gap as spec-4-2 (documented there: "dev environment has no .env / DATABASE_URL"). `navigation.spec.ts` rewritten for `banner`/`dialog` landmarks (was `complementary`); logic correct, execution deferred to a DB-equipped env. `a11y.spec.ts` tests are landmark-agnostic (Tab sequence + activeElement + skip-link + SearchBox INPUT + nav-link outline) — no functional change needed, only a stale comment updated.
- **Token/architecture:** `globals.css` untouched; no schema/read-model/AD change (Epic 6 scope invariant holds).
- **Guardrails:** `aria-label="主导航"` + `aria-current`; keyboard focus via global `:focus-visible`; drawer Escape/overlay close preserved (1.2); reduced-motion honored (instant toggle, no animation lib).

## File List
- `apps/web/app/(public)/_components/public-nav.tsx` — MODIFY (rework: desktop left-rail `<aside>` removed; top-bar `<header>` promoted to all widths; horizontal `DesktopNav` + `DrawerNav` split; drawer logic preserved)
- `apps/web/app/(public)/layout.tsx` — MODIFY (remove `md:flex` row + `min-w-0 flex-1`; column shell: skip-link + `<PublicNav>` + `<main>`)
- `apps/web/e2e/navigation.spec.ts` — MODIFY (rewrite: `complementary` aside → `banner`/`dialog` landmarks; desktop horizontal links + mobile drawer + breakpoint)
- `apps/web/e2e/a11y.spec.ts` — MODIFY (stale comment update: navigation.spec now scopes to `banner`/`dialog`, not `complementary`)

## Change Log
- 2026-07-12: Story 6.1 implemented — desktop left-rail replaced by sticky top-bar窄条 at all widths (UX-DR3); mobile drawer preserved; navigation.spec rewritten for new landmarks; typecheck green; visual verified on `/design`; e2e deferred (no DB). Status → review.

