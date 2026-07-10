---
title: '公开页面语义与键盘可达基线 (3.5)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: 'd5bb045741b6f912c5e07bbe539f4e3df995cec1'
final_revision: 'd3afcbcbe934fa3908053a635593907e2005223a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/EXPERIENCE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Verbatim intent (Story 3.5, epics.md):** "As a 市场观察用户, I want 在首页、详情、主题、日报、搜索和关注列表中获得一致的语义与键盘可达性, So that 我在不依赖鼠标的情况下也能稳定完成浏览。" AC1: "Given 用户使用键盘浏览公共页面, When 焦点在导航、卡片、搜索、筛选、收藏和来源链接之间移动, Then 所有核心交互都可达, And 页面提供可见焦点状态和清晰的标题层级。" AC2: "Given 页面展示市场反应信号或涨跌语义, When 用户仅依赖文本、图标或辅助技术理解界面, Then 关键状态不只依赖红绿颜色表达, And 对应语义有文本或等价辅助标识。"

**Problem:** 调查（6 面 + 全部共享组件）表明可达基线**大部分已由前序 epic 落地**，但有一处真实缺口与两处需锁定的不变量。(1) **AC1 可达性**已满足：`(public)` 下所有交互元素均为真实 `<a>`/`<button>`/`<input>`，**零 `div onClick`**——nav/feed-filters/search-box/event-card/follow-button/back-link/详情来源链接全部原生可聚焦。(2) **AC1 标题层级**已满足：每页恰好一个 `<h1>`、无层级跳级（home/detail/themes×2/daily/search/favorites 均查证）。(3) **AC1 可见焦点 = 真实缺口**：`globals.css` 定义了 `--color-focus-ring:#335A91` token，但**没有任何全局 `:focus-visible` 规则**；显式焦点环只出现在 SearchBox（`search-box.tsx:88,94`）与 FollowButton（`follow-button.tsx:182,248,260`）——**所有 nav 链接、FilterPill（`chips.tsx:92-98`，波及 home/topics×2/detail 关联+主题/search 五面）、卡片链接、BackLink、详情外链证据、CTA 链接全部依赖浏览器默认 outline**（且品牌约定是蓝色 ring，不是默认 outline，故「可见焦点状态」对品牌一致性而言未达标）。(4) **AC2 非颜色**已满足：唯一使用市场色的 `ReactionChip`（`components/chips.tsx:152-160`）= `bg/text-market-*` 颜色 **+「涨/跌/平」CJK 文字 + 数值**，颜色非唯一区分维度；`globals.css:50-52` 注释与详情页注释（`events/[hotEventId]/page.tsx:56,257`）已将其编码为不变量，但**无回归守卫**——未来一个 color-only 变体可静默回归。另缺键盘可达的经典基线原语：无 skip-to-content 入口、`<main>`（`layout.tsx:33`）无 `id`（键盘用户每页须 Tab 穿过整套 nav）。

**Approach:** **纯 web 层、零 core/DB/worker/迁移。** ponytail 高 rung：(1) **一条全局 `:focus-visible` CSS 规则**（用既有 `--color-focus-ring` token，`:where(a,button,input,textarea,select,summary):focus-visible`，specificity 0 故既有 `focus:outline-none focus-visible:ring-*` 组件仍用自己的 ring、不被覆盖）——一行 CSS 把「可见焦点」基线一次性铺到全部 6 面 + 全部共享组件，零逐组件改 focus 类。(2) **skip-to-content 链接 + `<main id="main" tabIndex={-1}>`**——可达基线的经典原语（`sr-only` 直到 `:focus`），键盘用户可跳过整套 nav。(3) **AC2 回归守卫**：在 DB-free 的 `/design` 面断言 `ReactionChip` 三态各自渲「涨/跌/平」可见文字（锁住「颜色+文字」不变量，AC2 非颜色不可静默回归）。(4) `@a11y` e2e 断言 AC1 键盘可达性（Tab 序列命中 `A`/`BUTTON`/`INPUT`，无 div-onclick 陷阱）+ skip-link 聚焦后跳至 `#main`。AC1 标题层级与 AC2 非颜色**今日已满足**——3.5 不改其结构，仅以 e2e/守卫锁定，诚实登记（不伪造工作）。

## Boundaries & Constraints

