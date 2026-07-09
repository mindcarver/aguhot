---
title: '基础导航与响应式公共页面壳层 (1.2)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'a720921cac26ec82c589b139019f2f1d04a4f86c'
final_revision: 'f93ad7a660a814ce9b806ac77f6b9eb612c435ec'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-1-public-shell-and-anonymous-home-entry.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** Story 1.1 只交付了匿名首页壳层与 pnpm monorepo 脚手架，根布局仍是裸 `<body>{children}</body>`：公共页面没有任何导航，也没有跨断点的响应式布局结构。用户在不同设备上没有稳定一致的浏览起点，后续公共页面（1.7 热点流、1.8 详情）也没有可复用的响应式壳层。

**Approach:** 在 `apps/web/app/(public)/` 增加一个组级 `layout.tsx` 作为响应式公共壳层——桌面端（≥768px）左侧一级导航栏 + 主内容区，移动端（<768px）顶部栏 + 抽屉导航，一级入口在两端一致（首页 / 日报 / 主题 / 收藏 + 内部入口运营台）。为导航目标补齐最小占位页面使入口真正匿名可达。本 story 只交付结构与响应式布局，不实现 design tokens / 排版 / 主题（1.3）与任何业务页面内容（1.7+）。

## Boundaries & Constraints

**Always:**
- 信息架构与响应式断点对齐 epic-1-context 的 UX 约束：桌面左侧一级导航（≥768px / Tailwind `md:`）、移动顶部栏 + 抽屉（<768px）；导航深度一级；一级入口在桌面与移动端一致（首页 / 日报 / 主题 / 收藏 + 内部入口运营台）。
- 公共路径保持匿名可用（继承 1.1 AD-8）：导航与壳层不得引入任何登录墙 / 认证重定向；新增页面均为 server component，无会话依赖。
- 可达性地板：导航链接与抽屉触发按钮键盘可达；抽屉支持 Escape 关闭、点击遮罩关闭、`aria-expanded` / `aria-controls`；移动端可点击目标满足基本触控尺寸（≥44px）；尊重 `prefers-reduced-motion`（抽屉瞬时切换、无强制动画）。
- 复用 1.1 已落地的 Tailwind 4 CSS-first 接入与 `lib/utils.ts` 的 `cn`；不新增 `tailwind.config.js`，不填充 `@theme`（token 留 1.3）。
- 现有 1.1 e2e（`apps/web/e2e/home.spec.ts`：首页 200、H1「AGUHOT」、无 `/login` 重定向）必须保持通过。

**Block If:**
- 任何新增路由在匿名访问下触发重定向或需要会话（违反 AD-8）。
- 桌面 / 移动切换出现内容重叠、导航丢失或主内容无法滚动（违反 AC3）。

