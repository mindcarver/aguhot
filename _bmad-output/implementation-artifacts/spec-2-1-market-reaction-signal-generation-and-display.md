---
title: '市场反应信号生成与展示 (2.1)'
type: 'feature'
created: '2026-07-10'
status: 'in-review'
baseline_revision: '7d85b656c8ee39dce4640c4f9e4b8c20644a775e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.8 落地了公开详情页的三分区 + 证据时间线，但详情页没有任何「市场是否已经对这条热点作出响应」的结构化信号面；`market-reaction` 领域模块、`MarketDataAdapter` 端口、市场反应写表/读模型、市场反应 BullMQ job 全部不存在（epic-2-context 明确把 `market-reaction` 列为本 epic 首个新模块）。当前 `getPublishedHotEventDetail` 只组装 summary/explanation/evidence 三表，无反应维度；`ReactionChip` 组件（1.3 已建、`/design` 占位消费）从未接到真实读模型数据。

**Approach:** 新建 `market-reaction` 领域模块：`MarketDataAdapter` 端口（镜像 `SourceAdapter`，AD-7 行情源经端口接入）+ `StubMarketDataAdapter`（确定性测试双桩，**仅 verify/e2e 用**）+ `generateMarketReaction`（从 adapter 输出派生 **两类**信号——价格/成交维度 + 板块/涨停维度，每类带 tone 与 value，共享一个 `tradingSession` 时间语境）+ append-only `MarketReactionSnapshot` 写表（一次市场快照一行，`HOT_EVENT ||--o{ REACTION_SNAPSHOT`）。复用 `publish-orchestrator`（AD-3 公开读模型唯一拥有者）扩 `refreshPublishedReadModel`：publish 分支投影最新 snapshot→新 `published_hot_event_reactions`（无则 deleteMany），takedown 分支 deleteMany 该第 4 张 published 表（与既有三表同批清，保持「行存在=已发布」契约）；`getPublishedHotEventDetail` 加第 4 个读 + 返回新 `reaction` 字段。新增 `market-reaction` BullMQ job（AD-4，镜像 `explain` 队列/worker；处理 `publicationStatus:"published"` 且无 snapshot 的事件——**market 反应发生在发布之后**，故 status 过滤是 `published` 而非 explain 的 `candidate`）。详情页加「市场反应」`<section>`：渲染两类 `<ReactionChip/>` + `tradingSession` 时间语境；无 snapshot→诚实降级文案（AC3，NFR5）。V1 不接真实行情 provider（采购 defer）——**故 worker 运行时 adapter 解析为 none，prod 诚实降级；StubMarketDataAdapter 仅 verify/e2e 直调 `generateMarketReaction` 走通 happy path**（区别于 1.8：explain 的 template 是从真实证据诚实派生可在 prod 跑；市场反应 stub 是 fixture 数据，上公开财经页会误导，故 prod 降级、stub 仅测试）。新增 `verify:market-reaction`（worker，直调 stub）与 `@market-reaction` e2e（独立 seed：产 1 已发布+reaction + 1 已发布无 reaction）。不建 2.2 概念/行业/个股关联、不做日内轮询/cron、不做真实 provider SDK、不改 1-6~1-10 既有断言——均记 defer。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：详情页市场反应区块只经 `getPublishedHotEventDetail` 读 `published_hot_event_reactions`（+ 既有三表），绝不读 `market_reaction_snapshots`/`hot_events`/`evidence_*`。`reaction` 是详情读模型新增字段；行存在=当前已发布反应（无 status 列、无 WHERE 可遗忘，沿用 1-6/1-7/1-8 读模型契约）。`published_hot_event_reactions` 由 `publish-orchestrator` 投影（epic-2-context 明确「reaction sections read only published_* generated/refreshed by publish-orchestrator」），**非** market-reaction 模块直写。
- 写归属（AD-2 单一写拥有者）：`market-reaction` 仅拥有 `market_reaction_snapshots`（append-only 写表，一次快照一行，永不 update/delete 旧行）；`publish-orchestrator` 拥有 `published_hot_event_reactions` 投影。market-reaction **绝不**写 `hot_events`/`published_*`/`evidence_*`。
- 两类信号最低保证（AC2）：每个 `MarketReactionSnapshot` 至少含一价格/成交维度信号 + 一板块/涨停维度信号；每个信号带 `tone`（up/down/flat，复用 `ReactionChip` 语义）+ `value`（展示串）；整张快照带一个 `tradingSession` 时间语境（「每个信号都带明确时间语境」——两类信号共享同一快照的交易时段）。
- 市场反应是解释性、非建议性（NFR/epic-2-context）：信号串只描述已发生的行情事实（涨跌幅 / 板块名 / 涨停家数），**绝不**含买卖/目标价/持仓/增持减持措辞。`verify:market-reaction` 断言无投资建议关键词（沿用 1-8 `noInvestAdvice` 惯例）。
- adapter 端口（AD-7）：行情数据仅经 `MarketDataAdapter` 接口进入；domain 不依赖第三方 SDK（V1 无 SDK）。`generateMarketReaction({prisma,traceId,hotEventId,adapter?})`——`adapter` 缺失/返回 null→返回 null、不写 snapshot（诚实降级，非造假）。
- 经 BullMQ job（AD-4 字面）：`market-reaction` 队列/worker 镜像 `explain-queue.ts`（lazy Queue + enqueue helper + Worker 内 `dynamic import("@aguhot/core")`）；web 请求路径绝不调 `generateMarketReaction`。`generateMarketReaction` 纯逻辑+DB append，可被 verify/seed 直调（同 `generateExplanation`/`clusterEvents`，无 Redis）。
- append-only（AD-5 风格）：`MarketReactionSnapshot` 永不 update/delete，每次生成 append 一行；公开投影取该 hotEvent 最新一行（`createdAt` desc、`id` desc tiebreaker——UUIDv7 单调，沿用 1-8 修复）。日内多次轮询会追加多行时间序列（公开取最新）；V1 worker 仅处理「已发布且无 snapshot」的事件（初始生成），轮询 cadence/cron defer。
- 降级态诚实（AC3/NFR5）：无 snapshot（adapter 不可得 / explain 后 worker 未跑）→详情页市场反应区块显式「市场反应数据暂不可用」降级文案，**不**留空、**不**造假信号、**不**因缺数据阻断既有 summary/explanation/evidence 渲染。
- `next build` 保持无 `DATABASE_URL`（1-6~1-8 build 不变量延续）：详情路由已 `force-dynamic`，新增市场反应区块不改路由动态性；`(public)/layout.tsx` 及静态公共页仍不 import `@aguhot/core`。
- token 安全：市场反应区块用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`border-border-hairline`/`ink-*`），`<ReactionChip>` 复用既有 `bg-market-{up|down|flat}-soft`/`text-market-{up|down|flat}`（1.3 已落地，红绿仅作 chip、非整卡铺色——UX-DR7/UX-DR15）。数字 `font-mono`。
- 不变性约定（沿用 1-4~1-10）：状态/种类用 `const … as const` + union（禁 TS `enum`，`erasableSyntaxOnly`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601/稳定格式；PK UUIDv7（`newTraceId()`）；queue/job 名 kebab-case（`market-reaction`）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:market-reaction` 或 `@market-reaction` e2e seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 新增模型/模块致 `pnpm -r typecheck`/`lint` 回归 → HALT。
- `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。