**Always:**
- 全局焦点（AC1「可见焦点状态」）：`globals.css` 加一条 `:where(a,button,input,textarea,select,summary):focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }`（复核 patch 移除原 `border-radius: var(--radius-sm)`——它会覆盖各元素自身圆角致聚焦时形变 [pill→rectangle]，且现代浏览器 `outline` 本就跟随元素 `border-radius`，无需另设）。`:where()` 保持 specificity 0 → 既有 `focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`（SearchBox/FollowButton）的 ring 不被覆盖、无双重指示器；无 focus 类的链接/FilterPill/卡片/BackLink/外链由本规则获得品牌色可见焦点。**不**逐组件加 `focus:` 类（CSS 优于 JS，一条规则覆盖所有面）。
- skip-link（可达基线原语）：`(public)/layout.tsx` 在根 `<div>` 首子（`<PublicNav/>` 之前）加 `<a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink-primary focus:ring-2 focus:ring-focus-ring">跳至主要内容</a>`；`<main>` 加 `id="main" tabIndex={-1}`（可程序聚焦，skip-link 跳入后焦点落入 main 而非瞬移到首链）。skip-link 是 `(public)` 路由的第一个可聚焦元素（operator console 非公开、不需要）。
- AC1 可达性字节不变：**不**改任何 `(public)` 组件的交互元素类型（全部已是真实 `<a>`/`<button>`/`<input>`）——本 story 零 `div onClick`→`<button>` 类改动；可达性已满足，3.5 仅以 `@a11y` e2e 守卫防回归。
- AC1 标题层级字节不变：**不**改任何 `<h1>`/`<h2>` 结构（每页一 h1、无跳级，已查证）；**不**把关联子标题/成员事件/主题行标题由 `<p>` 提为 `<h3>`（defer）。
- AC2 非颜色不变量锁定：在 `/design`（`design/page.tsx:145-153` 已渲三态 `ReactionChip`，DB-free）断言每态含可见文字「涨/跌/平」——锁住 `ReactionChip`「颜色+文字」契约，防 color-only 静默回归。**不**改 `ReactionChip` 实现（`chips.tsx:152-160` 已是 color+文字+数值）。
- SSR/build 安全（不变量延续）：`(public)/layout.tsx` 仍是 server component；skip-link 是普通 `<a>`、`<main id tabIndex>` 是静态属性——无 `"use client"`、无 hydration 变化。`pnpm --filter web build`（无 `DATABASE_URL`）仍成功（不改任何 `@aguhot/core` import 或路由动态性）。
- 不变性约定（沿用 1.4~3.4）：camelCase；`import type` 用于类型；无新 `enum`（`erasableSyntaxOnly`）；零新 npm 依赖；零新 sessionStorage key。

**Block If:**
- 改 `globals.css` / `layout.tsx` 致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- 改 `globals.css` / `layout.tsx` 致 `pnpm -r typecheck` / `pnpm -r lint` 回归 → HALT。
- 加 skip-link / `<main id>` 致 base `e2e`（home/navigation/design）回归（如某 spec 断言「首个 `<a>`」或链接计数被 skip-link 扰动）→ HALT（须调整 spec selector 跟随，断言意图不变，同 3.4 search.spec selector 跟随模式）。
- 本地 PG `aguhot_dev` 不可达致 `e2e:a11y`（`/` 首屏需请求期 `DATABASE_URL`，同 home.spec）失败 → HALT（不得跳过 e2e）。

