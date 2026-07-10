---
title: '热点与主题搜索 (3.1)'
type: 'feature'
created: '2026-07-11'
status: 'done'
review_loop_iteration: 0
baseline_revision: '03eee40f22fc6ad6e1938d8c3c859f761ca40e31'
final_revision: '6466febfe2cd2216fa59057b38c37ac3eb0b2f1c'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-cross-surface-context-return-loop.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-theme-page-continuity-tracking.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 1/2 已落地全部公开阅读面（首页 feed、详情、主题页、日报），但读者**无法搜索**——既无 `/search` 路由，也无任何搜索入口（全仓零 `search` 命中，`public-nav.tsx` 无搜索框，`PRIMARY_NAV_ITEMS` 仅 首页/日报/主题/收藏）。FR12（「用户可以搜索热点事件、主题页或相关关键词，结果覆盖标题、解释摘要和主题名称」）完全未落地。读者想找回某条热点或某条主线，只能靠手动翻 feed / 翻主题目录——回访路径断裂，这是 Epic 3 列明的首发能力。

**Approach:** **零 schema/迁移/worker 改动，纯读路径。** 新增一个 `search-read` core 模块，导出 `searchPublished({ prisma, traceId, query })`——它**复用既有 filter-free list 函数 + 一个新增兄弟函数**（`listPublishedHotEventExplanations`，镜像 2.2 `listPublishedAssociations` / 2.3 `listPublishedThemeMemberships` 的 sibling-list 惯例，让 `published_hot_event_explanations.summary` 进入公开读面），把三类已发布语料（`published_hot_events.title` + `published_hot_event_explanations.summary` + `published_hot_event_themes.items[].label`）一次性读出后**在 JS 内存里做大小写不敏感子串匹配**（沿用 1.7 `filterByWindow` / 2.2 association join / 2.3 theme-derive 的「V1 体量极小，filter 是 UI 关注点」既定模式；中文无需分词、子串字符级命中即正确，故**不引入** Postgres FTS/tsvector/GIN——defer 到真实查询负载出现）。返回分组结果 `{ events, themes }`：event 命中按「标题命中（强相关）→ 摘要命中」分层、层内按 `latestEvidenceAt DESC`（相关性与时间综合排序，FR12 AC）；theme 命中按成员事件数 DESC、label ASC。Web 层新增 `apps/web/app/(public)/search/page.tsx`（`force-dynamic`，`searchParams: Promise<{q?}>`，Next 16 Promise 惯例）：空 query→输入引导态；有 query 无命中→明确无结果反馈 + 回首页/换词路径（FR12 AC）；有命中→分组渲染（event 命中复用 `EventCard`，theme 命中复用 `FilterPill` → `/topics/{slug}`）。全局搜索入口为一个原生 HTML `<form method="get" action="/search">`（`<input name="q" type="search">`，`role="search"`）的 `<SearchBox/>` 组件，**渲染在 `NavList` 顶部**（同时出现在桌面左栏 aside 与移动抽屉，无客户端 JS、键盘 Enter 原生提交、触控热区满足 `min-h-11`）——**不**作为 `PRIMARY_NAV_ITEMS` 的一项（避开 `navigation.spec.ts` 对「四个一级入口」的硬断言，零既有 spec 改动）。最后把 `/search` 加入 `list-context-memory.tsx` 的 `isValidListReturn` allowlist（2.5 spec 明示「epic-3 `/search` 路由落地后扩 allowlist」的 defer 项），使 搜索→详情→返回 经既有 `<BackLink/>` 基建恢复原搜索 URL（query + scroll）。ponytail：一个新 core 读函数（纯 JS 匹配）+ 一个新 web 路由 + 一个原生表单组件 + 一行 allowlist 扩展；无新依赖、无迁移、无 worker、无 FTS。

## Boundaries & Constraints

**Always:**
- 三语料覆盖（FR12 AC1）：`searchPublished` 必须能命中 (a) `published_hot_events.title` 含 q、(b) `published_hot_event_explanations.summary` 含 q、(c) 任一成员事件的 `published_hot_event_themes.items[].label` 含 q。三类语料**只读 `published_*` 读模型**（AD-3），永不读 `hot_events`/`explanation_versions`/`event_theme_sets`/`evidence_*`。
- 仅已发布可见（AD-3 + AD-8）：row 存在 = 当前已发布（这些表无 status 列）。候选/驳回/下线事件的标题/摘要/主题**绝不**进入搜索结果（它们不在 `published_*` 读模型里）。下线即从 `published_*` 删除 → 自动从搜索消失，无需额外过滤。
- 相关性与时间综合排序（FR12 AC1）：event 命中分两层——标题命中（tier 0，强相关）优先于摘要命中（tier 1）；层内 `latestEvidenceAt DESC`（近期优先）。theme 命中按成员事件数 DESC、label ASC。一个事件同时命中标题与摘要时计一次、归 tier 0、`matchedField="title"`。
- 大小写不敏感子串匹配（中文友好）：`haystack.toLowerCase().includes(q.toLowerCase())`。中文无大小写，toLowerCase 对中文 no-op、对拉丁归一化。**不**做分词/pinyin/模糊（defer）。
- 输入校验 at trust boundary（公开输入，**不可简化**）：`parseSearchQuery(raw)` trim 后，长度 > `MAX_QUERY_LEN`（128）截断；空串 → 不调用 `searchPublished`、页面渲染空 query 引导态。query 经 trim + 截断后才进匹配函数（防超长输入放大内存匹配成本）。
- 匿名默认（AD-8）：`/search` 路由、`SearchBox`、结果页全程**不依赖**任何登录态/用户 id；搜索是公开阅读路径，与 `user-profile`/收藏（3.2/3.3）完全解耦。
- 三个诚实话术态（NFR 不造假，沿用 home/topics 惯例）：(1) 空 query → 「输入关键词搜索热点事件与主题。」+ 空输入框；(2) 有 query 零命中 → 「未找到与「{q}」相关的热点或主题。」+ 回首页链 + `SearchBox`（可就地换词）；(3) 有命中 → 分组「热点事件」/「主题」两段，每段内各自排序。绝不渲染占位假结果。
- 复用既有组件（一致性 + 零新视觉 token）：event 命中行复用 `EventCard`（`href=/events/{id}`，整卡可点，键盘可达）；theme 命中复用 `FilterPill`（`href=/topics/{slug}`）。
- 全局入口键盘/触控可达（FR12 AC3，UX-DR13）：`SearchBox` 为原生 `<form role="search">` + `<input type="search" name="q">` + `<label>`（可见或 `sr-only`）+ 提交按钮（`min-h-11` 触控热区）。Enter 原生提交 → `GET /search?q=…` → 服务端渲染。**不**依赖 hover/js 完成主路径。`/search` 页面的 `SearchBox` 用 `defaultValue={q}` 预填（uncontrolled，SSR 安全），供就地换词。
- 返回路径恢复（兑现 2.5 对 epic-3 的 defer）：把 `/search` 加入 `isValidListReturn` 的 `LIST_PATH_EXACT` allowlist（与既有 `/`、`/daily` 并列）。读者从 `/search?q=X` 点 event 卡进详情再点 `<BackLink/>` → 落回 `/search?q=X`（非首页），既有 `ListContextMemory` 捕获/恢复基建自动覆盖（捕获监听本就命中所有 `/events/` 点击，无需改捕获侧）。
- 不变性约定（沿用 1.4~2.5）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；core 内跨模块相对导入带 `.js`；camelCase；core 新模块经 `packages/core/src/index.ts` 总 barrel 单一入口导出（无 subpath export）。`SearchBox` 为服务端组件（无 `"use client"`，纯静态 HTML form），与 `(public)/layout.tsx` 一样不 import `@aguhot/core` 以外的运行时依赖——但 `SearchBox` 渲染在 `public-nav.tsx`（已是 `"use client"`）内，作为其返回的静态 JSX 子树，不引入新 client 状态。

