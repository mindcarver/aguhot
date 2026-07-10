---
title: '公开页面触控热区与减少动态效果支持 (3.6)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: '0f857be73b8be34f75b0fdb79d4ff1e47f0ede12'
final_revision: '88e3c758c293ac5b46dc88220729895c750de13c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/EXPERIENCE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Verbatim intent (Story 3.6, epics.md):** "As a 市场观察用户, I want 在移动端和低动态偏好场景下获得稳定的交互体验, So that 我不会因为点击困难或多余动效而中断浏览。" AC1: "Given 用户在移动端或启用减少动态效果偏好, When 页面渲染或状态切换, Then 交互热区满足基础触控尺寸, And 非必要动效被关闭或降级为即时切换。" UX floor (EXPERIENCE.md:108-115): "移动端点击热区至少符合常规触控尺寸，避免密集小标签难以点击" + "如果用户启用减少动态效果，所有状态变化应改为即时切换而非淡入淡出"。

**Problem:** 调查（6 面 + 全部共享组件）表明触控热区**大部分已由前序 epic 落地**——nav 链接 / SearchBox input+button / FollowButton 三按钮 / 移动端汉堡 / EventCard / daily·topics·favorites 卡片链接均已 `min-h-11`(44px) 或更大；减少动态方面 nav drawer 即时开关、BackLink/ListContextMemory 滚动用 `behavior:"instant"`——但存在两类真实缺口。(1) **触控热区缺口**：8 处交互控件 < 44px——`FilterPill`（`chips.tsx` pillClass `px-3 py-1 text-sm` 无 min-h，波及 home 筛选 / topics 目录 / search 主题命中 / detail 关联 / `/design` 五面，正是 UX floor 点名的「密集小标签」）；3 处返回链接（detail BackLink、`daily:113`、`topics/[slug]:150`，共享 `inline-flex items-center gap-1 text-sm text-ink-secondary` 约 20px）；4 处空态 CTA（home「查看全部」、favorites「返回首页」「探索主题」、search「返回首页」，`rounded-full px-3 py-1 text-sm` 约 28px）；detail 证据「原文链接 ↗」外链（`text-sm font-medium text-brand` 约 20px）。(2) **减少动态缺口**：`(public)` 仅有一处 CSS transition（`daily/page.tsx:177` `transition-colors hover:bg-surface-muted`，非必要 hover），无 `@keyframes`/`animate-*`，但**无全局 `@media (prefers-reduced-motion: reduce)` 规则**——启用减动效偏好时该 hover 仍 150ms 淡入，且未来新增动效无守卫。

**Approach:** **纯 web 层、零 core/DB/worker/迁移。** ponytail 高 rung、沿用 3.5「一条全局 CSS 规则」模式：(1) **一条全局 `@media (prefers-reduced-motion: reduce)` 规则**（canonical a11y snippet：`*,::before,::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; transition-duration:0.01ms !important; scroll-behavior:auto !important }`）——`!important` 覆盖 Tailwind `transition-colors:150ms` 及内联样式，把 daily hover 与一切未来动效在偏好下降级为即时；仅在 media query 内生效，默认用户零回归。(2) **8 处欠尺寸交互控件各加 `min-h-11`**（44px，既有约定：nav/SearchBox/FollowButton 同 token）——FilterPill pillClass 一处改覆盖五面 + 7 处内联 `<Link>`/`<a>` className 各加一 token；不抽公共 Primitive（8 处分属 3 个样式族 + 证据链，抽组件 = 过抽象，每处一 token 是最短 diff）。(3) `@a11y` e2e：FilterPill 触控高度 ≥ 44px（锚 `/design` DB-free）+ 减动效探针（`reducedMotion:'reduce'` 下注入 150ms transition 探针，断言全局 `* !important` 规则将其降级为近 0，证同机制即降级 daily hover；锚 `/design` DB-free，避开 `/daily` 需 seed）。

## Boundaries & Constraints

