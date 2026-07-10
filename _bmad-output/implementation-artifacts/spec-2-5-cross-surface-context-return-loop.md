---
title: '跨首页、主题页、日报与详情页的主线浏览闭环 (2.5)'
type: 'feature'
created: '2026-07-11'
status: 'done'
baseline_revision: 'e5fb4d6ff6e8637710d5ff5678881247a1f8326f'
final_revision: '97384790eed8505cbcf20bafbb5bede3edab10ad'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-daily-digest-generation-and-reading.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 2 的「主线浏览闭环」结构上已通——首页卡→详情、详情→主题、主题→详情、日报→详情四向跳转链已在 1.7/1.8/2.2/2.3/2.4 全部落地且无死链。但 UX-DR12（epic-2-context「Return paths must preserve reading context … restores filter state and scroll position rather than always falling back to the homepage top」「Navigation depth is capped at one level」）**完全未落地**：详情页（`events/[hotEventId]/page.tsx:127-132`）、日报页（`daily/page.tsx:109-115`）、主题页（`topics/[slug]/page.tsx:128-133`）的三处「返回」链均为**裸根路径**（`href="/"` / `href="/topics"`），点击即丢 `?window=`/`?date=`/`?concept=` 过滤态 + 丢滚动位、回到列表顶部；代码内三处注释自标「originating-context retention is 2.5 / full UX-DR12 scroll/filter context restoration is 2.5」。全仓零恢复基建：无 sessionStorage、无 scroll 捕获、无 `useSearchParams`、无 `Link scroll={false}`、无 history.state。读者从「7 日窗口第 5 屏的第 3 个事件」读完详情点返回，落到「全部窗口、顶部第 1 屏」——阅读上下文断裂，这是 epic 列明的 Epic-2 defect。

**Approach:** **纯前端、零 core/DB/worker 改动。** 在 `(public)/layout.tsx` 挂一个 client 组件 `<ListContextMemory/>`：在 `document` 上注册**单个捕获期 click 监听**——当被点的 `<a>` 目标解析为 `/events/{id}`（详情）时，把「当前列表 URL（pathname+search）+ 当前 `window.scrollY`」写进 `sessionStorage`（`RETURN_CONTEXT_KEY` + `scrollKey(href)`）。详情页把裸「返回首页」`<Link href="/">` 换成 client 组件 `<BackLink fallback="/">`：mount 时读 `RETURN_CONTEXT_KEY`，经 `isValidListReturn`（同源 + 公开列表路由前缀 allowlist `/`/`/topics/`/`/daily`，拒 `//evil`/`https://`/`/console`）校验→渲染该 href，否则 fallback `/`；onClick 把该 href 写进 `RESTORE_MARKER_KEY`。`<ListContextMemory/>` 经 `usePathname` 检测到达列表路由时，若 `RESTORE_MARKER_KEY === 当前 pathname+search`，则读 `scrollKey`、`window.scrollTo({top, behavior:"instant"})`、清 marker+scroll（一次性，刷新/直访无 marker→no-op，不错误跳转）。**正向跳转 href 字节不变**（首页卡 / 主题成员 / 日报条目链仍为 `/events/{id}`）→ 既有 1.7~2.4 e2e 全绿零改动。ponytail：一个布局级 client 组件 + 一个 BackLink 守详情返回，无 per-link 包装、无 URL `?from=` 污染、无服务端状态；深度上限一层（UX-DR12）天然满足——只捕获「列表→详情」一跳的上下文。详情「返回」语义统一：从哪来回哪去（home `/?window=` / theme `/topics/{slug}` / daily `/daily?date=`），直访/外链无上下文→诚实回首页顶部 fallback。

## Boundaries & Constraints

