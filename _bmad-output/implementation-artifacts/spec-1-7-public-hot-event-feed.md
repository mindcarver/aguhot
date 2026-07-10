---
title: '公开热点事件流 (1.7)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '8724e9a31c6831b7b55f49eadfdcb6a6503ca122'
final_revision: 'a3afebc46e3c871261d3c3d4d01e867c1b7570b5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-review-queue-and-publication-gate.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.6 落地了发布闸门与 `published_hot_events` 读模型，但公开首页 `/` 仍是 1-1 的静态壳层——没有任何路由读取读模型，已发布事件永不显现在公开面，epic「可信发布闭环」的"可查看"那一半（viewable）卡在缺公开消费端。同时 `publish-orchestrator` 只写不读（无公开读查询），`published_hot_events` 行存在=已发布的设计契约尚无消费者验证。

**Approach:** 在 `publish-orchestrator`（AD-3 读模型单一拥有者）新增纯读查询 `listPublishedHotEvents({prisma, traceId})`（仅 `SELECT published_hot_events`，按 evidenceCount DESC + latestEvidenceAt DESC 优先级排序），在 `apps/web/(public)/page.tsx` 落地公开热点流——首页转 `force-dynamic`、经 `getPrisma()` 读读模型、渲染卡片（标题/来源数/更新时间/排序理由 chip）。日期窗口筛选经 URL `searchParams` + `<Link>` 驱动（服务端、无 client JS、可分享 URL），活动筛选态可视且可经"全部"清除。落地空态（无已发布）与筛选无结果态（均不渲染假数据）。新增确定性 `@feed` e2e（独立 seed 脚本发布一条 + 留一条未发布候选）：断言已发布标题显现、未发布候选不泄漏、`/` 匿名可达。`next build`（无 `DATABASE_URL`）仍成功（force-dynamic 不在 build 时求值）。本 story 不做一句话解释/分类筛选/市场反应排序理由/详情页整卡点击（数据依赖 1.8/Epic 2，记 defer）。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：首页 `/` 只 `SELECT published_hot_events`，绝不读 `hot_events` / `evidence_records` / `review_decisions` / `publication_decisions` / `hot_event_evidence`。`listPublishedHotEvents` 是该读模型的首个公开消费者；行存在=当前已发布（无 status 列、无 WHERE 过滤可遗忘，沿用 1-6 读模型契约）。
- `next build` 保持无 `DATABASE_URL`（1-6 build 不变量延续）：首页声明 `export const dynamic = "force-dynamic"`（沿用 `(operator)/console` 既有机制），`getPrisma()` 仅在请求时被调、不在 build 时求值；`(public)/layout.tsx` 及 `/daily` `/topics` `/favorites` `/design` 保持静态、不 import `@aguhot/core`。首页 import `@aguhot/core` 是 AD-3 公开读的必然结果——隔离手段从"公开路由不 import core"演化为"DB 读路由 force-dynamic"，build 不变量不破。
- 匿名可达（AD-8）：首页无认证、无 `/login` 重定向；登录态仍仅用于收藏/关注/偏好。
- URL 驱动筛选（native platform 优先）：日期窗口经 `searchParams`（`?window=today|7d|30d|all`，默认 all）+ `<Link>` 服务端渲染；活动 pill 用 brand 态、可见；"全部" pill 即清除控件（恒可见）。不引入 client component / `useState` 管理筛选态。
- 诚实状态、绝不假数据（NFR）：无已发布 → "暂无公开展示的热点事件" 空态（不渲染骨架假卡）；有已发布但窗口内无 → "当前筛选条件下无热点事件" + 清除链接；运行时 `DATABASE_URL` 缺失 → `getPrisma` 显式抛错（大声失败、不静默空态）——与"外部市场数据缺失才优雅降级"区分（DB 是核心 infra，下线即事故）。
- 排序理由只在有信号时呈现：`evidenceCount ≥ 3`（多源覆盖）或 `latestEvidenceAt` 在近 72h（近期升温）才渲染 chip；两者皆无则不渲染（不伪造理由）。排序本身（evidenceCount DESC, latestEvidenceAt DESC）始终生效。
- token 安全：卡片/筛选用**真实解析**的 token（`bg-surface-raised` / `border-border-hairline` / `rounded-lg` / `ink-*` / `bg-brand` 等）；**不得**复制 1-6 运营台漂移的未定义 token（`bg-surface` / `border-line-subtle` / `bg-brand-strong`，Tailwind v4 下不解析）。时间/计数用 `font-mono`（IBM Plex Mono 数字层），标题用 sans。
- 不变性约定（沿用 1-4/1-5/1-6）：状态/种类用 `const … as const` + union（禁 TS `enum`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；查询每调带 `traceId`；时间 UTC、展示 ISO 8601 / 稳定格式。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（`verify:publish` 扩展断言或 `e2e:feed` seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 引入首页 force-dynamic + import `@aguhot/core` 导致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT（公开 build 必须保持 DATABASE_URL-free）。

