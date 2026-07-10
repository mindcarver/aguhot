---
title: '已发布热点的文案与标签修正 (1.9)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '87cddf0c5e5becb566dd2006c032f671419bf9aa'
final_revision: 'e130483c00e48f821cfe0adc56348a6b0793d096'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-8-hot-event-detail-and-evidence-timeline.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-review-queue-and-publication-gate.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-public-hot-event-feed.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.6 落地了发布闸门（`candidate+approve→published`，`published+takedown→taken_down`），1.8 落地了公开详情与追加式 `ExplanationVersion`。但已发布热点一旦需要修正公开文案（标题 / 标签 / 解释），当前无任何路径：`HotEvent.title` 由 event-assembly 单向派生、无修订写入点；`标签(tags)` 字段在整个 schema 中不存在（FR14「运营可修正归组/标题/标签」、本 story AC「修改标题、标签或解释」均要求它）；`ExplanationVersion.source` union 预留了 `"human"` 但无运营写入路径（1.8 显式 defer 给 1.9）；转换图无 `published→published` 重发布路径（`rejected`/`taken_down` 终态、`transitions.ts` 注释把 re-publish 标记为 1.9/1.10 defer）；运营复核台不渲染解释 / `<AiLabel>`（AC3「公开页与后台复核页一致」1.8 仅组件级满足、行为级 defer 到 1.9）；详情页 `<AiLabel>` 对 `source` 盲目（1.9 引入 `human` 后会错标，1.8 前瞻 defer）。

**Approach:** 引入运营修订闭环，**复用而非重建**发布闸门（epic cross-story 依赖明示 1.9 reuse the publish gate）：
- **标签**：新增运营可编辑的自由文本标签（`HotEventRevision` 承载 `title` + `tags` 快照，`published_hot_events` 加 `tags` 列投影）。不引入分类法（taxonomy 未定义），不做按标签筛选（分类筛选维度归 Epic 2.2）。
- **追加式版本记录（AD-5）**：标题/标签修订 → event-assembly append `HotEventRevision`（永不 update/delete）；解释修订 → explanation 模块新增 `saveExplanation` append `ExplanationVersion(source="human")`。两者各做变更检测，仅在确实变化时 append（避免空版本与无谓 source 翻转）。
- **待发布(pending)语义（AC2）**：不新增 `publication_status` 值（仍 candidate/published/rejected/taken_down）。effective（最新 revision ?? 标题基线 + `[]` 标签；最新 ExplanationVersion）vs published（`published_*` 读模型）的**内容差**即 pending；修订不触读模型 → 公开仍显旧版；运营台显待发布修改与差异。
- **重发布**：review-workflow 加 `ReviewOutcome.Republish` + 转换 `published+republish→published/publish`，复用 `decideReview`（同一事务 append `ReviewDecision`+`PublicationDecision(published→published)`+`refreshPublishedReadModel`）；`refreshPublishedReadModel(action="publish")` 改读 effective 标题/标签并投影（解释/证据投影沿用 1.8）。
- **AC3 + AiLabel 门控**：运营复核台渲染解释 + `<AiLabel>`（与公开同组件、同 source 门控）；公开/运营 `<AiLabel>` 均改为 `source !== "human"`（1.8 defer 落地）。
- 落地运营修订 UI（`/console/[eventId]` 对 published 分支：当前发布版 + 待发布差异 + 标题/标签/解释修订表单 + 重新发布），`/console` 增「已发布热点」入口。新增 `@revision` e2e 与 `verify:revision`，扩 `verify:publish`。本 story 不做合并/拆分/从下线重发布（1.10）、不做按标签筛选（Epic 2.2）、不做真实 LLM、不做运营台鉴权（沿用 1.6 占位）——均记 defer。

## Boundaries & Constraints