**Always:**
- UX-DR12 闭环恢复（AC1/AC2/AC3）：从 `/?window=…` / `/?concept=…` / `/topics/{slug}` / `/daily?date=…` 任一列表进入详情后点「返回」，必须回到**该来源列表的完整 URL（含其 query）**且 **scroll 位恢复**，不落到首页/列表顶部。来源由 sessionStorage `RETURN_CONTEXT_KEY` 决定（点击详情链那一刻的 `location.pathname+search`）。
- 正向跳转链**不改**（AC4 不回归）：`event-card.tsx` 卡片链 `/events/{hotEventId}`、主题成员链、日报条目链保持原 href（字节不变）；捕获靠布局级**单一 document 捕获期 click 监听**自动覆盖所有详情跳转入口，不包装任何 `<Link>`。
- 开放重定向守卫（信任边界，AC6，**不可简化**）：`isValidListReturn(raw)` 用 `new URL(raw, "http://localhost")` 解析——`url.origin !== "http://localhost"` → 拒（拦 `https://evil`、`//evil.com` 协议相对、完整外链）；`url.pathname` 必须精确为 `/` 或 `/daily`、或以 `/topics/` 起头；其余（`/console`、`/events/…`、`/favorites` 等）一律拒；search 任意。BackLink 只渲染校验通过的 href，否则 fallback。篡改的/越权的 returnContext 永不产生站外跳转。
- 一次性 scroll 恢复（AC3/AC5）：恢复**仅**在「从详情返回」时触发——`RESTORE_MARKER_KEY` 由 BackLink onClick 写入（值=来源 href），`<ListContextMemory/>` 到达列表路由且 marker===当前 pathname+search 时恢复并**立即清除** marker+scrollKey。刷新列表页/直访/首次进入（无 marker）→ no-op，绝不把上一会话的旧 scroll 强加给新加载（避免「刷新后乱跳」regression）。
- 深度上限一层（UX-DR12/AC1）：只捕获「列表→详情」一跳；详情→详情（如无）、列表→列表（nav 切换）不捕获/不恢复（nav 为全局导航，非阅读上下文返回）。捕获监听只在目标为 `/events/` 时写上下文，其余点击 no-op。
- SSR 安全（build 不变量延续 1.6~2.4）：`<ListContextMemory/>` 与 `<BackLink/>` 均 `"use client"`，仅用 `useEffect`/`useLayoutEffect` 触碰 `window`/`sessionStorage`/`document`；服务端渲染期 fromHref=null → BackLink 初渲 `href={fallback}`（与今日裸 `/` 一致，既有 detail.spec 断言保持绿）。`next build` 无 `DATABASE_URL` 仍成功（本 story 不动任何 `@aguhot/core` import 或路由动态性；`(public)/layout.tsx` 仍不 import core）。
- a11y（UX-DR13，AC7）：BackLink 渲染为真实 `<a href>`（非 JS button），键盘可达、可 focus、可中键新开；scroll 恢复用 `behavior:"instant"`（reduced-motion 下等同瞬切，无动画；UX-DR15 禁 attention-grabbing animation 一致）。返回链文案不变（「← 返回首页」/主题页「← 返回主题目录」/日报「← 返回首页」）。
- 降级与隐私模式（NFR 一致）：`sessionStorage` 不可用（隐私模式/禁用）或 `window`/`document` 缺失→所有读写包 `try/catch` 静默 no-op；BackLink 回退 fallback `/`；读者仍可浏览，仅无上下文恢复（absence as absence，不抛错不崩）。
- token 安全：BackLink 复用既有返回链样式（`inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary`），真实解析 token，无新增视觉/间距改动。`<ListContextMemory/>` 渲染 `null`（零 UI、零布局影响）。
- 不变性约定（沿用 1.4~2.4）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；相对导入带 `.js`；camelCase 命名；常量 key（`RETURN_CONTEXT_KEY="aguhot:returnContext"` 等）集中定义在 `list-context-memory.tsx` 顶部 `as const`，BackLink 从该模块 import（单一来源，避免两文件镜像字符串）。

**Block If:**
- 新增 client 组件致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- 新增致 `pnpm -r typecheck`/`pnpm -r lint` 回归 → HALT。
- 本地 PG `aguhot_dev` 不可达致 `seed-loop` 造数失败 → HALT（不得跳过 e2e）。