**Always:**
- 减动效全局规则（AC1「非必要动效即时切换」）：`globals.css` 末尾追加 `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }`——canonical a11y snippet，`!important` 是必须的（Tailwind `transition-colors` 编译为 `transition-duration:150ms`，specificity 高于普通声明，须 `!important` 覆盖；内联样式同理被 `!important` 覆盖）。仅在 media query 内生效 → 默认用户（无偏好）行为字节不变、daily hover 仍 150ms。`scroll-behavior:auto` 与 BackLink/ListContextMemory 既有 `behavior:"instant"` 一致（防御性，锁未来若加 `scroll-behavior:smooth`）。
- 触控热区（AC1「交互热区满足基础触控尺寸」）：**仅**对 8 处已识别的欠尺寸交互控件加 `min-h-11`——FilterPill pillClass（`chips.tsx`，一处覆盖 home/topics/search/detail/`/design` 五面）、3 处返回链接（detail BackLink 调用方 className、`daily/page.tsx:113`、`topics/[slug]/page.tsx:150`）、4 处空态 CTA（`page.tsx:168`「查看全部」、`favorites/page.tsx:271`「返回首页」+`:277`「探索主题」、`search/page.tsx:136`「返回首页」）、detail 证据「原文链接 ↗」`<a>`（`events/[hotEventId]/page.tsx:378`）。`min-h-11` = 44px，既有约定（nav/SearchBox/FollowButton 同）。`min-h-11` 插入 `items-center` 之后（Tailwind sizing utility 位置约定）。
- SSR/build 安全（不变量延续）：全部改动是 className 加一 token + 一段纯 CSS media query——零 `"use client"`、零 hydration 变化、零路由动态性变化。`pnpm --filter web build`（无 `DATABASE_URL`）仍成功。
- 不变性约定（沿用 1.4~3.5）：camelCase；`import type` 用于类型；无新 `enum`；零新 npm 依赖；零新 sessionStorage key。

**Block If:**
- 改 `globals.css` / `chips.tsx` / 任一 page 致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- 改 `globals.css` / `chips.tsx` / 任一 page 致 `pnpm -r typecheck` / `pnpm -r lint` 回归 → HALT。
- 加 `min-h-11` 致 base `e2e`（home/navigation/design/feed/daily/themes/search/favorites/detail）任一断言回归（如某 spec 断言链接 boundingBox/像素位置/链接计数）→ HALT（须调整 spec selector 跟随，断言意图不变，同 3.4/3.5 模式）。
- 本地 PG `aguhot_dev` 不可达致 `e2e:a11y`（`/` 首屏需请求期 `DATABASE_URL`，同 home.spec）失败 → HALT（不得跳过 e2e）。

