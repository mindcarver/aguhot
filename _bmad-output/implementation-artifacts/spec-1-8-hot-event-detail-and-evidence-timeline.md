---
title: '热点事件详情、证据时间线与解释分区 (1.8)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: 'a3afebc46e3c871261d3c3d4d01e867c1b7570b5'
final_revision: '6dbbb3f458b357b56174e51c025a581a0d15039c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-review-queue-and-publication-gate.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.7 落地了公开首页热点流（`listPublishedHotEvents` 读 `published_hot_events`），但卡片不可点（1.7 把整卡进详情显式 defer 到 1.8），且公开面没有任何详情路由。epic「可信发布闭环」要求用户能"进入详情页阅读摘要与证据时间线"——当前公开详情面完全缺失。同时解释内容（"发生了什么 / 为什么重要 / 当前仍不确定什么"三分区）没有任何数据源：`ExplanationVersion` 模型不存在、explain job 未建（schema 注释与 1.7 deferred-work 均把解释生成显式指派给"1.8 详情页范围"），证据行（来源名/时间/摘要/原文链接）也未投影进任何公开读模型（AD-3 禁止公开页读 `evidence_records`/`hot_event_evidence`）。

**Approach:** 新建 `explanation` 领域模块 + `ExplanationVersion`（追加式，AD-5）+ 确定性 `generateExplanation`（从真实证据派生三分区，V1 不接外部 LLM，注册 defer）+ `explain` BullMQ job（AD-4，镜像 `event-cluster` 队列/worker 结构）。扩展 `publish-orchestrator`（AD-3 公开读唯一拥有者）：`refreshPublishedReadModel` 在 publish 时把最新 `ExplanationVersion` 投影进新 `published_hot_event_explanations`、把证据投影进新 `published_hot_event_evidence`（带 `link_status`，url 缺失即标注、行不消失），takedown 时三表（summary/explanation/evidence）同删；新增 `getPublishedHotEventDetail({prisma, traceId, hotEventId})` 纯读查询（仅 `SELECT published_*`）。落地公开详情路由 `(public)/events/[hotEventId]/page.tsx`（`force-dynamic` + `getPrisma` + 读查询 + `notFound()`）：首屏三分区视觉分区、AI 标识统一（复用 `AiLabel`，AC3）、证据时间线按时序渲染每条来源名/时间/摘要/原文链接（失效标注不静默消失，AC2）、诚实降级态。把 1.7 feed 卡接成 `<Link href="/events/{id}">`（落地 1.7 defer 的整卡进详情）。新增 `@detail` e2e（独立 seed：cluster→explain→approve 产 1 已发布 + 留未发布）与 `verify:explain`（解释生成/追加式断言）、扩 `verify:publish`（详情投影断言）。本 story 不接真实 LLM provider、不做链接存活探测、不做 cluster→explain 自动编排/cron、不做运营解释修订 UI（1.9）、不做返回语境保留（2.5）——均记 defer。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3）：详情页只经 `getPublishedHotEventDetail` 读 `published_hot_events` + `published_hot_event_explanations` + `published_hot_event_evidence`，绝不读 `hot_events`/`evidence_records`/`evidence_sources`/`hot_event_evidence`/`explanation_versions`/`review_decisions`/`publication_decisions`。`getPublishedHotEventDetail` 是详情读模型的首个公开消费者；行存在=当前已发布（无 status 列、无 WHERE 可遗忘，沿用 1-6/1-7 读模型契约）。
- 解释生成是确定性、从真实证据派生（NFR 绝不假数据）：`generateExplanation` 仅从 `HotEvent.title` + 成员 `evidence_records`（sourceName/title/summary/publishedAt/url）派生三分区——"发生了什么"=标题+最新记录摘要；"为什么重要"=来源数/覆盖跨度的客观陈述；"当前仍不确定什么"=数据缺口（缺摘要/缺 url/missing_fields 记录数）+保守不确定陈述。绝不编造未由证据支撑的事实、市场含义或个股判断。
- 解释生成经 BullMQ job（AD-4 字面）：`explain` 队列/worker 镜像 `event-cluster-queue.ts` 结构（lazy Queue + enqueue helper + Worker 内 `dynamic import("@aguhot/core")` 调 `generateExplanation`）；web 请求路径绝不调 `generateExplanation`（详情页只读已投影的发布态）。`generateExplanation` 同时可被 verify/seed 脚本直接调（同 `verify:cluster` 直调 `clusterEvents` 之惯例，无需 Redis）。
- 解释记录追加式、可追溯（AD-5）：`ExplanationVersion` 永不 update/delete，每次生成 append 一行（含 `source` 字段区分 provenance："template" V1，未来 "ai"/"human"）；公开投影取该 hotEvent 最新一行（`createdAt` desc 首条）；运营台版本链消费归 1.9，本 story 只保证模型追加式 + 公开取最新。
- 三分区视觉分区 + 统一 AI 标识（AC1/AC3）：详情页"发生了什么/为什么重要/当前仍不确定什么"为三个独立 `<section>`，事实（标题/来源数/时间）与系统解释（三分区正文）视觉分离；所有系统派生的解释正文统一挂 `<AiLabel />`（复用 `components/chips.tsx`，与运营台同一组件，公开/后台一致）。provenance 细粒度（template/ai/human）在 `ExplanationVersion.source`（运营审计），公开面只见统一标识。
- 证据时间线：每条至少来源名、时间、摘要、原文链接（AC2）；按时序（`publishedAt` ASC，null 末）渲染；`link_status`：url 存在→"available"（渲染"原文链接 ↗"），url 缺失/空→"unavailable"（渲染"无原始链接"徽标，**行保留不消失**）；行永不因链接问题被静默丢弃。
- `next build` 保持无 `DATABASE_URL`（1-6/1-7 build 不变量延续）：详情路由声明 `export const dynamic = "force-dynamic"`，`getPrisma()` 仅请求时被调、不在 build 时求值；`(public)/layout.tsx` 及 `/daily` `/topics` `/favorites` `/design` 保持静态、不 import `@aguhot/core`。
- 匿名可达（AD-8）：详情页无认证、无 `/login` 重定向；未发布 id（读模型无行）→ `notFound()`（404），不泄漏候选/驳回/下线事件。
- token 安全：详情页/证据行用**真实解析**的 token（`bg-surface-raised`/`bg-surface-base`/`bg-surface-muted`/`border-border-hairline`/`rounded-lg`/`ink-*`/`bg-brand`/`bg-accent-warm`）；**不得**复制 1-6 运营台漂移的未定义 token（`bg-surface`/`border-line-subtle`/`bg-brand-strong`，Tailwind v4 下不解析——`event-card.tsx` 头注释为权威警告）。数字/时间用 `font-mono`，标题 `font-display`/`font-sans`。
- 不变性约定（沿用 1-4/1-5/1-6/1-7）：状态/种类用 `const … as const` + union（禁 TS `enum`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601 / 稳定格式；PK UUIDv7（`newTraceId()`）；queue/job 名 kebab-case（`explain`）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:explain`/`verify:publish` 扩展断言或 `e2e:detail` seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 引入详情页 force-dynamic + import `@aguhot/core` 导致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- `pnpm -r typecheck`/`lint` 因新模型/新模块/新路由回归 → HALT。

**Never:**
- 不接真实外部 LLM provider（无 API key/SDK/网络调用；V1 `generateExplanation` 纯确定性派生）。`LLMAdapter` port 本 story **不预建**（当前唯一实现是确定性派生、无第三方 SDK——属 ponytail「单一实现的接口」反模式；port 待真实 LLM 引入时按 AD「外部适配器端口」抽取，记 defer）。不引入 openai/anthropic 等新依赖。
- 不做原文链接 HTTP 存活探测/归档快照（"dead link"由 url 缺失推导为 unavailable；主动探测 → archive 归独立 concern，记 defer）。
- 不做 cluster→explain 自动编排/cron（沿用 1-5「两 job 独立、幂等、chaining 未落地」；explain 同 cluster 为可独立/手动/cron 触发的 job，seed/verify 显式调）。
- 不做运营解释修订/版本差异/重发布 UI（归 1.9）；不做从日报/主题/搜索返回原语境（归 2.5，本 story 仅提供回首页 `/` 的稳定返回链接）。
- 不在公开详情读 `evidence_records`/`hot_event_evidence`/`explanation_versions` 绕过读模型；不让 `(public)/layout.tsx` 或其它既有公共页 import `@aguhot/core`（仅首页 + 详情页两个动态路由 import）。
- 不新增 `SourceAdapter`/`MarketDataAdapter`；不改 1-4/1-5/1-6/1-7 既有 verify/seed/spec 断言（console/feed seed/spec 零改动保持绿）；不渲染投资建议措辞（无买卖/目标价/持仓，NFR）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 已发布详情渲染（AC1/AC2/AC3） | 某 hotEvent 已发布且 `explanation_versions` 有 ≥1 行、`published_hot_event_evidence` 有 N 行，`GET /events/{id}` | force-dynamic 读 `getPublishedHotEventDetail`；首屏三分区（发生了什么/为什么重要/当前仍不确定）视觉分区、解释正文挂 `<AiLabel/>`；证据时间线按时序渲染 N 行（来源名/时间/摘要/原文链接） | 无错误预期 |
| 未发布 id 不泄漏（AD-8） | candidate/rejected/taken_down 的 id（读模型无 summary 行），`GET /events/{id}` | `getPublishedHotEventDetail` 返回 null → `notFound()`（404）；标题/内容不泄漏 | 404 |
| 解释缺失降级（NFR） | 已发布但 explain 未跑（无 `ExplanationVersion` → 无 explanation 投影行） | 三分区结构仍在；"为什么重要/当前仍不确定"区显诚实降级文案"系统解释生成中"，不伪造解释正文；"发生了什么"区仍显标题/来源数/时间（事实不依赖解释） | 无错误预期 |
| 证据原文链接缺失（AC2） | 某证据 `url` 为 null → `link_status="unavailable"` | 该证据行**保留**，渲染"无原始链接"徽标（不静默消失）；其余字段（来源名/时间/摘要）照常 | 无错误预期 |
| 链接可用 | 证据 `url` 存在 → `link_status="available"` | 渲染"原文链接 ↗"（`<a href>` 外链，brand 态） | 无错误预期 |
| 整卡进详情（1.7 defer 落地） | feed `/` 已发布卡 | 卡为 `<Link href="/events/{hotEventId}">`（整卡可点），指向详情页 | 无错误预期 |
| 运行时无 DB | 请求期 `DATABASE_URL` 缺失/PG 不可达 | `getPrisma()` 显式抛错（大声失败，非静默 404）；`next build`（无 DB）仍成功 | 显式错误 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 3 模型。`ExplanationVersion`（id UUIDv7 PK, hotEventId FK→hot_events onDelete Cascade, summary, whyItMatters `@map("why_it_matters")`, uncertainties, source String, traceId, createdAt；`@@index([hotEventId])` `@@index([createdAt])` `@@map("explanation_versions")`）。`PublishedHotEventExplanation`（hotEventId PK/FK→hot_events onDelete Cascade, summary, whyItMatters, uncertainties, explanationSource `@map("explanation_source")`, generatedAt `@map("generated_at")`, traceId, updatedAt `@updatedAt` `@@map("published_hot_event_explanations")`）。`PublishedHotEventEvidence`（id UUIDv7 PK, hotEventId FK→hot_events onDelete Cascade, sourceName, url?, summary?, publishedAt?, linkStatus `@map("link_status")`, position Int, traceId, createdAt；`@@index([hotEventId])` `@@map("published_hot_event_evidence")`）。在 `HotEvent` 加只读反向导航 `explanationVersions ExplanationVersion[]`、`publishedExplanation PublishedHotEventExplanation?`、`publishedEvidence PublishedHotEventEvidence[]`（元数据，不改 event-assembly 写归属，沿用 schema 既有 AD-2/AD-6 注释惯例）
- `packages/core/prisma/migrations/<ts>_explanation_and_detail_read_models/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name explanation_and_detail_read_models` 生成（3 张新表；hot_events 反向关系无需列，仅 Prisma 导航）
- `packages/core/src/modules/explanation/explain-service.ts` -- NEW：`generateExplanation({prisma, traceId, hotEventId})`（查 HotEvent include evidence.evidenceRecord.source；确定性派生三分区→**append** `ExplanationVersion`，source="template"，每次调用追加一行、永不 update/delete 旧行——AD-5；无证据则不生成、返回 null、不写空版本）；`getLatestExplanation({prisma, traceId, hotEventId})`（createdAt desc 首条，无则 null）。纯逻辑、无 BullMQ/无外部 SDK
- `packages/core/src/modules/explanation/types.ts` -- NEW：`GenerateExplanationOptions`、`ExplanationPartitions`({summary,whyItMatters,uncertainties})、`ExplanationSource` union（"template"）、`ExplanationVersionRecord`
- `packages/core/src/modules/explanation/index.ts` -- NEW：桶导出
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：`refreshPublishedReadModel` 在 `action==="publish"` 分支追加——读最新 `ExplanationVersion`（有则 upsert `published_hot_event_explanations`，无则 deleteMany 该 hotEventId 的 explanation 行）、重写证据（deleteMany `published_hot_event_evidence` where hotEventId → 按 publishedAt ASC 遍历 hot_event_evidence→evidence_records→evidence_sources insert，linkStatus 由 url 推导，position 递增）；`action==="takedown"` 分支追加 deleteMany explanation + evidence。新增 `getPublishedHotEventDetail({prisma, traceId, hotEventId})`：无 published_hot_events 行→返回 null；否则 findMany published_evidence orderBy position + 读 explanation 行，组装 `{hotEventId,title,evidenceCount,latestEvidenceAt,publishedAt,explanation:Partitions|null,evidence:EvidenceRow[]}`
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：加 `GetPublishedHotEventDetailOptions`、`PublishedHotEventDetail`（含 `explanation: ExplanationPartitions & {source,generatedAt} | null`、`evidence: PublishedEvidenceRow[]`）、`PublishedEvidenceRow`({sourceName,url,summary,publishedAt,linkStatus,position})、`EvidenceLinkStatus` union（"available"|"unavailable"）
- `packages/core/src/index.ts` -- MODIFY：桶追加 `generateExplanation`、`getLatestExplanation`、`getPublishedHotEventDetail` + 相关类型导出
- `apps/worker/src/queues/explain-queue.ts` -- NEW：镜像 `event-cluster-queue.ts`——`EXPLAIN_QUEUE_NAME="explain"`/`EXPLAIN_JOB_NAME="explain"`、`getExplainQueue()` lazy Queue、`enqueueExplain(traceId)`（removeOnComplete 100/removeOnFail 500）、`registerExplainWorker()`（Worker 内 `dynamic import("@aguhot/core")` 调 `generateExplanation`，遍历无 ExplanationVersion 的候选 hotEvent）
- `apps/worker/src/index.ts` -- MODIFY：`requireEnv("DATABASE_URL")`+`REDIS_URL`；注册 `registerExplainWorker()`；shutdown 关闭三 worker；启动 log 改为 source-ingest + event-cluster + explain
- `apps/worker/src/verify-explain.ts` -- NEW：镜像 `verify-cluster.ts`/`verify-publish.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetPrisma）；seed source+records→clusterEvents→`generateExplanation`→断言 `ExplanationVersion` append 一行、三分区非空、确定性（同输入二次生成等值）、无证据时不生成；打印 PASS。无需 Redis（直调 core）
- `apps/worker/src/verify-publish.ts` -- MODIFY：在既有 approve 流程前先 `generateExplanation`；approve 后断言 `getPublishedHotEventDetail` 返回该行（title/evidenceCount/latestEvidenceAt + explanation 三分区 + evidence 行数=成员数 + linkStatus 推导正确）；takedown 后断言 detail 返回 null 且三 published 表皆无该 hotEventId 行
- `apps/worker/package.json` -- MODIFY：加 `verify:explain`（`tsx src/verify-explain.ts`）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- NEW：`export const dynamic="force-dynamic"`；`Page({params}:{params:Promise<{hotEventId:string}>})`；`getPrisma()`+`getPublishedHotEventDetail({prisma,traceId:newTraceId(),hotEventId})`；null→`notFound()`；渲染：回首页 `<Link href="/">`、`<h1 font-display>` 标题、三分区 `<section>`（发生了什么=标题+来源数+时间事实；为什么重要/当前仍不确定=解释正文 or 降级文案，挂 `<AiLabel/>`）、证据时间线 `<ol>`（每行 `<li border-l-2 border-brand>`：来源名、时间 `font-mono`、摘要、"原文链接 ↗"/"无原始链接"徽标）。真实 token，无投资建议措辞
- `apps/web/app/(public)/_components/event-card.tsx` -- MODIFY：`EventCardProps` 加 `hotEventId: string`；将 `<li>` 内容包进 `<Link href={`/events/${hotEventId}`}>`（整卡可点，落地 1.7 defer）；保留既有 token/排序理由 chip；删去"not a link"注释
- `apps/web/app/(public)/page.tsx` -- MODIFY（最小）：`<EventCard>` 调用处传 `hotEventId={e.hotEventId}`（`listPublishedHotEvents` 已返回 hotEventId）
- `apps/web/e2e/seed-detail.ts` -- NEW：镜像 `seed-feed.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→清 9 表 FK 序：published_evidence/published_explanation/published_hot_events/publication_decisions/review_decisions/explanation_versions/hot_event_evidence/hot_events/evidence_records/evidence_sources→建 source+N records→clusterEvents→`generateExplanation`(对将发布者)→`decideReview({outcome:"approve"})` 产 1 已发布（返回 hotEventId+title+expectedEvidenceCount）→留 1 未发布候选→resetPrisma）；自包含、不触碰 seed-console/seed-feed
- `apps/web/e2e/detail.spec.ts` -- NEW（describe 标题含 `@detail`）：前置 `tsx e2e/seed-detail.ts`；断言 `GET /events/{publishedId}` 200 无 `/login` 重定向（AD-8）、三分区标题可见（发生了什么/为什么重要/当前仍不确定，AC1）、证据行可见且含来源名/时间/原文链接或无原始链接徽标（AC2）、解释区可见 `<AiLabel>`（AC3）；`GET /events/{unpublishedId}` 404（未发布不泄漏）；`GET /` 卡片为指向 `/events/{id}` 的链接（整卡进详情）
- `apps/web/package.json` -- MODIFY：加 `e2e:detail`（`tsx e2e/seed-detail.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @detail`）与 `seed:detail`；**改 `e2e` 的 `--grep-invert` 为 `"@console|@feed|@detail"`**；`e2e:console`/`e2e:feed` 不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-8 defer（真实 LLM provider+LLMAdapter port 抽取、链接存活探测/归档、cluster→explain 自动编排/cron、运营解释修订/版本差异/重发布 UI 归 1.9、返回原语境归 2.5、`pnpm e2e` 现 home/navigation/design+detail 均 request 期依赖 DATABASE_URL 的演化、确定性 template 解释的语义上限）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_explanation_and_detail_read_models` -- 加 3 模型（ExplanationVersion 追加式 + 2 published 读模型）+ HotEvent 反向导航 + 迁移 -- AD-5 解释版本化 + AD-3 公开详情/证据读模型落表
- `packages/core/src/modules/explanation/{explain-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- 确定性 `generateExplanation`/`getLatestExplanation`（从真实证据派生三分区，source="template"）+ 类型 + 桶导出 -- 解释生成核心逻辑（AD-4 job 调此、verify/seed 直调此）
- `apps/worker/src/queues/explain-queue.ts` + `src/index.ts` + `verify-explain.ts` + `package.json:verify:explain` -- explain BullMQ 队列/worker（镜像 event-cluster）+ 注册 + 关闭 + 确定性自检脚本 -- AD-4 字面（解释生成经 BullMQ job，off web path）
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts}` + `src/index.ts` 桶 -- refresh 扩展（publish 投影 explanation+evidence、takedown 三表同删）+ `getPublishedHotEventDetail` 纯读 + 类型/桶 -- AD-3 公开详情读模型唯一拥有者投影 + 首个详情公开消费者
- `apps/worker/src/verify-publish.ts` -- generateExplanation→approve→断言 detail 投影（三分区+证据行+linkStatus）→takedown→断言 detail null 及三表清 -- 锁详情读契约（surface = 查询返回 + 三表）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- force-dynamic + getPrisma + getPublishedHotEventDetail + notFound + 三分区视觉分区 + AiLabel + 证据时间线 + 降级态 -- AC1/AC2/AC3/AD-8 详情主面
- `apps/web/app/(public)/_components/event-card.tsx` + `(public)/page.tsx` -- 卡片加 hotEventId + `<Link>` 整卡进详情、page 传 hotEventId -- 落地 1.7 defer 的整卡进详情
- `apps/web/e2e/{seed-detail.ts,detail.spec.ts}` + `package.json:e2e:detail/seed:detail` + `e2e` grep-invert 加 @detail -- 独立 seed（cluster→explain→approve 发布 1 + 留未发布）+ @detail e2e（三分区/证据/AI 标识/未发布 404/整卡链接/AD-8）-- AC1/AC2/AC3/AD-8 surface-anchored 验证；console/feed seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-8 defer 项（LLM/port/探测/cron/1.9 UI/2.5 返回/DB 依赖演化/template 语义上限）-- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 1-8 迁移已应用，When 经 `clusterEvents`→`generateExplanation`→`decideReview(approve)` 发布一候选后访问 `/events/{id}`，Then 详情首屏呈现"发生了什么""为什么重要""当前仍不确定什么"三个视觉分区（AC1），And 解释正文统一挂 AI 标识（AC3，与运营台同组件），And 证据时间线按时序每条呈现来源名/时间/摘要/原文链接（AC2），And url 缺失证据行渲染"无原始链接"徽标且行不消失，And `getPublishedHotEventDetail` 仅 `SELECT published_*` 三表（不触及 evidence_records/hot_event_evidence/explanation_versions）。
- Given 某 id 未发布（读模型无 summary 行），When 匿名访问 `/events/{id}`，Then `notFound()`（404）且候选/驳回/下线标题不泄漏，And 返回链可回 `/`（AD-8 匿名可达无登录墙）。
- Given 已发布但 explain 未跑（无 ExplanationVersion→无 explanation 投影），When 访问 `/events/{id}`，Then 三分区结构仍在、"为什么重要/当前仍不确定"显诚实降级文案（不伪造解释正文）、"发生了什么"仍显标题/来源数/时间（NFR 不假数据）。
- Given `ExplanationVersion` 已有 ≥1 行，When 再次 `generateExplanation` 同 hotEvent，Then append 新行（旧行不 update/delete，AD-5），And 公开投影取 `createdAt` desc 首条。
- Given 详情路由 force-dynamic 且 import `@aguhot/core`，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功（DB 读路由不在 build 求值），And `pnpm -r typecheck` / `pnpm -r lint` 通过，And `pnpm --filter worker verify:explain` 打印 PASS（追加式/确定性/无证据不生成），And `pnpm --filter worker verify:publish` 打印 PASS（含 detail 投影 + takedown 清三表新断言）。
- When 执行 `pnpm --filter web e2e:detail`（seed + `@detail`），Then `/events/{publishedId}` 200 且三分区/证据/AI 标识可见、`/events/{unpublishedId}` 404、`/` 卡片为 `/events/{id}` 链接；And `pnpm --filter web e2e`（home/navigation/design）全绿（现 request 期需 DATABASE_URL，属 1-7→1-8 有意演化）；And `pnpm --filter web e2e:console`/`e2e:feed` 不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (medium 1, low 5)
- defer: 7: (low 7)
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` explain worker 没有 `publicationStatus` 过滤（处理 candidate/published/rejected/taken_down 全部），导致已发布事件 worker 生成解释后投影不刷新（公开详情页停在降级态）+ 对 rejected/taken_down 浪费生成——`apps/worker/src/queues/explain-queue.ts` 收窄为 `publicationStatus: "candidate"`（对齐 spec「候选 hotEvent」），消除 stale-projection 与浪费。
  - `[low]` `[patch]` `ExplanationVersion` 取「latest」用 `orderBy: createdAt desc` 无 tiebreaker，同毫秒追加非确定——`explain-service.ts` `getLatestExplanation` 与 `publish-service.ts` `projectExplanation` 均加 `id: "desc"` 次级排序（UUIDv7 单调），now 确定性。
  - `[low]` `[patch]` 证据时间线投影对相同 `publishedAt` 无 tiebreaker，重投影可换序——`projectEvidenceTimeline` sort 增加 evidence record id 作次级键（null-null 与等时两种 tie 均确定化）。
  - `[low]` `[patch]` `@detail` AC3 断言用 `getByText("AI")` 子串匹配，遇含「AI」的解释文案会假阳性——`detail.spec.ts` 改为定位 AiLabel chip 的 `.bg-accent-warm` 类，精确断言。
  - `[low]` `[patch]` append-only→latest-投影契约在投影边界无测试覆盖（`projectExplanation` 自有 `findFirst`，未被多版本断言）——`verify-publish.ts` 新增「二次 generateExplanation + refresh 后投影的 generatedAt = gen2.createdAt」断言，锁 latest 投影契约（41/41 通过）。

## Design Notes

**为何解释生成在 1.8 落地、且 V1 用确定性派生而非真实 LLM：** 项目自有绑定计划把解释生成显式指派给 1.8（schema `HotEvent` 注释"real title/explanation generation is the separate explain job (1.8)"、deferred-work 1.7 条目"解释/摘要归 1.8 explain job → ExplanationVersion"）。故 1.8 必须建 `ExplanationVersion`（AD-5 追加式）+ explain job（AD-4 BullMQ）。但真实 LLM provider（API key/SDK/网络/prompt 工程）是独立大块且 V1 未决（架构把"具体云/数据源采购"列为 defer）——`ponytail:` 不为一尚不存在的 external 预接 provider。V1 `generateExplanation` 是**确定性、从真实证据派生**的三分区（标题+最新摘要→发生了什么；来源数/覆盖跨度→为什么重要的客观陈述；数据缺口→不确定），**绝不编造**未由证据支撑的事实/市场含义/个股判断（NFR 不假数据 + 不投资建议）。它经 BullMQ job（AD-4 字面）、追加式版本（AD-5）、可被 verify/seed 直调（同 clusterEvents 惯例）。真实 LLM + `LLMAdapter` port 抽取记 defer——port 待真实 external LLM 引入时按 AD「外部适配器端口」落 worker 层（当前唯一实现是确定性派生、无第三方 SDK，预建 port 属「单一实现接口」反模式）。

**为何确定性 template 解释仍挂统一 AI 标识（AC3）且不 dishonest：** epic「uniform AI label」的意图是让**系统派生/合成**内容（非一手来源直引）可被读者识别、校准信任——而非仅指标注"大模型产出"。template 是系统从证据合成（非来源直引），属 AC3「derived content」范畴，挂统一 `<AiLabel/>` 是保守诚实选择（告知读者"此分区为系统合成、请对照下方来源核验"）。provenance 细粒度（template/ai/human）落 `ExplanationVersion.source` 供运营审计（AD-5「哪一版来自 AI/人工」），公开面只见统一标识（epic「uniform, identical on public and operator」）。真实 LLM 落地时 source 翻 "ai"、公开标识不变。这非 intent gap（epic「uniform label for derived content」可辩护读法唯一覆盖此情形）。

**为何不预建 `LLMAdapter` port、不接真实 LLM：** `ponytail:` 不为不存在的 external 造 port（梯级 1：YAGNI）。确定性派生无第三方 SDK，port 抽取待真实 LLM（有 SDK/网络/重算）引入时再做——彼时 AD-4「外部调用走异步 job」与 AD「外部适配器端口在 worker 层」才被真正触发。当前 `generateExplanation` 在 core（纯逻辑、无 SDK）、worker 的 explain job 调它（AD-4 job 载体）、verify/seed 直调它（同 verify:cluster 直调 clusterEvents，无 Redis）。这与既有 `SourceAdapter`/`RssAdapter` 的务实形态一致（deferred-work 已记 AD-7「具体适配器+SDK 可下沉 worker」为更纯读法，未决）。

**为何新增 2 个 published 读模型而非扩列 `published_hot_events`：** `published_hot_events` 是 1-6/1-7 的**摘要**读模型（feed 消费，select 仅摘要字段）。把解释正文（长文本）+证据行（1:N）塞进去会污染 feed 查询语义且 1:N 无法平铺。AD-3 允许多个 `published_*` 读模型——`published_hot_event_explanations`（1:1，三分区+provenance）+ `published_hot_event_evidence`（1:N，带 link_status/position）职责清晰，`getPublishedHotEventDetail` 一次组装三表。takedown 三表同删保持"行存在=已发布"契约。

**为何 link_status 由 url 缺失推导、不做 HTTP 探测：** AC2 核心不变量是"链接失效时行保留+明确标注，不静默消失"。最小诚实实现：url 存在→available（渲染原文链接），url 缺失→unavailable（渲染"无原始链接"徽标，**行不丢**）。主动 HTTP 存活探测→archive 快照是独立 concern（需异步 job + 归档存储 + 重试），记 defer。`ponytail:` 不在无探测 writer 时给 `evidence_records` 加 dead-link 列（无 owner 写即死列）；link_status 仅存于 published 投影（publish-orchestrator 拥有），由 url 推导。

**为何 explain job 镜像 event-cluster 而非自动 chain：** 沿用 1-5「两 job 独立、幂等、chaining/cron 未落地」（deferred-work 已记）。explain 同 cluster：BullMQ 队列/worker 为 prod 运行时载体（AD-4），verify/seed 直调 core 逻辑（无 Redis），自动 cluster→explain 编排/cron 记 defer。worker 处理"无 ExplanationVersion 的候选 hotEvent"，幂等（已有最新版本可跳过或 append）。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name explanation_and_detail_read_models` -- expected: 迁移应用、3 新表生成（随后 `pnpm --filter core db:generate` 或 typecheck 内置的 `prisma generate` 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 explanation 模块 + publish-orchestrator 扩展 + web 详情页消费）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:explain` -- expected: 集成脚本打印 PASS（generateExplanation 追加式/确定性/无证据不生成）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` -- expected: 打印 PASS（含 approve 后 detail 投影三分区+证据、takedown 后 detail null + 三表清的新断言）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（详情页 force-dynamic 不在 build 求值；其它公共页静态）
- `pnpm --filter web e2e:detail` -- expected: seed 后 `@detail` 通过（`/events/{publishedId}` 200 + 三分区/证据/AI 标识可见 + `/events/{unpublishedId}` 404 + `/` 卡片为详情链接）
- `pnpm --filter web e2e` -- expected: home/navigation/design 全绿（request 期需 DATABASE_URL，1-7→1-8 有意演化）
- `pnpm --filter web e2e:console`/`e2e:feed` -- expected: 不回归（console/feed seed/spec 零改动）

