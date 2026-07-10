---
title: '运营复核队列与发布闸门 (1.6)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '7f8abe123f75310f8c8db0512fecca44ea091236'
final_revision: '8724e9a31c6831b7b55f49eadfdcb6a6503ca122'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-5-candidate-hot-event-clustering.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.5 把已归档证据聚成了 `publication_status="candidate"` 的候选 `HotEvent`，但系统还没有发布闸门：候选永远不会变成"已发布"，没有任何路径让运营复核并决定通过/驳回/下线，也没有任何"发布态读模型"可供 1.7 公开流 / 1.8 详情页读取。结果：1.4–1.5 的采集-聚类管道产出的候选无人能审、无人能发，公开面仍恒为空态，epic 的"可信发布闭环"卡在闸门缺失。

**Approach:** 在 `packages/core` 新增两个模块——`review-workflow`（AD-6 发布闸门单一写拥有者：写 `ReviewDecision` + `PublicationDecision` 两张 append-only 决策表，并驱动 `hot_events.publication_status` 的合法转移 candidate→published / candidate→rejected / published→taken_down）与 `publish-orchestrator`（AD-3 发布态读模型单一写拥有者：发布时 upsert、下线时 delete `published_hot_events` 读模型行）。决策经应用命令 `decideReview` 在单个事务内原子完成"校验转移合法性 → 写两条决策记录 → 改 publication_status → 刷新读模型"。在 `apps/web/(operator)/console` 落地运营复核台（列表 + 详情 + 决策 server action），使 web 首次消费 `@aguhot/core`（operator 路由动态、公开路由保持静态 / DATABASE_URL-free 不变）。`apps/worker` 加确定性 `verify:publish` 集成验证 + core 加纯转移自检 `verify:review-logic`。本 story 不做合并/拆分/标题修订（1.9/1.10）、不做解释生成（1.8）、不引入真实运营认证（依赖未建 user-profile）。

## Boundaries & Constraints