**Never:**
- 不逐组件加 `focus:` / `focus-visible:` Tailwind 类（全局 CSS 规则已覆盖；逐组件改 = 低 rung + 大 diff + 双重指示器风险）。
- 不移除既有 SearchBox/FollowButton 的 `focus:outline-none focus-visible:ring-*`（它们仍用自己的 ring；全局规则与它们 specificity 正交、共存无冲突——统一为单一机制 defer）。
- 不改 core / prisma / worker / 任何 `@aguhot/core` 导出 / schema / migration（本 story 纯 web 层）。
- 不改任何 `<h1>`/`<h2>` 结构、不把 `<p>` 子标题提为 `<h3>`（标题层级已满足 AC1；子项 heading 是增强非基线，defer）。
- 不改 `ReactionChip` 实现 / 不加 ▲▼↑↓ 符号层 / 不加 `aria-label`（AC2 由既有「涨/跌/平」文字+数值已满足；符号/aria 层 defer）。
- 不加 `aria-live` 公告 follow 成功/处理中态（FollowButton 既有 `role="alert"` 仅覆错误；成功公告 defer）。
- 不做触控热区 / reduced-motion（显式 Story 3.6 范围）。
- 不在 operator console 加 skip-link / 焦点基线（非公开面；本 story 仅 `(public)`）。
- 不新增 seed 脚本（`@a11y` 用 `/`（同 home.spec，本地 PG）+ `/design`（DB-free），零新 seed）。
- 不改 1.1~3.4 既有 seed/既有 `@*` spec 断言——**唯一可能例外**：base `e2e` 或 navigation.spec 若有「首个链接/链接计数」类断言被 skip-link 扰动，须跟随调整 selector（断言意图不变，同 3.4 模式）；其余既有 spec 零改动。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 键盘 Tab 穿过公开页（AC1 可达） | 在 `/` 按 Tab | 焦点依序命中 skip-link → nav 链接 → 搜索 input → …全部为真实 `A`/`BUTTON`/`INPUT`，无 div-onclick 陷阱 | 无错误预期 |
| 链接获键盘焦点（AC1 可见焦点） | Tab 到任一 nav 链接 / FilterPill / 卡片链接 / BackLink / 详情外链 | 该元素显示 `--color-focus-ring` 色实线 outline（品牌一致），非浏览器默认 outline | 无错误预期 |
| 既有 ring 组件不回归 | Tab 到 SearchBox input / FollowButton | 仍显示既有 `ring-focus-ring`（全局 `:where()` specificity 0 不覆盖 `focus:outline-none` + `focus-visible:ring-2`） | 无错误预期 |
| skip-link 跳至主内容 | 首次 Tab 聚焦 skip-link → 按 Enter | 焦点移至 `<main id="main">`（tabIndex={-1} 可程序聚焦），不再须 Tab 穿过整套 nav | 无错误预期 |
| skip-link 视觉隐身 | 鼠标浏览（skip-link 未聚焦） | skip-link 视觉隐藏（`sr-only`），不占布局 | 无错误预期 |
| 市场反应非颜色（AC2 守卫） | `/design` 渲 `ReactionChip` 三态 | 每态含可见文字「涨」「跌」「平」（颜色非唯一区分维度，锁定不变量） | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/globals.css` -- MODIFY（追加一条规则，既有 `@theme` 零改动）：在文件末尾追加全局焦点规则 `:where(a, button, input, textarea, select, summary):focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }`（复核 patch 移除原 `border-radius: var(--radius-sm)`——它会覆盖各元素自身圆角致聚焦形变，现代浏览器 `outline` 已跟随元素 `border-radius`）。注释点明：Story 3.5 键盘可达基线——一条全局 `:focus-visible` 用既有 `--color-focus-ring` token 保证每个可聚焦元素键盘聚焦时显示品牌色可见焦点，使焦点可见性不再依赖逐组件类（仅 SearchBox/FollowButton 有）或浏览器默认 outline；`:where()` 保持 specificity 0 故既有 `focus:outline-none focus-visible:ring-*` 组件的 ring 不被覆盖（无双重指示器、无回归）。
- `apps/web/app/(public)/layout.tsx` -- MODIFY：(1) 根 `<div>` 首子（`<PublicNav/>` 之前）加 skip-link `<a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink-primary focus:ring-2 focus:ring-focus-ring">跳至主要内容</a>`；(2) `<main className="min-w-0 flex-1">` → `<main id="main" tabIndex={-1} className="min-w-0 flex-1">`。注释更新：补「Story 3.5 — skip-to-content 入口 + `<main id>` 键盘可达基线原语；skip-link 是 `(public)` 路由首个可聚焦元素，`:focus` 时可见、否则 `sr-only`；`tabIndex={-1}` 使 skip-link 跳入后焦点落入 main。」`<ListContextMemory/>` / children 零改动（id/tabIndex 不影响子树行为/2.5 scroll 恢复）。
- `apps/web/e2e/a11y.spec.ts` -- NEW（`describe` 标题含 `@a11y`）：(1) AC1 可达性：`page.goto("/")` → 反复 `page.keyboard.press("Tab")`，每次 `page.evaluate(() => (document.activeElement as HTMLElement)?.tagName)` 收集，断言命中序列含 `"A"`（nav 链接）与 `"INPUT"`（搜索）等真实可聚焦元素、且任一 activeElement 均非 `<div>`（无 div-onclick 陷阱）；首个 Tab 命中 skip-link（`getByRole("link", { name: /跳至主要内容/ })` 与 activeElement 一致）。(2) skip-link：聚焦 skip-link → `Enter` → `expect.poll(() => document.activeElement?.id).toBe("main")`。(3) AC1 可见焦点：Tab 到首个 nav 链接 → `expect.poll(() => getComputedStyle(document.activeElement).outlineStyle).not.toBe("none")` 且 `outlineColor` 含非透明值（全局规则生效）。(4) AC2 非颜色守卫：`page.goto("/design")`（DB-free）→ 三态 `ReactionChip` 各 `getByText("涨")`/`"跌")`/`"平")` 可见（锁定 color+文字不变量）。匿名全程 200。
- `apps/web/package.json` -- MODIFY：加 `"e2e:a11y": "NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @a11y"`（`/` 同 home.spec 用本地 PG、`/design` DB-free，零新 seed）；`e2e` 的 `--grep-invert` 追加 `|@a11y`（base e2e 不跑 `@a11y`，与 `@search`/`@loop` 等同构隔离）。既有其余脚本零改动。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 3-5 defer（统一焦点机制：移除 SearchBox/FollowButton 既有 ring 改用全局规则；`<p>` 子标题/成员事件/主题行标题提为 `<h3>`；`ReactionChip` 加 ▲▼ 符号层 + `aria-label`；follow 成功/处理中 `aria-live` 公告；daily `<ol>` 补 `role="list"` 一致性；焦点规则的单元/视觉回归自动化）。