**Always:**
- 复用发布闸门，版本记录追加式（AD-5）：标题/标签修订 = event-assembly append `HotEventRevision`（永不 update/delete 旧行；FK onDelete 沿用 ReviewDecision 审计保留语义，不 Cascade）；解释修订 = explanation append `ExplanationVersion(source="human")`。重发布 = `decideReview({outcome:"republish"})` 在单事务内 append `ReviewDecision`+`PublicationDecision(from=published,to=published)`+`refreshPublishedReadModel(action:"publish")`。绝不 in-place 覆盖历史；历史版本链完整可审计。
- 写归属（AD-2/AD-6 字段级）严格不变：event-assembly 写 `hot_event_revisions`（**仅**此表；**不**写 `hot_events.title`——基线标题仍是聚类派生，修订是 overlay）；explanation 写 `explanation_versions`；review-workflow 写 `review_decisions`/`publication_decisions` + 驱动 refresh；publish-orchestrator 写 `published_hot_events`（投影 effective 标题+标签）/`published_hot_event_explanations`/`published_hot_event_evidence`。模块间不跨边界写。
- 公开只读发布态读模型（AD-3）：公开详情只经 `getPublishedHotEventDetail` 读 `published_hot_events`(+新 `tags` 列)+`published_hot_event_explanations`+`published_hot_event_evidence`，绝不读 `hot_events`/`hot_event_revisions`/`explanation_versions`/`review_decisions`/`publication_decisions`。运营复核台可读工作表（`hot_event_revisions`/`explanation_versions`）——运营侧非公开读，与 1.6 `getCandidateDetail` 跨聚合读同型。
- effective 解析（单一来源）：effective 标题 = 最新 `HotEventRevision.title`（createdAt desc、id desc 首条）?? `HotEvent.title`（聚类基线）；effective 标签 = 最新 revision 的 `tags` ?? `[]`（聚类不派生标签，故基线为空）；effective 解释 = 最新 `ExplanationVersion`（任意 source）。pending = effective 与 published（`published_*`）的**内容差**（标题串、标签数组、解释三分区串分别比对），无新增 status 值、无 timestamp 比对。
- 变更检测防脏版本：`reviseHotEvent` 仅当标题或（规范化后的）标签相对 effective 变化时 append；`saveExplanation` 仅当三分区相对最新版本变化时 append。无变化 → 不 append、不翻转 source、不产生 pending。
- 标签语义（V1 最小可辩护读法）：自由文本运营标签，`String[]`（PostgreSQL text[]）；规范化 = trim、去空、按分隔符（英文/中文逗号、换行）拆分、去重（保序、大小写敏感）。**无**分类法、**无**标签级元数据、**无**按标签的 feed 筛选（AC 不要求；筛选维度归 Epic 2.2）。公开仅在详情页渲染非空标签 chip。
- `<AiLabel>` source 门控（AC3 + 1.8 defer 落地）：解释分区挂 `<AiLabel/>` 当且仅当 `source !== "human"`（正向：`template`|`ai` 挂；`human` 不挂）。公开详情页与运营复核台**同组件、同门控**（复用 `components/chips.tsx` 的 `<AiLabel>`，epic「uniform, identical on public and operator」）。
- `next build` 保持无 `DATABASE_URL`（1-6/1-7/1-8 build 不变量延续）：新增/改动路由仍 `export const dynamic = "force-dynamic"`，`getPrisma()` 仅请求期求值；`(public)/layout.tsx`、`/daily`、`/topics`、`/favorites`、`/design` 保持静态、不 import `@aguhot/core`（动态公开路由仍仅 `/` 与 `/events/[hotEventId]`）。
- token 安全（沿用 1-8 警告）：新增运营台 UI 用**真实解析** token（`bg-surface-raised`/`bg-surface-base`/`bg-surface-muted`/`border-border-hairline`/`rounded-lg`/`ink-*`/`bg-brand`/`bg-accent-warm`）；**不得**复制 1-6 运营台漂移的未定义 token（`bg-surface`/`border-line-subtle`/`bg-brand-strong`，Tailwind v4 下不解析）。数字/时间 `font-mono`，标题 `font-display`/`font-sans`。
- 不变性约定（沿用 1-4…1-8）：状态/种类/结果用 `const … as const` + union（禁 TS `enum`）；`import type` 用于类型；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`；每调带 `traceId`；时间 UTC、展示 ISO 8601 / 稳定格式；PK UUIDv7（`newTraceId()`）。
- 重发布不新增 BullMQ job：修订是运营触发（同步，同 `decideReview`），`refreshPublishedReadModel` 仍在 `decideReview` 事务内同步执行（与 1.6/1.8 一致）。

**Block If:**
- 本地 PG `aguhot_dev` 不可达（迁移应用、`verify:revision`/`verify:publish` 扩展断言或 `e2e:revision` seed 连接失败）→ HALT，不得跳过集成/e2e 验证。
- 引入新路由/新 import 导致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT。
- `pnpm -r typecheck`/`lint` 因新模型/新模块/新转换回归 → HALT。
- `pnpm --filter core verify:review-logic`（`transitions.selfcheck` 含新 republish 用例）失败 → HALT。

**Never:**
- 不做合并/拆分/从 `taken_down` 或 `rejected` 重发布（归 1.10）；本 story 仅加 `published→published` 重发布（修订后刷新）。
- 不做按标签的 feed 筛选 / 分类维度（归 Epic 2.2）；标签在 1.9 是展示属性，非筛选维度。不向 `listPublishedHotEvents`/`PublishedHotEventSummary` 加 `tags`（不改 1.7 feed 契约；标签仅详情面）。
- 不引入标签分类法 / 预定义标签集 / 标签级元数据表（YAGNI；自由文本足满足 AC）。不做多输入标签 UI（用单文本框分隔符输入）。
- 不接真实外部 LLM（`saveExplanation` 接收运营**手输**文本，非 LLM 生成）；不引入 openai/anthropic 等新依赖；`LLMAdapter` port 仍不预建（沿用 1.8 defer）。
- 不做运营台鉴权 / `(operator)` 路由组门（沿用 1.6 占位 `/console` 公开可达；鉴权 defer）。不引入新静态公开路由 import `@aguhot/core`。
- 不做「丢弃 pending 修订」功能（追加式不可删；运营可再修订回 published 值使差异归零，或保持 pending 不重发布——公开不受影响；discard defer）。
- 不在公开详情读 `hot_event_revisions`/`explanation_versions`/`hot_events` 绕过读模型（AD-3）；不让 `(public)/layout.tsx` 或其它既有静态公共页 import `@aguhot/core`。
- 不改 1-6 候选复核流程（candidate→approve/reject、published→takedown 既有 ReviewForm/submitReview 行为零回归；published 分支**新增**修订 UI，不删既有 takedown 能力）。不改 1-4/1-5/1-7/1-8 既有 verify/seed/spec 断言（console/feed/detail seed/spec 零改动保持绿）。
- 不渲染投资建议措辞（无买卖/目标价/持仓，NFR）；不伪造标签/解释（NFR 空态不假数据：无标签不渲染标签区，解释缺失仍走 1.8 降级文案）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 修订标题（AC1/AC2） | 某 hotEvent 已 published；运营经 `/console/{id}` 提交新标题（标签/解释同当前 effective） | `reviseHotEvent` append 1 行 `HotEventRevision`(新标题+当前标签)；`saveExplanation` 检测无变化不 append；读模型不动；公开 `/events/{id}` 仍显旧标题；运营台 pending.title=true 显差异 | 无错误预期 |
| 修订标签 | 已 published；运营提交新标签集（标题/解释不变） | append `HotEventRevision`(当前标题+新标签)；公开标签不变；pending.tags=true | 无错误预期 |
| 修订解释为人工（AC1 + 1.8 defer） | 已 published；运营提交新三分区 | `saveExplanation` append `ExplanationVersion(source="human")`；`reviseHotEvent` 检测标题/标签无变化不 append；公开解释不变；pending.explanation=true | 无错误预期 |
| 重新发布（AC1） | 已 published 且有 pending；运营点「重新发布」 | `decideReview({outcome:"republish"})` 单事务 append `ReviewDecision`+`PublicationDecision(published→published)`+`refreshPublishedReadModel(publish)` 投影 effective 标题/标签/最新解释；公开 `/events/{id}` 显新版；pending 归零 | 无错误预期 |
| 空操作修订 | 已 published；运营提交与 effective 完全相同的值 | `reviseHotEvent`/`saveExplanation` 均不 append（变更检测）；无新版本、无 pending、读模型不动 | 无错误预期 |
| 重发布非法状态（AD 闸门） | 非 published（candidate/rejected/taken_down）的 hotEvent，`decideReview({outcome:"republish"})` | `resolveTransition` 抛 `IllegalTransitionError`（事务零写入）；server action revalidate+redirect 回详情 | IllegalTransitionError |
| 追加式不变量（AD-5） | 连续修订标题两次再重发布 | `hot_event_revisions` 有 ≥2 行（旧标题行不 update/delete）；effective=最新；审计链含两次修订 + 一次 republish 决策 | 无错误预期 |
| 公开标签展示 | 已 published 且 effective 标签非空，已重发布 | `/events/{id}` 渲染标签 chips（`published_hot_events.tags`）；标签为空不渲染标签区（NFR） | 无错误预期 |
| AiLabel source 门控（AC3 + 1.8 defer） | published 且解释 source="human"（运营修订后重发布） | 公开详情与运营复核台解释分区**均不**挂 `<AiLabel>`；source="template" 则**均**挂（同组件同门控） | 无错误预期 |
| 标签规范化 | 运营输入 `"A股, a股，政策 新闻"` | 拆分（`,`/`，`/换行）→ trim → 去空 → 去重保序 → `["A股","a股","政策","新闻"]`（大小写敏感） | 无错误预期 |
| pending 解释内容差 | 已 published（投影了 template 解释 v1）；运营保存 human 解释 v2 但未重发布 | effective 解释=v2、published 解释=v1 → pending.explanation=true；公开仍显 v1 | 无错误预期 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 `HotEventRevision`（id UUIDv7 PK, hotEventId FK→hot_events【onDelete 沿用 ReviewDecision 审计保留，不 Cascade】, title String, tags String[] @default([]), reviewer String, note String?, traceId, createdAt；`@@index([hotEventId])` `@@index([createdAt])` `@@map("hot_event_revisions")`）。`PublishedHotEvent` 加 `tags String[] @default([]) @map("tags")`（投影列，default `[]` 对既有行安全）。`HotEvent` 加只读反向导航 `revisions HotEventRevision[]`（元数据，不改 event-assembly 写归属，沿用 explanationVersions 反向导航注释惯例）
- `packages/core/prisma/migrations/<ts>_revision_and_published_tags/migration.sql` -- NEW：`pnpm --filter core db:migrate -- --name revision_and_published_tags` 生成（建 `hot_event_revisions` 表；`ALTER published_hot_events ADD tags text[] NOT NULL DEFAULT '{}'`）
- `packages/core/src/modules/event-assembly/revise-service.ts` -- NEW：`reviseHotEvent({prisma, traceId, hotEventId, title, tags, reviewer, note?})`——读最新 revision（无则基线=`hotEvent.title`+`[]`）；规范化 tags（trim/去空/去重保序）；标题或标签变化则 append `HotEventRevision`，否则 no-op；返回 `{appended:boolean, revisionId?:string}`。仅写 `hot_event_revisions`，**不**写 `hot_events`
- `packages/core/src/modules/event-assembly/types.ts` -- MODIFY：加 `ReviseHotEventOptions`、`ReviseHotEventResult`
- `packages/core/src/modules/event-assembly/index.ts` -- MODIFY：桶导出 `reviseHotEvent` + 类型
- `packages/core/src/modules/explanation/explain-service.ts` -- MODIFY：抽私有 `appendExplanationVersion(prisma, traceId, hotEventId, partitions, source)`（`generateExplanation` 复用之，source=template）；新增 `saveExplanation({prisma, traceId, hotEventId, summary, whyItMatters, uncertainties, source})`——读最新版本，三分区变化则 append（caller 传 `source="human"`），否则 no-op；返回 `{appended:boolean, explanationVersionId?:string}`
- `packages/core/src/modules/explanation/types.ts` -- MODIFY：加 `SaveExplanationOptions`（`source: ExplanationSource` 必填，V1 caller 传 `human`）
- `packages/core/src/modules/explanation/index.ts` -- MODIFY：桶导出 `saveExplanation` + 类型
- `packages/core/src/modules/review-workflow/types.ts` -- MODIFY：`ReviewOutcome` 加 `Republish:"republish"`；加 `GetPublishedEventForRevisionOptions`、`PublishedEventRevisionView`（含 `published:{title,tags,explanation:Partitions|null,publishedAt}|null`、`effective:{title,tags,explanation:Partitions|null}`、`pending:{title,tags,explanation}` 三 bool）
- `packages/core/src/modules/review-workflow/transitions.ts` -- MODIFY：`LEGAL_TRANSITIONS` 加 `{from:"published", outcome:"republish", to:"published", action:"publish"}`
- `packages/core/src/modules/review-workflow/transitions.selfcheck.ts` -- MODIFY：加 republish 合法用例 + candidate/taken_down+republish 非法用例（锁转换图）
- `packages/core/src/modules/review-workflow/review-service.ts` -- MODIFY：新增 `getPublishedEventForRevision({prisma, traceId, hotEventId})`——单 `findUnique` include `publishedReadModel`/`publishedExplanation`/`revisions`(orderBy createdAt desc,id desc)/`explanationVersions`(同序)；JS 取最新 revision/explanation 组装 published vs effective vs pending（**内容差**比对）；事件不存在抛 `CandidateNotFoundError`。`decideReview` 本身零改动（generic 已覆盖 republish）
- `packages/core/src/modules/review-workflow/index.ts` -- MODIFY：桶导出 `getPublishedEventForRevision` + `ReviewOutcome`（已导出，仅值集扩大）
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- MODIFY：`refreshPublishedReadModel(action="publish")`——标题源由 `hotEvent.title` 改为 effective（include `revisions` 取最新 ?? `hotEvent.title`）；`publishedHotEvent.upsert` 的 create/update `data` 加 `tags`=effective 标签（投影）。解释/证据投影沿用 1.8（`projectExplanation`/`projectEvidenceTimeline` 不动）。`getPublishedHotEventDetail` 返回加 `tags`（读 `published_hot_events.tags`）
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：`PublishedHotEventDetail` 加 `tags: string[]`
- `packages/core/src/index.ts` -- MODIFY：桶追加 `reviseHotEvent`、`saveExplanation`、`getPublishedEventForRevision` + 相关类型导出；`ReviewOutcome` 值集扩大自动随
- `apps/web/components/chips.tsx` -- MODIFY：新增 `TagChip({children})`（真实 token、`rounded-full`，复用于公开详情 + 运营台；最小展示组件）
- `apps/web/app/(public)/events/[hotEventId]/page.tsx` -- MODIFY：`<AiLabel>` 门控改 `hasExplanation && detail.explanation!.source !== "human"`（两处，1.8 defer 落地）；标题下加标签区（`detail.tags.length>0` 时渲染 `<TagChip>` 列表，空不渲染 NFR）
- `apps/web/app/(operator)/console/page.tsx` -- MODIFY（最小）：在既有 candidate 队列下加「已发布热点」section——调 `listPublishedHotEvents` 列已发布（复用公开读，运营侧读合法），每项 `<Link href={`/console/${e.hotEventId}`}>`
- `apps/web/app/(operator)/console/[eventId]/page.tsx` -- MODIFY：仍先 `getCandidateDetail`（status/evidence/decisions/title，零改动复用）；`publicationStatus==="published"` 时**增调** `getPublishedEventForRevision` 并渲染 published 分支（当前发布版 + pending 差异 + 标题/标签/解释修订表单 + 重新发布按钮 + 既有 takedown）；非 published 走既有 `ReviewForm`。新 UI 用真实 token（不复制 1-6 漂移 token）
- `apps/web/app/(operator)/console/[eventId]/actions.ts` -- MODIFY：`submitReview` outcome 白名单加 `"republish"`（published 分支的「重新发布」按钮 `<button name="outcome" value="republish">` 复用此 action → decideReview）；新增 `submitRevision(formData)`——解析 eventId/title/tags(分隔符拆 string[])/summary/whyItMatters/uncertainties，调 `reviseHotEvent`+`saveExplanation`，revalidate `/console/[eventId]`+`/events/{eventId}`，redirect 回详情
- `apps/worker/src/verify-revision.ts` -- NEW：镜像 `verify-publish.ts`（resetEnvCache→requireEnv DATABASE_URL→getPrisma→resetPrisma）；seed source+records→clusterEvents→`generateExplanation`→`decideReview(approve)` 产 1 published；断言：`reviseHotEvent` append + effective=最新、二次同值 no-op、`saveExplanation(human)` append、重发布前 `getPublishedHotEventDetail` 显旧标题/标签/template 解释、`decideReview(republish)` 后显新标题/标签/human 解释(source="human")、`hot_event_revisions`/`explanation_versions` 追加式旧行不删；打印 PASS。无需 Redis
- `apps/worker/src/verify-publish.ts` -- MODIFY：在既有流程加一条「revise + republish」——断言 `published_hot_events.tags` 投影=effective 标签、标题投影=effective 标题（含 revision overlay）、republish 后 `publishedAt` 不变（首次发布时间稳定，沿用 1.8 upsert 语义）
- `apps/worker/package.json` -- MODIFY：加 `verify:revision`（`tsx src/verify-revision.ts`）
- `apps/web/e2e/seed-revision.ts` -- NEW：镜像 `seed-detail.ts`；cluster→explain→approve 产 1 published（返回 hotEventId+initial title/tags(空)/explanation source=template）→不改 console/feed seed
- `apps/web/e2e/revision.spec.ts` -- NEW（describe 标题含 `@revision`）：前置 `tsx e2e/seed-revision.ts`；断言：`/console/{publishedId}` 渲染修订表单 + 当前发布版；填新标题/标签/解释并提交（`submitRevision`）；`/events/{publishedId}` **仍显旧**标题/标签/template 解释（pending 未重发布，AC2）；运营台显 pending 差异；提交「重新发布」(`outcome=republish`)；`/events/{publishedId}` 显新标题/新标签/human 解释且**无** `<AiLabel>`（AC3 + 1.8 defer）；`/console/{publishedId}` 审计链含 republish 决策
- `apps/web/package.json` -- MODIFY：加 `e2e:revision`（`tsx e2e/seed-revision.ts && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 playwright test --grep @revision`）与 `seed:revision`；**改 `e2e` 的 `--grep-invert` 为 `"@console|@feed|@detail|@revision"`**；`e2e:console`/`e2e:feed`/`e2e:detail` 不动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-9 defer（按标签筛选/分类维度归 Epic 2.2、标签分类法、丢弃 pending 修订、运营台鉴权、多输入标签 UI、从 taken_down/rejected 重发布归 1.10、真实 LLM 沿用 1.8 defer、revision 跨模块非原子——各模块 append 各自原子、整体非事务）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` + `migrations/<ts>_revision_and_published_tags` -- 加 `HotEventRevision` 模型 + `PublishedHotEvent.tags` + `HotEvent.revisions` 反向导航 + 迁移 -- AD-5 标题/标签版本化 + AD-3 公开标签投影落表
- `packages/core/src/modules/event-assembly/{revise-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- `reviseHotEvent`（变更检测 + append `HotEventRevision`，仅写 revisions 表）+ 类型 + 桶导出 -- 标题/标签修订写入点（event-assembly 写归属内）
- `packages/core/src/modules/explanation/{explain-service.ts,types.ts,index.ts}` + `src/index.ts` 桶 -- 抽 `appendExplanationVersion` + `saveExplanation`（变更检测 + append human 版本）+ 类型 + 桶导出 -- 解释人工修订写入点（1.8 reserved "human" 落地）
- `packages/core/src/modules/review-workflow/{types.ts,transitions.ts,transitions.selfcheck.ts,review-service.ts,index.ts}` + `src/index.ts` 桶 -- `ReviewOutcome.Republish` + 转换 `published+republish→published/publish` + selfcheck 用例 + `getPublishedEventForRevision` 运营读 + 桶导出 -- 重发布闸门复用 + 运营待发布差异读
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts}` + `src/index.ts` 桶 -- `refreshPublishedReadModel` 投影 effective 标题/标签 + `getPublishedHotEventDetail` 返 tags + 类型/桶 -- AD-3 公开读模型唯一拥有者投影 effective
- `apps/worker/src/{verify-revision.ts,verify-publish.ts}` + `package.json:verify:revision` -- `verify:revision` 集成自检（append/effective/重发布前后/source 门控）+ 扩 `verify:publish`（tags/effective 标题/publishedAt 稳定）-- 锁修订+重发布读契约（surface = 查询返回 + 读模型行）
- `apps/web/components/chips.tsx` + `app/(public)/events/[hotEventId]/page.tsx` -- `TagChip` + 详情页标签区 + `<AiLabel>` source 门控 -- AC3（source 门控）+ 公开标签展示（AC1 公开显当前发布版含标签）
- `apps/web/app/(operator)/console/page.tsx` + `console/[eventId]/{page.tsx,actions.ts}` -- `/console` 已发布入口 + published 分支修订 UI（当前版/差异/标题·标签·解释表单/重新发布）+ `submitRevision`/`submitReview(republish)` -- AC1/AC2 运营修订主面 + AC3 运营台解释/AiLabel
- `apps/web/e2e/{seed-revision.ts,revision.spec.ts}` + `package.json:e2e:revision/seed:revision` + `e2e` grep-invert 加 @revision -- 独立 seed（cluster→explain→approve 发布 1）+ @revision e2e（修订/pending 未重发布公开显旧/重发布后显新/AiLabel 门控/审计链）-- AC1/AC2/AC3 surface-anchored 验证；console/feed/detail seed/spec 零改动
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-9 defer 项（标签筛选/分类法/丢弃 pending/鉴权/多输入标签 UI/1.10 重发布/LLM/跨模块非原子）-- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG 可达且 1-9 迁移已应用，When 经 cluster→explain→`decideReview(approve)` 发布一候选后运营在 `/console/{id}` 修订标题/标签/解释并提交，Then `hot_event_revisions` append 标题/标签版本行、`explanation_versions` append `source="human"` 行（旧行不 update/delete，AD-5），And 公开 `/events/{id}` 仍显**上一个已发布版本**（标题/标签/解释均未变，AC2），And 运营台显待发布修改与版本差异（pending 三项）。
- Given 上述 pending 状态，When 运营点「重新发布」(`outcome=republish`)，Then `decideReview` 单事务 append `ReviewDecision`+`PublicationDecision(published→published)`+刷新读模型（投影 effective 标题/标签/最新解释），And 公开 `/events/{id}` 显**新**标题/标签/解释（AC1），And `publishedAt` 不变（首次发布时间稳定），And pending 归零。
- Given 已重发布且解释 source="human"，When 访问公开 `/events/{id}` 与运营 `/console/{id}`，Then 两处解释分区**均不**挂 `<AiLabel>`；And 当解释 source="template" 时两处**均**挂（同组件同门控，AC3 + 1.8 defer）。
- Given 某 id 非 published（candidate/rejected/taken_down），When `decideReview({outcome:"republish"})`，Then `IllegalTransitionError`（事务零写入）；And server action revalidate+redirect 回详情（不静默状态漂移）。
- Given 运营提交与 effective 完全相同的值，When `submitRevision`，Then `reviseHotEvent`/`saveExplanation` 均 no-op（不 append、不翻转 source、无 pending）。
- Given `published_hot_events.tags` 非空，When 访问 `/events/{id}`，Then 渲染标签 chips；And 标签为空不渲染标签区（NFR）。And `getPublishedHotEventDetail` 仅 `SELECT published_*` 三表（不触及 hot_events/hot_event_revisions/explanation_versions，AD-3）。
- Given 详情路由 force-dynamic 且 1-9 新增运营/公开改动，When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功（DB 读路由不在 build 求值，仅 `/` 与 `/events/[hotEventId]` 动态），And `pnpm -r typecheck` / `pnpm -r lint` 通过，And `pnpm --filter core verify:review-logic` 打印 PASS（含新 republish 转换用例），And `pnpm --filter core verify:cluster-logic` 不回归，And `pnpm --filter worker verify:revision` 打印 PASS（append/effective/重发布前后/source 门控/追加式），And `pnpm --filter worker verify:publish` 打印 PASS（含 tags/effective 标题/publishedAt 新断言）。
- When 执行 `pnpm --filter web e2e:revision`（seed + `@revision`），Then 修订后 `/events/{publishedId}` 显旧版、重发布后显新版且无 AiLabel、运营台显 pending 差异与 republish 审计；And `pnpm --filter web e2e`（home/navigation/design）/ `e2e:console` / `e2e:feed` / `e2e:detail` 全绿不回归。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