**Never:**
- 不填充 `@theme` design tokens、不引入字体 / 颜色 token、不清理既有 `dark:` 死代码（属 Story 1.3）。
- 不实现热点流 / 过滤器 / 卡片 / 证据时间线 / 详情页内容（属 1.7、1.8）；日报 / 主题 / 收藏仅为结构性占位页（与 1.1 `/console` 占位同构）。
- 不实现登录 / 收藏后端 / 认证；`/favorites` 为占位，不强制登录。
- 不为运营台 `/console` 加认证或 robots（属 Story 1.6，已在 `deferred-work.md` 记录）。
- 不引入新依赖（导航用已有 React `useState` + Tailwind + `next/link`；不装 shadcn drawer / Base UI Dialog）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 桌面端导航渲染 | 视口 ≥768px 访问任意公共页面 | 左侧一级导航可见，含 首页 / 日报 / 主题 / 收藏 + 运营台入口；移动顶部栏与抽屉隐藏 | 无错误预期 |
| 移动端抽屉导航 | 视口 <768px 访问任意公共页面 | 顶部栏 + 汉堡按钮可见，左侧栏隐藏；点击汉堡展开抽屉，含相同一级入口；点击链接导航并关闭抽屉；Escape / 遮罩可关闭 | 无错误预期 |
| 跨断点布局稳定 | 在 ≥768 / <768 间切换并访问 首页 / 日报 / 主题 | 各页面保持单一主阅读流，主内容可滚动，无重叠、无导航丢失 | 无错误预期 |
| 导航目标可达 | 匿名点击 日报 / 主题 / 收藏 | 各路由返回 200，在公共壳层内渲染占位内容；无 `/login` 重定向 | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/layout.tsx` -- NEW：组级响应式壳层，桌面 flex 行（侧栏 + 主区）、移动块流（顶部栏 + 主区），包裹所有 `(public)` 路由
- `apps/web/app/(public)/_components/public-nav.tsx` -- NEW：`'use client'` 响应式导航（桌面侧栏 + 移动顶部栏 / 抽屉，`useState` 控制抽屉，Escape / 遮罩关闭，`aria-expanded` / `aria-controls`）
- `apps/web/app/(public)/page.tsx` -- MODIFY：移除自带 `<main className="min-h-screen">` 外壳（由 layout 接管），首页内容、H1 与文案保持不变
- `apps/web/app/(public)/daily/page.tsx` -- NEW：日报占位页（结构性 server component）
- `apps/web/app/(public)/topics/page.tsx` -- NEW：主题占位页
- `apps/web/app/(public)/favorites/page.tsx` -- NEW：收藏占位页（标注登录态将在后续迭代开放）
- `apps/web/e2e/navigation.spec.ts` -- NEW：桌面导航可见性 + 链接 href、移动抽屉开关与导航、跨页面可达性的 Playwright 覆盖

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/layout.tsx` -- 新增组级 layout，结构为 `<div className="min-h-screen md:flex"><PublicNav /><main className="flex-1 min-w-0">{children}</main></div>` -- 提供桌面侧栏 + 移动顶部栏的响应式壳层骨架（不包含 `<html>/<body>`，那是根 layout 职责）
- `apps/web/app/(public)/_components/public-nav.tsx` -- 新增 `'use client'` 导航组件：一级链接常量（首页 `/` / 日报 `/daily` / 主题 `/topics` / 收藏 `/favorites`）+ 内部入口（运营台 `/console`）；桌面 `<aside className="hidden md:flex md:w-60 md:sticky md:top-0 md:h-screen">`；移动 `<header className="md:hidden sticky top-0">` + 条件渲染抽屉；`useState(open)`、Escape、遮罩关闭、`aria-expanded` / `aria-controls="mobile-drawer"`、`size-11` / `min-h-11` 触控尺寸 -- 满足桌面左侧导航 + 移动抽屉 AC 与可达性地板
- `apps/web/app/(public)/page.tsx` -- 移除 `<main className="min-h-screen">` 外壳，根改为 `<div className="mx-auto max-w-3xl px-6 py-20">`；首页内容、H1「AGUHOT」与「可信热点发布闭环」文案保持不变 -- 由 layout 接管壳层且不破坏 1.1 e2e
- `apps/web/app/(public)/daily/page.tsx`、`topics/page.tsx`、`favorites/page.tsx` -- 各为最小 server component 占位页（H1 + 一行说明，套用首页同款 `max-w-3xl px-6 py-20` 容器）；`/favorites` 标注登录态后续开放 -- 使导航目标匿名可达（200），覆盖矩阵「导航目标可达」
- `apps/web/e2e/navigation.spec.ts` -- 桌面 describe（`test.use({ viewport: { width:1280, height:800 } })`）：侧栏可见、四个一级入口 href 正确、点击日报导航到 `/daily` 返回 200；移动 describe（`test.use({ viewport: { width:375, height:667 } })`）：汉堡按钮可见、展开抽屉含一级入口、点击链接导航后抽屉关闭、无 `/login` 重定向 -- surface-anchored 覆盖前三条矩阵行

**Acceptance Criteria:**
- Given 桌面端浏览器（视口 ≥768px），When 访问任意公共页面，Then 页面展示左侧一级导航，And 首页 / 日报 / 主题 / 收藏入口均可匿名访问。
- Given 移动端浏览器（视口 <768px），When 访问任意公共页面，Then 页面展示顶部导航入口与抽屉导航，And 与桌面端相同的一级入口均可访问。
- Given 在 ≥768 / <768 两档断点间切换，When 公共页面重新布局，Then 首页、日报、主题页保持单一主阅读流，And 不出现内容重叠、导航丢失或无法滚动。

## Design Notes

响应式壳层放在 `(public)/layout.tsx`（Next App Router 组级 layout）：根 `layout.tsx` 仅负责 `<html>/<body>`，公共壳层只包裹 `(public)` 路由，不影响 `(operator)/console`（其仍为 1.1 占位，无壳层，符合「内部入口跳转到不同 surface」的预期）。桌面 / 移动边界用单一 Tailwind `md:`（768px），与 epic「<768 抽屉」一致；epic 的 768–1199 vs ≥1200 只影响侧栏宽度微调，1.2 无实际内容可对照调参，故合并为 `md:` 单断点（ponytail：不为无可调内容的三档断点预建）。