**Block If:**
- 新增 core 模块/函数致 `pnpm -r typecheck`/`pnpm -r lint` 回归 → HALT。
- 新增 `/search` 路由 + `SearchBox` 致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT（`/search` 必须 `force-dynamic`，`SearchBox`/nav 不在 build 期触 DB）。
- 本地 PG `aguhot_dev` 不可达致 `seed:search` 造数失败 → HALT（不得跳过 e2e）。
- `navigation.spec.ts`（1.2）任一断言因新增 `SearchBox` 失败 → HALT（`SearchBox` 必须作为 NavList 内独立 form 存在，不得改 `PRIMARY_NAV_ITEMS` 的 4 项构成；若 1.2 spec 仍误判，优先调整 `SearchBox` 的 DOM/role 归属而非改既有 spec 的入口数断言）。

**Never:**
- 不引入 Postgres FTS / `tsvector` / `GIN` / `ILIKE` SQL 匹配 / 专用搜索引擎（V1 体量极小 + 中文分词需 zhparser/jieba 扩展，真实查询负载出现前 defer；本 story 用 JS 子串匹配，与 1.7/2.2/2.3 in-memory filter 既定模式一致）。**不**加任何 prisma migration / schema 改动 / index。
- 不改 `listPublishedHotEvents` / `listPublishedAssociations` / `listPublishedThemeMemberships` 的签名（filter-free 契约；search 靠新增 sibling `listPublishedHotEventExplanations` + JS join，镜像 2.2/2.3 sibling-list 模式）。
- 不把 `/search` 加进 `PRIMARY_NAV_ITEMS`（会破坏 `navigation.spec.ts` 对「四个一级入口」的硬断言 + 「四个」测试标题）。搜索入口是 `NavList` 内的 `SearchBox` form，不是一级导航项。
- 不做延迟登录 / 收藏 / 关注列表（3.2/3.3 own；`/search` 全程匿名）。不在搜索结果行加收藏按钮（3.2 own）。
- 不做搜索→详情→返回的**显式「返回搜索结果」入口**与 bfcache 不可恢复兜底（3.4 own；本 story 仅扩 allowlist 使既有 `<BackLink/>` 恢复搜索 URL，3.4 再补显式入口与不可恢复边案）。不做搜索分页 / 高亮 / 搜索建议 / 搜索历史（defer）。
- 不扩展搜索语料到 `tags` / `whyItMatters` / `uncertainties` / 证据 `summary`（FR12 点名「标题、解释摘要、主题名称」三样；扩展语料 defer）。解释摘要 = `published_hot_event_explanations.summary` 字段（不是 `whyItMatters`/`uncertainties`）。
- 不改 1.1~2.5 既有 verify/seed/spec 断言（home/navigation/detail/themes/daily/loop 等 seed/spec 零改动保持绿；本 story 仅新增 `@search` seed/spec + `e2e:search`/`seed:search` 脚本 + `e2e` grep-invert 追加 `|@search`）。不改 `EventCard`/`FilterPill` 组件本体（复用，字节不变）。
- 不引入新依赖（无 lunr/flexsearch/algolia/Meilisearch；纯 `String.prototype.includes` + `toLowerCase`）。不引入客户端搜索状态（无 useState/useReducer；query 全在 URL `?q=`，服务端渲染，可分享、可 back/forward）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 标题命中（AC1） | 已发布事件 A 标题含「芯片」，`GET /search?q=芯片` | `searchPublished` 返回 events 含 A（`matchedField:"title"`，tier 0）；页面「热点事件」段渲染 `EventCard` 链 `/events/{A}` | 无错误预期 |
| 摘要命中（AC1） | 已发布事件 B 标题不含「锂矿」但其 `explanations.summary` 含「锂矿」，`GET /search?q=锂矿` | events 含 B（`matchedField:"summary"`，tier 1）；页面渲染 B 的 `EventCard` | 无错误预期 |
| 主题名称命中（AC1） | 已发布事件 C 的 theme `items[].label` 含「半导体」，`GET /search?q=半导体` | themes 含该 slug（成员数=含该 slug 的事件数）；「主题」段渲染 `FilterPill` 链 `/topics/{slug}` | 无错误预期 |
| 相关性分层排序（AC1） | q 同时命中事件 X（标题）与事件 Y（仅摘要），X 较 Y 旧 | events 顺序：X（tier 0）在 Y（tier 1）之前，**即使 Y 更新**；同层内 `latestEvidenceAt DESC` | 无错误预期 |
| 无结果反馈（AC2） | `GET /search?q=不存在的词xyz`，零命中 | 页面渲染「未找到与「不存在的词xyz」相关的热点或主题。」+ 回首页链 + `SearchBox`（可换词） | 无错误预期 |
| 空 query 引导态（AC 边案） | `GET /search` 或 `GET /search?q=` 或 `GET /search?q=%20%20` | 不调用 `searchPublished`；渲染 `SearchBox` + 「输入关键词搜索热点事件与主题。」引导文案；**不**渲染无结果/结果段 | 无错误预期 |
| 超长 query 截断（信任边界） | `GET /search?q=` + 200 字符 | `parseSearchQuery` 截断至 128 字符后匹配；页面正常渲染（用截断后的 q） | 静默截断（不抛错） |
| 大小写不敏感（拉丁） | `GET /search?q=AI`，已发布标题含「ai」 | 命中（toLowerCase 归一） | 无错误预期 |
| 全局入口键盘提交（AC3） | 桌面 aside `SearchBox` 聚焦 → 输入「芯片」→ Enter | 原生 form 提交 → 导航至 `/search?q=芯片` → 结果页渲染 | 无错误预期 |
| 移动端入口触控（AC3） | 移动抽屉内 `SearchBox`，触控点输入框 + 提交按钮 | 输入框/按钮 `min-h-11` 热区；提交 → `/search?q=…` | 无错误预期 |
| 搜索→详情→返回恢复（兑现 2.5 defer） | `/search?q=芯片` 点 event 卡 → 详情 → 点 `<BackLink/>` | `RETURN_CONTEXT="/search?q=芯片"` 经 `isValidListReturn`（`/search` 已入 allowlist）通过 → BackLink href=`/search?q=芯片` → 落回原搜索结果页（query 保留）；既有 scroll 恢复基建生效 | 无错误预期 |
| 下线事件不命中（AD-3/AD-8） | 曾命中 q 的事件被运营下线（从 `published_*` 删除），再 `GET /search?q=…` | 该事件不再出现在结果（row 不存在 → 不读出） | 无错误预期 |
| 匿名可达（AD-8） | 未登录 `GET /search?q=…` | 200 + 结果正常渲染，无登录重定向/提示 | 无错误预期 |
| DB 缺失（NFR 一致） | runtime `DATABASE_URL` 缺失，`/search?q=…` | `getPrisma()` 抛错冒泡为路由错误（loud failure，DB 是核心基建非优雅降级；与 home/topics 一致） | 路由错误（非静默空态） |