<!-- 空，直至首次评审。 -->

## Design Notes

**为何「标签」是新概念而非 Epic 2.2 的分类、且 V1 用自由文本：** FR14（Epic 1 功能需求）明示「运营可修正归组/标题/标签」、本 story AC1 明示「修改标题、标签或解释」——标签是 Epic 1 内运营可编辑的一等属性。deferred-work 1.7 条目「分类筛选维度归 Epic 2.2（概念/行业关联）」指的是 feed 的**分类筛选维度**（派生分类、筛选器），与本 story 的**运营标签属性**（人设、展示标签）是不同概念：前者是筛选维度（2.2），后者是事件属性（1.9）。二者可共存（标签投影到读模型、详情面展示；按标签筛选若需要是另一 concern，AC 不要求）。无分类法在任何 planning 文档定义，引入分类法需先定义标签集（超范围、未决），故 V1 取最小可辩护读法：自由文本运营标签（trim/去重/保序、大小写敏感），`String[]`。这非 intent gap（AC 显式列标签、唯一满足 AC 的读法是引入标签属性；自由文本 vs 分类法是 V1 设计选择，ponytail 取最小、不改变 AC 结果）。

**为何标题/标签用新 `HotEventRevision` 表、解释复用 `ExplanationVersion`：** 解释已有追加式版本模型（1.8 `ExplanationVersion`，含 template/ai/human provenance、投影到 `published_hot_event_explanations`），复用之 = 「reuse, not rebuild, the publish gate」（epic cross-story 依赖明示）。标题/标签无任何版本模型（`HotEvent.title` 是聚类单向派生、无修订写入点；标签字段不存在），故需追加式新表 `HotEventRevision`（承载标题+标签**快照**，每行=一次运营修订的完整 effective 快照，effective=最新行 ?? 基线）。两表职责分离：内容版本（`HotEventRevision` 标题/标签、`ExplanationVersion` 解释）vs 决策（`ReviewDecision`/`PublicationDecision` 状态流转）。不把标题/标签塞进 `ExplanationVersion`（污染解释语义、破坏 1.8 投影读 `explanation_versions` 的单一写归属）。