## Tasks & Acceptance

**Execution:**
- `apps/web/app/globals.css` -- 追加全局 `:where(...):focus-visible` 规则（用 `--color-focus-ring`，specificity 0 不覆盖既有 ring） -- AC1 可见焦点基线（一行 CSS 铺满全部 6 面 + 共享组件，错失 = 焦点不可见/不一致）
- `apps/web/app/(public)/layout.tsx` -- 加 skip-link + `<main id="main" tabIndex={-1}>` -- AC1 可达基线原语（键盘用户跳过 nav）
- `apps/web/e2e/a11y.spec.ts` + `package.json:{e2e:a11y}` + `e2e` grep-invert 加 `|@a11y` -- `@a11y` e2e（AC1 可达 Tab 序列 + skip-link 跳转 + 可见焦点 outline + AC2 非颜色守卫） -- AC1/AC2 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 3-5 defer 项 -- 诚实登记统一焦点机制/heading 提升/符号层/aria-live/daily ol/焦点回归自动化

**Acceptance Criteria:**
- Given 读者用键盘浏览 `/`，When 反复按 Tab，Then 焦点依序命中真实 `<a>`/`<button>`/`<input>`（skip-link → nav → 搜索 → …），And 任一时刻 `document.activeElement` 均非 `<div>`（AC1 全部核心交互可达、无 div-onclick 陷阱）。
- Given 读者用键盘聚焦任一 nav 链接 / FilterPill / 卡片链接 / BackLink / 详情外链，When 该元素获 `:focus-visible`，Then 其 `outline-style` 非 `none`、`outline-color` 为品牌 `--color-focus-ring`（AC1 可见焦点状态，全局规则生效）。
- Given 读者用键盘聚焦 SearchBox input 或 FollowButton，When 获焦，Then 仍显示既有 `ring-focus-ring`（全局 `:where()` specificity 0 不覆盖，无回归、无双重指示器）。
- Given 读者首次 Tab 命中 skip-link「跳至主要内容」，When 按 Enter，Then 焦点移至 `<main id="main">`（`expect.poll(activeElement.id).toBe("main")`），不再须 Tab 穿过整套 nav（可达基线原语）。
- Given 鼠标浏览（skip-link 未聚焦），When 页面渲染，Then skip-link 视觉隐藏（`sr-only`，不占布局）；And `<main>` 带 `id="main"`。
- Given `/design` 渲三态 `ReactionChip`，When 读其可见内容，Then 「涨」「跌」「平」文字各自可见（AC2 关键状态不只依赖红绿颜色，锁定 color+文字不变量防回归）。
- When 执行 `pnpm -r typecheck` / `pnpm -r lint`，Then 通过；And `pnpm --filter web build`（无 `DATABASE_URL`）成功（layout 仍 server、skip-link 普通 `<a>`、SSR 安全）；And `pnpm --filter web e2e:a11y`（`@a11y`）全过（AC1 可达 + skip-link + 可见焦点 + AC2 守卫）；And `pnpm --filter web e2e`（base home/navigation/design）与 `e2e:loop`/`e2e:detail`/`e2e:search` 不回归（skip-link / `<main id>` / 全局焦点规则不破坏既有断言）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (low 5)
- defer: 4
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` **焦点规则 `border-radius: var(--radius-sm)` 致聚焦形变**（`globals.css:105`）：原规则（spec Code Map 指定）在 `:focus-visible` 上设 `border-radius:6px`，会覆盖各元素自身圆角——pill 形 FilterPill 聚焦时变圆角矩形、矩形 CTA 聚焦时被强加圆角 = 聚焦诱导的形变（a11y/UX 缺陷）；且现代浏览器 `outline` 本就跟随元素 `border-radius`，该声明冗余。修复：移除 `border-radius: var(--radius-sm);`，outline 自然跟随各元素自身圆角（pill 保持 pill 形 outline）。同步修订 spec Code Map / Always 条目去除该声明。纯 CSS、零逻辑改动，重跑 e2e 全绿。
  - `[low]` `[patch]` **`@a11y` 被默认 `e2e` grep-invert 排除 = 自致验证盲区**（`package.json:15`）：`@a11y` 是无 seed 套件（仅需本地 PG，同 home.spec），却仿照需-seed 套件被加入 `--grep-invert`，导致默认 `pnpm --filter web e2e` 闸门完全不跑焦点规则/skip-link 断言——本 story 落地的不变量（全局焦点 + skip-link）回归只在 opt-in `e2e:a11y` 里被抓。修复：从 base `e2e` grep-invert 移除 `|@a11y`，`@a11y` 现并入默认闸门（base e2e 由 17→24 测试，含 7 条 `@a11y`），`e2e:a11y` 保留作聚焦迭代用。
  - `[low]` `[patch]` **SearchBox ring 守卫仅断 `boxShadow !== "none"`**（`a11y.spec.ts` ring 测试）：原断言被任意 box-shadow 满足（理论上不限于品牌 ring）。强化：追加断言 box-shadow 含品牌焦点环通道 `51.*90.*145`（`#335A91`），使守卫真正锁定「品牌 ring 存活、未被全局规则覆盖」。注：SearchBox 实际无其他阴影，原断言对本元素已足，此强化为防御性。
  - `[low]` `[patch]` **AC2 守卫仅断文字可见、未证「color+text 同处」**（`a11y.spec.ts` `/design` AC2 测试）：原 `getByText("涨"/"跌"/"平").toBeVisible()` 只证文字存在某处，未证文字与市场色 chip 同节点（AC2 要的「非仅颜色」）。强化：改为 `[class*="market-*-soft"]').filter({ hasText: 涨/跌/平 }).toBeVisible()`——证每个市场色 chip 元素内含其可见文字标签，直接锁「颜色+文字」契约。
  - `[low]` `[patch]` **outline-color 断言硬编码 `rgb(51, 90, 145)` 序列化脆**（`a11y.spec.ts` outline 测试）：CSS Color 4 空格序列化 `rgb(51 90 145)` 或浏览器序列化变更会误败。修复：改为通道匹配——先 `.toContain("51")` 再 `replace(/[\s,]/g,"").toMatch(/51.*90.*145/)`，容许逗号/空格两种 rgb 序列化同时仍钉住品牌通道（token 漂移仍败）。
  - 4 项 defer 追加至 deferred-work（见下）：跨浏览器（WebKit/Firefox）a11y 验证（项目 chromium-only 配置）、标题层级自动化守卫（一 h1/无跳级，今日结构满足但无测试锁定）、按面 a11y e2e 扩展（themes/daily/search/favorites/detail）、grep-invert tag 列表可维护性（项目级模式）。
  - 13 项 reject 丢弃：`<main tabIndex={-1}>` 幻影 Tab stop（HTML 规范 -1 不入序列、假设性）、skip-link sr-only `≤1px` 仅抓粗失效（已抓主要回归、微妙 clip 假设性）、`expect.poll` 超时/报错文案（cosmetic DX）、outline-offset 被 overflow 裁剪（CSS 规范 outline 不被 overflow 裁剪、事实错误）、`focus:outline-none` 鼠标态无环（标准 `:focus-visible` 语义、既有非回归、文本 input 鼠标聚焦仍 match）、选择器漏 contenteditable/audio/details（YAGNI、`(public)` 今日无此类元素）、skip-link `#main` operator 缺失（假设性、正确仅 public）、`/#main` 永链 scroll（可忽略）、Tab 循环 wrap-around（断言按类型、wrap 不误判）、INPUT-hunt 移动视口脆（desktop 配置保 search 可见）、AD-8 `/` 需 DB（同 home.spec 约定）、deferred-work 冗长（匹配既有格式）、AC2 锚 `/design` 非详情页（ReactionChip 组件级不变量、详情页同组件同 `REACTION_LABEL[tone]` 文字源、`/design` 三态静态渲是组件守卫的恰当面）。