**Never:**
- 不改任何正向跳转链的 href（首页卡 / 主题成员 / 日报条目 / 关联 pill / 主题 pill 保持字节不变；捕获靠 document 监听，非 per-link 包装）。**不**给详情链加 `?from=` 查询参（避免污染可分享的详情 URL + 破坏既有 href 断言）。
- 不改 1.6~2.4 既有 verify/seed/spec 断言（console/feed/home/navigation/detail/revision/merge-split/market-reaction/associations/themes/daily seed/spec 零改动保持绿；本 story 仅新增 `@loop` seed/spec + `e2e:loop` 脚本 + `e2e` grep-invert 追加 `@loop`）。**不**改既有「返回」链文案/位置/样式（仅把裸 `<Link>` 换成 `<BackLink>`，fallback 与原 href 一致）。
- 不做 nav 级跨列表上下文（经主图 nav 在 home↔daily↔topics 间切换时的上下文恢复——nav 为全局导航非阅读返回，UX-DR12 不要求；defer）。不做详情→关联 pill 前向跳转的 `?window=` 保留（前向探索跳转，非 UX-DR12 返回路径；今日 pill `/?concept=X` 丢 window 是已知 context-leak，记 defer，不在本 story 扩面）。
- 不做多级返回栈 / 面包屑 / «前进» 恢复（UX-DR12 深度上限一层；超过一层的返回历史 defer）。不做跨会话 scroll 持久化（sessionStorage 会话级足矣；localStorage 跨会话 defer）。
- 不改 core / prisma / worker / 任何 `@aguhot/core` 导出（本 story 纯 web 层）。不改 `packages/config/src/env.ts`。不改 `(public)/layout.tsx` 之外的路由结构。不在 `(public)/layout.tsx` 引入 `@aguhot/core` import（保持静态公共壳 build 无 DB）。
- 不引入新依赖（无 router 库 / state 库 / scroll-restore 库；纯 React + Next + 浏览器 API）。不引入 Context Provider / Redux / Zustand（sessionStorage + 两组件足矣，ponytail）。
- 不把 BackLink 用于非详情页（日报页/主题页自身的「返回」链保持裸 `<Link href="/">` / `<Link href="/topics">` 不变——它们是列表→列表/列表→目录的次级导航，非 UX-DR12 详情返回；其代码注释更新为指向「详情返回为 2.5 落地点」避免误导）。
- 不做 epic-3 搜索入口返回（`/search` 路由未落地；`isValidListReturn` allowlist 暂不含 `/search`，待 epic-3 落地时扩；defer）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 捕获：列表→详情写上下文（AC1） | 用户在 `/?window=7d` scrollY=1200，点事件卡 `<a href="/events/{id}">` | document 捕获期监听命中（目标解析为 `/events/`）→ `sessionStorage[RETURN_CONTEXT_KEY]="/?window=7d"`、`sessionStorage[scrollKey("/?window=7d")]="1200"`，随后 Next 完成详情导航 | 无错误预期 |
| 返回：恢复 query（AC2） | 详情页 BackLink mount、`RETURN_CONTEXT_KEY="/?window=7d"` 且校验通过 | BackLink 渲染 `href="/?window=7d"`（非裸 `/`）；点击→导航至 `/?window=7d`；onClick 写 `RESTORE_MARKER_KEY="/?window=7d"` | 无错误预期 |
| 返回：恢复 scroll（AC3） | 上述点击后落回 `/?window=7d`，`<ListContextMemory/>` usePathname 触发 | marker===`/?window=7d`→读 `scrollKey`→`window.scrollTo({top:1200,behavior:"instant"})`→清 marker+scrollKey；scrollY≈1200 | 无错误预期 |
| 主题成员返回（AC2/AC3） | 从 `/topics/{slug}`（无 search）scrollY=800 进入成员详情→点返回 | BackLink href=`/topics/{slug}`；返回后 scrollY≈800 恢复 | 无错误预期 |
| 日报条目返回（AC2/AC3） | 从 `/daily?date=2026-07-11` scrollY=600 进入条目详情→点返回 | BackLink href=`/daily?date=2026-07-11`；返回后 scrollY≈600 恢复 | 无错误预期 |
| 直访/外链无上下文→fallback（AC4） | 直接 `GET /events/{id}`（无 RETURN_CONTEXT 或来源为本站详情/非列表），BackLink mount | `RETURN_CONTEXT` 缺失/校验失败→渲染 `href="/"`（fallback）；点击回首页顶部（无 marker→不恢复 scroll） | 无错误预期 |
| 开放重定向守卫（AC6） | `RETURN_CONTEXT` 被改写为 `https://evil.com` / `//evil.com` / `/console/123` / `/events/other` | `isValidListReturn` 全拒（origin≠localhost / pathname 非 allowlist）→BackLink href=fallback `/`；**不**产生站外/operator 跳转 | 静默回退（不抛错） |
| 刷新/直访列表不误跳（AC5） | 用户刷新 `/?window=7d`（非从详情返回，RESTORE_MARKER 缺） | `<ListContextMemory/>` marker 不匹配→no-op，scrollY 保持 0（顶部），**不**跳到旧 1200 | 无错误预期 |
| 一次性 marker（AC3） | 返回恢复后再次刷新该列表 | marker 已清→no-op，scrollY 保持当前（不重复跳） | 无错误预期 |
| sessionStorage 禁用/隐私模式（NFR） | `sessionStorage.setItem` 抛错（禁用）/ `window` 缺失 | 所有读写 `try/catch` 静默 no-op；BackLink 回退 `/`；页面正常渲染浏览 | 静默降级 |
| SSR 初渲（build 不变量） | 服务端渲染详情页（无 window） | BackLink 初态 fromHref=null→渲染 `<a href="/">`（=fallback，与今日一致）；hydrate 后 useEffect 读 storage 更新 | 无错误预期 |
| 点非详情链（nav/feed-pill/外链） | 点 nav「日报」/ feed `?window=` pill / 证据外链 | 捕获监听目标非 `/events/`→no-op，不写上下文（不污染） | 无错误预期 |
| 深度超一层（列表→详情→他处→返回） | 详情页再点主题 pill→主题页→成员→详情（多层） | 只捕获最近一跳「列表→详情」上下文；返回仅回上一层列表（UX-DR12 一层上限，多层栈 defer） | 无错误预期 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/list-context-memory.tsx` -- NEW（`"use client"`，渲染 `null`）：顶部 `as const` 定义 `RETURN_CONTEXT_KEY="aguhot:returnContext"`、`RESTORE_MARKER_KEY="aguhot:restoreMarker"`、`SCROLL_KEY_PREFIX="aguhot:scroll:"`、`LIST_PATH_PREFIXES=["/topics/"] as const`、`LIST_PATH_EXACT=["/","/daily"] as const`。导出纯函数 `scrollKey(href:string): string`（`SCROLL_KEY_PREFIX+href`）、`isValidListReturn(raw:string|null|undefined): boolean`（`new URL(raw,"http://localhost")`→`origin==="http://localhost"` 且 pathname∈exact 或 startsWith 某 prefix；raw 空/抛错→false）、`readReturnContext(): string|null`、`writeReturnContext(href)`、`writeScroll(href,y)`、`readScroll(href)`、`clearRestore(href)`、`clearScroll(href)`——全部 `try/catch` 包 sessionStorage 读写（隐私模式 no-op）。组件主体：`useEffect` 注册**单个** `document.addEventListener("click", handler, true)`（捕获期），handler 沿 `e.target` 向上找最近 `<a>`（`closest("a")`），`new URL(a.href, location.origin)` 若 `pathname.startsWith("/events/")`→写 `RETURN_CONTEXT=location.pathname+location.search` + `writeScroll(that, window.scrollY)`；cleanup 移除监听。`useLayoutEffect`（依赖 `usePathname()` 返回值）：若当前 pathname 命中列表路由 且 `RESTORE_MARKER===pathname+search`→`readScroll`→`window.scrollTo({top,behavior:"instant"})`→`clearRestore`+`clearScroll`。注释说明「单监听覆盖全公开站详情跳转入口；正向 href 不改；一次性 marker 防刷新误跳」。
- `apps/web/app/(public)/_components/back-link.tsx` -- NEW（`"use client"`）：`export function BackLink({ fallback, children, className }: { fallback: string; children: React.ReactNode; className?: string })`。`useState<string|null>(null)` + `useEffect`：`readReturnContext()` 经 `isValidListReturn` 校验→`setFromHref(ctx)`。渲染 `<Link href={fromHref ?? fallback} className={className} onClick={() => { if (fromHref) writeRestoreMarker(fromHref); }}>`。SSR/初渲 fromHref=null→`href={fallback}`（与既有裸 `/` 一致）。注释说明「详情返回唯一入口；fallback 保证直访/无上下文回首页顶部；onClick 写 marker 触发来源列表的 scroll 恢复」。从 `./list-context-memory.js` import `readReturnContext`/`isValidListReturn`/`RESTORE_MARKER_KEY`/`writeRestoreMarker`（单一 key 来源）。
- `apps/web/app/(public)/layout.tsx` -- MODIFY：import `ListContextMemory` from `./_components/list-context-memory.js`，在 `<main>` 内 `{children}` 之前或之后渲染 `<ListContextMemory/>`（渲染 null，零布局影响）。**不**新增 `@aguhot/core` import（保持壳静态、build 无 DB）。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY：删除 `import Link from "next/link"` 中用于返回链的用法（保留证据外链 `<a>` 不变；若 Link 仅返回链用则移除 import）。把 126-132 行的 `<Link href="/" …>← 返回首页</Link>` 替换为 `<BackLink fallback="/" className="inline-flex items-center gap-1 text-sm text-ink-secondary hover:text-ink-primary"><span aria-hidden>←</span> 返回首页</BackLink>`，import `BackLink` from `../../_components/back-link.js`（相对路径按既有惯例）。更新 126 行注释为「Detail return path — UX-DR12 reading-context restoration (Story 2.5); BackLink restores originating list URL + scroll via sessionStorage.」。其余六分区/证据/反应/关联/主题零改动。
- `apps/web/app/(public)/daily/page.tsx` -- MODIFY（仅注释）：109 行注释更新为「日报→首页为次级导航（非 UX-DR12 详情返回）；UX-DR12 上下文恢复落点在详情页 BackLink（2.5）。」，href `/` 保持不变。
- `apps/web/app/(public)/topics/[slug]/page.tsx` -- MODIFY（仅注释）：128 行注释更新同上语义（主题页→目录为次级导航，非详情返回；恢复落点在详情 BackLink），href `/topics` 不变。
- `apps/web/e2e/seed-loop.ts` -- NEW（镜像 `seed-themes.ts`/`seed-daily.ts` 合成：resetEnvCache→requireEnv DATABASE_URL→getPrisma→清表 FK 序[含 themes/digest 全部新表]→建 source+N records→clusterEvents→generateExplanation→`decideReview(approve)` 产 **≥1 已发布**事件 `loopHotEventId`（latestEvidenceAt 落当日 UTC，进入首页 feed）→对该事件 `generateThemes({adapter:new StubThemeAdapter()})`+`refreshPublishedReadModel(publish)`（使其成为 `STUB_THEME_SLUG` 主题成员，供 `/topics/{slug}` 成员链）→`generateDailyDigest({coverageDate:当日UTC, adapter:new StubDigestAdapter()})`+`refreshPublishedDailyDigest({coverageDate:当日UTC})`（使其进入当日日报 entries，供 `/daily` 条目链）→resetPrisma）；导出 `{ loopHotEventId, loopTitle, themeSlug, coverageDate }` 供 spec。**同一已发布事件同时存在于 feed/主题/日报三面**——这是 `@loop` 测三向返回的前提。直接运行守卫。
- `apps/web/e2e/loop.spec.ts` -- NEW（`describe` 标题含 `@loop`，`test.describe.configure({mode:"serial"})` + beforeAll `seedLoopContext()` 捕获 id/coverageDate）：(1) 首页：`/?window=today`→`evaluate(window.scrollTo(0,1500))`→点 `loopTitle` 卡→断言 detail 200 + BackLink href 经 hydration 后含 `/?window=today`（`toHaveAttribute("href", /window=today/)` 重试至 effect 完成）→点 BackLink→断言 URL 含 `window=today` + `evaluate(() => window.scrollY)` ≈1500（容差，>1000）。(2) 主题：`/topics/{themeSlug}`→scroll 1200→点成员 `loopTitle`→detail→BackLink href=`/topics/{themeSlug}`→点回→URL=`/topics/{themeSlug}` + scrollY≈1200。(3) 日报：`/daily?date={coverageDate}`→scroll 900→点条目 `loopTitle`→detail→BackLink href 含 `date=`→点回→URL 含 `date=` + scrollY≈900。(4) 直访：`/events/{loopHotEventId}` 直接打开（无前序点击）→BackLink href=`/`（fallback）。(5) 开放重定向：`page.evaluate` 写 `sessionStorage["aguhot:returnContext"]="https://evil.com"`→访问 detail→BackLink href=`/`（拒）；同样测 `//evil.com`、`/console/123` 均 fallback。(6) 刷新不误跳：`/?window=today` scroll 至 1500→刷新→scrollY≈0（顶部，无 marker）。(7) 不回归断言：detail 六分区/证据/反应/关联/主题仍渲染。
- `apps/web/package.json` -- MODIFY：加 `"e2e:loop": "tsx e2e/seed-loop.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @loop"`、`"seed:loop": "tsx e2e/seed-loop.ts"`；**改 `e2e` 的 `--grep-invert` 追加 `|@loop`**。既有脚本不动。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 2-5 defer（nav 级跨列表上下文 home↔daily↔topics 恢复、详情→关联 pill 前向 `?window=` 保留、多级返回栈/面包屑/前进恢复、跨会话 scroll 持久化 localStorage、epic-3 `/search` 路由落地后扩 `isValidListReturn` allowlist、scroll 恢复在 layout 改为内层 overflow 容器后的适配、sessionStorage 禁用环境的无恢复降级已实现但无可观测埋点、捕获监听对带 `target=_blank`/修饰键点击的语义边界）。

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/list-context-memory.tsx` -- NEW client 组件（document 捕获期 click 监听写 returnContext+scroll；useLayoutEffect+usePathname 一次性恢复 scroll；纯函数 `isValidListReturn`/`scrollKey`/读写 helper 全 try/catch） -- UX-DR12 上下文捕获+恢复基建（单一布局级组件覆盖全公开站）
- `apps/web/app/(public)/_components/back-link.tsx` -- NEW client 组件（mount 读 returnContext 校验渲染 href 或 fallback；onClick 写 restoreMarker） -- 详情返回唯一入口（UX-DR12 落地点，替换三处裸返回链中的详情那处）
- `apps/web/app/(public)/layout.tsx` -- 挂 `<ListContextMemory/>`（渲染 null，零布局影响，不 import core） -- 捕获/恢复全局挂载点
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 裸 `<Link href="/">` 返回链换 `<BackLink fallback="/">` + 注释更新 -- 详情→来源列表恢复（AC1/AC2/AC3 surface）
- `apps/web/app/(public)/daily/page.tsx` + `topics/[slug]/page.tsx` -- 仅注释更新（次级导航非详情返回，href 不变） -- 避免误导，明确 2.5 落点在详情 BackLink
- `apps/web/e2e/{seed-loop.ts,loop.spec.ts}` + `package.json:e2e:loop/seed:loop` + `e2e` grep-invert 加 `@loop` -- 独立 seed（同一已发布事件横跨 feed/主题/日报三面）+ @loop e2e（三向返回 query+scroll 恢复/直访 fallback/开放重定向守卫/刷新不误跳/不回归） -- AC1~AC7 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 2-5 defer 项 -- 诚实登记

**Acceptance Criteria:**
- Given `/?window=7d` 已加载且 scrollY>1000，When 用户点击首页事件卡进入 `/events/{id}` 然后点击「← 返回首页」BackLink，Then 落回的 URL 含 `window=7d`（非裸 `/`，AC2），And `window.scrollY` 恢复至点击前值（容差>1000，AC3），And 该返回链为真实 `<a>` 键盘可达（AC7）。
- Given `/topics/{slug}` scrollY>800，When 点击成员事件进详情再点 BackLink，Then URL=`/topics/{slug}` 且 scrollY 恢复（AC2/AC3）。
- Given `/daily?date={D}` scrollY>500，When 点击日报条目进详情再点 BackLink，Then URL 含 `date={D}` 且 scrollY 恢复（AC2/AC3）。
- Given 直接访问 `/events/{id}`（无前序列表点击，如外链/刷新），When 详情渲染并点 BackLink，Then href=`/`、回首页顶部、不抛错（AC4 fallback）。
- Given `sessionStorage["aguhot:returnContext"]` 被改写为 `https://evil.com` / `//evil.com` / `/console/123` / `/events/other` 任一，When 详情 BackLink 读取，Then `isValidListReturn` 全拒、href 回退 `/`、**不**产生站外/operator 跳转（AC6 开放重定向守卫）。
- Given 用户刷新 `/?window=7d`（非从详情返回），When 页面加载，Then scrollY 保持≈0（顶部，RESTORE_MARKER 缺→no-op），And 返回恢复后再次刷新该列表 marker 已清→仍 no-op（AC5 一次性，不误跳）。
- Given 点击非详情链（nav「日报」/feed `?window=` pill/证据外链），When 捕获监听触发，Then no-op 不写 returnContext（不污染，AC1 边界）。
- When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功，And `pnpm -r typecheck`/`pnpm -r lint` 通过，And `pnpm --filter web e2e:loop`（`@loop`）三向返回 query+scroll 恢复/直访 fallback/开放重定向守卫/刷新不误跳全过，And `pnpm --filter web e2e`（home/navigation/design）/`e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction`/`e2e:associations`/`e2e:themes`/`e2e:daily` 不回归（正向 href 字节不变，既有断言零改动）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (medium 2, low 7)
- defer: 1: (low 1)
- reject: 18
- addressed_findings:
  - `[medium]` `[patch]` `seed-loop.ts` 用 `nowMs - 2*HOUR` 作 `publishedAt/latestEvidenceAt`，当 seed 运行在 00:00–02:00 UTC 窗口时该时间落到**前一个 UTC 日**，导致首页 `?window=today`（`>= 当日 UTC 0 点`）与日报 `coverageDate` UTC 日等值过滤**同时排除**该事件 → 三向闭环测试确定性失败。改为把时间 clamp 到 `coverageDate + 安全偏移`（`max(nowMs - 2h, coverageMs + 3h)`），保证无论何时刻运行都落在当日 UTC 日内。
  - `[medium]` `[patch]` 主题页与日报页的 scroll 恢复**从未被断言**（仅首页 `expect.poll(scrollY).toBeGreaterThan(1000)`）——UX-DR12 点名的三表面中两个的 scroll AC 无验证；spacer 注入在客户端导航下被 React reconciliation 清除，无法测返回后 scroll。改为 seed 产 **≥10 条共享同 theme slug 的事件**（主题页时间序列自然变高）+ **≥10 条共享同 coverageDate 的日报条目**（日报页自然变高），使主题/日报返回后可断言 `scrollY` 恢复（>阈值），直接兑现 spec AC2/AC3 对这两表面的承诺。
  - `[low]` `[patch]` 修正 `list-context-memory.tsx` 头注释的文档谎言：声称恢复用 `useLayoutEffect` 实际是 `useEffect`（header + `[]`/`[pathname]` 依赖自相矛盾表述）；修正 `loop.spec.ts` 注释「BackLink's useEffect re-reads」为 `useSyncExternalStore` mount-once + reload-remount 语义；补 `[pathname]` 单依赖为何对一次性恢复正确的解释注释。
  - `[low]` `[patch]` 捕获监听增加 `anchor.hasAttribute("download")` 与 `anchor.target === "_blank"` 跳过——关闭 deferred-work 自认的 `target=_blank` 潜在 leak（download 属性不导航、`_blank` 新标签页不离开当前页，两者均不应写 returnContext）；相应更新 deferred-work 条目。
  - `[low]` `[patch]` `loop.spec.ts` `test.use({ viewport: { width:1280, height:720 } })` 固定视口高度 + 断言 seed filler 数/首页可滚动高度（`scrollHeight > 1500`），消除「tall viewport 致 maxScroll<1500 → 断言误败」的测试耦合，失败时信号清晰。
  - `[low]` `[patch]` 增加一次性契约断言：首页返回恢复后断言 `sessionStorage[RESTORE_MARKER]` 与 `scrollKey` 均为 null，随后 `page.reload()` 断言 `scrollY < 50`（移除 `clearRestore` 会致刷新重跳，现被该测试捕获）。
  - `[low]` `[patch]` 增加负向测试：从 `/?window=today` 点击 feed `?concept=` 过滤 pill（或 nav 链）后断言 `sessionStorage[RETURN_CONTEXT]` 仍为 null——锁住捕获门 `startsWith("/events/")` 不被宽化为 `startsWith("/")`。
  - `[low]` `[patch]` AC6 开放重定向输入追加 backslash 变体 `/\evil.com`（与既有 `https://`、`//`、`/console/123`、`/events/{id}` 并列），兑现代码注释「reject backslash-trick」的声明。
  - `[low]` `[patch]` 拆分清理语义：`RESTORE_MARKER` 在恢复触发时立即清（保证 AC5 刷新不重跳不变），`scrollKey` 延后到 `scrollTo` 实际提交后清——修复「rAF 重试期间用户快速离开 → marker+scroll 已清但 scroll 未应用 → 同会话再返该列表永久丢 scroll」的 TOCTOU 竞态。
  - 1 项 defer 已追加至 deferred-work：浏览器原生 back/forward（history/bfcache）的 scroll 恢复——当前设计仅经显式 BackLink 点击恢复（marker 由 onClick 写），浏览器 back 经原生 history 恢复 URL（filter 态）但不恢复 scroll；未来可加 `pageshow`/`history.scrollRestoration` 机制扩展（V1 显式返回链已覆盖 UX-DR12 测试路径）。
  - 18 项 reject 静默丢弃：SVG `<a>`（SVGAElement）closest 命中（app 无 SVG 锚）；bfcache restore 跳过 effect（marker 机制自洽——浏览器 back 无 marker 可消费，非 bug）；Windows `file://` auto-run guard（platform=darwin，且既有 seed 同惯例）；`pending.find(...)!` 非空断言（确定性 seed，标题唯一）；`formatDateTime` 双定义（既有、非本 story 引入）；`resetPrisma()` 仅底部（既有 seed 同惯例，测试 runner 正常退出）；`@loop` tag CI 守卫（describe 继承 tag 是全仓 e2e 既定模式）；隐私模式 try/catch no-op 测试（web 无单测层、Playwright addInitScript stub 较脆，按构造验证 + typecheck 覆盖，与 2-4 impossible-state 惯例一致）；`isValidListReturn` 硬编码 `http://localhost`（capture 永写相对路径→解析 origin 恒为 sentinel，正确；「若改成写绝对路径会坏」是假设性回归）；marker-equality 忽略 hash（app 无 hash 路由）；`subscribe` no-op 注释略过断（mount-once 语义正确）；CSS smooth-scroll 捕获（app 无 smooth-scroll）；BackLink `preventDefault` marker 泄漏（无其他 handler preventDefault，且泄漏为 no-op）；home filler 高度耦合（已由 viewport+高度断言 patch 覆盖）；`useSyncExternalStore` 偏离 spec 的 `useState`+`useEffect`（行为等价、更正确的 React 惯用法，非缺陷）；byte-identical SSR href 无正向断言（今日无回归、保护附带正确）；`router.push` 绕过 click 监听（无当前路径触发）；AC6 未测 `target=_blank`（已由捕获 skip patch 根治）。