**Never:**
- 不加全局 `a { min-height: 44px }` 规则（会破坏内联正文链接 / AGUHOT logo / 布局——触控热区仅适用于交互控件，不适用于正文内联链接；8 处均为交互控件，已逐一识别）。
- 不抽 `PillLink`/`ReturnLink`/`CtaLink` 公共组件（8 处分属 3 样式族 + 证据链，每处仅加一 token；抽组件 = 过抽象，违背 ponytail）。
- 不改 `FilterPill` 视觉样式（仅 `+min-h-11`；颜色/圆角/字号字节不变）。
- 不移除 `daily/page.tsx:177` 的 `transition-colors`（默认用户的合理 hover；减动效由全局 media query 处理，不删动效）。
- 不改 ReactionChip / TagChip / AiLabel（display-only chip，非交互目标，无触控热区要求）。
- 不改 core / prisma / worker / 任何 `@aguhot/core` 导出 / schema / migration（纯 web 层）。
- 不改 operator console（非公开面；同 3.5 仅 `(public)`）。
- 不改 AGUHOT logo 链接触控热区（header 品牌标记，非核心交互；加 44px 会破坏 header `h-16` 布局——defer）。
- 不做 3.5 范围（焦点 / skip-link / 标题层级 / 非颜色语义）——字节不变。
- 不新增 seed 脚本（`@a11y` 用 `/design` DB-free + `/` 同 home.spec 本地 PG，零新 seed）。
- 不改 1.1~3.5 既有 seed / 既有 `@*` spec 断言——**唯一可能例外**：base `e2e` 若有链接 boundingBox/位置类断言被 `min-h-11` 扰动，须跟随调整 selector（断言意图不变）；其余既有 spec 零改动。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| FilterPill 移动端点击（AC1 触控） | 手指点 home 筛选 pill / topics 目录 pill / search 主题 pill / detail 关联 pill | pill 触控热区 ≥ 44px 高（`min-h-11`），点击命中稳定，不再因密集小标签误触 | 无错误预期 |
| 空态 CTA 移动端点击（AC1 触控） | home/favorites/search 空态点「查看全部」/「返回首页」/「探索主题」 | CTA ≥ 44px 高（`min-h-11`），返回路径点击稳定 | 无错误预期 |
| 返回链接 / 证据外链移动端点击（AC1 触控） | detail BackLink / daily 返回 / topics 返回 / detail「原文链接 ↗」 | 链接 ≥ 44px 高（`min-h-11`），点击命中稳定 | 无错误预期 |
| 启用减动效偏好浏览 daily（AC1 减动效） | 系统设 `prefers-reduced-motion: reduce`，hover daily 摘要行 | `transition-colors` 被 media query 降级为即时切换（`transition-duration` ≈ 0），无 150ms 淡入 | 无错误预期 |
| 默认（无减动效偏好）浏览 daily（不回归） | 系统未设减动效偏好，hover daily 摘要行 | 仍 150ms `transition-colors` hover（media query 不生效，字节不变） | 无错误预期 |
| 减动效偏好下未来新增动效（守卫） | 有人后续加 `transition`/`animation` 到 `(public)` 组件 | media query 自动将其在偏好下降级为即时（`* !important` 全局覆盖） | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/globals.css` -- MODIFY（追加一条 media query，既有 `@theme` + 3.5 `:focus-visible` 规则零改动）：文件末尾追加 `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }`。注释点明：Story 3.6 减动效基线——一条全局 media query（canonical a11y snippet），`!important` 覆盖 Tailwind `transition-colors:150ms`（daily hover）及一切未来动效，仅在偏好下生效（默认用户零回归）；与 3.5 全局 `:focus-visible` 同为「一条 CSS 规则铺满全部面」模式。
- `apps/web/app/components/chips.tsx` -- MODIFY：`FilterPill` 的 `pillClass` 由 `"inline-flex items-center rounded-full px-3 py-1 text-sm"` 改为 `"inline-flex items-center min-h-11 rounded-full px-3 py-1 text-sm"`（加 `min-h-11`）。一处改覆盖 home 筛选 / topics 目录 / search 主题命中 / detail 关联 / `/design` 五面（FilterPill 同时渲染为 `<Link>` 与 `<span>`，两形态同 pillClass）。注释补「Story 3.6 — `min-h-11`(44px) 触控热区，UX-DR13『密集小标签』基线」。ReactionChip/TagChip/AiLabel 字节不变（display-only，非交互目标）。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY（两处 className 各加 `min-h-11`）：(1) BackLink 调用方 `className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"` → 加 `min-h-11`（插 `items-center` 后）；(2) 证据「原文链接 ↗」`<a>` `className="inline-flex items-center gap-1 text-sm font-medium text-brand"` → 加 `min-h-11`。href / 文本 / `rel="noopener noreferrer"` / `target="_blank"` 字节不变。
- `apps/web/app/(public)/daily/page.tsx` -- MODIFY：返回链接（`daily:113`「← 返回首页」）`className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"` → 加 `min-h-11`。该页 `transition-colors`（`:177`）**不动**（由 globals.css media query 在偏好下降级）。
- `apps/web/app/(public)/topics/[slug]/page.tsx` -- MODIFY：返回链接（`topics/[slug]:150`「← 返回主题目录」）`className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"` → 加 `min-h-11`。
- `apps/web/app/(public)/page.tsx` -- MODIFY：home 空态 CTA「查看全部」（`:168`）`className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"` → 加 `min-h-11`。
- `apps/web/app/(public)/favorites/page.tsx` -- MODIFY（两处 CTA 各加 `min-h-11`）：(1) 「返回首页」（`:271`）`className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"` → 加 `min-h-11`；(2) 「探索主题」（`:277`）`className="inline-flex items-center rounded-full border border-border-hairline bg-surface-raised px-3 py-1 text-sm text-ink-secondary hover:bg-surface-muted"` → 加 `min-h-11`。
- `apps/web/app/(public)/search/page.tsx` -- MODIFY：无结果 CTA「返回首页」（`:136`）`className="inline-flex items-center rounded-full bg-brand px-3 py-1 text-sm text-brand-foreground"` → 加 `min-h-11`。
- `apps/web/e2e/a11y.spec.ts` -- MODIFY（既有 3.5 `@a11y` describe 之外新增两个 describe，标题均含 `@a11y`）：新增五条测试覆盖全部 6 个矩阵行——(1) **触控热区 FilterPill**（矩阵行 1）：`page.goto("/design")`（DB-free）→ `getByText("全部",{exact:true}).first()` → `boundingBox().height >= 44`。(2) **触控热区 search 空态 CTA**（矩阵行 2）：`page.goto("/search?q=zzznomatch-x1y2z3")`（本地 PG）→ 先断言 no-results 标记 `/未找到与/` 可见 → CTA `boundingBox().height >= 44`。(3) **触控热区 `/daily` 返回链接**（矩阵行 3）：`page.goto("/daily")`（本地 PG，返回链接在 digest ternary 之上无条件渲染）→ 返回链接 `boundingBox().height >= 44`。(4) **默认不回归**（矩阵行 5，默认上下文）：`page.goto("/design")` → 断言 `matchMedia(...).matches === false` → 探针 `<div style="transition:color 150ms ease">` 的 `getComputedStyle.transitionDuration` 解析为 ms 后 `=== 150`（media query 未泄漏到默认上下文）。(5) **减动效**（矩阵行 4/6，`reducedMotion:'reduce'` 上下文 via `test.use({contextOptions:{reducedMotion:"reduce"}})`——Playwright 1.60 须走 `contextOptions` 而非 standalone option）：`page.goto("/design")` → 断言 `matchMedia(...).matches === true` → 同探针的 `transition-duration` 解析为 ms 后 `≤ 1`（证全局 `* !important` 规则在偏好下把任一 transition 降级为即时，同机制即降级 daily hover）。复核 patch：移除原「`≠ "150ms"`」空断言（getComputedStyle 按秒序列化，值永非 `"150ms"`，该断言恒真无意义；`≤ 1ms` 数值断言才是真守卫）。五测试覆盖矩阵行 1/2/3/4/5/6，锚 `/design`（DB-free）+ `/search`+`/daily`（本地 PG，同 home.spec 既有依赖），零新 seed。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 3-6 defer（AGUHOT logo 触控热区；减动效在真实 `/daily` transition 上的 seeded 行为验证——探针证机制、`/daily` 需 seed 故 defer；按面触控热区 e2e 全量 sweep——3.6 仅守 FilterPill 代表性密集标签，逐链接断言 defer；跨浏览器减动效/触控验证——项目 chromium-only 配置）。