- verification_note: 5 patch 后重跑 `pnpm -r typecheck`/`pnpm -r lint` PASS、`pnpm --filter web build` PASS（路由动态性不变）、`pnpm --filter web e2e` 24/24 PASS（base 闸门现含 7 条 `@a11y` + home/navigation/design 17）、`pnpm --filter web e2e:a11y` 7/7 PASS。intent-alignment 确认 diff 忠实实现 Reading C（关唯一真实缺口 [全局焦点 + skip-link] + 锁既有满足的不变量 [AC2 非颜色、AC1 标题层级]），验证足迹虽窄于 intent 枚举面但全局规则跨面、`/` 面已覆盖全部共享交互组件（nav/SearchBox/FilterPill/EventCard/FollowButton 同源 `<a>`/`<button>`/`<input>`）。

## Design Notes

**为何「一条全局 `:focus-visible` CSS 规则」而非逐组件加 `focus:` 类：** 三个候选。(1) 逐组件给每个链接/FilterPill/卡片/BackLink/外链加 `focus:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`：波及 6 面 × 数十元素，大 diff、双处维护、漏改一处即破基线。(2) 仅改 FilterPill 的 `pillClass`（`chips.tsx:92-98`，最高波及面）：缓解但仍遗漏 nav/卡片/BackLink/外链。(3) **一条 `:where(a,button,input,textarea,select,summary):focus-visible` 全局规则**：CSS 优于 JS（ladder rung 3），一行把品牌色可见焦点铺到全部 6 面 + 全部共享组件，零逐组件改。`:where()` 保持 specificity 0 是关键——既有 `focus:outline-none focus-visible:ring-2`（SearchBox/FollowButton，Tailwind 编译 specificity 更高）的 ring 不被覆盖，故无双重指示器、无回归；无 focus 类的元素由本规则获 outline。品牌焦点色 `--color-focus-ring:#335A91` 已是 1.3 既有 token（`globals.css:61`），零新 token。这是 ponytail：覆盖 AC1「可见焦点状态」的最短 diff——一行 CSS。