- verification_note: 本 story 纯 web、无 core/DB/worker/迁移改动；`pnpm -r typecheck`/`lint`、`pnpm --filter web build`（无 `DATABASE_URL`）、`pnpm --filter web e2e:loop`（8/8）实现期全绿。复核期发现并修复 2 medium + 7 low 测试确定性/验证覆盖/文档/竞态问题；patch 后重跑 e2e:loop 全绿。`db:migrate status` 存在与本 story 无关的既有 `association_read_models` 漂移（非 schema 改动），未触碰。

## Design Notes

**为何用「布局级单一 document 捕获监听 + sessionStorage」而非 `?from=` URL 参或 per-link client 包装：** 三个候选都能恢复 query，差异在正则面与回归面。(1) `?from=<encoded>` 详情 URL 参：可服务端读、可测，但**污染每个可分享的详情 URL**（`/events/{id}?from=%2F%3Fwindow%3D7d`），且使既有 `themes.spec`/`daily.spec`/`detail.spec` 对 `/events/{id}` 的 href 精确断言全部失败（需改既有 spec，违反「1.6~2.4 spec 零改动」惯例）。(2) per-link client 包装（EventCard/主题成员/日报条目各包一层 client）：三处 `event-card.tsx`/`topics/[slug]`/`daily` 都得 `"use client"` 或加包装组件，EventCard 目前是服务端组件、首页服务端读 searchParams 后传 props——client 化割裂既有服务端数据流。(3) **布局级单一捕获监听**：`<ListContextMemory/>` 在 `document` 上注册**一个**捕获期 click handler，沿 `closest("a")` 判定目标是否 `/events/`，命中即写 sessionStorage。正向 href **字节不变**（既有 href 断言全绿、零 spec 改动），新增点仅「布局挂一组件 + 详情换 BackLink」两处，per-link 零接触。捕获期（capture phase）保证 handler 在 Next `<Link>` 的客户端路由之前执行，写完上下文再放行导航。sessionStorage 会话级、同源 JS 写、隐私模式 try/catch no-op——无新依赖、无 Provider、无 URL 污染。这是 ponytail：覆盖需求（UX-DR12 query+scroll 恢复）的最短 diff，且把「改最少既有代码」作为硬约束兑现（正向链零改、既有 spec 零改）。