**Never:**
- 不实现一句话解释/摘要（数据归 1.8 explain job → `ExplanationVersion`，读模型当前无解释列；不在 1.7 预埋无消费者列）。
- 不实现分类筛选（分类/概念/行业关联归 Epic 2 / 2-2，读模型无 category 列；不伪造分类维度）。日期窗口筛选是本 story 唯一落地的筛选维度。
- 不实现市场反应排序理由/`ReactionChip` 在流卡上的消费（市场反应数据归 Epic 2 / 2-1；1.7 排序理由只用 evidenceCount + recency 两信号）。
- 不实现整卡点击进详情（详情页归 1.8；1.7 卡片为静态信息卡，不渲染指向不存在路由的链接、不假装可点击）。
- 不新增 Prisma schema/迁移（仅读既有 `published_hot_events`）；不新增 BullMQ 队列/worker；不新增第三方依赖；不引入 client component 驱动筛选（URL 驱动）。
- 不改 1-6 既有 `console.spec.ts` / `seed-console.ts` 断言与 seed（console seed 不发布任何候选，故 1.7 后 `/` 对该 seed 仍显空态、console AC3 候选不泄漏断言仍成立——零改动保持绿）。
- 不读 `hot_events`/证据表绕过读模型；不让 `(public)/layout.tsx` 或其它公共页 import `@aguhot/core`（仅首页 page）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 已发布事件渲染（AC1） | `published_hot_events` 有 N 行，首页 `/`（`?window=all`） | force-dynamic 读读模型；渲染 N 张卡片，按 evidenceCount DESC + latestEvidenceAt DESC 排序；每卡：标题、来源数（evidenceCount，`font-mono`）、更新时间（latestEvidenceAt）、排序理由 chip（仅 evidenceCount≥3 或近 72h） | 无错误预期 |
| 未发布不泄漏（AC2） | candidate/rejected/taken_down 事件（读模型无对应行） | 这些事件的标题/内容不出现在 `/`；结构隔离（读模型只有已发布行） | 无错误预期 |
| 空发布流（AC1） | `published_hot_events` 为空 | `/` 渲染"暂无公开展示的热点事件"空态文案（不渲染假卡/骨架假数据） | 无错误预期 |
| 日期窗口筛选收窄（AC3） | 有已发布，用户选 `?window=7d` | 仅 latestEvidenceAt 落近 7 天的事件渲染；该 pill 为 brand 活动态；URL 可分享 | 无错误预期 |
| 清除筛选（AC3） | 已应用窗口，用户点"全部" | 全部已发布渲染；活动 pill 清除；不丢失页面上下文（仍在 `/`） | 无错误预期 |
| 筛选无结果（AC3） | 有已发布但窗口内为 0 | "当前筛选条件下无热点事件" + 清除链接（区别于"无已发布"空态） | 无错误预期 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错 → 路由错误（大声失败，非静默空态）；`next build`（无 DB）仍成功（force-dynamic） | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：新增纯读 `listPublishedHotEvents({prisma, traceId})`（`prisma.publishedHotEvent.findMany`，select hotEventId/title/evidenceCount/latestEvidenceAt/publishedAt，orderBy evidenceCount desc + latestEvidenceAt desc；无 where、无写、无 since 参数）；AD-3 读模型拥有者首次提供公开读
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY（若不存在则 NEW，与 publish-service 同模块）：`ListPublishedHotEventsOptions`({prisma, traceId})、`PublishedHotEventSummary`({hotEventId, title, evidenceCount, latestEvidenceAt, publishedAt})
- `packages/core/src/index.ts` -- MODIFY：桶追加 `listPublishedHotEvents` + `PublishedHotEventSummary`/`ListPublishedHotEventsOptions` 类型导出
- `apps/worker/src/verify-publish.ts` -- MODIFY：在既有 approve 后追加断言 `listPublishedHotEvents` 返回该已发布行（title/evidenceCount/latestEvidenceAt 一致），takedown 后断言返回集不含该行（锁公开读契约，仅需 live PG）
- `apps/web/app/(public)/page.tsx` -- REWRITE：`export const dynamic = "force-dynamic"`；`async function Page({ searchParams }: { searchParams: Promise<{window?:string}> })`；`getPrisma()` + `listPublishedHotEvents({prisma, traceId: newTraceId()})`；保留 masthead（H1「AGUHOT」sans-bold + 副标「可信热点发布闭环」，延续 home.spec 断言）；URL 窗口 → JS 按 latestEvidenceAt 过滤；渲染 `<FeedFilters window>` + 卡片 `<ul role="list">` 或空态/无结果态
- `apps/web/app/(public)/_components/event-card.tsx` -- NEW（server component）：props `{ title, evidenceCount, latestEvidenceAt, publishedAt }`；渲染 `bg-surface-raised border border-border-hairline rounded-lg` 卡（标题 ink-primary sans-semibold、来源数/时间 `font-mono text-xs text-ink-tertiary`、排序理由 chip 仅 evidenceCount≥3「多源覆盖」或近 72h「近期升温」）；1.7 不渲染链接（详情归 1.8）
- `apps/web/app/(public)/_components/feed-filters.tsx` -- NEW（server component）：props `{ window: string }`；渲染日期窗口 pill 组（今日/近7天/近30天/全部）为 `<Link href="?window=…">`，当前窗口=active（brand 态）；复用 FilterPill 类样式
- `apps/web/components/chips.tsx` -- MODIFY：`FilterPill` 加可选 `href?: string`，提供时渲染为 `<Link>`（同 active/default 类样式）——1-7 是 filter-pill 首个真实消费者（1-3 deferred 预期）；保留无 href 的 `<span>` 显示用途
- `apps/web/e2e/seed-feed.ts` -- NEW：独立 seed（`tsx`，`resetEnvCache`→`requireEnv("DATABASE_URL")`→清表→建 1 source + 确定性 records→`clusterEvents`→对其中一条 `decideReview({outcome:"approve"})` 产 1 已发布 + 留 ≥1 未发布候选→`resetPrisma`）；自包含、不触碰 seed-console.ts
- `apps/web/e2e/feed.spec.ts` -- NEW（describe 标题含 `@feed`）：前置 `tsx e2e/seed-feed.ts`；断言 `GET /` 200 且无 `/login` 重定向（AD-8）、已发布标题在 `/` 可见（AC1）、未发布候选标题不可见（AC2）
- `apps/web/package.json` -- MODIFY：加 `e2e:feed`（`tsx e2e/seed-feed.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @feed`）与 `seed:feed`；**改 `e2e` 的 `--grep-invert` 为 `"@console|@feed"`**（否则无 seed 的 `e2e` 轨会误纳需 seed 的 `@feed` 用例而失败）；`e2e:console` 不动
- `apps/web/e2e/home.spec.ts` -- MODIFY（最小）：保留 AD-8 可达性 + H1「AGUHOT」+ 「可信热点发布闭环」断言（masthead 延续即仍绿）；这些断言现需请求期 `DATABASE_URL`（首页已 force-dynamic）——在文件头注释说明该演化
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-7 defer（一句话解释/分类筛选/市场反应排序理由/整卡进详情/骨架与流式、`pnpm e2e` 现 request 期依赖 DATABASE_URL、`listPublishedHotEvents` V1 全表读+JS 过滤的 scale ceiling、filter-pill clear 态目前以"全部" pill 实现）