**Never:**
- 不接真实行情 provider（无 API key/SDK/网络调用；V1 `StubMarketDataAdapter` 纯确定性 fixture，**且仅 verify/e2e 用、不在 worker/prod 接线**——fixture 市场数据上公开财经页违反 NFR「absence as absence」）。具体 provider 采购 defer。
- 不让 worker 在 prod 跑 stub 产出 fixture 信号（worker 运行时 adapter 解析为 none → 跳过 → prod 降级）；`StubMarketDataAdapter` 不被 `apps/worker` import。
- 不做日内轮询/cron/cluster→explain→market 自动编排（沿用 1-5/1-8「job 独立、幂等、chaining/cron 未落地」；market-reaction 同 explain 为可独立/手动/cron 触发的 job，seed/verify 显式调）。
- 不建 2.2 概念/行业/个股关联（sector 名来自 stub fixture，真实板块/个股映射依赖 2.2 关联结果，defer）；不做 market-reaction 绕过 review 闸门直发（epic defer 项）；不做运营市场反应修订 UI。
- 不在公开详情读 `market_reaction_snapshots`/`hot_events` 绕过读模型；不让既有公共页新 import `@aguhot/core`；不改 1-6~1-10 既有 verify/seed/spec 断言（console/feed/detail/revision/merge-split seed/spec 零改动保持绿）。
- 不渲染投资建议措辞（无买卖/目标价/持仓，NFR）；不新增 `SourceAdapter`/`LLMAdapter`；不改 `packages/config/src/env.ts`（V1 无 market-data env，adapter defer）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 已发布+adapter 可得→生成+投影（AC1/AC2） | 某 hotEvent 已 `published`、`adapter` 返回非 null `MarketDataSnapshot`，`generateMarketReaction` | append 一行 `market_reaction_snapshots`（两类信号各一，tone/value 非空、`tradingSession`、`source="template"`、`traceId`）；随后 `refreshPublishedReadModel(publish)` upsert `published_hot_event_reactions`；`getPublishedHotEventDetail` 返回非 null `reaction`（两类信号+tradingSession） | 无错误预期 |
| 详情渲染两类 chip+时间语境（AC2） | 已发布且有 reaction 投影，`GET /events/{id}` | 「市场反应」`<section>` 渲染 ≥1 价格/成交 `<ReactionChip>` + ≥1 板块/涨停 `<ReactionChip>`（tone+value，复用 1.3 chip），显 `tradingSession` 时间语境 | 无错误预期 |
| 信号不可得→降级（AC3/NFR5） | 已发布但无 snapshot（adapter none / worker 未跑 / takedown 后），`GET /events/{id}` | 「市场反应」区块显「市场反应数据暂不可用」降级文案；**不**留空、**不**造假 chip；其余 summary/explanation/evidence 照常渲染 | 无错误预期 |
| adapter 缺失→不写（NFR 不造假） | `generateMarketReaction({adapter:undefined})` 或 adapter 返回 null | 返回 null、**不** append 任何 `market_reaction_snapshots` 行（无数据→不生成→降级） | 无错误预期 |
| append-only + 投影取最新（AD-5） | 同 hotEvent 已有 ≥1 snapshot，再次 `generateMarketReaction` | append 新行（旧行不 update/delete）；`refresh` 后 `published_hot_event_reactions.generatedAt` = 最新行 `createdAt` | 无错误预期 |
| takedown 清第 4 表 | 已发布（含 reaction 投影）→`decideReview(takedown)` | `published_hot_event_reactions` deleteMany（与既有三表同批）；之后 `getPublishedHotEventDetail` 返回 null（404，AD-8 不泄漏） | 无错误预期 |
| 未发布 id 不泄漏（AD-8） | candidate/rejected/taken_down/未知 id，`GET /events/{id}` | `getPublishedHotEventDetail` 返回 null→`notFound()`（404） | 404 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错；`next build`（无 DB）仍成功 | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 2 模型。`MarketReactionSnapshot`（id UUIDv7 PK, hotEventId FK→hot_events onDelete Cascade, priceVolumeTone `@map("price_volume_tone")`, priceVolumeValue, sectorLimitUpTone `@map("sector_limit_up_tone")`, sectorLimitUpValue, limitUpCount Int `@map("limit_up_count")`, tradingSession DateTime `@map("trading_session")`, source String, traceId, createdAt；`@@index([hotEventId])` `@@index([createdAt])` `@@map("market_reaction_snapshots")`）。`PublishedHotEventReaction`（hotEventId PK/FK→hot_events onDelete Cascade, 同 6 信号列 + reactionSource `@map("reaction_source")`, generatedAt `@map("generated_at")`, traceId, updatedAt `@updatedAt` `@@map("published_hot_event_reactions")`）。在 `HotEvent` 加只读反向导航 `marketReactionSnapshots MarketReactionSnapshot[]`、`publishedReaction PublishedHotEventReaction?`（元数据，不改 event-assembly 写归属，沿用 schema 既有 AD-2/AD-6 注释惯例）
- `packages/core/prisma/migrations/<ts>_market_reaction_read_models/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name market_reaction_read_models` 生成（2 张新表；hot_events 反向关系无列、仅 Prisma 导航）
- `packages/core/src/modules/market-reaction/types.ts` -- NEW：`ReactionTone`（up/down/flat const）、`ReactionSource`（template const，未来 provider id）、`ReactionDimension`（price_volume/sector_limit_up）、`MarketDataSnapshot`({tradingSession,priceVolumeChangePercent,sector:{name,changePercent},limitUpCount})、`ReactionSignal`({tone,value})、`MarketDataAdapter`（端口 interface `fetchSnapshot({hotEventId}): Promise<MarketDataSnapshot|null>`）、`GenerateMarketReactionOptions`({prisma,traceId,hotEventId,adapter?})、`GenerateMarketReactionResult`、`GetLatestMarketReactionOptions`、`MarketReactionSnapshotRecord`
- `packages/core/src/modules/market-reaction/adapter.ts` -- NEW：`MarketDataAdapter` 端口 interface（镜像 `source-ingest/adapter.ts` 注释风格：domain 依赖端口、concrete adapter 在 worker/assembly 层解析、provider swap 不动 domain；V1 无 SDK）。类型从 `./types.js` 导入
- `packages/core/src/modules/market-reaction/stub-adapter.ts` -- NEW：`StubMarketDataAdapter implements MarketDataAdapter`——确定性 fixture（`fetchSnapshot` 返回固定非 null `MarketDataSnapshot`：如 priceVolumeChangePercent=3.42、sector{name:"半导体",changePercent:2.1}、limitUpCount=5、tradingSession=固定 UTC）。**仅 verify/e2e 消费**，头注释标明「test-only, not wired in worker/prod; real provider deferred」
- `packages/core/src/modules/market-reaction/market-reaction-service.ts` -- NEW：`generateMarketReaction({prisma,traceId,hotEventId,adapter?})`（adapter 缺失/返回 null→返回 null、不写；否则 `deriveSignals(snapshot)`→append 一行 `market_reaction_snapshots`，source="template"，每次 append、永不 update/delete）；`getLatestMarketReaction({prisma,traceId,hotEventId})`（createdAt desc、id desc 首条，无则 null）。纯逻辑+DB append、无 BullMQ/无外部 SDK。`deriveSignals` 为纯函数（同输入→同 tone/value，可直测）
- `packages/core/src/modules/market-reaction/index.ts` -- NEW：桶导出
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：`refreshPublishedReadModel` `action==="publish"` 分支追加 `projectMarketReaction(prisma,traceId,hotEventId)`（读最新 `MarketReactionSnapshot`→有则 upsert `published_hot_event_reactions`、无则 deleteMany，镜像 `projectExplanation`）；`action==="takedown"` 分支追加 deleteMany `publishedHotEventReaction`（第 4 张表，与既有三表同批清）。`getPublishedHotEventDetail` 加第 4 个读（`publishedHotEventReaction.findUnique`）+ 返回 `reaction: PublishedHotEventReaction|null` 字段
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：加 `PublishedHotEventReaction`（{priceVolume:{tone,value}, sectorLimitUp:{tone,value}, limitUpCount, tradingSession, source, generatedAt}）、`GetPublishedHotEventDetailOptions` 不变、`PublishedHotEventDetail` 加 `reaction: PublishedHotEventReaction|null`
- `packages/core/src/index.ts` -- MODIFY：桶追加 `generateMarketReaction`、`getLatestMarketReaction`、`StubMarketDataAdapter`、`MarketDataAdapter`(type)、`ReactionTone`、`ReactionSource` + 相关类型导出
- `apps/worker/src/queues/market-reaction-queue.ts` -- NEW：镜像 `explain-queue.ts`——`MARKET_REACTION_QUEUE_NAME="market-reaction"`/`MARKET_REACTION_JOB_NAME="market-reaction"`、`MarketReactionJobData`、`getMarketReactionQueue()` lazy Queue、`enqueueMarketReaction(traceId)`（removeOnComplete 100/removeOnFail 500）、`registerMarketReactionWorker()`（Worker 内 `dynamic import("@aguhot/core")`；查 `publicationStatus:"published"` 且 `marketReactionSnapshots:{none:{}}` 的事件；adapter 解析为 none→跳过该批、return {generated:0,skipped}；`// ponytail: real provider wired when procured — V1 no adapter, prod degrades honestly`；有 adapter 则 `generateMarketReaction`+`refreshPublishedReadModel(publish)`，per-event try/catch 隔离）
- `apps/worker/src/index.ts` -- MODIFY：注册 `registerMarketReactionWorker()`；shutdown 关闭四 worker；启动 log 改为 source-ingest + event-cluster + explain + market-reaction
- `apps/worker/src/verify-market-reaction.ts` -- NEW：镜像 `verify-explain.ts`/`verify-publish.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetPrisma）；seed source+records→clusterEvents→`generateExplanation`→`decideReview(approve)` 产 1 已发布→`generateMarketReaction({adapter:new StubMarketDataAdapter()})`→`refreshPublishedReadModel(publish)`→断言：snapshot append 一行（两类信号非空、source=template、traceId）、`getPublishedHotEventDetail.reaction` 非 null（两类 tone/value + tradingSession）、append-only（二次 generate append 第二行、旧行不动、refresh 后投影 generatedAt=最新）、adapter 缺失→返回 null 不写、NFR 无投资建议关键词、takedown 后 reaction 投影清零+detail null；打印 PASS。无需 Redis（直调 core）
- `apps/worker/src/verify-publish.ts` -- MODIFY（最小）：不强制扩断言（market-reaction 由 `verify:market-reaction` 独立覆盖）；仅在 resetState 清表序列追加 `publishedHotEventReaction.deleteMany` + `marketReactionSnapshot.deleteMany`（FK 序：reactions/snapshots 在 hot_events 之前清）以保持既有脚本在新表存在下 reset 干净——若无此需要可不动（snapshots/reactions 以 hotEventId FK Cascade，hot_events deleteMany 前须先清这两表）。**优先不动 verify-publish**；若 typecheck/runtime 因新表 FK 报错才扩 reset
- `apps/worker/package.json` -- MODIFY：加 `verify:market-reaction`（`tsx src/verify-market-reaction.ts`）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY：在「当前仍不确定什么」分区与「证据时间线」之间插入「市场反应」`<section>`——`detail.reaction !== null` 时渲染：标题「市场反应」+ 两类 `<ReactionChip tone={…} value={…}>`（价格/成交 + 板块/涨停，来自 `detail.reaction.priceVolume`/`.sectorLimitUp`）+ `tradingSession` 时间语境行（`font-mono`，复用 `formatDateTime`）；`detail.reaction === null` 时渲染降级文案「市场反应数据暂不可用」（AC3）。真实 token，无投资建议措辞。既有三分区/证据时间线零改动
- `apps/web/e2e/seed-market-reaction.ts` -- NEW：镜像 `seed-detail.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→清表 FK 序[含新 2 表]→建 source+N records→clusterEvents→generateExplanation→对将发布者 `generateMarketReaction({adapter:new StubMarketDataAdapter()})`→`decideReview(approve)` 产 **1 已发布+reaction**；另产 **1 已发布但无 reaction**（不调 generateMarketReaction，验证降级）→resetPrisma）；自包含、不触碰既有 seed
- `apps/web/e2e/market-reaction.spec.ts` -- NEW（describe 标题含 `@market-reaction`）：前置 `tsx e2e/seed-market-reaction.ts`；断言 `GET /events/{withReactionId}` 200、市场反应区块可见、两类 chip 文案可见（涨/跌/平 label + value）、tradingSession 时间语境可见（AC2）；`GET /events/{withoutReactionId}` 200、市场反应区块显降级文案「市场反应数据暂不可用」、**不**出现市场 chip（AC3）；既有三分区/证据时间线不回归
- `apps/web/package.json` -- MODIFY：加 `e2e:market-reaction`（`tsx e2e/seed-market-reaction.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @market-reaction`）与 `seed:market-reaction`；**改 `e2e` 的 `--grep-invert` 为追加 `@market-reaction`**；既有 `e2e:console`/`e2e:feed`/`e2e:detail` 等不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 2-1 defer（真实行情 provider + SDK 接入、日内轮询 cadence/cron、cluster→explain→market 自动编排、market-reaction 绕过 review 闸门直发、sector/个股真实映射依赖 2.2 关联、扁平 2-dimension 模型的扩展性上限、stub 仅测试非 prod 的诚实下限、market-reaction worker 为未测运行时）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_market_reaction_read_models` -- 加 2 模型（MarketReactionSnapshot append-only + published_hot_event_reactions 读模型）+ HotEvent 反向导航 + 迁移 -- AD-2 写归属 + AD-3 公开反应读模型落表
- `packages/core/src/modules/market-reaction/{types.ts,adapter.ts,stub-adapter.ts,market-reaction-service.ts,index.ts}` + `src/index.ts` 桶 -- `MarketDataAdapter` 端口 + `StubMarketDataAdapter`（测试双桩）+ `generateMarketReaction`/`getLatestMarketReaction`（确定性派生两类信号、append-only）+ 类型 + 桶 -- market-reaction 领域模块核心（AD-4 job 调此、verify/seed 直调此）
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts}` + `src/index.ts` 桶 -- refresh 扩展（publish 投影最新 snapshot、takedown 清第 4 表）+ `getPublishedHotEventDetail` 加 reaction 读 + `PublishedHotEventDetail.reaction` + 类型/桶 -- AD-3 公开反应读模型唯一拥有者投影 + 详情读契约扩展
- `apps/worker/src/queues/market-reaction-queue.ts` + `src/index.ts` + `verify-market-reaction.ts` + `package.json:verify:market-reaction` -- market-reaction BullMQ 队列/worker（镜像 explain；published 状态过滤；V1 adapter none→prod 降级）+ 注册 + 关闭 + 确定性自检脚本 -- AD-4 字面（市场反应汇总经 BullMQ job，off web path）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- 插入「市场反应」section（两类 ReactionChip + tradingSession 时间语境 + 降级态）-- AC2/AC3 surface
- `apps/web/e2e/{seed-market-reaction.ts,market-reaction.spec.ts}` + `package.json:e2e:market-reaction/seed:market-reaction` + `e2e` grep-invert 加 @market-reaction -- 独立 seed（产 1 已发布+reaction + 1 已发布无 reaction）+ @market-reaction e2e（两类 chip/时间语境/降级态/不回归）-- AC1/AC2/AC3 surface-anchored 验证；既有 seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 2-1 defer 项（provider/SDK/cron/编排/闸门/2.2 映射/扁平模型/stub 诚实下限/worker 未测）-- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 2-1 迁移已应用，When 经 clusterEvents→generateExplanation→decideReview(approve) 发布一候选后 `generateMarketReaction({adapter:new StubMarketDataAdapter()})`→`refreshPublishedReadModel(publish)`，Then `market_reaction_snapshots` append 一行（价格/成交 + 板块/涨停两类信号各 tone/value 非空、`tradingSession`、`source="template"`），And `published_hot_event_reactions` 投影该最新行，And `getPublishedHotEventDetail` 返回非 null `reaction` 且仅 `SELECT published_*` 四表（不触及 market_reaction_snapshots/hot_events/evidence_*）。
- Given 已发布且有 reaction 投影，When 匿名访问 `/events/{id}`，Then 详情「市场反应」区块呈现 ≥1 价格/成交 `<ReactionChip>` + ≥1 板块/涨停 `<ReactionChip>`（涨/跌/平 label + value），And 显 `tradingSession` 时间语境（AC2），And 无投资建议措辞。
- Given 已发布但无 snapshot（adapter 不可得 / worker 未跑），When 访问 `/events/{id}`，Then 「市场反应」区块显「市场反应数据暂不可用」降级文案（AC3），And 不出现市场 chip，And 既有 summary/explanation/evidence 照常渲染（NFR5 不阻断）。
- Given `MarketReactionSnapshot` 已有 ≥1 行，When 再次 `generateMarketReaction` 同 hotEvent，Then append 新行（旧行不 update/delete），And `refresh` 后投影 `generatedAt` = 最新行 `createdAt`。
- Given 已发布（含 reaction 投影），When `decideReview(takedown)`，Then `published_hot_event_reactions` 清零（与既有三表同批），And 之后 `getPublishedHotEventDetail` 返回 null（404，AD-8）。
- Given `generateMarketReaction({adapter:undefined})`，When 调用，Then 返回 null、不 append 任何 snapshot 行（无数据→不造假）。
- Given 详情路由 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功，And `pnpm -r typecheck`/`pnpm -r lint` 通过，And `pnpm --filter worker verify:market-reaction` 打印 PASS（两类信号/append-only/投影取最新/adapter 缺失不写/takedown 清第 4 表/NFR 无建议词），And `pnpm --filter worker verify:publish` 不回归。
- When 执行 `pnpm --filter web e2e:market-reaction`（seed + `@market-reaction`），Then `/events/{withReactionId}` 200 且两类 chip + 时间语境可见、`/events/{withoutReactionId}` 200 且降级文案可见无 chip；And `pnpm --filter web e2e`（home/navigation/design）/`e2e:console`/`e2e:feed`/`e2e:detail` 不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

