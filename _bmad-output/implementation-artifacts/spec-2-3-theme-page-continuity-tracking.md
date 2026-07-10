---
title: '主题页连续追踪 (2.3)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'b9fe7f717803bb89434126716550966de2e92bd8'
final_revision: '622fa97ea8792df1f418c726a2d72bfd626c3988'
review_loop_iteration: 0
followup_review_recommended: false # 7 patches all low-consequence (verification strengthening + determinism + AC2 fail-fast hardening); no API/security/data-integrity or broad behavioral change
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-concept-industry-and-stock-associations.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 2.1 落地详情「市场反应」、2.2 落地详情「概念/行业/个股关联」，但热点仍是孤立单点——读者无法把多次事件串成一条「主题主线」（如「芯片短缺」随时间牵动哪些热点）。epic-2-context 明确 `HOT_EVENT }o--o{ THEME`（多对多主题成员——连续性基底）尚未建：`Theme` 聚合、主题成员写表、`theme-backfill` job（epic 列明的三 Epic-2 BullMQ job 类目之一，回填历史事件到主题、驱动 FR9 连续性与 FR11 演进）、公开主题读模型、主题页（`/topics` 目录 + `/topics/{slug}` 时间序列页）、详情→主题跳转（FR9）全部缺失；`/topics` 仍是静态占位页，主图「主题」入口指向死页面（违反闭环）。

**Approach:** 在 `theme-linking` 模块（2.2 已建 concept/industry/stock 关联，本 story 扩 `Theme` 成员——AD-2 该模块拥有 Theme 关联）新增主题子域，**镜像 2.2 关联的端到端形态**（ponytail：同一模块、同形端口/桩/服务/读模型/section/降级，避免再造一套异形抽象）：`ThemeAdapter` 端口（AD-7，主题知识源经端口接入，V1 无 SDK）+ `StubThemeAdapter`（确定性测试双桩，**仅 verify/e2e 用**）+ `generateThemes`（从 adapter 派生 `ThemeRef[]`（每项 `slug`/`label`/`mappingBasis`）——adapter 缺失/返回 null/空数组→返回 null、不写，诚实降级；缺 mappingBasis/slug/label→抛错，AC2 强制）+ append-only `EventThemeSet` 写表（一次生成一行，`items Json`，`HOT_EVENT ||--o{ EVENT_THEME_SET`）。复用 `publish-orchestrator`（AD-3 公开读模型唯一拥有者）扩 `refreshPublishedReadModel`：publish 分支 `projectThemes`（读最新 set→upsert 第 6 张 published 表 `published_hot_event_themes`，无则 deleteMany），takedown 分支 deleteMany 该第 6 表（与既有五表同批清，保持「行存在=已发布」契约）；`getPublishedHotEventDetail` 加第 6 个读 + 返回新 `themes` 字段；新增 `listPublishedThemeMemberships`（镜像 `listPublishedAssociations`，供主题页 JS 过滤）。新增 `theme-backfill` BullMQ worker（**镜像 2-1 `market-reaction-queue.ts`**：lazy Queue 单例 + `enqueueThemeBackfill` + `registerThemeBackfillWorker`，eligible = published 且无 theme set，per-event try/catch，append 后 `refreshPublishedReadModel(publish)`，adapter resolve 为 undefined→诚实 `{generated:0,skipped}`，stub 绝不被 worker import——区别于 2.2 关联无 worker，因 theme-backfill 是 epic 明列 job 类目）。Web 落地：`/topics` 目录页（替换静态占位，动态列主题）、`/topics/[slug]` 主题页（按时间升序聚合成员事件、每项链回 `/events/{id}` 即 FR11、未知 slug→404 不造假）、详情页加「主题」section（FR9，每主题为可点击 `<FilterPill>` 链 `href=/topics/{slug}`、显 provenance「关联依据：系统映射」、无 set→降级文案）。V1 不接真实主题知识源（采购 defer）——worker 在 prod adapter 缺失→不生成→诚实降级；`StubThemeAdapter` 仅 verify/e2e 直调 `generateThemes` 走通 happy path。新增 `verify:themes`（worker，直调 stub）与 `@themes` e2e（独立 seed：产 ≥2 已发布共享同主题 + 1 已发布无主题；验证主题页时间序列、详情→主题跳转、主题→详情跳转、未知 slug 404、降级态）。不做 2.5 跨页返回路径上下文（scroll/filter）恢复（归 2.5）、不做运营主题修订 UI、不接真实知识库/NER/LLM、不改 worker 解耦/不做 cron 自动编排、不做主题成员移除/版本化、不做主题合并/拆分——均记 defer。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：主题页（`/topics`、`/topics/[slug]`）与详情主题 section 只经 `listPublishedHotEvents`+`listPublishedThemeMemberships`/`getPublishedHotEventDetail` 读 `published_hot_event_themes`（+ 既有五表/summary），绝不读 `event_theme_sets`/`hot_events`/`evidence_*`。`themes` 是详情读模型新增字段；行存在=当前已发布主题集（无 status 列、无 WHERE 可遗忘，沿用 1-6~2-2 读模型契约）。`published_hot_event_themes` 由 `publish-orchestrator` 投影（epic-2-context「theme page reads only published_* generated/refreshed by publish-orchestrator」），**非** theme-linking 模块直写。
- 写归属（AD-2 单一写拥有者）：`theme-linking` 仅拥有 `event_theme_sets`（append-only 写表，一次生成一行，永不 update/delete 旧行）；`publish-orchestrator` 拥有 `published_hot_event_themes` 投影。theme-linking **绝不**写 `hot_events`/`published_*`/`evidence_*`/`market_reaction_snapshots`/`event_association_sets`。主题成员身份（哪个 Theme 与事件相关、可点击）归 theme-linking。
- 明确映射依据 + 非建议性（AC2/NFR）：每个 `ThemeRef` 必须带非空 `mappingBasis`、非空 `slug`、非空 `label`；adapter 返回的每一项缺任一→`generateThemes` 抛错（**不** silently 填充默认）。主题 section/页显「关联依据：系统映射」provenance。主题 `label` 只描述主题概念身份（如「芯片短缺」），**绝不**含买卖/目标价/持仓/增持减持措辞（沿用 1-8/2-1/2-2 `noInvestAdvice` 惯例）。`verify:themes` 断言每项三字段非空 + 无投资建议关键词。
- adapter 端口（AD-7）：主题知识源（主题映射库/NER/LLM）仅经 `ThemeAdapter` 接口进入；domain 不依赖第三方 SDK（V1 无 SDK）。`generateThemes({prisma,traceId,hotEventId,adapter?})`——`adapter` 缺失/返回 null/返回空数组→返回 null、不写 set（诚实降级，非造假）。
- append-only（AD-5 风格）：`EventThemeSet` 永不 update/delete，每次生成 append 一行；公开投影取该 hotEvent 最新一行（`createdAt` desc、`id` desc tiebreaker——UUIDv7 单调，沿用 1-8/2-1/2-2 修复）。多次生成追加多行版本（公开取最新）；V1 无自动触发（verify/seed 显式调 + worker 回填），cron/编排 defer。
- 主题成员关系诚实（epic-2-context）：证据不足以将事件关联到主题时，系统**什么都不显示**而非伪造「相似历史」。无 set → 详情「主题」section 显降级文案、主题页未知 slug → 404、`/topics` 无主题 → 「暂无已确认的主题。」；**不**留空、**不**造假主题、**不**因缺数据阻断既有 summary/explanation/evidence/reaction/associations 渲染。
- 闭环跳转明确且非死链（AC1/AC4/FR9/FR11）：详情「主题」section 每个主题为可点击 `<FilterPill>` 链 `href=/topics/${encodeURIComponent(slug)}`（FR9）；主题页每个成员事件链回 `/events/{hotEventId}`（FR11）；`/topics` 目录每主题链 `/topics/{slug}`。死链是 defect。链目标必须真实存在（主题页有 ≥1 已发布成员、详情 id 已发布），否则 404。
- `theme-backfill` worker 诚实（镜像 2-1）：worker resolve `adapter = undefined`（V1 无真实主题知识源）→ eligible 事件 `generateThemes` 返回 null → `{generated:0, considered, skipped}`，**不**造假主题。`StubThemeAdapter` 是 TEST-ONLY，`apps/worker` **绝不** import 它（与 2-1/2-2 stub 惯例一致）；真实 provider 落地时只换 adapter 装配。
- `next build` 保持无 `DATABASE_URL`（1-6~2-2 build 不变量延续）：`/topics`、`/topics/[slug]`、详情路由均 `force-dynamic`，新增主题 section/页不改既有路由动态性；`(public)/layout.tsx` 及静态公共页（`design`）仍不 import `@aguhot/core`。
- token 安全：主题 section/页用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`border-border-hairline`/`ink-*`），主题项复用既有 `<FilterPill>`（active/clear 态/链态，1.3/1.7/2.2 已落地）；主题页标题用编辑级衬线 `font-display`（UX 主题/section/日报标题惯例）；系统派生主题内容带统一 `<AiLabel>`（UX-DR8）。
- 不变性约定（沿用 1-4~2-2）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601/稳定格式；PK UUIDv7（`newTraceId()`）；items 用 Prisma `Json` 列存 `ThemeRef[]`（变量基数结构，display-only，不做规范化子表/Theme 目录表——ponytail，沿用 2.2 items Json 决策）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:themes` 或 `@themes` e2e seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 新增模型/模块致 `pnpm -r typecheck`/`lint` 回归 → HALT。
- `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。