## Tasks & Acceptance

**Execution:**
- `apps/web/app/globals.css` -- 追加全局 `@media (prefers-reduced-motion: reduce)` 规则（canonical snippet，`* !important`） -- AC1 减动效基线（一条 CSS 规则降级 daily hover + 守未来，错失 = 偏好下动效不即时/未来无守卫）
- `apps/web/app/components/chips.tsx` -- FilterPill `pillClass` 加 `min-h-11` -- AC1 触控热区（一处覆盖五面，密集小标签基线）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- BackLink 调用方 className + 证据「原文链接」`<a>` className 各加 `min-h-11` -- AC1 触控热区（detail 返回 + 来源外链）
- `apps/web/app/(public)/daily/page.tsx` -- 返回链接 className 加 `min-h-11` -- AC1 触控热区（daily 返回）
- `apps/web/app/(public)/topics/[slug]/page.tsx` -- 返回链接 className 加 `min-h-11` -- AC1 触控热区（主题页返回）
- `apps/web/app/(public)/page.tsx` -- home 空态 CTA「查看全部」className 加 `min-h-11` -- AC1 触控热区（空态返回路径）
- `apps/web/app/(public)/favorites/page.tsx` -- 两处空态 CTA className 各加 `min-h-11` -- AC1 触控热区（空态返回路径）
- `apps/web/app/(public)/search/page.tsx` -- 无结果 CTA「返回首页」className 加 `min-h-11` -- AC1 触控热区（无结果返回路径）
- `apps/web/e2e/a11y.spec.ts` -- 新增 `@a11y` 触控热区测试（FilterPill `/design` ≥ 44px）+ 减动效测试（`reducedMotion:'reduce'` 探针 transition-duration 近 0） -- AC1 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 3-6 defer 项 -- 诚实登记 logo 触控 / seeded daily 减动效 / 按面触控 sweep / 跨浏览器