**为何 scroll 恢复要 RESTORE_MARKER 一次性门控（而非每次列表 mount 都恢复）：** sessionStorage 在会话内（含刷新）持久。若列表页每次 mount 都「读 scrollKey→scrollTo」，则用户**刷新** `/?window=7d` 时会跳到上一次离开时的 1200px——一个「刷新后乱跳」regression，违反直觉。故引入 `RESTORE_MARKER_KEY`：仅 BackLink onClick（即「真正从详情返回」这一动作）写入 marker=来源 href；`<ListContextMemory/>` 检测 marker===当前 pathname+search 才恢复并**立即清除** marker+scrollKey。刷新/直访/首次进入无 marker→no-op→顶部。这把恢复精确门控到「从详情返回」单一语义，避免持久 scroll 副作用泄漏到非返回加载。marker 值=来源 href（非布尔）还能保证「A 列表返回」不会误触发「B 列表恢复」（pathname+search 严格等值）。

**为何 `isValidListReturn` 用 `new URL(raw, "http://localhost")` + origin 严格等值而非简单 `startsWith("/")`：** 返回 href 来自 sessionStorage，虽同源 JS 写入，仍按信任边界校验（防御未来 bug/插件写入脏值）。`startsWith("/")` 不够：`//evil.com` 以 `/` 起头但浏览器解析为协议相对→跳 `evil.com`（开放重定向）；`/\evil.com`、`/` + Unicode 欺骗同理。`new URL(raw, "http://localhost")` 把相对/协议相对/绝对统一解析，再断言 `url.origin === "http://localhost"`（拦截一切跨站）+ `url.pathname` ∈ allowlist（`/`、`/daily` 精确，`/topics/` 前缀；拒 `/console`、`/events`、`/favorites`）。这是 ponytail 明示「输入验证 at trust boundary 不可简化」的落点——5 行纯函数，挡住整类开放重定向。