</intent-contract>

## Code Map

- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：新增 `ListPublishedHotEventExplanationsOptions`（`{ prisma; traceId }`，镜像 `ListPublishedAssociationsOptions`）与 `PublishedHotEventExplanationSummaryRow`（`{ hotEventId: string; summary: string }`）。注释说明「sibling list fn for explanation summaries，search-read 的第三语料来源；row 存在 = 已发布，无 status 列」。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：新增 `listPublishedHotEventExplanations(options): Promise<PublishedHotEventExplanationSummaryRow[]>`——`prisma.publishedHotEventExplanation.findMany({ select: { hotEventId: true, summary: true } })`，filter-free、无 orderBy 约束（调用方在 JS 里 join 排序）。完整 JSDoc 说明：这是 search-read 用的 sibling list（镜像 2.2 `listPublishedAssociations` / 2.3 `listPublishedThemeMemberships`），只 SELECT `published_hot_event_explanations`，永不读 `explanation_versions`/`hot_events`（AD-3）；`listPublishedHotEvents` 等既有 fn 签名不动。
- `packages/core/src/modules/publish-orchestrator/index.ts` -- MODIFY：`export { listPublishedHotEventExplanations } from "./publish-service.js"` + 对应 `export type { … }`。
- `packages/core/src/modules/search-read/types.ts` -- NEW：`SearchPublishedOptions`（`{ prisma; traceId; query: string }`）、`SearchHitKind = "event" | "theme"`、`EventSearchHit`（`{ kind:"event"; hotEventId; title; evidenceCount; latestEvidenceAt; publishedAt; matchedField: "title" | "summary" }`）、`ThemeSearchHit`（`{ kind:"theme"; slug; label; memberCount }`）、`SearchPublishedResult`（`{ query: string; events: EventSearchHit[]; themes: ThemeSearchHit[] }`）。
- `packages/core/src/modules/search-read/search-service.ts` -- NEW：`export async function searchPublished(options): Promise<SearchPublishedResult>`。实现：`const q = options.query.trim()`；若 `q === ""` 直接 return `{query:"", events:[], themes:[]}`（双保险，页面层已 guard）。并发 `Promise.all` 取 `listPublishedHotEvents` + `listPublishedHotEventExplanations` + `listPublishedThemeMemberships`（从 `../publish-orchestrator/index.js` import）。events：对每个 summary row 按 hotEventId join 标题/计数/时间；`title.toLowerCase().includes(qLower)` → tier0 matchedField"title"；否则 `summary?.toLowerCase().includes(qLower)` → tier1 matchedField"summary"；其余丢弃；排序 tier 升序、层内 `latestEvidenceAt DESC`。themes：遍历 memberships，聚合 slug→{label, memberEventIds Set}；保留 `label.toLowerCase().includes(qLower)` 的 slug；`memberCount = Set.size`；排序 memberCount DESC、label ASC。纯函数 `rankEventHit`/`matchTheme` 不导出（模块内）。注释点明「JS 子串匹配 = 1.7/2.2/2.3 in-memory filter 既定模式；FTS/tsvector defer；中文子串字符级命中」。
- `packages/core/src/modules/search-read/index.ts` -- NEW：barrel，`export { searchPublished } from "./search-service.js"` + `export type { … } from "./types.js"`。
- `packages/core/src/index.ts` -- MODIFY：(1) 在 publish-orchestrator 的 value/type export 块各追加 `listPublishedHotEventExplanations` + 两新 type；(2) 新增 search-read 块（注释「Story 3.1 — public search over published_* read models」）`export { searchPublished } from "./modules/search-read/index.js"` + `export type { SearchPublishedOptions, EventSearchHit, ThemeSearchHit, SearchPublishedResult, SearchHitKind } from "./modules/search-read/index.js"`。
- `apps/web/app/(public)/_components/search-box.tsx` -- NEW（服务端组件，无 `"use client"`，零 hook）：`export function SearchBox({ defaultValue }: { defaultValue?: string } = {})`。渲染 `<form role="search" method="get" action="/search" className="…">` 含**隐式 label 包裹**（`<label className="sr-only">搜索 <input …/></label>`，无需 `htmlFor`/`id`——`SearchBox` 在桌面 aside 与移动抽屉**两处同时渲染**，显式 `id` 会重复，隐式包裹免 id 且服务端组件不可用 `useId()` hook）+ `<input name="q" type="search" defaultValue={defaultValue ?? ""} placeholder="搜索热点 / 主题" className="min-h-11 …" />` + `<button type="submit" className="min-h-11 …">搜索</button>`。token 用既有 `bg-surface-raised`/`border-border-hairline`/`ink-*`。注释：原生 HTML form GET 提交，无客户端 JS，键盘 Enter 原生，触控 `min-h-11`，隐式 label 免 id 冲突。
- `apps/web/app/(public)/search/page.tsx` -- NEW：`export const dynamic = "force-dynamic"`；`export const metadata = { title: "搜索" }`；`interface PageProps { searchParams: Promise<{ q?: string }> }`。`export default async function SearchPage({ searchParams })`：`const { q: raw } = await searchParams`；`const q = parseSearchQuery(raw)`；`parseSearchQuery` 为本文件顶部 helper（trim + 截断 128，定义 `MAX_QUERY_LEN = 128 as const`）。`q === ""` → 渲染 `SearchBox` + 引导文案。否则 `getPrisma()` + `newTraceId()` + `const result = await searchPublished({ prisma, traceId, query: q })`；`result.events.length === 0 && result.themes.length === 0` → 无结果态（文案含 q + 回首页 `<Link href="/">` + `SearchBox defaultValue={q}`）；否则分组渲染——「热点事件 (N)」段 `<ul role="list">` 映射 `EventCard`（now 注入）+ 「主题 (N)」段 `<div className="flex flex-wrap gap-2">` 映射 `FilterPill href={/topics/{slug}}`。顶部常驻 `<SearchBox defaultValue={q}>`。h1「搜索」。注释说明三态 + force-dynamic + AD-3/AD-8。
- `apps/web/app/(public)/_components/public-nav.tsx` -- MODIFY：在 `NavList` 组件的 `<nav>` 内、`<ul>` **之前**渲染 `<SearchBox />`（import from `./search-box.js`）。桌面 aside 与移动抽屉共享 `NavList` → 两处自动出现搜索框。**不**改 `PRIMARY_NAV_ITEMS`（仍 4 项）。注释：搜索为全局入口，置于 NavList 顶部；非一级导航项以保持 navigation.spec 对「四个一级入口」断言。
- `apps/web/app/(public)/_components/list-context-memory.tsx` -- MODIFY：`LIST_PATH_EXACT` 数组追加 `"/search"`（与 `"/"`、`"/daily"` 并列）。注释更新：allowlist 现含 `/search`（2.5 defer 兑现，epic-3 落地），搜索→详情→返回恢复原搜索 URL。捕获侧不动（监听本就覆盖所有 `/events/` 点击）。
- `apps/web/e2e/seed-search.ts` -- NEW（镜像 `seed-themes.ts` 结构）：`resetEnvCache`→`requireEnv("DATABASE_URL")`→`getPrisma`→清表（FK 序，与 seed-themes 同 16 表集合）→建 1 source→造 ≥3 事件组：(A)「芯片短缺」标题事件（标题命中 q「芯片」），(B) 标题不含「稀土」但 explanation `summary` 含「稀土」的事件（summary 命中——**确定性保证**：走 `clusterEvents`+`generateExplanation`+`decideReview(approve)`+`refreshPublishedReadModel(publish)` 正常管线后，若生成 summary 不含目标词，则**直接 upsert `publishedHotEventExplanations` 行**把 `summary` 改写为含「稀土」的确定性文案，保证 title 不含而 summary 含；这是 seed-only 测试造数，非生产行为，注释须标明），(C) 带 stub theme 成员（label 含「半导体」或复用 `STUB_THEME_LABEL`）的事件（`generateThemes(StubThemeAdapter)`）。导出 `{ titleHitId, titleHitTitle, summaryHitId, summaryHitTitle, summaryQuery, themeSlug, themeLabel, themeMemberCount, titleQuery }` 供 spec。直接运行守卫。
- `apps/web/e2e/search.spec.ts` -- NEW（`describe` 标题含 `@search`，`test.describe.configure({mode:"serial"})` + beforeAll `seedSearchContext()`）：(1) 标题命中：`/search?q={titleQuery}` → 200 + 「热点事件」段含 `EventCard` 链 `/events/{titleHitId}`；(2) 摘要命中：`/search?q={summaryQuery}` → 含 `/events/{summaryHitId}`；(3) 主题命中：`/search?q={themeLabel 或其子串}` → 「主题」段含 `FilterPill` 链 `/topics/{themeSlug}`；(4) 相关性分层：构造 q 同时命中标题事件（旧）+ 摘要事件（新）→ 标题事件排在前；(5) 无结果：`/search?q=不存在xyz` → 含「未找到」文案 + 回首页链；(6) 空 query：`/search`（无 q）→ 含引导文案 + 不含「未找到」；(7) 全局入口：桌面 aside `SearchBox` 输入 + Enter → 落 `/search?q=…` + 结果；(8) 移动抽屉 `SearchBox` 可见可提交；(9) 返回恢复：`/search?q={titleQuery}` 点 event 卡 → 详情 → 点 `<BackLink/>` → URL 含 `q={titleQuery}`（非首页）；(10) 匿名：未登录全程 200；(11) 不回归：`/search` 页面仍在公共壳内（含 nav）。
- `apps/web/package.json` -- MODIFY：加 `"e2e:search": "tsx e2e/seed-search.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @search"`、`"seed:search": "tsx e2e/seed-search.ts"`；**改 `e2e` 的 `--grep-invert` 追加 `|@search`**。既有脚本不动。
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 3-1 defer（Postgres FTS/tsvector+GIN 或 ILIKE 下推、专用搜索引擎、搜索分页/高亮/建议/历史、语料扩到 tags/whyItMatters/uncertainties/证据 summary、pinyin/模糊匹配、全局 header 内联搜索框样式增强、SearchBox 自动补全、3.4 own 的显式「返回搜索结果」入口与 bfcache 不可恢复兜底）。