**Acceptance Criteria:**
- Given 读者在移动端点击 home 筛选 pill / topics 目录 pill / search 主题命中 pill / detail 关联 pill，When 触控该 FilterPill，Then 其渲染高度 ≥ 44px（`min-h-11`，AC1 触控热区，FilterPill `<Link>` 与 `<span>` 两形态同源 pillClass）。
- Given 读者在移动端点击 home/favorites/search 空态 CTA 或 daily/topics 返回链接或 detail BackLink 或 detail「原文链接 ↗」，When 触控该链接，Then 其渲染高度 ≥ 44px（`min-h-11`，AC1 触控热区，8 处欠尺寸交互控件均达标）。
- Given 读者系统启用 `prefers-reduced-motion: reduce`，When hover daily 摘要行（`transition-colors`），Then `transition-duration` 被降级为近 0（即时切换，非 150ms 淡入，AC1 减动效）；And 默认（无偏好）用户 hover 仍 150ms（不回归）。
- Given 启用减动效偏好后有人新增 `transition`/`animation` 到任一 `(public)` 组件，When 该偏好用户浏览，Then 新动效被 media query 自动降级为即时（`* !important` 全局覆盖，AC1 减动效守卫）。
- When 执行 `pnpm -r typecheck` / `pnpm -r lint`，Then 通过；And `pnpm --filter web build`（无 `DATABASE_URL`）成功（纯 className + CSS media query，SSR 安全）；And `pnpm --filter web e2e:a11y` 全过（既有 7 条 3.5 + 5 新 3.6）；And `pnpm --filter web e2e`（base 闸门 home/navigation/design/feed/daily/themes/search/favorites/detail）不回归（`min-h-11` + media query 不破坏既有断言；若有 boundingBox/位置类断言被扰动则跟随调整 selector，断言意图不变）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (low 3)
- defer: 3: (low 3) — 均已在实现期登记于 deferred-work.md（按面触控 sweep / seeded daily 减动效 / 跨浏览器），本轮无新条目（重复）
- reject: 16
- addressed_findings:
  - `[low]` `[patch]` **减动效探针的 `not.toBe("150ms")` 断言恒真无意义**（`a11y.spec.ts` 减动效测试）：`getComputedStyle` 按秒序列化时间，150ms 返回 `"0.15s"`、规则的 0.01ms 返回如 `"0.00001s"`，值永非 `"150ms"`——该 `not.toBe("150ms")` 恒通过、证无物。修复：移除该空断言，仅保留 `≤ 1ms` 数值断言（真守卫）；同步更新注释说明秒序列化 + `!important` 覆盖内联/类规则的同机制（内联探针是更强测试：`!important` author 胜 normal 内联，内联胜 normal 类，故 `!important` author 胜 normal 类—— transitively 证 daily `transition-colors` 类规则亦被覆盖）。纯测试改动，重跑 e2e:a11y 12/12 全绿。
  - `[low]` `[patch]` **`/search?q=zzznomatch` CTA 测试在 DB 碰撞/CTA 缺失时失败信号不清**（`a11y.spec.ts` 矩阵行 2 测试）：原测试直接 `getByRole("link",{name:/返回首页/})`，若 dev DB 恰含 "zzznomatch" 命中行（CTA 不渲）或 PG 不可达，locator 超时/`boundingBox()` 返 null 抛 TypeError，失败信号与触控回归混淆。修复：先用更唯一的 gibberish `zzznomatch-x1y2z3` + 断言 no-results 标记 `/未找到与/` 可见（证空态渲染）再量 CTA 高度——失败信号区分「DB 状态问题」与「触控回归」。纯测试改动。
  - `[low]` `[patch]` **spec Code Map/Verification 漏记测试数**（spec 文档）：原 Code Map 写「新增两条测试」，但矩阵审计（step-03）为覆盖 6 个矩阵行加了 3 条（search CTA / daily 返回链接 / 默认不回归），实际 5 条。修复：更新 Code Map a11y 条目 + Verification `e2e:a11y` 行 + Acceptance Criteria 反映「既有 7 + 5 新」并枚举覆盖的矩阵行。纯文档精度修正。
  - 3 项 defer 复核再 surface，均已在实现期登记（无新条目）：(a) 8 处触控热区中 5 处无逐链接高度断言（FilterPill/search CTA/daily 返回 3 处为代表，矩阵行 1/2/3 已覆盖；home CTA/favorites×2/topics 返回/detail BackLink/证据外链 5 处逐链接断言 defer——「按面触控 sweep」已登记）；(b) 减动效探针为间接证明（未在真实 `/daily` seeded 摘要行直接断言 transition-duration 降级——「seeded daily 减动效验证」已登记）；(c) 跨浏览器（chromium-only，`transition-duration` 序列化/`!important` 优先级跨引擎差异——「跨浏览器减动效/触控验证」已登记，项目级同 3.5）。
  - 16 项 reject 丢弃：adversarial #3（daily 注释「UNCONDITIONALLY」——上下文准确，指不论 digest 状态均渲染，DB 依赖由 Block If + status 200 断言覆盖）；adversarial #5（探针未证类规则覆盖——事实错误，`!important` author 经内联 transitively 覆盖 normal 类规则，内联探针是更强测试，且 Tailwind 不用 `!important`）；adversarial #6（`toBe(150)` 对 Tailwind token 脆——探针硬编码 150ms、`toBe(150)` 自洽，daily 类是另一已 defer 关注点）；adversarial #7（`scroll-behavior:auto` 影响滚动容器——正确 a11y 行为，canonical app-wide，文档细节非缺陷）；adversarial #8（`animation-iteration-count:1` 闪烁——canonical snippet 权衡，无现存动画，假设性）；edge-case #1（`getByText("全部")` 非唯一——已核实 `/design` 仅 1 处「全部」）；edge-case #3（`getByRole("返回首页")` 命中 nav——已核实 nav 是「首页」非「返回首页」）；edge-case #5（全局 `*` 波及 operator console——canonical app-wide a11y，operator 亦受益，零 console 文件改动，作用域化 = 过工程 + 剥夺 a11y 收益）；edge-case #6（home CTA 未验证——矩阵行 2 由 search CTA 代表覆盖，逐面 sweep 已 defer）；edge-case #7（FilterPill flex-wrap 无 items-center——同行全为 44px pill 无矮兄弟，无错位）；edge-case #8（`boundingBox()` null 无 visibility guard——fragile 的 /search 已由 patch B 覆盖，FilterPill/daily 锚点可靠）；edge-case #9（证据 `<a>` `py-4`+`min-h-11` 行高增长——AC 要求 44px 触控的预期取舍，`py-1` 冗余但无害）；edge-case #10（触控测试未断 reducedMotion unset——同 describe 的默认不回归测试已断 `matchMedia===false`，`test.use` 不跨 describe 泄漏）；edge-case #11（`iteration-count:1` 冻结未来 spinner——同 adversarial #8 假设性）；edge-case #12（favorites 双 CTA flex-wrap 无 items-center——两 CTA 均 44px 无错位）；verification-gap（/search DB 依赖——@a11y 套件既有依赖，Block If 覆盖，patch B 改进诊断）；intent-alignment（纯描述性，确认 Reading A 忠实实现，所有偏离均为已登记 defer 或可辩护替换，无 intent_gap）。