**Manual checks (if no CLI):**
- 已发布事件 `/events/{id}` 三分区视觉分区、解释挂 AI 标识、证据按时序每条来源名/时间/摘要/原文链接（url 缺失显"无原始链接"行不消失）；未发布 id 404 不泄漏；解释缺失显降级文案不伪造；feed 卡可点进详情；详情匿名可达无登录墙；无投资建议措辞。

## Auto Run Result

Status: done
Final revision: `6dbbb3f`（承载完整改动的提交；后续 bookkeeping amend 为 `6d078be`，仅追加本节 + final_revision 字段——git 自引用所致，二者差一次 amend）
Follow-up review recommended: false

### Summary
Story 1.8 落地公开热点详情面：新增 `explanation` 核心模块（确定性 `generateExplanation`，经 `explain` BullMQ job，AD-4/AD-5）+ 3 个 Prisma 模型（`ExplanationVersion` 追加式 + 2 个 `published_*` 详情读模型）；`publish-orchestrator` 在 publish 时投影解释+证据、takedown 时三表同删，新增 `getPublishedHotEventDetail` 纯读查询（AD-3）；公开路由 `(public)/events/[hotEventId]` 渲染三分区 + 证据时间线 + 统一 AI 标识 + 诚实降级态 + 未发布 404；落地 1.7 defer 的整卡进详情。typecheck/lint/build/verify/e2e 全绿。