<!-- 空，直至首次 review pass。 -->

## Design Notes

**为何 V1 market-reaction 在 prod 降级、stub 仅测试（区别于 1.8 explain 的 template 在 prod 跑）：** 1.8 的 `generateExplanation` template 是**从真实证据诚实派生**（标题+摘要→发生了什么；来源数/跨度→为什么重要；数据缺口→不确定），故可在 worker/prod 跑、公开页挂 AiLabel。市场反应则**无任何真实行情数据源**（provider 采购 defer），`StubMarketDataAdapter` 返回的是 fixture 百分比——把 fixture 「+3.42%」上公开财经页会让读者误以为是真实行情反应，违反 NFR「absence shown as absence, never fabricated completeness」。故 V1 worker 运行时 adapter 解析为 none（`// ponytail: real provider wired when procured`），prod 诚实走 AC3 降级；`StubMarketDataAdapter` 仅 verify/e2e 直调 `generateMarketReaction` 走通 happy path（证明管道正确）。真实 provider 落地时 worker 解析它、信号流入、source 由 "template" 翻为 provider id。这非 intent gap（AC1 前置「available market data」在 V1 prod 不满足→降级是 NFR5 指定行为；happy path 由 verify/e2e 用 stub 锁）。

**为何建 `MarketDataAdapter` 端口（不像 1.8 defer 掉 LLMAdapter）：** 1.8 defer LLMAdapter 的理由是「单一确定性实现、无 SDK→port 属 YAGNI 反模式」。market-reaction 不同：行情数据是本模块的**唯一输入**、无内部 fallback（explain 能从证据派生，市场反应不能从新闻派生真实涨跌幅），adapter 端口是真实 provider 唯一接入缝——defer 端口意味着 provider 落地时整模块重写。且 epic-2-context 显式把 `MarketDataAdapter` 端口列为「fixed」架构决策（「all market-data sources enter exclusively through this port」）。故端口建（`modules/market-reaction/adapter.ts`，镜像 `source-ingest/adapter.ts` 的模块内端口惯例，非 epic 文本的 `packages/core/contracts`——仓库既有约定是模块内 adapter.ts，describe-by-purpose 从之），concrete 实现是测试用 stub + defer 的真实 provider。