- verification_note: 3 patch 后重跑 `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web e2e:a11y` 12/12 PASS（既有 7 + 5 新）、`pnpm --filter web e2e` 29/29 PASS（base 闸门不回归）。intent-alignment 确认 diff 忠实实现 Reading A（关 8 处触控热区真实缺口 + 1 条全局减动效规则；代表性地验证矩阵 6 行，逐面 sweep / seeded daily / 跨浏览器 defer 已诚实登记）。follow-up review：false——3 patch 均为 localized low-severity（1 处真测试正确性[空断言] + 1 处测试鲁棒性[失败信号] + 1 处 spec 文档精度），无 API/数据/安全/架构层变更，全部 fully verified。

## Design Notes

**为何「一条全局 `@media (prefers-reduced-motion: reduce)` 规则」而非逐组件处理：** `(public)` 仅 daily 一处 CSS transition（非必要 hover），但减动效 AC 是跨面不变量。候选：(1) 仅移除 daily `transition-colors`——丢默认用户的合理 hover，且未来新增动效无守卫；(2) 逐组件加 `motion-reduce:transition-none`——波及多面、大 diff、漏改即破；(3) **一条全局 media query（canonical a11y snippet，`* !important`）**——CSS 优于 JS（ladder rung 3），一行覆盖 daily hover + 一切未来 transition/animation，仅在偏好下生效（默认零回归）。`!important` 是必须的：Tailwind `transition-colors` 编译为 `transition-duration:150ms`（specificity 高于普通声明），须 `!important` 覆盖；内联样式同理。沿用 3.5「一条全局 CSS 规则铺满全部面」模式（焦点规则 → 减动效规则），一致性。canonical snippet（`animation-duration:0.01ms`/`iteration-count:1`/`transition-duration:0.01ms`/`scroll-behavior:auto`）是 a11y 社区公认形态，复核可识别。

**为何 `min-h-11` 逐元素加而非全局 `a { min-height:44px }`：** 触控热区仅适用于**交互控件**（返回链接 / CTA / 筛选 pill / 来源外链），不适用于正文内联链接 / logo / 布局。全局 `a {min-height}` 会破坏 AGUHOT logo（header `h-16` 内 `text-lg`）、未来正文内联链接、布局。故逐元素识别 8 处欠尺寸交互控件、各加 `min-h-11`（44px，既有约定：nav/SearchBox/FollowButton 同 token）。8 处分属 3 样式族（FilterPill `rounded-full px-3 py-1`、返回链接 `gap-1 text-sm text-ink-secondary`、CTA `rounded-full bg-brand px-3 py-1`）+ 证据链——不抽公共 Primitive（每处仅加一 token，抽组件 = 过抽象，违背 ponytail）。`min-h-11` 在 `inline-flex items-center` 元素上生效（flex 容器适用 min-height），文本垂直居中，44px 高的 pill/链接符合触控基线。