## Tasks & Acceptance

**Execution:**
- `packages/core/src/modules/publish-orchestrator/{types.ts,publish-service.ts,index.ts}` -- 新增 sibling `listPublishedHotEventExplanations`（select hotEventId+summary，filter-free）+ types + barrel 导出 -- 让 explanation.summary 进入公开读面（search 第三语料；镜像 2.2/2.3 sibling-list 惯例，既有 fn 签名不动）
- `packages/core/src/modules/search-read/{types.ts,search-service.ts,index.ts}` -- NEW 模块 `searchPublished`（并发取 3 list → JS 大小写不敏感子串匹配 → event 两层相关性分层 + theme 成员数排序） -- FR12 三语料覆盖 + 相关性/时间综合排序的核心域逻辑（纯 JS，无 FTS/迁移）
- `packages/core/src/index.ts` -- 总 barrel 导出 search-read + `listPublishedHotEventExplanations` + types -- 单一入口惯例（无 subpath export）
- `apps/web/app/(public)/_components/search-box.tsx` -- NEW 原生 HTML form（`role="search"`，GET `/search`，`<input type="search" name="q">`，`min-h-11`） -- 全局搜索入口（键盘 Enter 原生提交、触控热区、无客户端 JS）
- `apps/web/app/(public)/search/page.tsx` -- NEW `/search` 路由（force-dynamic，`searchParams: Promise<{q?}>`，三态：空 query 引导 / 无结果反馈 / 分组命中） -- FR12 AC1/AC2 surface；复用 EventCard + FilterPill
- `apps/web/app/(public)/_components/public-nav.tsx` -- `NavList` 顶部渲染 `<SearchBox/>`（不动 PRIMARY_NAV_ITEMS） -- 桌面 aside + 移动抽屉均有搜索入口（AC3），零 navigation.spec 回归
- `apps/web/app/(public)/_components/list-context-memory.tsx` -- `LIST_PATH_EXACT` 追加 `"/search"` -- 兑现 2.5 defer：搜索→详情→返回恢复原搜索 URL
- `apps/web/e2e/{seed-search.ts,search.spec.ts}` + `package.json:e2e:search/seed:search` + `e2e` grep-invert 加 `|@search` -- 独立 seed（标题/摘要/主题三类命中 + 相关性分层）+ @search e2e（三语料命中、无结果、空 query、全局入口键盘/移动、返回恢复、匿名、不回归） -- AC1/AC2/AC3 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 3-1 defer 项 -- 诚实登记 FTS/分页/语料扩展/3.4 返回闭环显式入口等