**为何 pending 用内容差而非新 status：** AC2 要求「修正尚未重新发布」状态可观测（公开显旧版、运营显差异）。最小实现：status 不扩（仍 candidate/published/rejected/taken_down，避免改读模型「行存在=已发布」契约），pending = effective（最新 revision ?? 基线标题/`[]` 标签 + 最新 ExplanationVersion）vs published（`published_*`）的**内容差**（标题串/标签数组/解释三分区分别比对）。修订 append 版本但不触读模型 → 公开自然显旧版；重发布 `refreshPublishedReadModel(publish)` 投影 effective → 公开显新版、差异归零。无 timestamp 比对脆弱性（内容差稳健）。

**为何重发布复用 `decideReview`+`ReviewOutcome.Republish`：** `decideReview` 已在单事务内 append 决策+驱动 refresh，generic 适配新转换（`resolveTransition` 返回 `{to:"published", action:"publish"}`，其余逻辑通用）。新增独立「republish」函数会重复事务/决策/refresh 编排（反 DRY）。`ReviewOutcome.Republish` 语义=「运营于修订后重新发布」，`ReviewDecision(outcome=republish)` 是该动作的审计记录（note 载原因），与 approve/reject/takedown 同为审计链一员。`published→published` 是 1.8 `publish-service.ts` 注释「On a re-publish (refresh)…update branch preserving publishedAt」早已预留的路径。