**为何减动效 e2e 用探针而非测真实 `/daily` transition：** `/daily` 是 `(public)` 唯一含 CSS transition 的面，但 `@a11y` 套件在 base `e2e` 闸门跑（无 `seed-daily` 前置），`/daily` 摘要行依赖 digest 数据，空态无 transition li 可断言。探针在 `/design`（DB-free）注入 `<div style="transition:color 150ms ease">`，断言 `getComputedStyle.transitionDuration` 被全局 `* !important` 规则降级为近 0——证「media query 在偏好下把任一 transition 降级为即时」的机制，即降级 daily hover 的同一机制。surface-anchored（证 CSS 行为）+ DB-free（避 seed 依赖）+ 诚实（不伪造 `/daily` seeded 验证；seeded 行为 defer）。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（globals.css CSS only、chips.tsx + 7 page className 一 token、a11y.spec 新增 + tsconfig.e2e）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（纯 className + CSS media query，零路由动态性变化）
- `pnpm --filter web e2e:a11y` -- expected: `@a11y` 全过（既有 7 条 3.5 + 5 新 3.6：FilterPill/search CTA/`/daily` 返回链接触控高度 ≥ 44px + 默认不回归探针 150ms + 减动效探针 ≤ 1ms + matchMedia 偏好生效）
- `pnpm --filter web e2e` -- expected: base 闸门不回归（home/navigation/design/feed/daily/themes/search/favorites/detail；`min-h-11` 改变链接高度但不断言像素位置，若某 spec 断言 boundingBox/位置被扰动则跟随调整 selector，断言意图不变）

**Manual checks (if no CLI):**
- `/design`：FilterPill「全部」/「市场反应」样本高度 ≥ 44px（移动端触控尺寸）。
- 移动端视口下 home 筛选 pill 行、daily/topics 返回链接、favorites/search 空态 CTA、detail BackLink 与「原文链接 ↗」：各链接高度 ≥ 44px，点击命中稳定。
- 系统启用「减少动态效果」后 hover daily 摘要行：背景即时切换，无 150ms 淡入；默认偏好下 hover 仍 150ms（不回归）。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 3 story 3.6 公开页面触控热区与减少动态效果支持——纯 web 层（零 core/DB/worker/迁移）。调查（6 面 + 全部共享组件）表明触控热区大部分已由前序 epic 落地（nav/SearchBox/FollowButton/汉堡/EventCard/卡片链接均 `min-h-11` 或更大；nav drawer 即时开关、BackLink/ListContextMemory 滚动 `behavior:"instant"`），3.6 的净增量是关两类真实缺口：(a) **8 处欠尺寸交互控件各加 `min-h-11`（44px）**——FilterPill pillClass（一处覆盖 home/topics/search/detail/`/design` 五面，UX-DR13 点名的「密集小标签」）+ 3 处返回链接（detail BackLink 调用方、daily、topics/[slug]）+ 4 处空态 CTA（home「查看全部」、favorites×2、search）+ detail 证据「原文链接 ↗」外链；(b) **一条全局 `@media (prefers-reduced-motion: reduce)` 规则**（canonical a11y snippet，`*,::before,::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; transition-duration:0.01ms !important; scroll-behavior:auto !important }`）——`!important` 覆盖 Tailwind `transition-colors:150ms`（daily hover）及一切未来动效，仅在偏好下生效（默认零回归），沿用 3.5「一条全局 CSS 规则铺满全部面」模式。`@a11y` e2e 守卫覆盖全部 6 个矩阵行：FilterPill/search CTA/`/daily` 返回链接触控高度 ≥ 44px + 默认不回归探针（150ms）+ 减动效探针（≤ 1ms）。