**为何把 daily/page.tsx 与 topics/[slug]/page.tsx 的「返回」链留为裸 href（只改注释）：** UX-DR12 的「返回」语义特指「**进入详情**后返回原消费上下文」——即详情页那一条返回链。daily→home、theme[slug]→/topics 是**列表→列表/列表→目录**的次级导航，读者并非「从详情返回」，且其入口多为主图 nav（全局导航，非阅读上下文返回）。把 BackLink 扩到这两处需让 nav 也带上下文（nav href 污染 + client 化），超出 UX-DR12 与一层深度上限。故仅详情 BackLink 落地 UX-DR12；这两处注释更新为「次级导航，恢复落点在详情 BackLink」，避免其原「is 2.5」注释误导后续维护者以为这里也该恢复。daily/theme 的裸返回链保持 `href="/"` / `href="/topics"` 不变（行为同今日，零回归）。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含两新 client 组件 + layout/详情页改动）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（layout 仍不 import core；两 client 组件 SSR 安全）
- `pnpm --filter web e2e:loop` -- expected: seed 后 `@loop` 通过（首页/主题/日报三向返回 query+scroll 恢复 + 直访 fallback + 开放重定向守卫 + 刷新不误跳 + 不回归六分区）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:market-reaction` / `e2e:associations` / `e2e:themes` / `e2e:daily` -- expected: 不回归（正向 href 字节不变）

**Manual checks (if no CLI):**
- `/?window=7d` 滚至中下部→点事件卡→详情→点「← 返回首页」→落回 `/?window=7d` 原 scroll 位（非顶部）；同理主题成员、日报条目；直访 `/events/{id}`（拷链新开）→返回链回首页顶部；既有详情六分区/证据/反应/关联/主题不回归；返回链键盘可达、instant 滚动（无动画）。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 2 收官 story 的 UX-DR12 阅读上下文恢复——纯 web 层（零 core/DB/worker 改动）。在 `(public)/layout.tsx` 挂一个 client 组件 `<ListContextMemory/>`，其 `document` 捕获期 click 监听在任意 `/events/{id}` 点击时把「来源列表 URL + `window.scrollY`」写入 sessionStorage；详情页把裸「返回首页」链换成 client `<BackLink/>`，mount 时读 + 校验（`isValidListReturn`：同源 + `/`/`/daily`/`/topics/` allowlist，挡 `https://`/`//`/`/console`/`/\` 开放重定向）来源 URL 并恢复，scroll 经一次性 `RESTORE_MARKER`（BackLink onClick 写、恢复后清）触发。正向跳转 href 字节不变→既有 1.6~2.4 e2e 零改动全绿。

