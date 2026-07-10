---
title: '概念、行业与个股关联视图 (2.2)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '42155c9a5cbbab825ae4044c8800a3ec1cf56f64'
final_revision: '163a70fde9f9bcc9e3ac600d06964a150b6a38ca'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-market-reaction-signal-generation-and-display.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.8 落地公开详情页三分区+证据时间线，2.1 落地「市场反应」第 4 个 section，但详情页仍无「这条热点牵动哪些概念 / 行业 / 代表性个股」的结构化关联层——读者无法把消息和市场反应对象连起来看。`theme-linking` 领域模块（AD-2 明确拥有 concept/industry/theme 关联）不存在；概念/行业/个股关联写表、公开读模型、详情关联区块、关联项跳转去向全部缺失。epic-2-context 把 `theme-linking` 列为本 epic 第二个新模块，且 deferred-work 2-1 已登记「sector 名 / 个股真实映射依赖 Epic 2.2 关联结果」。

**Approach:** 新建 `theme-linking` 领域模块（2.2 建 concept/industry/stock 关联，2.3 将扩 theme 成员/连续性）：`AssociationAdapter` 端口（镜像 `MarketDataAdapter`/`SourceAdapter`，AD-7 关联知识源经端口接入）+ `StubAssociationAdapter`（确定性测试双桩，**仅 verify/e2e 用**）+ `generateAssociations`（从 adapter 输出派生 concept/industry/stock 三类 `AssociationItem`，每项带 `kind`/`label`/`mappingBasis`——adapter 缺失/返回 null/空数组→返回 null、不写，诚实降级）+ append-only `EventAssociationSet` 写表（一次生成一行，`items Json`，`HOT_EVENT ||--o{ ASSOCIATION_SET`）。复用 `publish-orchestrator`（AD-3 公开读模型唯一拥有者）扩 `refreshPublishedReadModel`：publish 分支投影最新 set→新 `published_hot_event_associations`（无则 deleteMany），takedown 分支 deleteMany 该第 5 张 published 表（与既有四表同批清，保持「行存在=已发布」契约）；`getPublishedHotEventDetail` 加第 5 个读 + 返回新 `associations` 字段。新增 `listPublishedAssociations` 供 feed 关联维度筛选。详情页加「关联」`<section>`：按 concept/industry/stock 分组渲染可点击 `<FilterPill>` 链（去向 `/?<kind>=<label>` 过滤首页），显「关联依据：系统映射」provenance（AC2）；无 set→诚实降级文案「暂无已确认的概念 / 行业 / 个股关联。」（AC3，NFR5）。首页 feed 接受 `?concept=|?industry=|?stock=` URL 维度，JS 过滤（复用 `filterByWindow` 模式，`listPublishedHotEvents` 保持 filter-free 不变），活动关联筛选以可清除 `<FilterPill>` 呈现。V1 不接真实关联知识源（采购 defer）——**worker 不接线（epic 未列关联生成 job 类目，区别于 2-1 market-signal aggregation），故 prod 无关联生成、诚实降级；`StubAssociationDataAdapter` 仅 verify/e2e 直调 `generateAssociations` 走通 happy path**。新增 `verify:associations`（worker，直调 stub）与 `@associations` e2e（独立 seed：产 1 已发布+关联 + 1 已发布无关联；并验证关联 chip 跳转 `/?concept=半导体` 命中过滤 feed）。不建 2.3 theme 页/连续性、不做运营关联修订 UI、不接真实知识库/LLM、不做 worker/cron 触发、不改 1-6~2-1 既有断言——均记 defer。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：详情页关联区块只经 `getPublishedHotEventDetail` 读 `published_hot_event_associations`（+ 既有四表），绝不读 `event_association_sets`/`hot_events`/`evidence_*`。`associations` 是详情读模型新增字段；行存在=当前已发布关联集（无 status 列、无 WHERE 可遗忘，沿用 1-6~2-1 读模型契约）。`published_hot_event_associations` 由 `publish-orchestrator` 投影（epic-2-context 明确「association sections read only published_* generated/refreshed by publish-orchestrator」），**非** theme-linking 模块直写。
- 写归属（AD-2 单一写拥有者）：`theme-linking` 仅拥有 `event_association_sets`（append-only 写表，一次生成一行，永不 update/delete 旧行）；`publish-orchestrator` 拥有 `published_hot_event_associations` 投影。theme-linking **绝不**写 `hot_events`/`published_*`/`evidence_*`/`market_reaction_snapshots`。concept/industry/**stock 关联身份**（可点击的关联项 label）归 theme-linking；stock **价格反应数据**归 market-reaction（2-1 ReactionSnapshot，已建）——本 story 不碰价格反应列。
- 明确映射依据（AC2）：每个 `AssociationItem` 必须带非空 `mappingBasis`（provenance，如 `"knowledge_base:v1"`）；adapter 返回的每一项无 `mappingBasis`→视为非法、`generateAssociations` 抛错（**不** silently 填充默认依据）。详情区块显「关联依据：系统映射」provenance 行。`verify:associations` 断言每项 `mappingBasis` 非空（AC2 数据级强制）。
- adapter 端口（AD-7）：关联知识源（概念/行业/个股映射库）仅经 `AssociationAdapter` 接口进入；domain 不依赖第三方 SDK（V1 无 SDK）。`generateAssociations({prisma,traceId,hotEventId,adapter?})`——`adapter` 缺失/返回 null/返回空数组→返回 null、不写 set（诚实降级，非造假）。
- append-only（AD-5 风格）：`EventAssociationSet` 永不 update/delete，每次生成 append 一行；公开投影取该 hotEvent 最新一行（`createdAt` desc、`id` desc tiebreaker——UUIDv7 单调，沿用 1-8/2-1 修复）。多次生成追加多行版本（公开取最新）；V1 无自动触发（verify/seed 显式调），worker/cron defer。
- 降级态诚实（AC3/NFR5）：无 set（adapter 不可得 / 未生成 / takedown 后）→详情页关联区块显「暂无已确认的概念 / 行业 / 个股关联。」降级文案，**不**留空、**不**造假关联项、**不**因缺数据阻断既有 summary/explanation/evidence/reaction 渲染。某类缺只渲染已有类（如只有 concept 则只显 concept 组，不伪造 industry/stock）。
- 跳转去向明确且非死链（AC1）：每个渲染的关联项是可点击 `<FilterPill>` 链，`href = /?${kind}=${encodeURIComponent(label)}`，指向首页 feed 该维度过滤视图；死链是 defect。feed 必须真实 honor `?concept=|?industry=|?stock=`（命中含该关联的已发布事件），否则链为假过滤=死链。
- 关联是解释性、非建议性（NFR/epic-2-context）：关联项 label 只描述实体身份（概念名 / 行业名 / 「个股名 代码」），**绝不**含买卖/目标价/持仓/增持减持措辞。`verify:associations` 断言无投资建议关键词（沿用 1-8/2-1 `noInvestAdvice` 惯例）。
- `next build` 保持无 `DATABASE_URL`（1-6~2-1 build 不变量延续）：详情/首页路由已 `force-dynamic`，新增关联区块与 feed 关联过滤不改路由动态性；`(public)/layout.tsx` 及静态公共页仍不 import `@aguhot/core`。
- token 安全：关联区块用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`border-border-hairline`/`ink-*`），关联项复用既有 `<FilterPill>`（active/clear 态，1.3/1.7 已落地）。无投资建议措辞。
- 不变性约定（沿用 1-4~2-1）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601/稳定格式；PK UUIDv7（`newTraceId()`）；items 用 Prisma `Json` 列存 `AssociationItem[]`（变量基数结构，display-only，不做规范化子表——ponytail）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:associations` 或 `@associations` e2e seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 新增模型/模块致 `pnpm -r typecheck`/`lint` 回归 → HALT。
- `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。

**Never:**
- 不接真实关联知识源 / 映射库 / NER / LLM（无 API key/SDK/网络调用；V1 `StubAssociationAdapter` 纯确定性 fixture，**且仅 verify/e2e 用、不在 worker/prod 接线**——fixture 关联上公开页而无真实映射依据会误导读者，违反 NFR「absence as absence」+ AC2「禁止随意映射」）。具体知识源采购 defer。
- 不建 worker / cron / publish→association 自动触发（epic 只列 market-signal/digest/theme-backfill 三 Epic-2 job 类目，关联生成不在其列；`generateAssociations` 为纯逻辑+DB append，verify/seed 直调，区别于 2-1 有 worker——2-1 worker 对应 epic 列明的 market-signal aggregation job）。自动编排 defer。
- 不建 2.3 theme 页 / theme 成员 / 连续性 / 历史相似（theme-linking 模块 2.2 只落 concept/industry/stock 关联，theme 相关 schema/读模型/页归 2.3）；不做运营关联修订 UI（运营手填关联无映射依据违反 AC2，运营 curated 关联需先有 taxonomy + 映射依据机制，defer）。
- 不做 stock 价格反应（归 2-1 market-reaction，已建；本 story 只做 stock 作为关联项的身份/链）；不做概念/行业/个股独立详情页（V1 去向仅过滤 feed）；不做多关联维度同时活动的显式「清除全部」控件（V1 单维度，沿用 1-7 filter-pill clear defer）。
- 不在公开详情读 `event_association_sets`/`hot_events` 绕过读模型；不让既有公共页新 import `@aguhot/core`；不改 1-6~2-1 既有 verify/seed/spec 断言（console/feed/detail/revision/merge-split/market-reaction seed/spec 零改动保持绿）；不改 `listPublishedHotEvents` 签名（保持 filter-free，关联维度过滤在 web 层 JS，沿用 1-7 window 过滤模式）。
- 不渲染投资建议措辞（无买卖/目标价/持仓，NFR）；不新增 `SourceAdapter`/`LLMAdapter`/`MarketDataAdapter`；不改 `packages/config/src/env.ts`（V1 无关联知识源 env，adapter defer）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 已发布+adapter 可得→生成+投影（AC1/AC2） | 某 hotEvent 已 `published`、`adapter` 返回非空 `AssociationItem[]`（concept/industry/stock 各 ≥0，每项带 `mappingBasis`），`generateAssociations` | append 一行 `event_association_sets`（items 含 ≥1 项、每项 kind/label/mappingBasis 非空、`source="template"`、`traceId`）；随后 `refreshPublishedReadModel(publish)` upsert `published_hot_event_associations`；`getPublishedHotEventDetail` 返回非 null `associations`（items） | 无错误预期 |
| 详情渲染分组关联+跳转（AC1/AC2） | 已发布且有 association 投影，`GET /events/{id}` | 「关联」`<section>` 渲染 concept/industry/stock 分组中已确认的项（≥1 组），每项为可点击 `<FilterPill>` 链 `href=/?<kind>=<label>`，显「关联依据：系统映射」provenance | 无错误预期 |
| 关联 chip 跳转命中过滤 feed（AC1 非死链） | 关联项链 `/?concept=半导体`，`GET /?concept=半导体` | feed 只显含 concept="半导体" 关联的已发布事件（至少含来源事件）；活动筛选以可清除 `<FilterPill>` 呈现；无匹配→「当前筛选条件下无热点事件。」空态 + 清除链 | 无错误预期 |
| 关联不可得→降级（AC3/NFR5） | 已发布但无 set（adapter none / 未生成 / takedown 后），`GET /events/{id}` | 「关联」区块显「暂无已确认的概念 / 行业 / 个股关联。」降级文案；**不**留空、**不**造假项；其余 summary/explanation/evidence/reaction 照常渲染 | 无错误预期 |
| adapter 缺失/空→不写（NFR 不造假） | `generateAssociations({adapter:undefined})` / adapter 返回 null / 返回 `[]` | 返回 null、**不** append 任何 `event_association_sets` 行（无数据→不生成→降级） | 无错误预期 |
| 缺映射依据→拒写（AC2 强制） | adapter 返回项某项 `mappingBasis` 为空/缺 | `generateAssociations` 抛错（不 silently 填默认依据）、不 append | 显式错误（非法 adapter 输出） |
| append-only + 投影取最新（AD-5） | 同 hotEvent 已有 ≥1 set，再次 `generateAssociations` | append 新行（旧行不 update/delete）；`refresh` 后 `published_hot_event_associations.generatedAt` = 最新行 `createdAt`、items = 最新行 items | 无错误预期 |
| takedown 清第 5 表 | 已发布（含 association 投影）→`decideReview(takedown)` | `published_hot_event_associations` deleteMany（与既有四表同批）；之后 `getPublishedHotEventDetail` 返回 null（404，AD-8 不泄漏） | 无错误预期 |
| 未发布 id 不泄漏（AD-8） | candidate/rejected/taken_down/未知 id，`GET /events/{id}` | `getPublishedHotEventDetail` 返回 null→`notFound()`（404） | 404 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错；`next build`（无 DB）仍成功 | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 2 模型。`EventAssociationSet`（id UUIDv7 PK, hotEventId FK→hot_events onDelete Cascade, items `Json`（存 `AssociationItem[]`）, source String, traceId, createdAt；`@@index([hotEventId])` `@@index([createdAt])` `@@map("event_association_sets")`）。`PublishedHotEventAssociation`（hotEventId PK/FK→hot_events onDelete Cascade, items `Json`, associationSource `@map("association_source")`, generatedAt `@map("generated_at")`, traceId, updatedAt `@updatedAt` `@@map("published_hot_event_associations")`）。在 `HotEvent` 加只读反向导航 `eventAssociationSets EventAssociationSet[]`、`publishedAssociation PublishedHotEventAssociation?`（元数据，不改 event-assembly 写归属，沿用 schema 既有 AD-2/AD-6 注释惯例）
- `packages/core/prisma/migrations/<ts>_association_read_models/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name association_read_models` 生成（2 张新表 + 索引 + FK Cascade；hot_events 反向关系无列、仅 Prisma 导航）
- `packages/core/src/modules/theme-linking/types.ts` -- NEW：`AssociationKind`（concept/industry/stock const）、`AssociationSource`（template const，未来 knowledge-base/provider id）、`AssociationItem`（{kind: AssociationKind; label: string; mappingBasis: string}——非空映射依据，AC2）、`AssociationAdapter`（端口 interface `fetchAssociations({hotEventId}): Promise<AssociationItem[] | null>`）、`GenerateAssociationsOptions`({prisma,traceId,hotEventId,adapter?})、`GenerateAssociationsResult`、`GetLatestAssociationSetOptions`、`AssociationSetRecord`。`PrismaClient` 从 `../../../generated/client.js` 导入
- `packages/core/src/modules/theme-linking/adapter.ts` -- NEW：`AssociationAdapter` 端口 interface（镜像 `market-reaction/adapter.ts` 注释风格：domain 依赖端口、concrete adapter 在 worker/assembly 层解析、provider swap 不动 domain；V1 无 SDK）。类型从 `./types.js` 导入，`export type { AssociationAdapter } from "./types.js"`
- `packages/core/src/modules/theme-linking/stub-adapter.ts` -- NEW：`StubAssociationAdapter implements AssociationAdapter`——确定性 fixture（`fetchAssociations` 返回固定非空 `AssociationItem[]`：concept{label:"半导体",mappingBasis:"knowledge_base:v1"}、industry{label:"芯片",mappingBasis:"knowledge_base:v1"}、stock{label:"中芯国际",mappingBasis:"knowledge_base:v1"}，每项 mappingBasis 非空）。**仅 verify/e2e 消费**，头注释标明「TEST-ONLY: not wired in worker/prod; real knowledge source/provider deferred」
- `packages/core/src/modules/theme-linking/association-service.ts` -- NEW：`generateAssociations({prisma,traceId,hotEventId,adapter?})`（adapter 缺失→null；`fetchAssociations` 返回 null/`[]`→null、不写；否则校验每项 `mappingBasis` 非空（空→抛错，AC2 强制）→ normalize（dedup by kind+label、保序）→ append 一行 `event_association_sets`，items=Json，source="template"，每次 append、永不 update/delete）；`getLatestAssociationSet({prisma,traceId,hotEventId})`（createdAt desc、id desc 首条，无则 null）。纯逻辑+DB append、无 BullMQ/无外部 SDK。`normalizeItems` 为纯函数（同输入→同输出，可直测）
- `packages/core/src/modules/theme-linking/index.ts` -- NEW：桶导出（`generateAssociations`/`getLatestAssociationSet`/`StubAssociationAdapter` + const `AssociationKind`/`AssociationSource` + 类型，沿用 market-reaction barrel 的 `as FooType` 别名惯例）
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：`refreshPublishedReadModel` `action==="publish"` 分支追加 `projectAssociations(prisma,traceId,hotEventId)`（读最新 `EventAssociationSet`→有则 upsert `published_hot_event_associations`（items Json）、无则 deleteMany，镜像 `projectMarketReaction`）；`action==="takedown"` 分支追加 deleteMany `publishedHotEventAssociation`（第 5 张表，与既有四表同批清）。`getPublishedHotEventDetail` 加第 5 个读（`publishedHotEventAssociation.findUnique`）+ 返回 `associations: PublishedHotEventAssociation|null` 字段。新增 `listPublishedAssociations({prisma,traceId})`（`publishedHotEventAssociation.findMany({select:{hotEventId,items}})`，供 feed 关联维度过滤）
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：加 `AssociationItem`（{kind,label,mappingBasis}）、`PublishedHotEventAssociation`（{items: AssociationItem[]; source: string; generatedAt: Date}）、`GetPublishedHotEventDetailOptions` 不变、`PublishedHotEventDetail` 加 `associations: PublishedHotEventAssociation|null`、`ListPublishedAssociationsOptions`({prisma,traceId})
- `packages/core/src/modules/publish-orchestrator/index.ts` -- MODIFY：桶追加导出 `listPublishedAssociations` + 类型 `PublishedHotEventAssociation`/`AssociationItem`（**顺手补 2-1 遗留缺口**：把 `PublishedHotEventReaction` 也补进桶导出，避免 web 再用 inline `as` 强转）
- `packages/core/src/index.ts` -- MODIFY：桶追加 `theme-linking` 模块组（`generateAssociations`/`getLatestAssociationSet`/`StubAssociationDataAdapter` + const + 类型）+ `listPublishedAssociations`/`PublishedHotEventAssociation`/`AssociationItem`/`PublishedHotEventReaction`（补导出）
- `apps/worker/src/verify-associations.ts` -- NEW：镜像 `verify-market-reaction.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetState 清表序含新 2 表）；seed source+records→clusterEvents→`generateExplanation`→`decideReview(approve)` 产 1 已发布→`generateAssociations({adapter:new StubAssociationAdapter()})`→`refreshPublishedReadModel(publish)`→断言：set append 一行（items ≥1 项、每项 kind/label/mappingBasis 非空、source=template、traceId）、`getPublishedHotEventDetail.associations` 非 null（items）、append-only（二次 generate append 第二行、旧行不动、refresh 后投影 generatedAt=最新、items=最新）、adapter 缺失/返回 null/`[]`→返回 null 不写、缺 mappingBasis 项→抛错（AC2）、NFR 无投资建议关键词、takedown 后 association 投影清零+detail null、`listPublishedAssociations` 返回该行；打印 PASS。无需 Redis（直调 core）
- `apps/worker/src/verify-publish.ts` -- MODIFY（最小，沿用 2-1 惯例）：优先不动；若 typecheck/runtime 因新表 FK 报错才在 resetState 清表序追加 `publishedHotEventAssociation.deleteMany` + `eventAssociationSet.deleteMany`（FK 序：在 hot_events 之前清）
- `apps/worker/package.json` -- MODIFY：加 `verify:associations`（`tsx src/verify-associations.ts`）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY：在「市场反应」section 与「证据时间线」之间插入「关联」`<section>`——`detail.associations !== null && detail.associations.items.length > 0` 时：按 concept/industry/stock 分组（只渲染存在项，AC3），每组标题 + 该组 `<FilterPill href={\`/?${kind}=${encodeURIComponent(label)}\`}>{label}</FilterPill>`（复用 chips.tsx FilterPill，渲染为链），底部 provenance 行「关联依据：系统映射」（AC2，`text-xs text-ink-tertiary`）；`detail.associations === null` 或 items 空→降级文案「暂无已确认的概念 / 行业 / 个股关联。」（AC3）。真实 token，无投资建议措辞。既有五分区/证据时间线零改动
- `apps/web/app/(public)/page.tsx` -- MODIFY（最小）：`searchParams` 增 `concept?/industry?/stock?`；额外调 `listPublishedAssociations({prisma,traceId})` 建 `hotEventId→items` map；`visible` 过滤追加关联维度（event 须含对应 kind+label 项，与 window 过滤 AND）；活动关联维度渲染可清除 `<FilterPill>`（链回 `?window=<current>` 去关联维度）；无匹配→既有「当前筛选条件下无热点事件。」空态 + 清除链。无关联维度参数时行为与 1-7 完全一致（零回归）
- `apps/web/app/(public)/_components/feed-filters.tsx` -- MODIFY（最小）：新增 `parseAssociationFilter` + 关联维度 active 时在窗口 pill 组旁渲染一个可清除 `<FilterPill>`（active 态，链去该维度）；不动 `FEED_WINDOWS`/`parseFeedWindow`/默认行为
- `apps/web/e2e/seed-associations.ts` -- NEW：镜像 `seed-market-reaction.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→清表 FK 序[含新 2 表]→建 source+N records→clusterEvents→generateExplanation→对将发布者 `generateAssociations({adapter:new StubAssociationAdapter()})`→`decideReview(approve)` 产 **1 已发布+关联**；另产 **1 已发布但无关联**（不调 generateAssociations，验证降级）→resetPrisma）；导出 `{withAssocHotEventId, withAssocTitle, withoutAssocHotEventId, withoutAssocTitle, stubConcept}` 供 spec
- `apps/web/e2e/associations.spec.ts` -- NEW（describe 标题含 `@associations`）：前置 `tsx e2e/seed-associations.ts`；断言 `GET /events/{withAssocId}` 200、关联区块可见、concept/industry/stock 分组中已确认项可见、每项为可点击链 `/?<kind>=<label>`（AC1）、provenance「关联依据：系统映射」可见（AC2）；点 concept 链→`/?concept=<stubConcept>` feed 只显含该 concept 的事件（非死链，AC1）；`GET /events/{withoutAssocId}` 200、关联区块显降级文案「暂无已确认的概念 / 行业 / 个股关联。」、**不**出现关联项（AC3）；既有五分区/证据时间线/市场反应不回归
- `apps/web/package.json` -- MODIFY：加 `e2e:associations`（`playwright test --grep @associations`，spec beforeAll 自 seed）与 `seed:associations`；**改 `e2e` 的 `--grep-invert` 追加 `@associations`**；既有 `e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction` 等不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 2-2 defer（真实关联知识源/provider+SDK、关联生成 worker/cron/自动触发、运营 curated 关联 UI+taxonomy、stock 价格反应归 2-1 已建、概念/行业/个股独立详情页、多关联维度同时活动 clear 控件、feed 关联过滤 JS 全表读 scale ceiling、Json items 列的查询性上限、stub 仅测试非 prod 的诚实下限、关联生成无 worker 的触发缺口）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_association_read_models` -- 加 2 模型（EventAssociationSet append-only + published_hot_event_associations 读模型，items Json）+ HotEvent 反向导航 + 迁移 -- AD-2 写归属 + AD-3 公开关联读模型落表
- `packages/core/src/modules/theme-linking/{types.ts,adapter.ts,stub-adapter.ts,association-service.ts,index.ts}` + `src/index.ts` 桶 -- `AssociationAdapter` 端口 + `StubAssociationAdapter`（测试双桩）+ `generateAssociations`/`getLatestAssociationSet`（确定性、强制 mappingBasis、append-only）+ 类型 + 桶 -- theme-linking 领域模块核心（verify/seed 直调，无 worker）
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- refresh 扩展（publish 投影最新 set、takedown 清第 5 表）+ `getPublishedHotEventDetail` 加 associations 读 + `PublishedHotEventDetail.associations` + 新 `listPublishedAssociations` 查询 + 类型/桶（顺手补 `PublishedHotEventReaction` 桶导出） -- AD-3 公开关联读模型唯一拥有者投影 + 详情读契约扩展 + feed 关联过滤数据源
- `apps/worker/src/verify-associations.ts` + `package.json:verify:associations` + `verify-publish.ts`（仅 FK 必要时扩 reset） -- 确定性自检脚本（items/basis 强制/append-only/投影取最新/adapter 缺失不写/takedown 清第 5 表/listPublishedAssociations/NFR 无建议词） -- AC1/AC2/AC3 数据级验证；既有 verify 零回归
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 插入「关联」section（concept/industry/stock 分组 FilterPill 链 + provenance + 降级态）-- AC1/AC2/AC3 surface
- `apps/web/app/(public)/page.tsx` + `_components/feed-filters.tsx` -- feed 接受 `?concept=|?industry=|?stock=` JS 过滤 + 活动关联维度可清除 FilterPill -- AC1 跳转去向（非死链）surface；无参数零回归
- `apps/web/e2e/{seed-associations.ts,associations.spec.ts}` + `package.json:e2e:associations/seed:associations` + `e2e` grep-invert 加 @associations -- 独立 seed（产 1 已发布+关联 + 1 已发布无关联）+ @associations e2e（分组项/链跳转命中过滤/provenance/降级态/不回归）-- AC1/AC2/AC3 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 2-2 defer 项（provider/SDK/worker-cron/运营 UI+taxonomy/独立详情页/多维 clear/JS 过滤 scale ceiling/Json 查询性/stub 诚实下限/触发缺口）-- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 2-2 迁移已应用，When 经 clusterEvents→generateExplanation→decideReview(approve) 发布一候选后 `generateAssociations({adapter:new StubAssociationAdapter()})`→`refreshPublishedReadModel(publish)`，Then `event_association_sets` append 一行（items 含 concept/industry/stock ≥1 项、每项 kind/label/mappingBasis 非空、`source="template"`），And `published_hot_event_associations` 投影该最新行，And `getPublishedHotEventDetail` 返回非 null `associations` 且仅 `SELECT published_*` 五表（不触及 event_association_sets/hot_events/evidence_*）。
- Given 已发布且有 association 投影，When 匿名访问 `/events/{id}`，Then 详情「关联」区块按 concept/industry/stock 分组呈现已确认项（≥1 组，AC1），And 每项为可点击链 `/?<kind>=<label>`，And 显「关联依据：系统映射」provenance（AC2），And 无投资建议措辞。
- Given 关联 concept 项链 `/?concept=半导体`，When 访问该 URL，Then feed 只显含 concept="半导体" 关联的已发布事件（含来源事件），And 活动筛选以可清除 FilterPill 呈现，And 无关联维度参数时 feed 与 1-7 行为一致（零回归）。
- Given 已发布但无 set（adapter 不可得 / 未生成），When 访问 `/events/{id}`，Then 「关联」区块显「暂无已确认的概念 / 行业 / 个股关联。」降级文案（AC3），And 不出现关联项，And 既有 summary/explanation/evidence/reaction 照常渲染（NFR5 不阻断）。
- Given adapter 返回项某项缺 `mappingBasis`，When `generateAssociations`，Then 抛错、不 append（AC2 强制映射依据，不 silently 填默认）。
- Given `generateAssociations({adapter:undefined})` 或 adapter 返回 null/`[]`，When 调用，Then 返回 null、不 append 任何 set 行（无数据→不造假）。
- Given `EventAssociationSet` 已有 ≥1 行，When 再次 `generateAssociations` 同 hotEvent，Then append 新行（旧行不 update/delete），And `refresh` 后投影 `generatedAt` = 最新行 `createdAt`、items = 最新行 items。
- Given 已发布（含 association 投影），When `decideReview(takedown)`，Then `published_hot_event_associations` 清零（与既有四表同批），And 之后 `getPublishedHotEventDetail` 返回 null（404，AD-8）。
- Given 详情/首页路由 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功，And `pnpm -r typecheck`/`pnpm -r lint` 通过，And `pnpm --filter worker verify:associations` 打印 PASS（items/basis 强制/append-only/投影取最新/adapter 缺失不写/takedown 清第 5 表/listPublishedAssociations/NFR 无建议词），And `pnpm --filter worker verify:publish`/`verify:market-reaction` 不回归。
- When 执行 `pnpm --filter web e2e:associations`（`@associations`），Then `/events/{withAssocId}` 200 且分组项+链+provenance 可见、点 concept 链过滤 feed 命中、`/events/{withoutAssocId}` 200 且降级文案可见无项；And `pnpm --filter web e2e`（home/navigation/design）/`e2e:console`/`e2e:feed`/`e2e:detail`/`e2e:market-reaction` 不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (medium 1, low 1)
- defer: 9
- reject: 18
- addressed_findings:
  - `[medium]` `[patch]` feed 关联过滤的 exclude 分支（非匹配事件须隐藏）此前仅正向验证（源事件可见），未断言非匹配事件被排除——回归为「显示全部」会绿通过。在 `@associations` e2e 的非死链测试追加 `expect(withoutAssoc.title).toHaveCount(0)` 负向断言，锁住 AC1 非死链的 load-bearing 半边。
  - `[low]` `[patch]` 关联过滤的空态 + 清除路径（`?concept=<不存在的>` → 空态文案 + `查看全部` 清除链 → 返回正常 feed）为新行为且无测试。新增 `@associations` 测试覆盖空态文案、清除链存在性、点击清除后 feed 恢复。
  - 9 项 defer 已追加至 deferred-work（投影并发 race、normalizeItems 静默丢弃未知 kind/空白 label 的 observability、label 存储边界归一化、corrupt-DB Json 读侧校验、provenance 固定文案与 multi-basis 动态化、降级路径 traceId 日志、EventAssociationSet 复合索引 perf ceiling）；另 2 项 defer（多维度 collapse、JS 全表读）与实现已登记条目重叠未重复追加。
  - 18 项 reject 静默丢弃（含 `updatedAt`/`generatedAt` 双时间列语义——镜像 2-1 读模型约定；href 未编码 kind——固定 ASCII union；`as never` 测试桩——刻意的边界注入；`sleep(20)` append 断言——镜像 2-1 且 UUIDv7 tiebreaker 正确；republish 恢复关联——AD-5 追加式要求的正确行为，与 explanation/reaction 投影同形；duplicate React key——dedup 已防；单写拥有者 Prisma 之外的 FK/DEFAULT/非 UUIDv7 id 担忧；projectAssociations 幂等 UPDATE 分支——被 assertion 3 覆盖；decideReview+预存 set——由 refresh→projectAssociations 组合验证；AC3 部分集渲染——按组渲染已被全量用例覆盖）。

## Design Notes

**为何 concept/industry/stock 关联身份统一归 `theme-linking` 单一拥有者（尽管 epic-2-context 把「representative-stock」划给 market-reaction）：** epic-2-context 原文「concept/industry/theme associations fall under theme-linking; representative-stock and price/volume reaction data fall under market-reaction (the ReactionSnapshot owner). The internal sub-aggregate split is left to module design.」其把 representative-stock 与 price/volume reaction 并列划归 market-reaction，最自然读法是「个股**价格反应数据**归 market-reaction（2-1 ReactionSnapshot 已有 sector/limitUp）」，而非「个股**关联身份/链**归 market-reaction」。Story 2.2 与 UX 要求概念/行业/个股作为**统一的关联阅读层**渲染，若 stock 关联项归 market-reaction、concept/industry 归 theme-linking，则详情关联读模型须跨拥有者合并投影（publish-orchestrator 从两模块各读再拼），违反 AD-2 读模型单一拥有者清晰性且徒增复杂度。epic 显式「internal sub-aggregate split is left to module design」把此决策下放给模块设计——故选最简可辩护读法：**关联身份（哪个 concept/industry/stock 与事件相关、可点击）统一归 theme-linking；stock 的价格反应数据归 market-reaction（已建，本 story 不碰）**。这非 intent gap（epic 显式下放 + story 统一关联层框定共同选定此读法）。

**为何建 `AssociationAdapter` 端口（区别于 1-8 defer 掉 LLMAdapter，同于 2-1 建 MarketDataAdapter）：** 1-8 defer LLMAdapter 因「单一确定性实现、无 SDK→port 属 YAGNI 反模式」（explain 能从真实证据诚实派生）。concept/industry/stock 关联**无法**从证据文本诚实派生——「中芯国际是半导体板块个股」是知识、非推导，须外部映射库/知识源/NER/LLM。故关联是 theme-linking 模块的**唯一外部输入**、无内部 fallback（同 2-1 行情数据）。adapter 端口是真实知识源唯一接入缝——defer 端口意味着 provider 落地时整模块重写。且 AD-7 字面把行情/LLM/源站端口列为不变量，epic-2-context 把关联「rest on an explicit mapping basis」与 `MarketDataAdapter` 同列。故端口建（`modules/theme-linking/adapter.ts`，镜像 `market-reaction/adapter.ts` 模块内端口惯例），concrete 实现是测试用 stub + defer 的真实知识源。

**为何 V1 关联无 worker（区别于 2-1 market-reaction 有 worker）：** epic-2-context Technical Decisions 列举 Epic-2 三个 BullMQ job 类目：market signal aggregation（2-1）、daily digest（2-4）、theme backfill（2-3）。**关联生成不在其列**（theme-backfill 是 2-3 主题成员回填，非 2-2 concept/industry/stock 关联）。故 `generateAssociations` 为纯逻辑+DB append，verify/seed 直调（同 `generateExplanation`/`generateMarketReaction`，无 Redis）。2-1 有 worker 因 epic 把 market-signal aggregation 列为 job 类目；2-2 无 worker 因 epic 未列关联生成 job——区别是 epic job 类目表，非随意。V1 prod 无任何触发→无关联生成→诚实降级（与 2-1 worker 跑但 adapter none→skip→降级，功能等价）。建一个无触发、无真实 adapter 的 worker 纯属仪式（ponytail），故不建；触发（worker/cron/操作命令/publish 钩子）defer。

**为何跳转去向是过滤 feed（`/?<kind>=<label>`）而非独立页：** AC1「每个关联项有明确跳转去向」+ epic「every associated item must have a clear click-through destination (filtered view, detail, or secondary page); dead links are defects」。V1 无 concept/industry/stock 独立详情页（2-3 theme 页未建、stock 详情页不存在），唯一 V1 内部可行去向是**过滤 feed 视图**（epic 列举的「filtered view」）。deferred-work 1-7/1-9/1-10 均登记「分类筛选维度随 Epic 2.2 分类关联落地时评估」——即 2-2 是分类 feed 筛选的自然落点。故关联项链 `/?concept=半导体`，feed 真实 honor 该维度（JS 过滤，复用 `filterByWindow` 模式，`listPublishedHotEvents` 保持 filter-free 不变），链非死链。多关联维度同时活动 + 显式「清除全部」控件 defer（沿用 1-7 filter-pill clear defer）。

**为何 `items Json` 列而非规范化子表：** 一个事件可有多个 concept/industry/stock 项（变量基数）。`items Json` 存 `AssociationItem[]` 最简、端到端强类型（TS `AssociationItem[]` ↔ Prisma Json）、直映射详情分组渲染。这些项是 display-only 编辑注解，**整体读、永不按单项查询**（feed 关联过滤是 JS 全表读 + 内存过滤，非 SQL 单项查），故规范化子表（`published_hot_event_association_items` 多行）是过度设计（ponytail：不为尚不存在的单项 SQL 查询预建子表）。未来若需按 concept/industry 做 SQL 索引查询或聚合，重构为子表（defer，记 deferred-work）。沿用 `tags String[]` 的「display-only 集合用非规范化列」精神，但 items 有结构故用 Json 而非 `String[]`。

**为何 `mappingBasis` 数据级强制（adapter 返回缺依据项→抛错）：** AC2「关联结果必须基于明确映射依据 / 不允许完全手工随意填写后直接公开」。若 adapter 返回无 `mappingBasis` 的项被 silently 接受（填默认依据），则 AC2 的「明确依据」沦为装饰——任何来源（含未来手填）都能产出无依据关联。故 `generateAssociations` 校验每项 `mappingBasis` 非空，缺则抛错（fail-fast，沿用「absence as absence, never fabricated」）。stub fixture 每项带 `"knowledge_base:v1"` 依据；真实 provider 须自带依据（如 `"tushare:concept"`）。详情显 provenance 行让依据在公开面可观测/可审计（非仅数据级）。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name association_read_models` -- expected: 迁移应用、2 新表生成（随后 prisma generate 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 theme-linking 模块 + publish-orchestrator 扩展 + web 详情/首页消费）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:associations` -- expected: 集成脚本打印 PASS（items/basis 强制/append-only/投影取最新/adapter 缺失不写/缺依据抛错/takedown 清第 5 表/listPublishedAssociations/NFR 无建议词）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` / `verify:market-reaction` -- expected: 不回归（若新表 FK 致 reset 报错则仅扩 resetState 清表序，不改既有断言）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（详情/首页 force-dynamic 不在 build 求值；静态公共页不 import core）
- `pnpm --filter web e2e:associations` -- expected: seed 后 `@associations` 通过（withAssoc 分组项+链+provenance / 链跳转命中过滤 feed / withoutAssoc 降级文案无项）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` / `e2e:market-reaction` -- expected: 不回归

**Manual checks (if no CLI):**
- 已发布+关联事件 `/events/{id}` 关联区块显 concept/industry/stock 分组项（可点击链）+ provenance；点 concept 链 `/?concept=半导体` feed 命中过滤；已发布无关联显「暂无已确认的概念 / 行业 / 个股关联。」降级无项；未发布 id 404 不泄漏；既有五分区/证据时间线/市场反应不回归；无投资建议措辞；详情匿名可达无登录墙。