**Acceptance Criteria:**
- Given 已发布事件标题含「芯片」，When `GET /search?q=芯片`，Then 「热点事件」段渲染该事件的 `EventCard`（链 `/events/{id}`），And 页面 200 且无登录要求（AC1 + AD-8）。
- Given 已发布事件标题不含「稀土」但其 explanation `summary` 含「稀土」，When `GET /search?q=稀土`，Then 该事件出现在结果中（AC1 摘要语料覆盖）。
- Given 已发布事件带 theme label 含「半导体」，When `GET /search?q=半导体`，Then 「主题」段渲染该主题的 `FilterPill`（链 `/topics/{slug}`），And 显示其成员事件数（AC1 主题语料覆盖）。
- Given q 同时命中一标题事件（较旧）与一仅摘要命中事件（较新），When `GET /search?q=…`，Then 标题事件排在摘要事件之前（AC1 相关性分层优先于时间）。
- Given q 零命中，When `GET /search?q=不存在xyz`，Then 页面含「未找到」反馈文案，And 提供回首页 `<Link>`，And 渲染 `SearchBox` 可换词（AC2）。
- Given `GET /search`（无 q 或空/纯空格 q），Then 渲染引导文案与空 `SearchBox`，And **不**渲染「未找到」亦不渲染结果段（空 query 引导态）。
- Given 桌面 aside 的 `SearchBox`，When 键盘聚焦→输入→Enter，Then 原生提交导航至 `/search?q=…` 并渲染结果（AC3 键盘主路径，不依赖 hover/js）。
- Given 移动抽屉内的 `SearchBox`，When 触控操作，Then 输入框与提交按钮 hit target 满足 `min-h-11` 且可完成搜索（AC3 触控）。
- Given `/search?q=芯片`，When 点 event 卡进详情再点 `<BackLink/>`，Then 落回的 URL 含 `q=芯片`（非首页 `/`），兑现 2.5 对 epic-3 的 allowlist 扩展 defer。
- When 执行 `pnpm -r typecheck`/`pnpm -r lint`，Then 通过；And `pnpm --filter web build`（无 `DATABASE_URL`）成功；And `pnpm --filter web e2e:search`（`@search`）全过（三语料命中 + 相关性分层 + 无结果 + 空 query + 全局入口键盘/移动 + 返回恢复 + 匿名）；And `pnpm --filter web e2e`（home/navigation 等）不回归（`SearchBox` 不改 PRIMARY_NAV_ITEMS 的 4 项构成 + 复用 EventCard/FilterPill 字节不变）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (medium 3, low 6)
- defer: 7: (low 7)
- reject: 27
- addressed_findings:
  - `[medium]` `[patch]` **a11y — SearchBox input unlabeled** (`search-box.tsx`): the `<label className="sr-only">` was a SIBLING of `<input>`, not wrapping it, so the input had no accessible name (the comment claimed implicit wrapping but lied). Dropped the orphan `<label>`, added `aria-label="搜索热点事件与主题"` to the input (id-free, safe across the two simultaneous SearchBox instances, and unlike wrapping inside an sr-only label it does NOT hide the input). UX-DR13 / FR12 AC3.
  - `[medium]` `[patch]` **theme-corpus under-delivery** (`search-service.ts`): theme aggregation matched ONLY the first-seen label per slug, so a theme whose label drifted on a later event (same slug, different label) was unsearchable even though a published membership carried that exact label — violating AC1 "search theme names". Now collects ALL distinct labels per slug (`Map<slug, Set<label>>`) and matches if ANY collected label includes the query; display label stays first-seen (unchanged).
  - `[medium]` `[patch]` **/search open-redirect guard unverified** (`search.spec.ts`): adding `/search` to `isValidListReturn`'s allowlist reopened trust-boundary surface the 2.5 AC6 test didn't cover for `/search`-prefixed tampering. Added cases writing `/search/../console` + `/search//evil.com` to `sessionStorage["aguhot:returnContext"]` and asserting BackLink falls back to `/` — locks the allowlist entry as an EXACT pathname match, not a prefix.
  - `[low]` `[patch]` `listPublishedHotEventExplanations` had no `orderBy` (both siblings have one) → added `orderBy: { hotEventId: "asc" }` for sibling-pattern consistency + deterministic order for future direct-iteration callers.
  - `[low]` `[patch]` SearchBox input: added `required` (native HTML5 blocks empty submit — no more navigating to `/search?q=` with a blank box) and `maxLength={128}` (matches `MAX_QUERY_LEN`; prevents a huge paste from building a GET URL the server rejects as 414 before `parseSearchQuery` runs — the trust-boundary guard must hold at the input, not only the server).
  - `[low]` `[patch]` theme FilterPill member count had no accessible unit (SR announced "芯片供应链 · 1" — 1 what?) → added visually-hidden `（N 个相关事件）` alongside the visible `· N`.
  - `[low]` `[patch]` `parseSearchQuery` `slice(0,128)` operated on UTF-16 code units and could split a surrogate pair (CJK Extension B / emoji) at position 128 → lone surrogate that matches nothing. Switched to code-point-safe `Array.from(trimmed).slice(0, MAX_QUERY_LEN).join("")`; fixed the adjacent comment that incorrectly claimed UTF-16-unit slicing was correct.
  - `[low]` `[patch]` within-tier `latestEvidenceAt DESC` was unasserted (tiering test only crossed tiers, so a recency reversal WITHIN a tier would ship undetected) → added seed rows for two same-tier title hits (older/newer) + a DOM-order test asserting newer-before-older.
  - `[low]` `[patch]` theme ranking (`memberCount DESC`) was unasserted (only one theme seeded) → seeded two themes with differing memberCount + a DOM-order test asserting broader-first.
  - `[low]` `[patch]` truncation boundary (128 pass-through vs 129 cut) was unasserted → added 128-char (full) and 129-char (cut to 128) cases; also fixed the `className` prop JSDoc that described a non-existent `idSuffix` (copy-paste from a removed prop) and rewrote the SearchBox comments to describe the real `aria-label` mechanism.
  - 7 defer items appended to `deferred-work.md` (duplicate `?q` array handling — project-wide searchParams pattern; unicode NFC/ZWJ normalization for pasted combining-char queries; theme slug canonicality at aggregation; cap captured return-href length in 2.5 list-context-memory for long-q sessions; sessionStorage scroll-key eviction for many distinct searches; query-aware page title via generateMetadata; AD-3 read-scope invariant unverifiable without a core unit-test runner / prisma query spy).
  - 27 reject dropped: scale/no-cache reads (by-design V1 deferral, spec Never clause); `required`/no-cache/seed-AD-3-write (spec-sanctioned); surrogate/dedup/PK/title-typeof (schema-enforced); summary-hit & theme-hit isolation (assertions are id-specific, isolation holds); matchedField single-field (by design); bg-brand 返回首页 link (consistent with home feed's 查看全部 pill); two-search-boxes empty state + 502/414 cosmetics; seed title-substring brittleness (loud failure); takedown source-order (serial reliable); return-test regex (hypothetical); deferred-work verbosity; bracket-collision echo (honest verbatim); EventCard raw hotEventId (pre-existing component, UUIDv7-safe); evidenceCount tiebreaker (spec defined tier+recency explicitly, UUID tiebreaker deterministic, identical-latestEvidenceAt ties near-impossible); intent-alignment overshoots (defensible: `/search` allowlist honors the 2.5 defer within epic-3, `listPublishedHotEventExplanations` required by FR12, truncation/case-insensitivity are trust-boundary hygiene); empty-explanations indicator (consistent with app's absence-as-absence model); seed summary-upsert mask (narrow, other events exercise pipeline); theme ranking "relevance+time" underspecification (intent silent, breadth+alpha is a defensible reading); min-h-11 CSS direct-assertion (structural e2e limitation).