**Files changed:**
- `apps/web/app/(public)/_components/list-context-memory.tsx` — NEW client 组件：document 捕获期监听写 returnContext+scroll、usePathname 一次性 scroll 恢复、纯函数 isValidListReturn/scrollKey/读写 helper（全 try/catch）。
- `apps/web/app/(public)/_components/back-link.tsx` — NEW client 组件：useSyncExternalStore 读+校验来源 URL 渲染或 fallback、onClick 写 restoreMarker。
- `apps/web/app/(public)/layout.tsx` — 挂 `<ListContextMemory/>`（渲染 null、不 import core）。
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` — 裸返回链换 `<BackLink fallback="/">`。
- `apps/web/app/(public)/daily/page.tsx` + `topics/[slug]/page.tsx` — 仅注释更新（次级导航非 UX-DR12 详情返回）。
- `apps/web/e2e/{seed-loop.ts,loop.spec.ts}` — 独立 seed（同一已发布事件横跨 feed/主题/日报三面）+ @loop e2e（三向返回 query+scroll、直访 fallback、开放重定向守卫、一次性 marker、负向捕获门、刷新不误跳）。
- `apps/web/package.json` — `e2e:loop`/`seed:loop` + `e2e` grep-invert 加 `@loop`。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 2-5 defer 项。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0。patch 9（medium 2：seed 时区确定性 + 主题/日报 scroll 恢复验证覆盖；low 7：文档谎言修正、捕获 skip download/target=_blank、视口固定+高度断言、一次性 marker 清理断言、负向捕获门测试、backslash 开放重定向输入、rAF marker/scroll 清理竞态拆分）。defer 1（浏览器 back 原生 scroll 恢复）。reject 18（SVG 锚、bfcache、Windows auto-run、`pending.find!`、formatDateTime 双定义、resetPrisma 惯例、@loop tag 守卫、隐私模式过度测试、硬编码 origin 假设性回归、hash、smooth-scroll 等约定/by-design/无当前路径）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 `DATABASE_URL`）PASS、`pnpm --filter web e2e:loop` 10/10 PASS。patch 后重跑 e2e:loop 全绿。

**Follow-up review:** false（2 medium 均为验证/确定性类——生产行为本就正确，只是测试未覆盖；生产代码仅 2 处低后果健壮性修复 P4/P10，无 API/安全/数据完整性变更；验证覆盖经本次显著强化反而降低后续复核需要）。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-2-5.patch`（复核工作 diff，非变更一部分，未提交）。无运行时残留风险超出 deferred-work 已登记项。