**为何修订分两个 server action、各模块 append 各自原子：** 标题/标签归 event-assembly（`reviseHotEvent`）、解释归 explanation（`saveExplanation`）——各模块写归属内、各自 append 原子。两者非跨模块事务（web 层顺序调）：若标题 append 后解释 append 前崩溃，留部分修订——但追加式无损坏（运营重提交），记 defer。强制跨模块事务需重构模块函数接受 `tx` 或引入 core 编排器，超 V1 最小（ponytail：接受非原子、append-only 兜底）。变更检测在各模块内（防脏版本 + 防无谓 source 翻转：仅解释真变才 append human、避免「只改标题却把 template 解释翻成 human 而误撤 AiLabel」）。

**为何运营读 `getPublishedEventForRevision` 放 review-workflow：** review-workflow 已是运营读汇编者（`getCandidateDetail` 跨聚合读 hot_events/evidence/decisions）。新读 via `HotEvent` 反向导航 include（`publishedReadModel`/`publishedExplanation`/`revisions`/`explanationVersions`）——与 `getCandidateDetail` 读 evidence_records 同型（只读导航元数据、不跨写归属）。单 `findUnique` 组装 published vs effective vs pending。publish-orchestrator 仍只负责**公开**读（`getPublishedHotEventDetail` 加 tags 返回），不掺运营工作表读——保持 AD-3「公开读模型唯一拥有者」纯粹。