- verification_note: `pnpm -r typecheck`/`lint` PASS, `pnpm --filter web build`（无 `DATABASE_URL`）PASS，`pnpm --filter web e2e:search` 18/18 PASS（原 14 + patch 新增 4：within-tier recency、theme memberCount ranking、/search open-redirect guard、truncation boundary），`pnpm --filter web e2e`（base）17/17 PASS 不回归（navigation.spec 四入口断言保持绿）。patch 后全部重跑通过。`db:migrate status` 未触碰（零 schema 改动）。

## Design Notes

**为何用 JS 内存子串匹配而非 Postgres FTS / ILIKE 下推：** 三个候选都能命中三类语料，差异在依赖面与中文面。(1) Postgres FTS（`tsvector` + `GIN` + `websearch_to_tsquery`）：对中文需 `zhparser`/`pg_jieba` 扩展（默认 Postgres 无中文分词），引入扩展 + 迁移 + 索引维护 + 一个新 prisma migration——epic-3-context 明示「Search engine choice is intentionally deferred: V1 may use PostgreSQL full-text capabilities and only adopt a dedicated search stack once real query load appears」，且当前 `schema.prisma` 与全部 9 个 migration 零 FTS 痕迹。(2) ILIKE 下推（`WHERE title ILIKE '%q%'`）：需给既有 filter-free list fn 加 where 或新建 SQL 查询 fn，且仍要解决「三类语料 union + 跨表 join + 相关性分层」——把排序/分层逻辑下推 SQL 反而比 JS 更绕。(3) **JS 内存子串**：本仓 1.7 `filterByWindow`、2.2 association join、2.3 theme-derive 全部是「取全部 published 行 + JS 内存 filter/join」，明示理由「V1 published volume is tiny, filtering is a UI concern」——search 是同一 V1 体量、同一约定。中文子串字符级 `includes` 命中天然正确（无需分词），拉丁 `toLowerCase` 归一。三类语料（标题 + 摘要 + 主题 label）一次性 `Promise.all` 取回后在一个 JS pass 里 union 匹配 + 分层排序，比 SQL union+跨表更直观可测。这是 ponytail：覆盖 FR12 的最短路径，且把「不改既有 filter-free fn 签名、不加迁移、不引扩展」作为硬约束兑现。升级路径明确：真实查询负载出现时，把 `searchPublished` 内部换成 FTS/ILIKE，**调用面（签名/返回类型）不变**——页面与 e2e 无感。