导航为单个 `'use client'` 组件：桌面侧栏无交互、移动抽屉需 state，合并到一个文件最省结构；抽屉用条件渲染（`{open && ...}`，瞬时挂载 / 卸载，天然满足 reduced-motion）而非动画库；初始 `open=false` 在 SSR 与客户端一致，无水合错配。不引入 shadcn drawer / Base UI Dialog（YAGNI）。

日报 / 主题 / 收藏为结构性占位，与 1.1 `/console` 占位同构，仅使导航目标可达、不含业务内容。既有首页的 `dark:` 死代码不在本 story 清理范围（属 1.3）；新增占位页不引入新的 `dark:` 变体。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 `tsconfig.e2e.json`）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: Next 生产构建成功，`/`、`/daily`、`/topics`、`/favorites`、`/console` 均可静态预渲染（构建时未设 `DATABASE_URL` / `REDIS_URL`）
- `pnpm --filter web e2e` -- expected: 1.1 `home.spec.ts` 仍全绿；`navigation.spec.ts` 桌面与移动用例全绿

**Manual checks (if no CLI):**
- 桌面 1280px：左侧栏 `sticky` 不随主内容滚动消失；移动 375px：汉堡展开抽屉、Escape 与遮罩可关闭；Reduced-motion 下抽屉无动画。

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 4: (high 0, medium 2, low 2)
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` 抽屉路由变更自动关闭机制改写：以 render-time 调整 state（`lastPathname` 守卫）取代 `openedAtPath` / `effectiveOpen` 派生 —— 修复浏览器返回原路由时抽屉重新弹出（back-reopen）、`setOpenedAtPath` 嵌套在 `setOpen` updater 内的 React 反模式（Strict Mode 双调用风险）、以及 `pathname` / `openedAtPath` 双 null 比较边角。
  - `[medium]` `[patch]` 移除抽屉 `aria-modal="true"` —— 不再向辅助技术承诺未实现的模态焦点陷阱 / 背景滚动锁（intent a11y 地板仅要求 Escape / 遮罩 / 键盘可达，不含模态语义），并补 KEEP 注释禁止在无焦点陷阱时加回。焦点陷阱与滚动锁两条发现随之消解（非模态披露不承诺二者）。
  - `[medium]` `[patch]` 新增 768px 断点边界 e2e（`navigation.spec.ts` 新 describe）—— 钉住矩阵「跨断点布局稳定」在最脆弱的 `md:` 翻转点，确认桌面侧栏与移动顶部栏不并存。
  - `[low]` `[patch]` 遮罩点击坐标改为按抽屉面板实际包围盒推导 —— 移除魔法常量 `x:330`，面板宽度变更不再令测试失效。
  - `[low]` `[patch]` 新增 `aria-current` 断言 —— 验证 `isActive` 精确 / 前缀规则（首页精确匹配、其余 startsWith），关闭既有高亮行为的验证缺口。
  - defer：1 条新登记至 `deferred-work.md`（公共壳层暗色策略横跨 + 深色 OS 首页不可读，1.3 主题系统落地时统一清理）；另 3 条（`suppressHydrationWarning` 残留、e2e/CI 自动化门、`/console` 鉴权与回链）为 Story 1.1 已记录的既有项，本次复核再次浮现，已被既有 deferred-work 条目覆盖，未重复登记。
  - reject：9（遮罩 `<button>` 语义偏好且 Escape 键盘可关；既有 `dark:` 清理属 1.3；reduced-motion 回归守卫——无动画即满足不变量；移除 `<main min-h-screen>`——容器 `min-h-screen` 仍撑满视口；运营台「无视觉信号」——`内部入口` 分区标签已存在；logo 链接无 `aria-current`——品牌链接惯例；占位页 H1 不断言——可达性已覆盖；`isomorphic` 注释措辞轻微；home.spec 无 `<main>` landmark 断言——shell 已由 `<aside>` 间接钉住）。

## Auto Run Result

Status: done

### 实施变更摘要
交付 Story 1-2（基础导航与响应式公共页面壳层）。在 `apps/web/app/(public)/` 增加组级响应式壳层 `layout.tsx`（桌面 `md:flex` 行 = 左侧导航 + 主区；移动块流 = 顶部栏 + 主区）与单个 `'use client'` 响应式导航组件 `public-nav.tsx`（桌面 sticky 左侧栏 ≥768px、移动 sticky 顶部栏 + 抽屉 <768px，一级入口首页/日报/主题/收藏 + 内部入口运营台，抽屉 Escape/遮罩关闭、aria-expanded/controls、≥44px 触控目标、瞬时切换满足 reduced-motion）。为导航目标补齐 `/daily` `/topics` `/favorites` 三张结构性占位页（与 1.1 `/console` 同构）。首页 `page.tsx` 移除自带 `<main>` 外壳、改由 layout 接管，内容与 H1 不变。

### 变更文件（一行描述）
- `apps/web/app/(public)/layout.tsx` — NEW：组级响应式壳层，桌面 flex 行（侧栏 + 主区）、移动块流（顶部栏 + 主区），接管 `<main>`
- `apps/web/app/(public)/_components/public-nav.tsx` — NEW：`'use client'` 响应式导航（桌面 sticky 左侧栏 + 移动顶部栏/抽屉；render-time 自动关闭、Escape/遮罩关闭、aria-expanded/controls、aria-current 高亮）
- `apps/web/app/(public)/page.tsx` — MODIFY：移除自带 `<main min-h-screen>` 外壳（由 layout 接管），首页内容、H1、文案不变
- `apps/web/app/(public)/daily/page.tsx` — NEW：日报结构性占位页（匿名 server component）
- `apps/web/app/(public)/topics/page.tsx` — NEW：主题结构性占位页
- `apps/web/app/(public)/favorites/page.tsx` — NEW：收藏结构性占位页（标注登录态后续开放，不强制登录）
- `apps/web/e2e/navigation.spec.ts` — NEW：桌面导航可见性/href、点击日报到 `/daily`、`/topics`+`/favorites` 匿名可达、移动抽屉开关与导航、Escape/遮罩关闭、768px 断点边界、aria-current 高亮的 Playwright 覆盖

### 评审结论分布
- patch：7（3 medium、4 low，均已应用并复验全绿）
- defer：4（1 条新登记至 `deferred-work.md`；3 条为 1.1 既有项再次浮现，已被覆盖）
- reject：9（误报 / 推测 / 已被既有设计覆盖）
- intent_gap / bad_spec：0

### 是否建议跟进评审
false —— 本评审 pass 的改动集中于单个导航组件 + 其 e2e：1 处 a11y 诚实化（移除 `aria-modal`）、1 处导航状态机制改写（render-time 取代派生，修 back-reopen）、3 处测试加固（断点边界、aria-current、遮罩点击稳健性）。范围窄、仅影响抽屉行为（无 API/安全/数据面），且全部由扩展后的 9 条 e2e 验证通过。

### 验证执行
- `pnpm -r typecheck`：5/5 workspace 通过（含 `tsconfig.e2e.json`）
- `pnpm -r lint`：5/5 通过（render-time 调整 state 模式未被 `react-hooks` 规则标记）
- `pnpm --filter web build`：Next 16.2.10 构建成功，`/`、`/_not-found`、`/console`、`/daily`、`/favorites`、`/topics` 均 `○ (Static)` 静态预渲染（构建时未设 `DATABASE_URL`/`REDIS_URL`）
- `pnpm --filter web e2e`：9/9 通过（2 条 1.1 `home.spec` 无回归 + 7 条 `navigation.spec`，含新增 768px 断点边界与 aria-current 断言）
- AD-8 人工核对：无 `middleware.ts`；新增公共页面/壳层均为 server component，无 auth / redirect

### 残留风险 / 残留产物
- 1 条新 defer 见 `_bmad-output/implementation-artifacts/deferred-work.md`（公共壳层暗色策略横跨 + 深色 OS 首页不可读，1.3 主题系统统一清理）；3 条既有 defer（suppressHydrationWarning、e2e/CI 门、/console 鉴权与回链）保持不变。
- 移动抽屉为非模态披露（无焦点陷阱 / 背景滚动锁），符合 intent a11y 地板；若后续 story 提升可达性要求，需在加回 `aria-modal` 时一并补焦点陷阱。
- 磁盘构建缓存（`.next/`、`node_modules/`、`*.tsbuildinfo`、`test-results/`）已 gitignore，不入产物。