### Files changed (22)
- schema + migration（3 新模型 + HotEvent 反向导航）
- `packages/core/src/modules/explanation/`（explain-service/types/index）+ `publish-orchestrator/{publish-service,types,index}.ts` + `src/index.ts` 桶
- `apps/worker/src/queues/explain-queue.ts` + `index.ts` + `verify-explain.ts`（NEW）+ `verify-publish.ts`（扩展）+ `package.json`
- `apps/web/app/(public)/events/[hotEventId]/page.tsx`（NEW）+ `_components/event-card.tsx` + `page.tsx` + `e2e/{seed-detail,detail.spec}.ts`（NEW）+ `package.json`
- `_bmad-output/implementation-artifacts/{spec-1-8-*.md, deferred-work.md}`

### Review findings（4 层并行评审）
- **Patches applied: 6**（1 medium——explain worker 收窄为 `candidate` 过滤，消除已发布事件 stale 投影 + 对 rejected/taken_down 浪费；5 low——createdAt+id 排序 tiebreaker ×2、证据时间线 tiebreaker、AiLabel e2e 断言收紧为 `.bg-accent-warm`、新增多版本 latest-投影契约断言）。
- **Deferred: 7**（AC3 运营台行为级一致性→1.9；AiLabel source="human" 门控→1.9；`UNIQUE(position)`+write-isolation 断言→defense-in-depth；静态 `<title>`；派生不截断；evidenceRecord null 守卫）。已写入 deferred-work.md。
- **Rejected: 9**（summary 分区为合法 ExplanationVersion 字段、有契约化未来消费者——非 dead weight；url-absence-vs-liveness 与 template-as-AI 已在 spec 显式 defer/辩护；whitespace-url 已被投影 trim 覆盖；refresh 并发/seed 脆弱性/批处理/evidence-title 省略/断言冗余——非缺陷）。

### Verification
- `pnpm -r typecheck` / `pnpm -r lint`：5 包全绿。
- `pnpm --filter core db:migrate`：迁移应用（3 新表）。
- `pnpm --filter worker verify:explain`：14/14。`verify:publish`：41/41（含新增 AD-5 latest-投影断言）。
- `pnpm --filter web build`（无 `DATABASE_URL`）：成功；`/` + `/events/[hotEventId]` ƒ Dynamic，`/daily` `/topics` `/favorites` `/design` ○ Static（build 不变量成立）。
- `pnpm --filter web e2e:detail`：7/7（含降级态 + 收紧的 AiLabel 断言）。`e2e` / `e2e:console` / `e2e:feed`：无回归。

### Residual risks
- V1 解释为确定性 template（诚实下限，不造假；真实 LLM defer）。
- link_status 仅由 url 缺失推导（无存活探测；defer）。
- explain worker 为未测运行时（镜像 event-cluster；无 cron/chaining；defer）。
- 公开 e2e 需 request 期 `DATABASE_URL`（1.7→1.8 演化；dev/CI 跑 PG）。
- AC3「公开页与后台复核页一致」目前组件级满足（共享 `<AiLabel>`），行为级待 1.9 运营解释展示。