## Tasks & Acceptance

**Execution:**
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts}` + `src/index.ts` -- 加纯读 `listPublishedHotEvents`（findMany + 排序，无 where/无写）+ 类型 + 桶导出 -- AD-3 读模型拥有者首次提供公开读，首页消费入口
- `apps/worker/src/verify-publish.ts` -- approve 后断言读查询返回该行、takedown 后断言不含 -- 锁公开读契约（surface = 查询返回集）
- `apps/web/app/(public)/page.tsx` -- force-dynamic + getPrisma + 读查询 + searchParams 窗口 + masthead + 卡片列表/空态/无结果态 -- AC1/AC2/AC3 公开流主面
- `apps/web/app/(public)/_components/{event-card.tsx,feed-filters.tsx}` + `components/chips.tsx`(FilterPill href) -- 卡片（token 安全、排序理由 chip）+ URL 驱动日期窗口筛选 pill（active/clear） -- AC1 卡片字段 + AC3 筛选可视可清除
- `apps/web/e2e/{seed-feed.ts,feed.spec.ts}` + `package.json:e2e:feed` + `home.spec.ts` 注释 -- 独立 seed（发布 1 + 留未发布）+ @feed e2e（已发布可见/未发布不泄漏/AD-8 可达）-- AC1/AC2/AD-8 surface-anchored 验证；console seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-7 defer 项（解释/分类/市场反应/详情点击/骨架/DB 依赖演化/读查询 scale ceiling）-- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 1-6 迁移已应用（`published_hot_events` 表存在），When 经 `decideReview(approve)` 发布一候选后访问 `/`，Then 该已发布事件以卡片显现（标题/来源数/更新时间，evidenceCount≥3 或近期时附排序理由 chip），And 候选/驳回/下线事件（读模型无行）不显现，And `listPublishedHotEvents` 仅 `SELECT published_hot_events`（不触及其它表）。
- Given `published_hot_events` 为空，When 匿名访问 `/`，Then 渲染"暂无公开展示的热点事件"空态（无假卡），And 返回 200、无 `/login` 重定向（AD-8）。
- Given 有已发布事件，When 用户经 URL 选 `?window=7d`，Then 仅 latestEvidenceAt 落近 7 天的事件显现、该 pill 为活动 brand 态，And 选"全部"恢复全部且清除活动态，And 窗口内为 0 时显"当前筛选条件下无热点事件" + 清除链接。
- Given 首页 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功（DB 读路由不在 build 时求值），And `pnpm -r typecheck` / `pnpm -r lint` 通过，And `pnpm --filter worker verify:publish` 打印 PASS（含新读查询断言）。
- When 执行 `pnpm --filter web e2e:feed`（seed + `@feed`），Then `/` 200 且已发布标题可见、未发布候选标题不可见；And `pnpm --filter web e2e`（home/navigation/design）全绿（home/navigation/design 现 request 期依赖 `DATABASE_URL`，因首页已 force-dynamic——属 1-7 有意演化，文件头注释说明）；And `pnpm --filter web e2e:console` 不回归（console AC3 候选不泄漏仍成立，因 console seed 不发布）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

<!-- 空，直至首次评审。 -->

## Design Notes

**为何公开首页从"静态/不 import core"演化为"force-dynamic + import core"不破 1-6 build 不变量：** 1-6 的"公开路由不 import `@aguhot/core`"是达到"`next build` 无 `DATABASE_URL`"这一**目的**的**手段**，非目的本身。1-7 是 AD-3（公开面只读发布态读模型）的首次落地——首页**必然**要 import core 调 `listPublishedHotEvents`。隔离手段随之演化为"DB 读路由声明 `force-dynamic`"（沿用 `(operator)/console` 既有机制）：force-dynamic 路由不在 build 时静态求值，故其 core import / `getPrisma()` 调用不在 build 期触发 `requireEnv("DATABASE_URL")`，build 仍 DB-free。`(public)/layout.tsx` 及其它公共页保持静态、不 import core，故仅 `/` 动态。运行期 `pnpm e2e` 因 `goto("/")` 需 DB——这是 AD-3 公开读的必然结果，1-6 无法预见（彼时无公开 DB 读），属有意演化而非回归（dev 环境本就跑 PG）。`(public)/layout.tsx` 保持静态是关键：nav chrome 不被首页动态化拖入 DB 依赖。

**为何一句话解释/分类筛选/市场反应排序理由/整卡进详情全部 defer 而非伪造：** 读模型（`published_hot_events`）当前列集为 1-6 最小集（title/evidenceCount/latestEvidenceAt/publishedAt），**无**解释列、**无** category、**无** market reaction——这些数据分别归 1.8（explain job → `ExplanationVersion`）、Epic 2.2（概念/行业关联）、Epic 2.1（市场反应信号）。epic 列出的卡片字段与"分类筛选维度"AC 无法在无数据时满足：伪造一句话解释/分类/市场反应 chip 直接违反 NFR"空态绝不渲染假数据"且违反 AD-3（如为凑解释去读 `evidence_records` 摘要）。这**不是 intent gap**（无任何"应实现"的可辩护读法——数据不存在），而是与 1-6 defer 运营认证同型的**数据依赖 defer**：1.7 只呈现读模型实有字段（标题/来源数/更新时间/排序理由），其余字段随其数据源（1.8/Epic 2）落地时接入。排序理由只用 evidenceCount（多源）+ recency（近期）两信号；市场反应理由待 Epic 2。整卡点击待 1.8 详情页（不渲染指向不存在路由的链接）。`ponytail:` 不预埋无消费者读模型列、不为不存在的数据造 UI。

**为何日期筛选用 URL `searchParams` + `<Link>` 而非 client state：** URL 即状态——服务端渲染、零 client JS、可分享/可后退、刷新不丢筛选；"全部" pill 恒为清除控件（epic"活动筛选可视且可清除，不丢阅读上下文"原生满足）。这是 native platform（URL/query string）优于自建 `useState` 筛选的典型场合（ponytail 梯级 3）。`FilterPill` 加 `href` 渲染为 `<Link>` 是其首个真实消费者（1-3 deferred「真实过滤器落地时接入」正此时）；"clear" 态以"全部" pill 实现，不额外造可 dismiss chip（YAGNI）。`searchParams` 在 Next 16 为 Promise，首页 `await` 之。

**为何 `listPublishedHotEvents` 不带 `since` 参数、窗口过滤放 web 层：** 一次 `findMany` 返回全部已发布（V1 规模极小——ingest 每批数条到数十条，已发布子集更少），web 层按 `latestEvidenceAt` JS 过滤窗口、并据此区分"无已发布"空态 vs"窗口无结果"态（同一次查询即得 totalExist）。core 只担优先级排序（evidenceCount+recency，产品规则/域），窗口是 UI 关注点（web）。`ponytail:` 全表读 + JS 过滤有 scale ceiling（已登记 defer：已发布集增长后改 SQL `WHERE latest_evidence_at >= $1` + 索引）；不预埋无消费者的 `since` 参数。verify:publish 在 approve/takedown 后断言读返回集，锁公开读契约。

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: 全 workspace 通过（core 前置 `prisma generate`；含新读查询类型 + web 消费）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:publish` -- expected: 集成脚本打印 PASS（含 approve 后 `listPublishedHotEvents` 返回该行、takedown 后不含的新断言）；仅需 live PG
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（首页 force-dynamic 不在 build 求值；其它公共页静态；公开 build 仍 DATABASE_URL-free）
- `pnpm --filter web e2e:feed` -- expected: seed 后 `@feed` 通过（`/` 200 + 已发布标题可见 + 未发布候选标题不可见）
- `pnpm --filter web e2e` -- expected: home/navigation/design 全绿（现 request 期需 `DATABASE_URL`，首页 force-dynamic 所致——有意演化）
- `pnpm --filter web e2e:console` -- expected: 不回归（console AC3 候选不泄漏仍成立）

**Manual checks (if no CLI):**
- 已发布事件在 `/` 按 evidenceCount+recency 排序呈现卡片；活动窗口 pill 为 brand 态、点"全部"清除；空 DB 显"暂无公开展示的热点事件"；窗口无结果显"当前筛选条件下无热点事件"；未发布候选标题绝不泄漏；首页匿名可达无登录墙。