**为何 skip-link 在「可达基线」范围内（AC1 字面只点名「可见焦点」）：** story 标题即「可达基线」，UX a11y floor（EXPERIENCE.md:110）明示「所有交互元素必须可键盘访问」。可达性今日已满足（全真实元素），但键盘用户每页须 Tab 穿过整套 nav 才到主内容——skip-to-content 是键盘可达的经典基线原语（WCAG 2.4.1），与 AC1「焦点在导航、卡片、搜索、筛选、收藏和来源链接之间移动」的键盘流直接相关。成本极低（`<a>` + `id` + `tabIndex`，3 处属性），HTML 原生（ladder rung 2，无 JS/无 Provider/无新依赖），故纳入基线而非 defer。

**为何 AC2「不做实现只加守卫」：** 调查证实 `ReactionChip`（`components/chips.tsx:152-160`）已是 `bg/text-market-*` 颜色 **+「涨/跌/平」文字 + 数值**——AC2「不只依赖红绿颜色」**今日已满足**。`globals.css:50-52` 注释、详情页注释（`events/[hotEventId]/page.tsx:56,257`）、`/design` caption（`design/page.tsx`「文本 + 颜色」）三处已编码该不变量，但**无测试守卫**——本 story 的 AC2 净增量是**回归守卫**：在 DB-free 的 `/design` 断言三态含可见文字，使未来一个 color-only 变体不可静默回归。伪造 AC2 实现工作（如重写 ReactionChip）违背 ponytail + 诚实报告。符号层（▲▼）/`aria-label`/组件级 selfcheck defer（文字层已足 AC2）。