**为何 `published_hot_event_reactions` 由 publish-orchestrator 投影（非 market-reaction 直写）：** epic-2-context 明确「the detail page's reaction sections read only published_* generated/refreshed by publish-orchestrator」。沿用 1-8 explanation 的既定模式：领域模块拥有 append-only 写表（`market_reaction_snapshots`），publish-orchestrator 拥有公开投影（`published_hot_event_reactions`）——单一写拥有者保持「所有 published_* 由 publish-orchestrator 投影 / takedown 同批清」契约统一。投影时机：publish/republish 时投影最新 snapshot（无则 deleteMany→降级）。market-reaction job 生成 snapshot 后调 `refreshPublishedReadModel(publish)` 触发投影（镜像 decideReview 调 refresh 的「触发层调投影、生成器只 append」分层）。投影幂等（upsert + publishedAt 保持），重复 refresh 无副作用。

**为何 market-reaction worker 过滤 `published` 而 explain 过滤 `candidate`：** 市场反应是对**已公开事件**的市场响应汇总（事件须先公开、市场数据才反映其影响），故 worker 处理 `publicationStatus:"published"` 且无 snapshot 的事件；explain 在候选期生成解释（发布时投影）。status 过滤是 load-bearing——否则会对 candidate/rejected/taken_down 浪费生成 + 对已发布 stale（沿用 1-8 explain worker 收窄为 candidate 的同款论证）。