**为何 event 结果分两层而非一个 blended score：** FR12 AC 说「按相关性与时间综合排序」。「相关性」对两类命中字段有天然强弱：标题命中（用户搜的词就在事件名里）远强于解释摘要命中（词出现在 AI 生成的解释正文里）。把两者混成一个 numeric score 再和时间加权，需调权重（魔法数），且中文无 BM25 这类成熟词频信号。ponytail：两个离散 tier（标题 > 摘要），层内纯时间序（`latestEvidenceAt DESC`，复用 feed 既有排序语义）——「相关性分层 + 时间层内序」就是「相关性与时间综合」的诚实、可测、零魔法数实现。一个事件同时命中标题+摘要计一次、归 tier 0（取强信号），避免重复。

**为何搜索入口是 `NavList` 内的 `SearchBox` form 而非 `PRIMARY_NAV_ITEMS` 的一项或 header 内联框：** 三个候选都提供入口，差异在回归面与 IA。(1) 加进 `PRIMARY_NAV_ITEMS`：UX 上最像「一级入口」，但 `navigation.spec.ts:38-39` 硬编码 `PRIMARY_HREFS=["/","/daily","/topics","/favorites"]` + `PRIMARY_LABELS=["首页","日报","主题","收藏"]`，且两个测试标题明写「四个一级入口」——加第 5 项会破坏既有 1.2 spec（违背「1.1~2.5 spec 零改动」惯例，需改 spec 数组 + 两标题）。(2) header 内联搜索框（移动顶栏/桌面顶栏）：移动 header `h-16` 空间紧（汉堡+logo 已占满），加框需重构 header 布局，回归面大。(3) **`NavList` 内 `SearchBox` form**：`NavList` 同时用于桌面 aside 与移动抽屉，在 `<ul>` 前插一个 `<form role="search">` → 两处自动有搜索框，全局可达；`navigation.spec` 断言的是 `NavList` 里的 link 元素（4 个 primary link），一个 form 不是 link、不进 `PRIMARY_LABELS` 迭代 → spec 零改动保持绿。原生 HTML form GET 提交（`action="/search" method="get"`）→ 零客户端 JS、键盘 Enter 原生、`?q=` URL 驱动（可分享、可 back/forward，与 feed 的 `?window=` URL 驱动 filter 一致）。这是 ponytail：单一组件 + 零既有 spec 改动 + 真全局入口。

**为何把 `/search` 加进 `isValidListReturn` allowlist 是 3.1 的职责（而非 3.4）：** 2.5 spec 的 `isValidListReturn` allowlist 当前是 `["/","/daily"]` exact + `["/topics/"]` prefix，其 deferred-work 明示「epic-3 `/search` 路由落地后扩 allowlist」。3.1 落地 `/search` 后，既有 `ListContextMemory` 的捕获监听**自动**在 `/search?q=…` 上点 event 卡时写入 `RETURN_CONTEXT="/search?q=…"`（捕获侧本就覆盖所有 `/events/` 点击，无需改）。但恢复侧 `<BackLink/>` 读出该 href 后须经 `isValidListReturn` 校验——**不扩 allowlist，搜索→详情→返回就 fallback 到 `/`**（丢 query），这是 3.1 用户立即可感知的 UX 缺陷。故扩 allowlist（一行）是「让 `/search` 成为合格 list 面」的必要组成，属 3.1。3.4 则 own 更深的返回闭环：浏览器 back 经 bfcache 不可恢复时的**显式「返回搜索结果」入口**、以及其专属 e2e 断言。本 story 的 e2e 仅断言「经 `<BackLink/>` 恢复搜索 URL」这一既有基建路径，不碰 3.4 的显式入口边案。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（新 search-read 模块 + publish-orchestrator 新 fn + web 新路由/组件 + e2e tsconfig）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（`/search` force-dynamic；`SearchBox` 服务端组件 SSR 安全；nav 仍可在 build 期渲染）
- `pnpm --filter web e2e:search` -- expected: seed 后 `@search` 通过（标题/摘要/主题三语料命中 + 相关性分层 + 无结果反馈 + 空 query 引导 + 桌面键盘提交 + 移动触控提交 + 搜索→详情→返回 URL 恢复 + 匿名可达 + 公共壳不回归）
- `pnpm --filter web e2e` -- expected: 不回归（home/navigation/detail/themes/daily/loop；`SearchBox` 不改 PRIMARY_NAV_ITEMS 构成、复用 EventCard/FilterPill 字节不变）