**Always:**
- 单一写拥有者（AD-2/AD-3/AD-6）：`review-workflow` 只写 `review_decisions` / `publication_decisions`，且只更新 `hot_events.publication_status`（字段级归属，见 Design Notes）；`publish-orchestrator` 只写 `published_hot_events`；两模块绝不写 `evidence_records` / `evidence_sources` / `hot_event_evidence` / `hot_events` 的 title/cluster_signature（那些归 event-assembly）。`event-assembly` 仍只赋 `"candidate"` 初值，从不置其它值（1.5 不变式延续）。
- 公开站只读发布态读模型（AD-3）：公开 web 路由绝不读 `hot_events` / `review_decisions` / `publication_decisions`；只 `published_hot_events` 行存在 = 当前已发布。`publication_status` 是公开可见性的唯一控制（AC2/AC3）。
- 决策 append-only、可追溯、可回滚（AD-5）：`ReviewDecision` / `PublicationDecision` 只追加、绝不原地改写或删除；下线/再发布是新决策 + 读模型刷新，不是抹历史。运营台能查到完整决策链（按 createdAt 升序）。
- 审计强制（NFR6）：所有复核相关关键变更（通过/驳回/下线）必落 `ReviewDecision` + `PublicationDecision`，每行带 `trace_id`，`PublicationDecision` 记 `from_status`/`to_status` 并链回触发它的 `review_decision_id`。
- 重活异步、运营动作同步（AD-4）：运营决策是"提交运营动作"——同步轻量命令（几张表的 DB 写，无 LLM/抓取）；web 请求路径不同步外部调用。不为本 story 新增 BullMQ 队列（决策与读模型刷新都是轻量 DB 写）。
- 转移合法性强校验：`candidate→published`(approve)、`candidate→rejected`(reject)、`published→taken_down`(takedown) 为唯一合法路径；非法转移（如 reject 已 published、approve 已 taken_down）抛 domain 错误、不落任何记录、不改状态。
- 不变性约定（沿用 1-4/1-5 全部）：状态/种类用 `const … as const` + union（禁 TS `enum`）；类型导入 `import type`；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`、表 `@@map("snake_case_plural")`；主键 UUIDv7（`newTraceId()`）；时间 UTC；每条记录带 `trace_id`。
- 公开 e2e 保持 DATABASE_URL-free：`home/navigation/design` 三个公共 e2e 不得因 web 引入 `@aguhot/core` 而需要 DB；console e2e 单独走 DB-backed 命令，不污染公共 e2e 的"无 infra 启动"性质。

**Block If:**
- `prisma migrate dev --name add_review_and_publish` 针对本地 PostgreSQL 失败且非可自愈原因（本地 PG 不可达）→ HALT。1-4/1-5 已确认本地 PG 可达、Redis 可达；当前 schema 对 16/17/18 兼容。
- 验证期本地 PG 不可达（`verify:publish` 连接失败）→ HALT，不得跳过集成验证。
- 引入 `@aguhot/core` 导致 `pnpm --filter web build`（无 `DATABASE_URL`）失败 → HALT（公开构建必须保持 DATABASE_URL-free）。

**Never:**
- 不实现合并/拆分/标题·标签·解释修订/再发布编排（属 1.9/1.10，复用本闸门但不重建）；不引入 `ExplanationVersion` / `Theme` / `ReactionSnapshot` / `published_*` 以外的读模型表。
- 不生成 AI 解释/摘要/标题文案（候选标题沿用 1.5 朴素派生；解释归 explain job / 1.8）；不引入 `LLMAdapter`。
- 不实现真实运营认证/会话（依赖未建 user-profile 模块，属后续 epic）；但必须落地 `(operator)` 路由组 layout 作为未来认证的 drop-in 点，并给 `/console` 加 `robots` noindex（解 1-1 既有 deferred「/console 可被 SEO 索引」）——认证本身记 defer。
- 不新增 BullMQ 队列/worker（决策与读模型刷新为同步轻量命令）；不改 1-4/1-5 既有 `home.spec`/`navigation.spec`/`design.spec`/`verify-ingest`/`verify-cluster` 断言（仅按需在 schema 加只读反向关系）；不内联 SQL 绕过 Prisma（迁移 SQL 除外）；不新增第三方依赖。
- 不把 `review-workflow` / `publish-orchestrator` 决策逻辑放 web 层（web 只调命令 + 渲染；命令与转移校验在 core）；不让公开路由 import `@aguhot/core`（仅 operator 路由）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| approve 候选发布（AC2） | 某 `publication_status="candidate"` 候选，运营提交 outcome=approve + note | 单事务：写 1 条 ReviewDecision(approve) + 1 条 PublicationDecision(from=candidate,to=published,链回 review)；`hot_events.publication_status`→`"published"`；publish-orchestrator upsert `published_hot_events` 行（title/evidenceCount/latestEvidenceAt/publishedAt）；返回摘要 | 无错误预期 |
| reject 候选（AC2） | 候选，运营提交 outcome=reject | 写 ReviewDecision(reject) + PublicationDecision(candidate→rejected)；`publication_status`→`"rejected"`；**不**触碰 `published_hot_events`（从未发布）；候选移出待复核列表 | 无错误预期 |
| takedown 已发布（AC2） | 某 `publication_status="published"` 事件，运营提交 outcome=takedown | 写 ReviewDecision(takedown) + PublicationDecision(published→taken_down)；`publication_status`→`"taken_down"`；publish-orchestrator **delete** `published_hot_events` 行（公开面随即不可见） | 无错误预期 |
| 未发布不进公开读模型（AC3） | candidate / rejected / taken_down 状态的事件 | `published_hot_events` 表中无对应行；公开 web 读该表得不到它们；后台仍可查完整决策链 | 无错误预期（结构隔离） |
| 非法转移被拒 | 如对已 `rejected` 候选再 approve，或对 `taken_down` approve，或对 `candidate` 直接 takedown | 抛 domain 错误（非法转移）；**不**写任何决策记录、**不**改 publication_status、**不**刷新读模型；web action 向运营展示错误 | domain error，事务回滚 |
| append-only 审计（NFR6） | 同一事件先 approve 再 takedown（两次决策） | `review_decisions` 有 2 行、`publication_decisions` 有 2 行（from/to 分别 candidate→published、published→taken_down），按 createdAt 升序可读 | 无错误预期 |
| 发布读模型幂等 | 对同一已 published 事件重复触发 publish 刷新 | `published_hot_events` 仍恰 1 行（upsert，无重复）；evidenceCount/latestEvidenceAt 重算一致 | 无错误预期 |
| 待复核列表（AC1） | 系统有多个 candidate | `listPendingCandidates` 返回这些候选（title、evidenceCount、latestEvidenceAt、status="candidate"），按最近更新降序；rejected/published/taken_down 不在列 | 无错误预期 |
| 空复核台 | 无 candidate | `/console` 渲染空态（"暂无待复核候选"），不渲染假数据；不抛 | 无错误预期 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 `ReviewDecision`(id/hot_event_id/outcome/reviewer/note?/trace_id?/created_at、`@@index([hotEventId])`、`@@index([createdAt])`、`@@map("review_decisions")`、FK→hot_events `onDelete: Restrict`)、`PublicationDecision`(id/hot_event_id/from_status/to_status/reason?/review_decision_id?/trace_id?/created_at、`@@index([hotEventId])`、`@@index([createdAt])`、`@@map("publication_decisions")`、FK→hot_events `onDelete: Restrict`)、`PublishedHotEvent`(hot_event_id PK/title/evidence_count/latest_evidence_at/published_at/trace_id?/updated_at、FK→hot_events `onDelete: Cascade`、`@@map("published_hot_events")`，**行存在=当前已发布**，无 status 列)；给 `HotEvent` 加只读反向关系 `reviewDecisions`/`publicationDecisions`/`publishedReadModel`（导航元数据，不改 event-assembly 写拥有权）
- `packages/core/prisma/migrations/<ts>_add_review_and_publish/migration.sql` -- NEW：`prisma migrate dev --name add_review_and_publish` 生成（三表 + FK + 索引）
- `packages/core/src/shared/publication-status.ts` -- NEW：权威 `PublicationStatus` 全集 `{Candidate:"candidate",Published:"published",Rejected:"rejected",TakenDown:"taken_down"} as const` + union（publication_status 现跨 event-assembly/review-workflow，归共享内核单一真相源）
- `packages/core/src/modules/event-assembly/types.ts` -- MODIFY：`PublicationStatus` 改为从 `../../shared/publication-status.js` re-export（保 1-5 公共 API 与 verify 不变；event-assembly 仍只赋 `"candidate"`）
- `packages/core/src/modules/review-workflow/types.ts` -- NEW：`ReviewOutcome={Approve:"approve",Reject:"reject",Takedown:"takedown"} as const`+union；`IllegalTransitionError` domain 错误；命令/查询 options 与 result 类型
- `packages/core/src/modules/review-workflow/transitions.ts` -- NEW：纯函数 `resolveTransition(from, outcome)`（返回 `{to, action: "publish"|"takedown"|"none"}` 或抛/返回非法标志，无 DB、无副作用、可单测）
- `packages/core/src/modules/review-workflow/transitions.selfcheck.ts` -- NEW：tsx 自检（无 infra）：3 合法转移 + 4 非法转移（reject published / approve taken_down / takedown candidate / approve rejected）+ 边界；打印 PASS/FAIL、非零退出 iff 失败
- `packages/core/src/modules/review-workflow/review-service.ts` -- NEW：`decideReview({prisma,traceId,hotEventId,outcome,reviewer,note})` 单事务（`$transaction`：读 from → `resolveTransition` 校验 → 写 ReviewDecision → 写 PublicationDecision(链回) → 改 publication_status → 调 publish-orchestrator 刷新）、`listPendingCandidates({prisma,traceId})`（读 candidate + `_count` evidence + 最近更新投影）、`getCandidateDetail({prisma,traceId,hotEventId})`（候选 + 证据 + 决策链）；AD-6 单一写拥有者
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- NEW：`refreshPublishedReadModel({prisma,traceId,hotEventId,action})`——action=publish 计算 evidenceCount/latestEvidenceAt 后 upsert `published_hot_events`、action=takedown delete 该行、action=none no-op；AD-3 单一写拥有者
- `packages/core/src/modules/review-workflow/index.ts` + `publish-orchestrator/index.ts` -- NEW：模块桶导出
- `packages/core/src/index.ts` -- MODIFY：包桶追加 review-workflow + publish-orchestrator 导出（`decideReview`/`listPendingCandidates`/`getCandidateDetail`/`ReviewOutcome`/`resolveTransition`/`refreshPublishedReadModel`）
- `packages/core/package.json` -- MODIFY：加 `verify:review-logic`(`tsx src/modules/review-workflow/transitions.selfcheck.ts`)
- `apps/worker/src/verify-publish.ts` -- NEW：确定性集成验证（仅需 live PG，无 Redis）：resetEnvCache→getPrisma→清旧测试行→播种 archived 记录→`clusterEvents` 产候选→断言 listPendingCandidates/approve(reviewer+note→两决策记录+published 读模型行)/reject(无读模型行)/takedown(读模型行删除)/append-only(两次决策两记录)/非法转移抛/读模型幂等/写隔离(仅 4 表被写)/审计链可查→PASS/FAIL、cleanup、非零退出 iff 失败
- `apps/worker/package.json` -- MODIFY：加 `verify:publish`(`tsx src/verify-publish.ts`)
- `apps/web/package.json` -- MODIFY：dependencies 加 `"@aguhot/core": "workspace:*"`
- `apps/web/app/(operator)/layout.tsx` -- NEW：路由组 layout，`metadata.robots={index:false,follow:false}`（noindex，解 1-1 deferred），结构化未来认证 drop-in 点（V1 无认证——记 defer）
- `apps/web/app/(operator)/console/page.tsx` -- MODIFY：占位改为真实候选列表（server component 调 `listPendingCandidates`），渲染 title/来源数/最近更新/状态(candidate) + 进详情链接 + 空态；`export const dynamic = "force-dynamic"`（DB 读）
- `apps/web/app/(operator)/console/[eventId]/page.tsx` -- NEW：候选详情（server component 调 `getCandidateDetail`）：标题、证据列表（来源名/时间/摘要/原文链接，经 hot_event_evidence→evidence_records）、决策审计链（升序）、决策表单（approve/reject/takedown + note）
- `apps/web/app/(operator)/console/[eventId]/actions.ts` -- NEW：server action `submitReview(formData)`：解析 outcome+note → 调 `decideReview` → `revalidatePath`；非法转移/未找到候选 → 回显错误
- `apps/web/e2e/console.spec.ts` + `playwright.config.ts` + `package.json` -- NEW/MODIFY：DB-backed console e2e（单独 tag/命令 `e2e:console`，需 `DATABASE_URL` + 前置 seed）：/console 渲染候选列表（AC1）、进详情提交 approve→状态变 published+审计链显示（AC2）、reject 另一条→rejected、公共首页 `/` 仍为静态空态且候选标题不泄漏（AC3）；公共 e2e（`e2e`）保持无 `DATABASE_URL` 启动
- `apps/web/src/seed-console.ts`（或 worker 侧 seed 脚本） -- NEW：console e2e 前置 seed（播种 archived→clusterEvents 产 2 个确定性候选），供 `e2e:console` globalSetup/前置命令调用
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-6 defer（真实运营认证、verify:publish/verify:review-logic/console e2e 未入 recurring gate、published 读模型为最小集无解释/市场反应/主题字段、运营合并/拆分/修订复用闸门）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- 加 `ReviewDecision`/`PublicationDecision`/`PublishedHotEvent`（snake_case `@map`/`@@map`、UUIDv7、`createdAt`/`updatedAt`、`traceId?`；决策表 FK `onDelete: Restrict` 护审计可追溯、读模型 FK `onDelete: Cascade`；`HotEvent` 加 3 个只读反向关系） -- AD-5 append-only 决策表 + AD-3 发布读模型
- `packages/core` 迁移 -- `pnpm --filter core exec prisma migrate dev --name add_review_and_publish` 生成迁移、本地建三表（含 FK、索引） -- schema 落库
- `packages/core/src/shared/publication-status.ts` + `event-assembly/types.ts` re-export -- `PublicationStatus` 全集移共享内核单一真相源，event-assembly re-export 保 API 稳定 -- 跨模块状态概念去重（解两模块各定义同名 union 的 clash）
- `packages/core/src/modules/review-workflow/transitions.ts` + `transitions.selfcheck.ts` + `package.json:verify:review-logic` -- 纯 `resolveTransition`（3 合法路径 + 非法抛）+ 自检（合法/非法/边界） -- 安全相关转移逻辑留可跑检查（无 infra）
- `packages/core/src/modules/review-workflow/review-service.ts` -- `decideReview` 单事务（校验→两决策记录→改状态→刷新读模型）、`listPendingCandidates`、`getCandidateDetail` -- AC1/AC2 闸门命令 + 审计链查询
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- `refreshPublishedReadModel`(publish→upsert / takedown→delete / none→no-op) -- AD-3 发布读模型单一写拥有者
- `packages/core/src/modules/{review-workflow,publish-orchestrator}/index.ts` + `src/index.ts` -- 桶导出命令/查询/类型 -- 对外 API
- `apps/worker/src/verify-publish.ts` + `package.json:verify:publish` -- 播种→聚类→断言 approve/reject/takedown/append-only/非法转移/读模型幂等/写隔离/审计链 -- AC2/AC3 surface-anchored 闸门端到端验证（仅需 PG）
- `apps/web/package.json` + `(operator)/layout.tsx` + `console/page.tsx` + `console/[eventId]/{page.tsx,actions.ts}` -- web 首次消费 `@aguhot/core`：复核台列表 + 详情 + 决策 server action；operator 路由动态、noindex、layout 作认证 drop-in -- AC1/AC2 运营台 UI 落地
- `apps/web/e2e/console.spec.ts` + `playwright.config.ts`(`e2e:console` tag/命令) + seed 脚本 + `package.json:e2e:console` -- DB-backed console e2e：列表/决策/审计/AC3 公开不泄漏；公共 `e2e` 保持无 DB -- AC1/AC2/AC3 surface-anchored UI 验证，不破坏公共 e2e 的无 infra 性质
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-6 defer 项（认证、verify 门、读模型最小集、合并/拆分/修订复用） -- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG `aguhot_dev` 可达且 1-5 迁移已应用，When 执行 `pnpm --filter core exec prisma migrate dev --name add_review_and_publish`，Then 生成迁移并建出 `review_decisions`/`publication_decisions`/`published_hot_events` 三表（含 FK、索引），And `pnpm --filter core exec prisma validate` 通过。
- Given 系统已有 `publication_status="candidate"` 的候选（经 1-5 聚类），When 运营在 `/console` 进入复核台，Then 看到待复核列表（候选标题、来源数、最近更新时间、当前状态），And 每条可进详情复核（证据列表 + 决策审计链 + 决策表单）。
- Given 运营在详情页对候选执行通过/驳回/下线，When 提交决策，Then 系统写入 `ReviewDecision` 与 `PublicationDecision` 记录（append-only，链回），And `hot_events.publication_status` 仅按合法路径转移（candidate→published / candidate→rejected / published→taken_down），And 公开可见性只由 `publication_status` 经 `published_hot_events` 读模型控制（approve→行存在、takedown→行删除、reject/candidate→无行）。
- Given 某候选未被发布（candidate/rejected）或已被下线（taken_down），When 公共用户访问首页 `/`，Then 该内容不出现在公开页（首页仍为静态空态、`home.spec` 不回归），And 后台仍能查到该事件的完整决策审计轨迹。
- Given 非法转移（如 reject 已 published 事件、approve 已 taken_down 事件、takedown candidate），When 调 `decideReview`，Then 抛 domain 错误且不写任何记录、不改 publication_status；And `pnpm --filter worker verify:publish` 与 `pnpm --filter core verify:review-logic` 均打印 PASS。
- Given web 引入 `@aguhot/core`（operator 路由消费），When 执行 `pnpm --filter web build`（无 `DATABASE_URL`），Then 构建成功（公开路由静态、operator 路由动态、web 公开构建仍 DATABASE_URL-free），And `pnpm --filter web e2e`（公共）全绿无回归，And `pnpm --filter web e2e:console`（DB-backed）验证复核台列表/决策/审计/公开不泄漏。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

<!-- 空，直至首次评审。 -->

## Design Notes

**`hot_events` 字段级写归属（AD-2 张力化解）：** `hot_events` 现由两个模块写——event-assembly（建候选 + cluster_signature/title，1.5 既有）与 review-workflow（仅 `publication_status`）。这不是写越界：AD-6 明确"高影响动作必须经 review-workflow 形成明确的 publication_status"，故 publication_status 字段委托给 review-workflow，event-assembly 拥有其余字段且只赋 `"candidate"` 初值。两模块写不同字段、无重叠（review-workflow 绝不改 title/signature，event-assembly 绝不改 status 至非 candidate）。`decideReview` 用 `prisma.hotEvent.update({data:{publicationStatus:to}})` 只更新该字段。

**为何 `published_hot_events` 行存在=已发布（无 status 列）：** 公开读契约（1.7/1.8）的最简形式是"读该表所有行"。下线 = delete 行、（再）发布 = upsert 行，使行集合恒等于当前已发布集。status 列会冗余（行存在即 published）且诱导公开读加 `WHERE status=...` 过滤（多余、易漏）。审计历史不靠读模型（下线删除行不丢历史——`PublicationDecision` append-only 已留 published→taken_down 记录）。ponytail：无消费者字段不预埋。

**为何决策与读模型刷新同步、不引入 BullMQ 队列：** AD-4 禁的是"请求路径同步等 LLM/抓取/聚类"等重活；运营决策是"提交运营动作"（AD-4 明文允许），即几张表的 DB 写 + 一次读模型 upsert/delete，全程无外部调用、毫秒级。引入队列会把"决策已落库但读模型尚未刷新"的窗口暴露给公开读（短暂不一致），反损 AD-3/AC2。故 `decideReview` 单事务内同步刷新读模型。1.6 不动 `apps/worker/src/index.ts`（无新 worker）；`verify:publish` 直调命令、仅需 PG 不需 Redis。

**为何 `PublicationStatus` 移共享内核：** 1-5 把 `PublicationStatus={Candidate}` 放 event-assembly/types.ts（当时唯一写者）。1.6 起 review-workflow 需 published/rejected/taken_down。若 review-workflow 自定义全集则与 event-assembly 同名 clash；若 review-workflow 依赖 event-assembly 则依赖方向反了（闸门依赖聚类）。共享内核 `shared/publication-status.ts` 是跨模块状态概念的天然归宿（同 `shared/ids.ts`），event-assembly re-export 保 `@aguhot/core` 公共 API 与 1-5 verify/selfcheck 不变。

**为何运营认证记 defer 而非本 story 实现：** AD-8 表"关注/后台路径才要求认证"，但真实认证依赖 `user-profile` 模块（未建，后续 epic）。本 story 落地 `(operator)/layout.tsx` 作认证 drop-in 结构点 + `/console` noindex（解 1-1 deferred SEO），把"V1 复核台无认证"如实记 defer（含安全含义：开发态 /console 公开可达）。这不是"简化掉安全措施"——是无认证系统可接（user-profile 未建），强行造一个一次性认证反而是过度设计；真正认证随 user-profile 落地时接入 layout。

**为何 web 首次 import `@aguhot/core` 仍保公开构建 DATABASE_URL-free：** `index.ts` 注释明示"operator flows consume these exports"。operator server component 调 `getPrisma()`（运行时读 `DATABASE_URL`）→ Next 16 将该路由判为 dynamic（请求时渲染，不在 build 时静态求值）；公开路由不 import core、保持静态。故 `next build`（无 `DATABASE_URL`）仍成功。web typecheck 需 Prisma 生成客户端类型——`pnpm -r typecheck` 拓扑序 core 先于 web（core typecheck 内含 `prisma generate`），web 见生成产物。client bundle 不受影响（无 client component import core）。

## Verification

**Commands:**
- `pnpm --filter core exec prisma validate` -- expected: 含新模型 schema 合法通过
- `pnpm --filter core exec prisma migrate dev --name add_review_and_publish` -- expected: 生成迁移、本地建三表（需 `DATABASE_URL` 指本地 PG）
- `pnpm --filter core verify:review-logic` -- expected: 纯转移自检 PASS（合法/非法/边界，无 infra）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（core 前置 `prisma generate`；含新决策/读模型客户端类型 + web 消费 core）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter worker verify:publish` -- expected: 集成脚本打印 PASS、非零退出 iff 任一断言失败（approve/reject/takedown/append-only/非法转移/读模型幂等/写隔离/审计链）；仅需 PG
- `pnpm --filter web build` -- expected: 无 `DATABASE_URL` 下构建成功（公开静态、operator 动态、web 公开仍 DATABASE_URL-free）
- `pnpm --filter web e2e` -- expected: `home/navigation/design` 全绿无回归（AC3 公开面）
- `pnpm --filter web e2e:console` -- expected: DB-backed 复核台 e2e PASS（列表/决策/审计/公开不泄漏）；公共 e2e 不被污染

**Manual checks (if no CLI):**
- 本地 PG 三张新表结构正确（FK `onDelete`、索引）；approve 后 `published_hot_events` 有行、takedown 后行删除、reject 不产生行；同一事件两次决策 → 决策表各 2 行 append-only；非法转移抛错且无副作用；`/console` 列表渲染候选数据、提交决策后状态与审计链更新；公共首页候选标题不泄漏。