**Files changed:**
- `apps/web/app/globals.css` — 追加全局 `@media (prefers-reduced-motion: reduce)` 规则（canonical snippet，`* !important`，仅在偏好下生效；`!important` 覆盖 Tailwind `transition-colors:150ms` + 内联/类规则）。
- `apps/web/components/chips.tsx` — FilterPill `pillClass` 加 `min-h-11`（一处覆盖五面，`<Link>`/`<span>` 两形态同源）；JSDoc 补 3.6 触控热区说明。ReactionChip/TagChip/AiLabel 字节不变（display-only 非交互）。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` — BackLink 调用方 className + 证据「原文链接 ↗」`<a>` className 各加 `min-h-11`。
- `apps/web/app/(public)/daily/page.tsx` — 返回链接 className 加 `min-h-11`（`transition-colors` 不动，由 media query 在偏好下降级）。
- `apps/web/app/(public)/topics/[slug]/page.tsx` — 返回链接 className 加 `min-h-11`。
- `apps/web/app/(public)/page.tsx` — home 空态 CTA「查看全部」className 加 `min-h-11`。
- `apps/web/app/(public)/favorites/page.tsx` — 两处空态 CTA（「返回首页」+「探索主题」）className 各加 `min-h-11`。
- `apps/web/app/(public)/search/page.tsx` — 无结果 CTA「返回首页」className 加 `min-h-11`。
- `apps/web/e2e/a11y.spec.ts` — 新增 2 个 `@a11y` describe、5 条测试覆盖 6 矩阵行：FilterPill 触控高度（`/design`）+ search 空态 CTA 触控高度（`/search?q=zzznomatch-x1y2z3`，先断 no-results 标记）+ `/daily` 返回链接触控高度 + 默认不回归探针（150ms）+ 减动效探针（`reducedMotion:'reduce'` via `contextOptions`，≤ 1ms）。复核 patch：移除空 `not.toBe("150ms")` 断言（getComputedStyle 按秒序列化，恒真）+ search CTA 测试加 no-results 标记断言与更唯一 gibberish（失败信号区分 DB 状态与触控回归）。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 3-6 实现期 4 项 defer（AGUHOT logo 触控热区 / seeded daily 减动效直接验证 / 按面触控 e2e sweep / 跨浏览器减动效·触控验证）。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0（intent-alignment 确认 diff 忠实实现 Reading A：关 8 处触控 + 1 条全局减动效规则，代表性地验证矩阵 6 行，逐面 sweep / seeded daily / 跨浏览器 defer 已诚实登记）。patch 3（low 3：减动效探针空 `not.toBe("150ms")` 断言移除[getComputedStyle 按秒序列化恒真] + search CTA 测试加 no-results 标记断言与更唯一 gibberish[失败信号区分] + spec Code Map/Verification 漏记测试数[2→5]）。defer 3（均已在实现期登记，无新条目：按面触控 sweep / seeded daily 减动效 / 跨浏览器）。reject 16（探针未证类规则[事实错误，`!important` author 经内联 transitively 覆盖 normal 类]、`getByText("全部")` 非唯一[已核实仅 1 处]、nav 含「返回首页」[已核实是「首页」]、全局 `*` 波及 console[canonical app-wide a11y operator 亦受益]、FilterPill flex-wrap 无 items-center[同行全 44px 无错位]、evidence `py-4`+`min-h-11` 行高增长[AC 预期取舍]、`scroll-behavior`/`iteration-count` 文档细节[canonical 行为正确]、daily 注释「UNCONDITIONALLY」[上下文准确]、`toBe(150)` 脆[探针自洽]、home CTA 未验证[矩阵行 2 由 search 代表]、`boundingBox` null guard[patch B 覆盖 fragile case]、触控测试未断 reducedMotion unset[同 describe 默认不回归测试已断]、favorites CTA flex-wrap[两 CTA 均 44px]、`/search` DB 依赖[既有依赖 Block If 覆盖]、`iteration-count` 未来 spinner[假设性]、intent-alignment 纯描述[无 prescription]）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 `DATABASE_URL`）PASS（纯 className + CSS media query，零路由动态性变化）、`pnpm --filter web e2e:a11y` 12/12 PASS（既有 7 条 3.5 + 5 新 3.6，patch 后重跑）、`pnpm --filter web e2e` 29/29 PASS（base 闸门 home/navigation/design + 12 `@a11y` 不回归）。

**Follow-up review:** false。3 patch 均为 localized low-severity（1 处真测试正确性[空断言移除] + 1 处测试鲁棒性[失败信号区分] + 1 处 spec 文档精度[测试数]），无 API/数据完整性/安全/架构层变更；全部 fully verified（typecheck/lint/build/e2e:a11y 12/base e2e 29 全绿）；不构成需独立 follow-up 的显著变更。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-3-6.patch`（复核工作 diff，非变更一部分，未提交）。其余残留风险已登记于 deferred-work.md（AGUHOT logo 触控、seeded daily 减动效直接验证、按面触控 e2e sweep、跨浏览器减动效/触控验证）。