**Manual checks (if no CLI):**
- 桌面 aside 顶部搜索框输入「芯片」→ Enter → `/search?q=芯片` 渲染标题命中 `EventCard`；换一个仅摘要含的词 → 摘要命中；换主题 label → 主题 `FilterPill`；输入不存在的词 → 「未找到」+ 回首页链；直接 `/search` → 引导态；从结果点 event 进详情点「← 返回首页」→ 落回 `/search?q=芯片`；移动端抽屉内搜索框可触控提交；全程未登录可用。

## Auto Run Result

Status: done

**Summary:** 落地 Epic 3 首发 story 的 FR12 公开搜索——纯读路径，零 schema/迁移/worker 改动。新增 `search-read` core 模块（`searchPublished`：并发取三类 `published_*` 语料 → JS 大小写不敏感子串匹配 → event 两层相关性分层 [标题>摘要] + 层内 recency、theme 按 memberCount DESC + label ASC），新增 `listPublishedHotEventExplanations` sibling 读函数（让 explanation `summary` 进入公开读面），新增 `/search` 路由（force-dynamic，三态：空 query 引导 / 无结果反馈 / 分组命中，复用 `EventCard`+`FilterPill`），新增 `SearchBox`（原生 HTML GET form，渲染在 `NavList` 顶部→桌面 aside + 移动抽屉均可达，不作为 PRIMARY_NAV_ITEMS 一项以保持 navigation.spec 绿），并把 `/search` 加入 `isValidListReturn` allowlist（兑现 2.5 defer：搜索→详情→返回恢复搜索 URL）。

**Files changed:**
- `packages/core/src/modules/search-read/{types.ts,search-service.ts,index.ts}` — NEW `searchPublished`（三语料 JS 匹配 + 两层 event 分层 + theme memberCount 排序，匹配任意 label）。
- `packages/core/src/modules/publish-orchestrator/{types.ts,publish-service.ts,index.ts}` — 新增 sibling `listPublishedHotEventExplanations`（select hotEventId+summary，filter-free，orderBy hotEventId ASC）+ types + barrel。
- `packages/core/src/index.ts` — 总 barrel 导出 search-read + `listPublishedHotEventExplanations` + types。
- `apps/web/app/(public)/_components/search-box.tsx` — NEW 原生 GET form（`aria-label`+`required`+`maxLength` input，无客户端 JS，键盘/触控可达）。
- `apps/web/app/(public)/search/page.tsx` — NEW `/search` 路由（三态 + code-point-safe 截断 + theme count a11y）。
- `apps/web/app/(public)/_components/public-nav.tsx` — `NavList` 顶部渲染 `<SearchBox/>`（PRIMARY_NAV_ITEMS 不变）。
- `apps/web/app/(public)/_components/list-context-memory.tsx` — `LIST_PATH_EXACT` 加 `/search`。
- `apps/web/e2e/{seed-search.ts,search.spec.ts}` — 独立 seed（标题/摘要/主题/within-tier/theme-ranking/takedown 命中）+ @search e2e（18 测：三语料命中、相关性分层、within-tier recency、theme memberCount 排序、无结果、空 query、桌面键盘、移动触控、返回 URL 恢复、/search 开放重定向守卫、截断边界、下线不命中、匿名可达、公共壳不回归）。
- `apps/web/package.json` — `e2e:search`/`seed:search` + `e2e` grep-invert 加 `|@search`。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 追加 3-1 实现期 + 复核期 defer 项。

**Review findings:** 4 层并行复核（adversarial / edge-case / verification-gap / intent-alignment）。intent_gap 0、bad_spec 0。patch 9（medium 3：SearchBox input a11y 标签、theme 语料全 label 可搜、/search 开放重定向守卫测试；low 6：sibling orderBy、input required/maxLength、theme count a11y、code-point-safe 截断、within-tier recency 测试、theme memberCount 排序测试，含截断边界与文档修正）。defer 7（重复 ?q 数组处理、Unicode NFC 归一、slug 规范性、RETURN_CONTEXT 长度 cap、scroll-key 淘汰、query-aware 标题、AD-3 读作用域可验证性）。reject 27（scale/no-cache by-design、schema-enforced、assertion 隔离已成立、spec-sanctioned seed 写、cosmetic、by-design ranking、defensible overshoot 等）。

**Verification:** `pnpm -r typecheck` PASS、`pnpm -r lint` PASS、`pnpm --filter web build`（无 `DATABASE_URL`）PASS、`pnpm --filter web e2e:search` 18/18 PASS、`pnpm --filter web e2e`（base）17/17 PASS。patch 后全部重跑通过。

**Follow-up review:** false（9 patches 多为 localized low-severity；3 medium 均为外科级修复——a11y 属性、主题匹配语义微调、安全测试新增——无 API/数据完整性/架构层变更；全部 fully verified，复杂度低，不构成需独立 follow-up 的显著变更）。

**Residual artifacts:** `_bmad-output/implementation-artifacts/.review-diff-3-1.patch`（复核工作 diff，非变更一部分，未提交）。其余残留风险已登记于 deferred-work.md（FTS/搜索引擎 scale、3.4 返回闭环显式入口等）。