**为何扁平 2-dimension 列而非 JSON signals 数组：** V1 AC 要求恰好两类（价格/成交 + 板块/涨停）。扁平列（priceVolumeTone/Value + sectorLimitUpTone/Value + limitUpCount）最简、强类型、可查询、直映射 `ReactionChip` 的 `{tone,value}`。未来更多维度（如资金流向）→ 重构为 JSON 数组或子表（defer，记 deferred-work）。`ponytail:` 不为尚不存在的第 3 维度预建多态结构。

**为何一次 snapshot 一行（append-only 时间序列）而非单行 upsert：** epic-2-context 数据模型 `HOT_EVENT ||--o{ REACTION_SNAPSHOT`（一对多）。日内多次轮询追加多行（市场反应的时间序列演化），公开投影取最新（createdAt desc）。V1 worker 仅初始生成（处理「无 snapshot」事件），轮询 cadence/cron defer——但写表结构已是 append-only 时间序列，未来日内轮询无需改 schema。`deriveSignals` 为纯函数（snapshot→tone/value 确定性），verify 断言同输入二次等值。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name market_reaction_read_models` -- expected: 迁移应用、2 新表生成（随后 prisma generate 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 market-reaction 模块 + publish-orchestrator 扩展 + web 详情页消费）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:market-reaction` -- expected: 集成脚本打印 PASS（两类信号/append-only/投影取最新/adapter 缺失不写/takedown 清第 4 表/NFR 无建议词）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` -- expected: 不回归（若新表 FK 致 reset 报错则仅扩 resetState 清表序，不改既有断言）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（详情页 force-dynamic 不在 build 求值；静态公共页不 import core）
- `pnpm --filter web e2e:market-reaction` -- expected: seed 后 `@market-reaction` 通过（withReaction 两类 chip+时间语境 / withoutReaction 降级文案无 chip）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` -- expected: 不回归

**Manual checks (if no CLI):**
- 已发布+reaction 事件 `/events/{id}` 市场反应区块显两类 chip（涨/跌/平 label+value）+ tradingSession 时间语境；已发布无 reaction 显「市场反应数据暂不可用」降级无 chip；未发布 id 404 不泄漏；既有三分区/证据时间线不回归；无投资建议措辞；详情匿名可达无登录墙。