## Verification

**Commands:**
- `pnpm --filter core db:migrate -- --name revision_and_published_tags` -- expected: 迁移应用、`hot_event_revisions` 表生成、`published_hot_events.tags` 列加（随后 typecheck 内置 `prisma generate` 产出新模型类型）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（含 event-assembly revise-service + explanation saveExplanation + review-workflow republish/operator-view + publish-orchestrator 扩展 + web 修订 UI）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter core verify:review-logic` -- expected: selfcheck PASS（含新 republish 合法 + candidate/taken_down+republish 非法用例）；无 infra
- `pnpm --filter core verify:cluster-logic` -- expected: 不回归（聚类逻辑零改动）
- `pnpm --filter worker verify:revision` -- expected: 集成脚本打印 PASS（reviseHotEvent append/no-op、saveExplanation human append、重发布前后读模型差异、source 门控、追加式）；仅需 live PG、无 Redis
- `pnpm --filter worker verify:publish` -- expected: 打印 PASS（含 tags 投影、effective 标题含 revision overlay、republish 后 publishedAt 稳定的新断言）
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（仅 `/` 与 `/events/[hotEventId]` ƒ Dynamic；运营台 force-dynamic 路由同；其它公共页静态）
- `pnpm --filter web e2e:revision` -- expected: seed 后 `@revision` 通过（修订后公开显旧 + 运营显 pending + 重发布后公开显新且无 AiLabel + 审计链含 republish）
- `pnpm --filter web e2e` / `e2e:console` / `e2e:feed` / `e2e:detail` -- expected: 不回归（console/feed/detail seed/spec 零改动）

**Manual checks (if no CLI):**
- 已发布事件 `/console/{id}`：修订表单可填标题/标签/解释，提交后公开 `/events/{id}` 不变、运营显 pending 差异；重新发布后公开显新版（标题/标签/解释），human 解释无 AiLabel；运营审计链含 republish 决策；非 published 事件重发布被拒（IllegalTransition）；连续修订旧版本行不丢；标签规范化（分隔符/去重）正确；无标签不渲染标签区。