**Never:**
- 不接真实主题知识源 / 映射库 / NER / LLM（无 API key/SDK/网络调用；V1 `StubThemeAdapter` 纯确定性 fixture，**且仅 verify/e2e 用、不在 worker/prod 接线**——fixture 主题上公开页而无真实映射依据会误导读者，违反 NFR「absence as absence」+ AC2「禁止随意映射」）。具体知识源采购 defer。
- 不做 worker cron / 自动编排 / publish→theme 自动触发 / job 链式（沿用 2-1「四 worker 独立、解耦、不自动链」不变量；worker 文件 + 注册是本 story 交付物，运行时由 verify 直调 core 验证逻辑、worker 运行时实测 defer）。`theme-backfill` worker 在 prod 仅占位（adapter 缺失→skip），真实触发/cron defer。
- 不做主题成员移除 / 版本化 / 回滚（V1 主题成员只追加，append-only set 取最新；移除语义、成员版本化 defer）。不做主题合并 / 拆分 / 重命名（归未来 taxonomy 治理 defer）。
- 不做 2.5 跨页返回路径上下文恢复（scroll 位 / filter 态 / 阅读上下文，UX-DR12 完整恢复归 2.5；本 story 仅做基本导航：详情→主题链、主题→详情链、主题页「← 返回」链 + 浏览器原生 back，深度上限一层）。不做运营主题 curated UI（运营手填主题无映射依据违反 AC2，需先 taxonomy + 依据机制，defer）。
- 不做 WebSocket/SSE 主题实时推送（V1 靠读模型刷新 + 主动轮询，epic defer）。不做「历史相似事件」相似度判断（超出主题成员关系的相似性推理 defer）。
- 不做主题目录 `Theme` 规范化目录表 / 主题成员规范化子表（沿用 2.2 items Json 决策：主题身份 slug/label 存 per-event Json，`/topics` 目录由 memberships 反推 distinct，不为尚不存在的 SQL 单主题查询预建表——ponytail）。
- 不在公开主题/详情读 `event_theme_sets`/`hot_events` 绕过读模型；不让既有公共页（`design` 等）新 import `@aguhot/core`；不改 1-6~2-2 既有 verify/seed/spec 断言（console/feed/detail/revision/merge-split/market-reaction/associations seed/spec 零改动保持绿，新表 FK Cascade 使既有 reset 不需扩）；不改 `listPublishedHotEvents`/`listPublishedAssociations` 签名（主题页过滤在 web 层 JS，沿用 1-7/2.2 window/association 过滤模式）；不改 `(public)/layout.tsx`（主图「主题」入口已指向 `/topics`，仅需把占位页换动态）。
- 不渲染投资建议措辞（无买卖/目标价/持仓，NFR）；不新增 `SourceAdapter`/`LLMAdapter`/`MarketDataAdapter`/`AssociationAdapter`；不改 `packages/config/src/env.ts`（V1 无主题知识源 env，adapter defer）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 已发布+adapter 可得→生成+投影（AC1/AC2） | 某 hotEvent 已 `published`、`adapter` 返回非空 `ThemeRef[]`（每项带 slug/label/mappingBasis 非空），`generateThemes` | append 一行 `event_theme_sets`（items 含 ≥1 项、每项 slug/label/mappingBasis 非空、`source="template"`、`traceId`）；随后 `refreshPublishedReadModel(publish)` upsert `published_hot_event_themes`；`getPublishedHotEventDetail` 返回非 null `themes`（items） | 无错误预期 |
| 主题页时间序列聚合 + 成员跳转（AC1/FR11） | 多个已发布事件共享同 slug（经 stub）、`GET /topics/{slug}` | 主题页 200、编辑级衬线标题显该 slug 的 label、成员事件按 `latestEvidenceAt` **升序**（时间序列，连续性叙事）呈现、每成员为可点击链 `/events/{hotEventId}`；带 `<AiLabel>` | 无错误预期 |
| 详情→主题跳转（AC4/FR9） | 已发布且有 theme 投影，`GET /events/{id}` | 「主题」`<section>` 渲染 ≥1 个可点击 `<FilterPill>` 链 `href=/topics/{slug}`、显「关联依据：系统映射」provenance、带 `<AiLabel>`；点链到达主题页 | 无错误预期 |
| `/topics` 目录列主题 | ≥1 已发布事件含主题，`GET /topics` | 目录页列 distinct 主题（slug→label），每项链 `/topics/{slug}`；带 `<AiLabel>` | 无错误预期 |
| 主题不可得→详情降级（AC3/NFR） | 已发布但无 theme set（adapter none / 未生成 / takedown 后），`GET /events/{id}` | 「主题」section 显「暂无已确认的主题关联。」降级文案；**不**留空、**不**造假项；其余 summary/explanation/evidence/reaction/associations 照常渲染 | 无错误预期 |
| 未知/空主题 slug→404（AC3 不造假） | slug 无任何已发布成员（adapter 未产出/未知主题），`GET /topics/{unknown}` | `notFound()`（404）；**不**渲染空主题页（伪造「无内容主题」违反 epic 连续性诚实） | 404 |
| 无任何主题→目录降级 | 无已发布事件含主题，`GET /topics` | 「暂无已确认的主题。」降级文案；**不**造假主题项 | 无错误预期 |
| adapter 缺失/空→不写（NFR 不造假） | `generateThemes({adapter:undefined})` / adapter 返回 null / 返回 `[]` | 返回 null、**不** append 任何 `event_theme_sets` 行（无数据→不生成→降级） | 无错误预期 |
| 缺映射依据/slug/label→拒写（AC2 强制） | adapter 返回项某项 `mappingBasis`/`slug`/`label` 空/缺 | `generateThemes` 抛错（不 silently 填默认）、不 append | 显式错误（非法 adapter 输出） |
| append-only + 投影取最新（AD-5） | 同 hotEvent 已有 ≥1 set，再次 `generateThemes` | append 新行（旧行不 update/delete）；`refresh` 后 `published_hot_event_themes.generatedAt` = 最新行 `createdAt`、items = 最新行 items | 无错误预期 |
| theme-backfill worker 诚实（镜像 2-1） | worker 运行、adapter resolve undefined（V1 prod） | eligible（published 且无 theme set）事件 `generateThemes` 返回 null → `{generated:0, considered, skipped}`、不 append、不投影 | 无错误预期 |
| takedown 清第 6 表 | 已发布（含 theme 投影）→`decideReview(takedown)` | `published_hot_event_themes` deleteMany（与既有五表同批）；之后 `getPublishedHotEventDetail` 返回 null（404，AD-8 不泄漏） | 无错误预期 |
| 未发布 id 不泄漏（AD-8） | candidate/rejected/taken_down/未知 id，`GET /events/{id}` | `getPublishedHotEventDetail` 返回 null→`notFound()`（404） | 404 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错；`next build`（无 DB）仍成功 | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 2 模型。`EventThemeSet`（id UUIDv7 PK, hotEventId FK→hot_events onDelete Cascade, items `Json`（存 `ThemeRef[]`）, source String, traceId String?, createdAt；`@@index([hotEventId])` `@@index([createdAt])` `@@map("event_theme_sets")`）。`PublishedHotEventTheme`（hotEventId PK/FK→hot_events onDelete Cascade, items `Json`, themeSource `@map("theme_source")`, generatedAt `@map("generated_at")`, traceId String?, updatedAt `@updatedAt` `@@map("published_hot_event_themes")`）。在 `HotEvent` 加只读反向导航 `eventThemeSets EventThemeSet[]`、`publishedTheme PublishedHotEventTheme?`（元数据，不改 event-assembly 写归属，沿用 schema 既有 AD-2/AD-6 注释惯例）
- `packages/core/prisma/migrations/<ts>_theme_read_models/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name theme_read_models` 生成（2 张新表 + 索引 + FK Cascade；hot_events 反向关系无列、仅 Prisma 导航）
- `packages/core/src/modules/theme-linking/types.ts` -- MODIFY：追加 `ThemeRef`（{slug: string; label: string; mappingBasis: string}——非空映射依据+身份，AC2）、`ThemeSource`（template const，未来 knowledge-base/provider id）、`ThemeAdapter`（端口 interface `fetchThemes({hotEventId}): Promise<ThemeRef[] | null>`，镜像 `AssociationAdapter`）、`GenerateThemesOptions`({prisma,traceId,hotEventId,adapter?})、`GenerateThemesResult`、`GetLatestThemeSetOptions`、`ThemeSetRecord`。`PrismaClient` 从 `../../../generated/client.js` 导入
- `packages/core/src/modules/theme-linking/theme-adapter.ts` -- NEW：`ThemeAdapter` 端口 interface（镜像 `adapter.ts`/`market-reaction/adapter.ts` 注释风格：domain 依赖端口、concrete adapter 在 worker/assembly 层解析、provider swap 不动 domain；V1 无 SDK）。类型从 `./types.js` 导入，`export type { ThemeAdapter } from "./types.js"`
- `packages/core/src/modules/theme-linking/stub-theme-adapter.ts` -- NEW：`StubThemeAdapter implements ThemeAdapter`——确定性 fixture（`fetchThemes` 返回固定非空 `ThemeRef[]`：{slug:"chip-supply-chain",label:"芯片供应链",mappingBasis:"knowledge_base:v1"}，三字段非空）。导出 `STUB_THEME_SLUG="chip-supply-chain"`、`STUB_THEME_LABEL="芯片供应链"` 供 seed/spec 复用。**仅 verify/e2e 消费**，头注释标明「TEST-ONLY: not wired in worker/prod; real theme knowledge source/provider deferred」
- `packages/core/src/modules/theme-linking/theme-service.ts` -- NEW：`generateThemes({prisma,traceId,hotEventId,adapter?})`（adapter 缺失→null；`fetchThemes` 返回 null/`[]`→null、不写；否则校验每项 `mappingBasis`/`slug`/`label` 非空（空→抛错，AC2 强制）→ normalize（dedup by slug、保序、丢弃含 `/` 的非法 slug 仅记 observability defer）→ append 一行 `event_theme_sets`，items=Json，source="template"，每次 append、永不 update/delete）；`getLatestThemeSet({prisma,traceId,hotEventId})`（createdAt desc、id desc 首条，无则 null）；`normalizeThemeItems` 为纯函数（同输入→同输出，可直测）。纯逻辑+DB append、无外部 SDK。镜像 `association-service.ts` 结构
- `packages/core/src/modules/theme-linking/index.ts` -- MODIFY：桶追加导出 `generateThemes`/`getLatestThemeSet`/`StubThemeAdapter`/`STUB_THEME_SLUG`/`STUB_THEME_LABEL` + const `ThemeSource` + 类型 `ThemeRef`/`ThemeAdapter`/option/result（沿用 barrel 的 `as FooType` 别名惯例）
- `packages/core/src/index.ts` -- MODIFY：桶追加 theme-linking 主题组（`generateThemes`/`getLatestThemeSet`/`StubThemeAdapter`/const+类型）+ `listPublishedThemeMemberships`/`PublishedHotEventTheme`/`ThemeRef`/`PublishedThemeMembershipRow`
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：`refreshPublishedReadModel` `action==="publish"` 分支追加 `projectThemes(prisma,traceId,hotEventId)`（读最新 `EventThemeSet`→有则 upsert `published_hot_event_themes`（items Json）、无则 deleteMany，镜像 `projectAssociations`/`projectMarketReaction`，作为第 6 步）；`action==="takedown"` 分支追加 deleteMany `publishedHotEventTheme`（第 6 张表，与既有五表同批清）。`getPublishedHotEventDetail` 加第 6 个读（`publishedHotEventTheme.findUnique`）+ 返回 `themes: PublishedHotEventTheme|null` 字段。新增 `listPublishedThemeMemberships({prisma,traceId})`（`publishedHotEventTheme.findMany({select:{hotEventId,items}})`，镜像 `listPublishedAssociations`，供主题页 JS 过滤）
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：加 `ThemeRef`（{slug,label,mappingBasis}）、`PublishedHotEventTheme`（{items: ThemeRef[]; source: string; generatedAt: Date}）、`PublishedThemeMembershipRow`（{hotEventId; items: ThemeRef[]}）、`ListPublishedThemeMembershipsOptions`({prisma,traceId})；`PublishedHotEventDetail` 加 `themes: PublishedHotEventTheme|null`
- `packages/core/src/modules/publish-orchestrator/index.ts` -- MODIFY：桶追加导出 `listPublishedThemeMemberships` + 类型 `PublishedHotEventTheme`/`ThemeRef`/`PublishedThemeMembershipRow`
- `apps/worker/src/queues/theme-backfill-queue.ts` -- NEW：**镜像 `market-reaction-queue.ts`**。`export const THEME_BACKFILL_QUEUE_NAME = "theme-backfill"`、`THEME_BACKFILL_JOB_NAME = "theme-backfill"`、`ThemeBackfillJobData { traceId: string }`；lazy `Queue` 单例 `getThemeBackfillQueue()`；`enqueueThemeBackfill(traceId)`（removeOnComplete 100 / removeOnFail 500）；`registerThemeBackfillWorker()`：dynamic `import("@aguhot/core")` 取 `getPrisma`/`generateThemes`/`refreshPublishedReadModel`，eligible = `prisma.hotEvent.findMany({where:{publicationStatus:"published", eventThemeSets:{none:{}}}, select:{id:true}})`，per-event try/catch 调 `generateThemes({prisma,traceId:data.traceId,hotEventId:ev.id, adapter: undefined})`（V1 无真实 adapter→诚实 skip），result!==null 则 `refreshPublishedReadModel(publish)`、`generated++`，catch 仅 `console.error` 不阻断其他事件，return `{generated, considered: eligible.length}`。**绝不 import `StubThemeAdapter`**（头注释标 V1 adapter 缺失→generated:0 的诚实下限）
- `apps/worker/src/index.ts` -- MODIFY：import `registerThemeBackfillWorker`、`const themeBackfillWorker = registerThemeBackfillWorker()`、并入 `Promise.all([…, themeBackfillWorker.close()])` 优雅关闭；头注释「四 worker」改为「五 worker」并保留「独立、解耦、不自动链」不变量表述
- `apps/worker/src/verify-themes.ts` -- NEW：镜像 `verify-associations.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetState 清表序含新 2 表）；seed source+records→clusterEvents→`generateExplanation`→`decideReview(approve)` 产 ≥2 已发布事件→对每个 `generateThemes({adapter:new StubThemeAdapter()})`→`refreshPublishedReadModel(publish)`；断言：set append（items ≥1 项、每项 slug/label/mappingBasis 非空、source=template、traceId）、`getPublishedHotEventDetail.themes` 非 null（items）、append-only（二次 generate append 第二行、旧行不动、refresh 后投影 generatedAt=最新、items=最新）、adapter 缺失/返回 null/`[]`→返回 null 不写、缺 mappingBasis/slug/label 项→抛错（AC2）、NFR 无投资建议关键词、takedown 后 theme 投影清零+detail null、`listPublishedThemeMemberships` 返回这些行（含共享 slug 多事件）；打印 PASS。无需 Redis（直调 core）
- `apps/worker/src/verify-publish.ts` / `verify-market-reaction.ts` / `verify-associations.ts` -- MODIFY（最小，沿用 2-1/2-2 惯例）：优先不动；新表 FK 均为 `onDelete Cascade`→既有 `hotEvent.deleteMany` 会级联清，预期不需扩 resetState；仅当 typecheck/runtime 因新表报错才在 resetState 清表序追加 `publishedHotEventTheme.deleteMany` + `eventThemeSet.deleteMany`（FK 序：在 hot_events 之前清）
- `apps/worker/package.json` -- MODIFY：加 `verify:themes`（`tsx src/verify-themes.ts`）
- `apps/web/app/(public)/topics/page.tsx` -- MODIFY（替换静态占位）：改为 `force-dynamic`、`import { getPrisma } from "@aguhot/core"`、`export const dynamic = "force-dynamic"`；调 `listPublishedHotEvents`+`listPublishedThemeMemberships`（或仅后者，目录只需 distinct 主题）→ 由 memberships 反推 distinct `{slug,label}` 集合（保序、dedup by slug）→ 每主题渲染可点击 `<FilterPill href={\`/topics/${encodeURIComponent(slug)}\`}>{label}</FilterPill>` + `<AiLabel/>`（系统派生）；空→「暂无已确认的主题。」降级文案。`max-w-3xl px-6 py-12`，标题 `font-display` 编辑级衬线。真实 token
- `apps/web/app/(public)/topics/[slug]/page.tsx` -- NEW：`force-dynamic`、`import { getPrisma } from "@aguhot/core"`。`PageProps { params: Promise<{ slug: string }> }`；`await params` 取 slug（无需 decode——Next 动态段已解码）；调 `listPublishedHotEvents`+`listPublishedThemeMemberships` 建 `hotEventId→ThemeRef[]` map → 过滤 items 含该 slug 的事件 → 按 `latestEvidenceAt` **升序**（`[a,b] => a.latestEvidenceAt.getTime()-b.latestEvidenceAt.getTime()`，连续性时间序列）→ label 取该 slug 对应 `ThemeRef.label`（共享 slug 取首个，stub 一致）。无成员→`notFound()`（404，AC3 不造假）。有成员→编辑级衬线标题显 label + `<AiLabel/>`、顶部「← 返回」链回 `/topics`、成员 `<ol>` 每项链 `/events/${hotEventId}`（FR11）、显每事件 title + 简要 meta（latestEvidenceAt 稳定格式）。`max-w-3xl px-6 py-12`，真实 token，无投资建议措辞
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY：在「关联」section 与「证据时间线」之间插入「主题」`<section>`——`detail.themes !== null && detail.themes.items.length > 0` 时：每个 `ThemeRef` 渲染为可点击 `<FilterPill href={\`/topics/${encodeURIComponent(slug)}\`}>{label}</FilterPill>`（FR9），底部 provenance 行「关联依据：系统映射」（AC2，`text-xs text-ink-tertiary`）+ `<AiLabel/>`（系统派生）；`detail.themes === null` 或 items 空→降级文案「暂无已确认的主题关联。」（AC3）。真实 token，无投资建议措辞。既有六分区/证据时间线零改动
- `apps/web/e2e/seed-themes.ts` -- NEW：镜像 `seed-associations.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→清表 FK 序[含新 2 表]→建 source+N records→clusterEvents→generateExplanation→`decideReview(approve)` 产 **≥2 已发布**→对其中 ≥2 个 `generateThemes({adapter:new StubThemeAdapter()})`（append set）→`refreshPublishedReadModel(publish)`（投影第 6 表）使它们共享 `STUB_THEME_SLUG`（验证主题页时间序列）；另产 **1 已发布但无主题**（不调 generateThemes，验证降级）→resetPrisma）；导出 `{ themeSlug, themeLabel, themedHotEventIds: string[], themedTitles: string[], noThemeHotEventId, noThemeTitle }` 供 spec
- `apps/web/e2e/themes.spec.ts` -- NEW（describe 标题含 `@themes`，`test.describe.configure({mode:"serial"})` + beforeAll seed 捕获 id）：断言 `GET /topics/{themeSlug}` 200、主题标题（`themeLabel`）可见、≥2 成员事件按时间序可见、每成员为可点击链 `/events/{id}`（FR11）；点某成员链→`/events/{id}` 200（主题→详情闭环）；`GET /events/{themedHotEventIds[0]}` 200、「主题」section 可见、含链 `/topics/{themeSlug}`（FR9）、provenance「关联依据：系统映射」可见；点该链→`/topics/{themeSlug}` 200（详情→主题闭环、非死链）；`GET /topics` 200、目录列含 `themeLabel` 链；`GET /topics/{unknown-slug}` 404（AC3 不造假）；`GET /events/{noThemeHotEventId}` 200、「主题」section 显降级文案「暂无已确认的主题关联。」、不出现主题项（AC3）；既有六分区/证据时间线/市场反应/关联不回归
- `apps/web/package.json` -- MODIFY：加 `e2e:themes`（`playwright test --grep @themes`，spec beforeAll 自 seed）与 `seed:themes`（`tsx e2e/seed-themes.ts`）；**改 `e2e` 的 `--grep-invert` 追加 `@themes`**；既有 `e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction`/`e2e:associations` 等不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 2-3 defer（真实主题知识源/provider+SDK、worker cron/自动编排/job 链式触发、主题成员移除/版本化/回滚、主题合并/拆分/重命名 taxonomy 治理、运营 curated 主题 UI+taxonomy、跨页返回路径 scroll/filter 上下文恢复归 2.5、主题页排序 toggle/分页、主题目录 `/topics` distinct 全表读 scale ceiling、Json items 列查询性上限、stub 仅测试非 prod 的诚实下限、worker 运行时未实测、历史相似事件相似度判断、主题实时推送 SSE/WS）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_theme_read_models` -- 加 2 模型（EventThemeSet append-only + published_hot_event_themes 读模型，items Json）+ HotEvent 反向导航 + 迁移 -- AD-2 写归属 + AD-3 公开主题读模型落表
- `packages/core/src/modules/theme-linking/{types.ts,theme-adapter.ts,stub-theme-adapter.ts,theme-service.ts,index.ts}` + `src/index.ts` 桶 -- `ThemeAdapter` 端口 + `StubThemeAdapter`（测试双桩）+ `generateThemes`/`getLatestThemeSet`（确定性、强制 mappingBasis/slug/label、append-only）+ 类型 + 桶 -- theme-linking 主题子域核心（verify/seed 直调 + worker 回填调）
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- refresh 扩展（publish 投影最新 set、takedown 清第 6 表）+ `getPublishedHotEventDetail` 加 themes 读 + `PublishedHotEventDetail.themes` + 新 `listPublishedThemeMemberships` 查询 + 类型/桶 -- AD-3 公开主题读模型唯一拥有者投影 + 详情读契约扩展 + 主题页数据源
- `apps/worker/src/queues/theme-backfill-queue.ts` + `index.ts` 注册/关闭 -- `theme-backfill` BullMQ worker（镜像 2-1 market-reaction-queue：lazy Queue + enqueue + register，eligible=published 无 set，adapter undefined→诚实 skip，stub 不 import） -- epic 列明 job 类目落地（区别 2.2 关联无 worker）
- `apps/worker/src/verify-themes.ts` + `package.json:verify:themes` + `verify-publish/market-reaction/associations`（仅 FK Cascade 必要时扩 reset，预期不需） -- 确定性自检脚本（items/slug+label+basis 强制/append-only/投影取最新/adapter 缺失不写/takedown 清第 6 表/listPublishedThemeMemberships/NFR 无建议词） -- AC1/AC2/AC3 数据级验证；既有 verify 零回归
- `apps/web/app/(public)/topics/page.tsx` -- 替换静态占位为动态主题目录（distinct 主题链 + AiLabel + 降级态） -- 主题入口闭环（主图「主题」非死链）
- `apps/web/app/(public)/topics/[slug]/page.tsx` -- 主题页（按 latestEvidenceAt 升序聚合成员事件 + FR11 成员链 + AiLabel + 未知 slug 404 + 返回链） -- AC1/AC3 surface
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 插入「主题」section（FR9 FilterPill 链 /topics/{slug} + provenance + AiLabel + 降级态） -- AC4/AC3 surface
- `apps/web/e2e/{seed-themes.ts,themes.spec.ts}` + `package.json:e2e:themes/seed:themes` + `e2e` grep-invert 加 @themes -- 独立 seed（≥2 已发布共享主题 + 1 无主题）+ @themes e2e（主题页时间序列/详情↔主题双向跳转/目录/未知 slug 404/降级态/不回归） -- AC1/AC2/AC3/AC4 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 2-3 defer 项（provider/SDK/worker-cron/成员移除版本化/合并拆分/运营 UI/返回路径归 2.5/排序分页/scale ceiling/Json 查询性/stub 诚实下限/worker 运行时未测/相似度/SSE） -- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 2-3 迁移已应用，When 经 clusterEvents→generateExplanation→decideReview(approve) 发布 ≥2 候选后对每个 `generateThemes({adapter:new StubThemeAdapter()})`→`refreshPublishedReadModel(publish)`，Then 每个 `event_theme_sets` append 一行（items 含 ≥1 项、每项 slug/label/mappingBasis 非空、`source="template"`），And 各 `published_hot_event_themes` 投影该最新行，And `getPublishedHotEventDetail` 返回非 null `themes` 且仅 `SELECT published_*` 六表（不触及 event_theme_sets/hot_events/evidence_*/associations）。
- Given ≥2 已发布事件共享同 slug（经 stub），When 匿名访问 `/topics/{slug}`，Then 200、编辑级衬线标题显该 slug 的 label、成员事件按 `latestEvidenceAt` 升序呈现（AC1 时间序列），And 每成员为可点击链 `/events/{hotEventId}`（FR11），And 带 `<AiLabel>`，And 无投资建议措辞。
- Given 已发布且有 theme 投影，When 匿名访问 `/events/{id}`，Then 详情「主题」section 渲染可点击 `<FilterPill>` 链 `/topics/{slug}`（AC4/FR9），And 显「关联依据：系统映射」provenance + `<AiLabel>`（AC2），And 点该链到达 `/topics/{slug}` 200（非死链）。
- Given ≥1 已发布事件含主题，When 访问 `/topics`，Then 目录页列 distinct 主题、每项链 `/topics/{slug}`、带 `<AiLabel>`；And 无任何已发布事件含主题时显「暂无已确认的主题。」降级（AC3）。
- Given slug 无任何已发布成员（adapter 未产出/未知主题），When 访问 `/topics/{unknown}`，Then 404（AC3 不造假主题页）。
- Given 已发布但无 theme set（adapter 不可得 / 未生成），When 访问 `/events/{id}`，Then 「主题」section 显「暂无已确认的主题关联。」降级文案（AC3），And 不出现主题项，And 既有 summary/explanation/evidence/reaction/associations 照常渲染（NFR 不阻断）。
- Given adapter 返回项某项缺 `mappingBasis`/`slug`/`label`，When `generateThemes`，Then 抛错、不 append（AC2 强制，不 silently 填默认）。
- Given `generateThemes({adapter:undefined})` 或 adapter 返回 null/`[]`，When 调用，Then 返回 null、不 append 任何 set 行（无数据→不造假）。
- Given `EventThemeSet` 已有 ≥1 行，When 再次 `generateThemes` 同 hotEvent，Then append 新行（旧行不 update/delete），And `refresh` 后投影 `generatedAt` = 最新行 `createdAt`、items = 最新行 items。
- Given `theme-backfill` worker 运行且 adapter resolve 为 undefined（V1 prod 形态），When 处理 eligible（published 且无 theme set）事件，Then `{generated:0, considered, skipped}`、不 append、不投影（诚实降级，镜像 2-1）。
- Given 已发布（含 theme 投影），When `decideReview(takedown)`，Then `published_hot_event_themes` 清零（与既有五表同批），And 之后 `getPublishedHotEventDetail` 返回 null（404，AD-8）。
- Given 详情/主题/目录路由 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功，And `pnpm -r typecheck`/`pnpm -r lint` 通过，And `pnpm --filter worker verify:themes` 打印 PASS（items/slug+label+basis 强制/append-only/投影取最新/adapter 缺失不写/缺字段抛错/takedown 清第 6 表/listPublishedThemeMemberships/NFR 无建议词），And `pnpm --filter worker verify:publish`/`verify:market-reaction`/`verify:associations` 不回归。
- When 执行 `pnpm --filter web e2e:themes`（`@themes`），Then `/topics/{slug}` 200 且成员时间序列+链可见、详情「主题」section 链 `/topics/{slug}` 且点击闭环、`/topics` 目录含该主题、`/topics/{unknown}` 404、`/events/{noThemeId}` 降级文案无项；And `pnpm --filter web e2e`（home/navigation/design）/`e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction`/`e2e:associations` 不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (medium 2, low 5)
- defer: 4: (low 4)
- reject: 22
- addressed_findings:
  - `[medium]` `[patch]` 主题页成员按 `latestEvidenceAt` 升序排列是 spec Design Notes 标注的 load-bearing 行为，但 `@themes` e2e 仅断言成员可见、不断言顺序——降序回归（或 sort 被删使 feed hotness 序漏入）会静默绿通过。在 AC1 测试追加 DOM 序断言（`themedTitles[0]` 早证据成员先于 `themedTitles[1]`），锁住升序契约。
  - `[medium]` `[patch]` `normalizeThemeItems` 校验 slug 非空但不校验 URL 安全性——含 `/`/`?`/`#`/空白的 slug 会破坏 `/topics/{slug}` 路由。加 kebab-case ASCII slug 校验（`/^[a-z0-9]+(-[a-z0-9]+)*$/`），缺则抛错（AC2 fail-fast 同形），并在 `verify:themes` 加 1 条 malformed-slug 抛错断言（24/24）。
  - `[low]` `[patch]` 主题页「成员存在（membership 非空，过 notFound 闸）但 join 后无已发布成员」（读间 takedown race / 投影缺失）原渲染「暂无成员事件。」防御文案——与 AC3「无成员→404 不造假」不一致且该分支无测试。改为 `notFound()`，两空态统一 404，移除未测防御分支。
  - `[low]` `[patch]` 主题页成员 sort 无 tiebreaker——等 `latestEvidenceAt` 时 DOM 序不确定。加 `|| a.hotEventId.localeCompare(b.hotEventId)` 确定 tiebreaker（升序主序不变）。
  - `[low]` `[patch]` `listPublishedThemeMemberships` `findMany` 无 `orderBy`——主题页 label「首见为准」跨载不确定（多事件共享 slug 时）。加 `orderBy: { hotEventId: "asc" }` 使 label 派生确定（签名不变）。
  - `[low]` `[patch]` `topics/[slug]/page.tsx` 残留 `export type { PublishedHotEventSummary }` 仅用于抑制未用 import 的 lint（hack）。移除未用 import + re-export（类型在值位置未用，元素类型由 `listPublishedHotEvents` 推断）。
  - `[low]` `[patch]` `seed-themes.ts` `seedTopicsEmpty` 的 `pending[0]` 在 length 守卫后仍被 TS 判 possibly-undefined（4 处 typecheck 错）。改 `pending[0]!`（镜像 `verify-themes.ts` 惯例），`pnpm -r typecheck` 复绿。
  - 4 项 defer 已追加至 deferred-work（theme-backfill eligible `none:{}` 使已有 set 事件永不回填 + 投影缺失无修复路径；`normalizeThemeItems` 按 slug dedup 静默丢弃冲突项无 observability；主题页成员行未显 source name/原始链接的 traceability 丰富化）；第 4 项（projectThemes read→write 非原子 race）实现期已登记、本 pass 确认 worker 为第二触发源后归并既有并发 defer。
  - 22 项 reject 静默丢弃（worker `adapter=undefined` 短路 + 查询先于 skip——镜像 2-1 V1 占位、无触发；双 `ThemeRef` 定义——镜像 2-2 双 `AssociationItem`；`sleep(20)` append 断言——镜像 2-1/2-2 且 UUIDv7 tiebreaker 正确（2-2 已 reject）；seed/verify `find(...)!`——测试码、loud failure；Json 读边界 cast 信任——镜像 2-2、写时强制；串行 e2e + seedTopicsEmpty 末位 DB 污染——每个 DB-backed seed 起始全清；目录部分校验不一致——无害防御；projectThemes publish 无 set 时 deleteMany no-op——镜像投影统一性；读查询 traceId 未用——镜像所有 publish-orchestrator 读；迁移无 DOWN——Prisma repo 约定；hotEventId 未 encodeURIComponent——UUIDv7 构造上 URL-safe；非字符串字段类型——adapter 已类型化；slug 大小写/空白不匹配——provider 契约、stub 干净；详情 dup-slug React key——写时 dedup 已防；listPublishedThemeMemberships scale ceiling——已 defer；verify pending.length 守卫——代码已有；normalizeThemeItems 无单测——repo 无单测 idiom、AC2 经 verify 覆盖；AC2 provenance 固定文案——spec 显式选择、镜像 2-2；移动端响应式验证——ambient repo 缺口；写归属负向测试——ambient；日报 2.4 耦合——正确排除出 2.3 范围）。

## Design Notes

**为何主题成员用 per-event append-only `items Json` set（镜像 2.2 关联）而非规范化 `Theme` 目录表 + `hot_event_themes` 成员表，尽管 epic 数据模型写 `HOT_EVENT }o--o{ THEME`（多对多）：** `HOT_EVENT }o--o{ THEME` 是概念基数模型（「一个事件可属多主题、一个主题含多事件」），**不**规定落表形态——正如 2.2 把 concept/industry/stock 关联（同样多对多语义）落成 per-event `items Json` 而非 `themes` 目录 + 成员表，且 2.2 Design Notes 已显式辩护「display-only 集合用非规范化 Json 列、不为尚不存在的单项 SQL 查询预建子表」（ponytail）。主题页查询是「给定 slug → JS 过滤所有已发布事件 memberships」（镜像 feed 关联维度过滤的 JS 全表读 + 内存过滤），**非** SQL `WHERE theme_slug=` 单项查；主题身份（slug/label）存 per-event Json 足以寻址（slug 是 URL）+ 显示（label 取自 Json）。故选最简同形：1 张 append-only 写表（`event_theme_sets`，items `ThemeRef[]`）+ 1 张 published 读模型（`published_hot_event_themes`），与 2.2 关联端到端同形（端口/桩/服务/投影/section/降级），避免再造一套异形 Theme 目录抽象。epic 的 M:N 概念被忠实满足（多对多语义在），只是不预建规范化目录表。未来若需按主题做 SQL 索引聚合或主题目录独立 curate，重构为目录 + 成员表（defer，记 deferred-work）。slug 取自 Json、`/topics` 目录由 memberships 反推 distinct——无独立目录表不阻碍寻址。

**为何 2.3 建 `theme-backfill` worker（区别于 2.2 关联无 worker，同于 2.1 market-reaction 有 worker）：** epic-2-context Technical Decisions 明列三 Epic-2 BullMQ job 类目：market signal aggregation（2-1）、daily digest（2-4）、**theme backfill（2-3，回填历史事件到主题，驱动 FR9 连续性 + FR11 演进）**。theme-backfill 在列 → 建 worker（镜像 2-1 `market-reaction-queue.ts`：lazy Queue + enqueue + register + eligible 过滤 + per-event try/catch + refresh 投影 + trace_id）。2.2 关联不在列 → 不建 worker（2.2 Design Notes 已显式区分）。V1 worker resolve adapter=undefined（无真实主题知识源）→ eligible 事件 `generateThemes` 返回 null → `{generated:0,skipped}`，prod 诚实降级（与 2-1 worker 跑但 adapter none→skip 同形，功能等价）；`StubThemeAdapter` 仅 verify/e2e 直调走通 happy path，**apps/worker 绝不 import**（沿用 2-1/2-2 stub 惯例）。建一个 epic 明列 job 类目的 worker 占位非仪式——provider 落地时只换 adapter 装配、domain/投影/页零改动；触发（cron/编排/job 链）defer（沿用「四 worker 独立、解耦、不自动链」不变量，头注释改「五 worker」）。

**为何主题页成员按 `latestEvidenceAt` 升序（连续性时间序列）而非降序（最新优先）：** epic-2-context 明确「a theme page aggregates multiple events across time and presents them **chronologically** so continuity reads as a **sequence**」。「sequence」（序列/顺序）的自然读法是按时间从早到晚的叙事演进（因→果、酝酿→爆发），非 feed 式最新优先。故按 `latestEvidenceAt` 升序（earliest→latest），tiebreaker 用 publishedHotEvent 既有的 `evidenceCount desc`（稳定）。首页 feed 仍按 hotness（evidenceCount/latestEvidenceAt desc）——两者目的不同（feed=发现最热、主题页=读一条主线的演进），故排序策略分离。降序/排序 toggle defer（记 deferred-work）。

**为何未知/空 slug → 404 而非空主题页（AC3 不造假）：** epic-2-context「Theme continuity must be honest: when evidence is insufficient to relate an event to a theme ... the system shows nothing rather than fabricating」。一个无任何已发布成员的 slug 若渲染空主题页（「该主题暂无事件」），等同于为一个**系统未确认存在的主题**伪造页面——违反「absence as absence, never fabricated」。故 slug 在 `published_hot_event_themes` memberships 中无任何命中 → `notFound()`（404），与未发布 hotEvent id → 404（AD-8 不泄漏）同形。真实主题（有 ≥1 已发布成员）才渲染页；主题被全部 takedown 后其 slug 自然重新 404（投影清零→无成员）。

**为何跨页返回路径上下文恢复（UX-DR12 scroll/filter）归 2.5 而非本 story：** epic-2-context 显式「Story 2.3 ... also depends on Story 2.5's return-path contract so a detail → theme jump round-trips without context loss」——即完整 UX-DR12（返回恢复 filter 态 + scroll 位）是 2.5 闭环 capstone 的职责，2.3 提供主题页/跳转 surface 但不独占返回契约。本 story 做基本导航（详情→主题链、主题→详情链、主题页「← 返回 `/topics`」链 + 浏览器原生 back、深度一层），完整 scroll/filter 恢复 defer 到 2.5（与 1-7/2.2 既有 filter-pill 返回态恢复同出处统一在 2.5 收口）。提前在 2.3 实现会与 2.5 职责重叠且 2.5 需跨首页/主题/日报/详情统一返回契约——故收口 2.5。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name theme_read_models` -- expected: 迁移应用、2 新表生成（随后 prisma generate 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 theme-linking 主题子域 + publish-orchestrator 第 6 投影/读 + worker theme-backfill queue + web 主题页/目录/详情 section）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:themes` -- expected: 集成脚本打印 PASS（items/slug+label+basis 强制/append-only/投影取最新/adapter 缺失不写/缺字段抛错/takedown 清第 6 表/listPublishedThemeMemberships/NFR 无建议词）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` / `verify:market-reaction` / `verify:associations` -- expected: 不回归（新表 FK Cascade→既有 hotEvent.deleteMany 级联清，预期不需扩 resetState；仅当报错才扩）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（主题页/目录/详情 force-dynamic 不在 build 求值；静态公共页 design 不 import core）
- `pnpm --filter web e2e:themes` -- expected: seed 后 `@themes` 通过（主题页时间序列 + 成员链 / 详情主题 section 链闭环 / 目录含主题 / 未知 slug 404 / 无主题降级无项）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:market-reaction` / `e2e:associations` -- expected: 不回归

**Manual checks (if no CLI):**
- 已发布+主题事件 `/events/{id}` 主题 section 显可点击主题链 `/topics/{slug}` + provenance + AiLabel；点链到达主题页、主题页成员按时间升序、每成员链回 `/events/{id}`；`/topics` 目录列该主题；未知 slug `/topics/{unknown}` 404；已发布无主题显「暂无已确认的主题关联。」降级无项；未发布 id 404 不泄漏；既有六分区/证据时间线/市场反应/关联不回归；无投资建议措辞；主题/详情匿名可达无登录墙。