**为何「`/design` 作 AC2 守卫面」而非详情页：** `/design`（`design/page.tsx:145-153`）已静态渲三态 `ReactionChip`（`tone="up|down|flat"` + 示例值），**DB-free**（无请求期 `DATABASE_URL` 依赖），且其 caption 本就是设计系统对「文本+颜色」契约的自我声明——断言其三态含「涨/跌/平」文字既验证 AC2 不变量、又零 seed 零 DB。详情页 ReactionChip 依赖 `@aguhot/core` 投影数据 + seed-market-reaction，用作守卫面成本高且与 AC2「组件非颜色」意图无关。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（globals.css CSS only、layout.tsx skip-link/main 属性、新 a11y spec + tsconfig.e2e）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（layout 仍 server、skip-link 普通 `<a>`、全局焦点规则纯 CSS、无路由动态性变化）
- `pnpm --filter web e2e:a11y` -- expected: `@a11y` 全过（AC1 可达 Tab 序列含 A/INPUT 且无 div + skip-link Enter 跳至 `#main` + 可见焦点 outline 非 none + AC2 `/design` 三态含「涨/跌/平」文字 + 匿名 200）
- `pnpm --filter web e2e` -- expected: base（home/navigation/design）不回归（skip-link / `<main id>` / 全局焦点不破坏既有 nav/home/design 断言；若 navigation.spec 有「首个链接/链接计数」类断言被 skip-link 扰动则跟随调整 selector，断言意图不变）
- `pnpm --filter web e2e:loop` / `e2e:detail` / `e2e:search` -- expected: 不回归（2.5 ListContextMemory、详情 BackLink、search 行为字节不变——本 story 仅加全局焦点 CSS + skip-link + main id，零交互逻辑改动）

**Manual checks (if no CLI):**
- `/` 用键盘 Tab：首个焦点 = skip-link「跳至主要内容」（可见），Enter → 焦点跳至主内容区；继续 Tab 依序穿 nav 链接、搜索框、筛选/卡片，每个获焦元素显示蓝色 `--color-focus-ring` 实线 outline；鼠标浏览时 skip-link 隐身。
- `/design` 三态 ReactionChip：每态除颜色外均有「涨/跌/平」文字（AC2 非颜色）。
- SearchBox/FollowButton 获焦仍显示既有 ring（全局规则未覆盖、无回归）。
- 详情页 Tab 到外链证据链接：显示品牌色可见焦点（AC1 来源链接可见焦点）。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 3 story 3.5 公开页面语义与键盘可达基线——纯 web 层（零 core/DB/worker/迁移）。调查（6 面 + 全部共享组件）表明基线大部分已由前序 epic 落地：(1) AC1 可达性已满足——`(public)` 下所有交互元素均为真实 `<a>`/`<button>`/`<input>`、零 `div onClick`；(2) AC1 标题层级已满足——每页恰好一个 `<h1>`、无层级跳级；(3) AC2 非颜色已满足——唯一使用市场色的 `ReactionChip` = 颜色 +「涨/跌/平」文字 + 数值。3.5 的净增量是关唯一真实缺口（AC1 可见焦点）+ 补键盘可达原语 + 锁既有不变量：(a) **一条全局 `:where(a,button,input,textarea,select,summary):focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px }`**（用既有 token，`:where()` specificity 0 不覆盖既有 ring 组件）——一行 CSS 把品牌色可见焦点铺到全部 6 面 + 全部共享组件，零逐组件改；(b) **skip-to-content 链接 + `<main id="main" tabIndex={-1}>`**——键盘可达经典原语；(c) `@a11y` e2e 守卫（AC1 可达 Tab 序列 + skip-link 跳转 + 可见焦点 outline + AC2 非颜色 chip 守卫 + SearchBox ring 不回归）。AC2/AC1-标题层级今日已满足，3.5 以守卫锁定、不改结构（诚实登记、不伪造工作）。

**Files changed:**
- `apps/web/app/globals.css` — 追加全局 `:where(...):focus-visible` 焦点规则（用 `--color-focus-ring`，specificity 0）。复核 patch：移除原 `border-radius: var(--radius-sm)`（聚焦时覆盖各元素自身圆角致形变；现代浏览器 outline 已跟随元素 border-radius）。
- `apps/web/app/(public)/layout.tsx` — 加 skip-link `<a href="#main">`（sr-only 直到 `:focus`）+ `<main id="main" tabIndex={-1}>`（键盘可达原语）。
- `apps/web/e2e/a11y.spec.ts` — NEW `@a11y` e2e（7 测，零新 seed：`/` 同 home.spec 本地 PG、`/design` DB-free）：AC1 可达 Tab 序列（无 div-onclick）+ skip-link Enter 跳 `#main` + skip-link sr-only 未聚焦隐身 + nav 链接可见焦点 outline（品牌色）+ SearchBox ring 未被全局规则覆盖（含品牌色通道断言）+ AC2 `/design` 三态 ReactionChip 颜色+文字同节点守卫 + 匿名 200。复核 patch：强化 ring/AC2/outline-color 三处断言（品牌色通道、chip 范围、rgb 序列化容忍）。
- `apps/web/package.json` — `e2e:a11y` 脚本 + 复核 patch：从 base `e2e` 的 `--grep-invert` **移除 `|@a11y`**（a11y 无 seed、仅需本地 PG 同 home.spec，应并入默认闸门——base e2e 由 17→24 测试）。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 3-5 实现期（6）+ 复核期（4：跨浏览器 a11y、标题层级守卫、按面 a11y e2e 扩展、grep-invert 可维护性）defer 项。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0（intent-alignment 确认 diff 忠实实现 Reading C：关全局焦点 + skip-link 唯一真实缺口，锁既有满足的 AC1 标题层级 / AC2 非颜色不变量）。patch 5（low 5：globals.css 移除 border-radius 致聚焦形变；package.json `@a11y` 移出 grep-invert 闭合验证盲区；a11y.spec SearchBox ring 断品牌色通道；AC2 守卫范围到市场色 chip；outline-color 容忍 rgb 逗号/空格序列化）。defer 4（跨浏览器 chromium-only 配置、标题层级自动化守卫、按面 a11y e2e、grep-invert tag 列表可维护性——均项目级/surface 顺带）。reject 13（outline 被 overflow 裁剪[CSS 规范事实错误]、main tabIndex 幻影 stop[HTML 规范假设性]、focus:outline-none 鼠标态[标准 focus-visible 语义非回归]、选择器漏 contenteditable[YAGNI 今日无]、skip-link operator 缺失[假设性正确仅 public]、Tab wrap-around[类型断言不误判]、INPUT-hunt 移动视口[desktop 配置]、AD-8 需 DB[同 home.spec]、deferred-work 冗长[匹配既有格式]、AC2 锚 /design[组件级不变量恰当面]、sr-only ≤1px/expect.poll 报错/`/#main` scroll[cosmetic 或可忽略] 等）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 `DATABASE_URL`）PASS（`/design` 仍 `○ Static`、其余 `ƒ Dynamic`、layout 仍 server、skip-link 普通 `<a>` SSR 安全）、`pnpm --filter web e2e` 24/24 PASS（base 闸门现含 7 条 `@a11y` + home/navigation/design 17，验证盲区已闭合）、`pnpm --filter web e2e:a11y` 7/7 PASS（patch 后重跑）。实现期另跑 `e2e:detail` 7/7、`e2e:loop` 10/10、`e2e:search` 18/18 不回归（BackLink/SearchBox/ListContextMemory 字节不变）。

**Follow-up review:** false。5 patch 均为 localized low-severity——1 处真实 CSS 视觉修正（border-radius 聚焦形变）+ 1 处验证闸门修正（@a11y 并入默认 e2e）+ 3 处测试守卫强化（品牌色/chip 范围/序列化容忍）。无 API/数据完整性/安全/架构层变更；全部 fully verified（typecheck/lint/build/base e2e 24/e2e:a11y 7 全绿）；不构成需独立 follow-up 的显著变更。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-3-5.patch`（复核工作 diff，非变更一部分，未提交）。其余残留风险已登记于 deferred-work.md（统一焦点机制、heading 提升、ReactionChip 符号层/aria、follow aria-live、daily ol role、焦点视觉回归自动化、跨浏览器 a11y、标题层级守卫、按面 a11y e2e、grep-invert 可维护性等）。
