---
title: '时间流读模型与发布刷新 (4.1)'
type: 'feature'
created: '2026-07-11'
status: 'ready-for-dev'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md'
review:
  pm: 'Approve-with-conditions (bmad-agent-pm, 2026-07-11)'
  architect: 'Approve-with-conditions (bmad-agent-architect, 2026-07-11)'
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
warnings: ['架构阻塞 A1-A5 已按评审应用（method A 事务内增量+自愈 job、读 fn、session_tag 派生、折叠归 event-assembly）；PM 阻塞 P2 SM-8 基线冻结须 Epic 4 dev 启动前完成；GA 受 §10 合规复核阻塞（非 dev 阻塞）']
---

# 预稿说明

本 spec 对应 Sprint Change Proposal 2026-07-11 新增 Epic 4 Story 4.1，已经 bmad-agent-pm 与 bmad-agent-architect 评审（均 Approve-with-conditions），架构阻塞项 A1-A5 已按评审意见应用。PM 阻塞 P2（SM-8 基线冻结）须在 Epic 4 dev 启动前由 PM 完成；§10 合规复核阻塞 GA 不阻塞 dev。审批通过后转 `/bmad-create-story` 正式化并补 `baseline_revision` 等字段。

<intent-contract>

## Intent

**Problem:** Sprint Change Proposal 2026-07-11 决定把首页从"优先级热点事件流"改为"分钟级时间流 + 同事件精选"。现有 `publish-orchestrator` 只产出事件级 `published_*` 读模型，无按时间序投影、无同事件多源折叠的读模型；首页若临时拼时间序 SQL 会违反 AD-3（公开站只读发布态读模型），且无法保证同事件折叠、盘前/盘中/盘后分段与公开可见性的一致性。本 story 先交付时间流的**数据底座**——`published_timeline` 读模型与其刷新/读契约——为 4.2（首页与卡片）、4.3（筛选）、4.4（搜索打通）提供统一只读源。

**Approach:** 在 `packages/core` 新增 `published_timeline` 读模型（Prisma 模型 + 迁移），由 `publish-orchestrator` 模块新增 timeline 刷新与读查询职责。刷新遵循 codebase 既有的"闸门原子"范式（评审阻塞 A1）：`decideReview` 事务内对 per-HotEvent 折叠条目做**增量 upsert/delete**（publish→upsert 该事件折叠条目，takedown→delete），与既有 `refreshPublishedReadModel` 并列调用，保证零可见性窗口；另保留**周期性全量自愈 job**（BullMQ）做纠偏。timeline 条目是 per-HotEvent 折叠（非全局聚合），可像 `published_hot_events` 一样增量 upsert/delete，**不采用全量幂等覆盖写入**（那会 needless 引入可见性窗口）。折叠阈值 = 2（PRD §12 Q6 已收口），由 `event-assembly` 模块配置拥有（评审决策：折叠是聚类语义，归 event-assembly，不进全局 env）。`session_tag`（盘前/盘中/盘后/非交易日）与 `trade_date` 由纯函数派生（A 股交易时段边界，codebase 目前无此定义，本 story 新建）。Web 首页经 `listPublishedTimeline` 读契约读取，不拼时间序 SQL（AD-3/AD-3b）。本 story 不交付首页 UI、筛选、搜索（4.2/4.3/4.4），不交付 AI 解读生成（5.1；AI 解读挂在 HotEvent 上，timeline 条目投影时关联其 latest version，不依赖 timeline 条目存在）。

## Boundaries & Constraints

**Always:**
- 单一写拥有权（AD-2）：`publish-orchestrator` 是 `published_timeline` 的唯一写拥有者；`event-assembly` 拥有 `HotEvent` 与折叠阈值配置；`source-ingest` 拥有 `EvidenceSource`。`publish-orchestrator` 只读这两者的 published 投影与 event-assembly 的阈值配置，不反向修改。
- 公开站只读发布态（AD-3/AD-3b/AD-6）：`published_timeline` 只含 `publication_status = published` 的内容；Web 只读不写。
- 闸门原子刷新（评审 A1）：timeline 增量刷新挂入 `decideReview` 的 `$transaction`，与 `refreshPublishedReadModel` 并列；approve/takedown 零可见性窗口。周期性自愈 job 走 BullMQ 异步（AD-4），仅纠偏，不作为主刷新路径。
- 版本化/可追溯（AD-5）：读模型条目保留 `evidence_source_id` 集合与 `hot_event_id` 链；折叠关系可回溯到被折叠的证据源集合。
- 端口隔离（AD-7）：本 story 不引入新外部源；复用既有端口，不直连第三方 SDK。
- 主键 UUIDv7；时间存 UTC；表名 snake_case 复数；队列名/job 名 kebab-case；每条记录与每个 job 带 `trace_id`。
- 不变性：状态/种类用 `const … as const` + union，禁用 TS `enum`；类型导入用 `import type`；相对导入带 `.js` 后缀。

**Block If:**
- PM 未完成 SM-8 基线冻结（评审 P2）→ 阻塞 Epic 4 dev 启动（非本 story 架构阻塞，但 PM 须先落）。
- `refreshPublishedTimelineForEvent` 在 `decideReview` 事务内针对本地 PostgreSQL 集成验证失败且非可自愈原因 → HALT。
- 本地 Redis 不可达（自愈 job 集成验证）→ HALT，不得跳过。

**Never:**
- 不实现首页 UI、时间流卡组件（4.2）；不实现筛选（4.3）；不实现搜索打通（4.4）。
- 不实现 AI 解读/深读/研判生成（Epic 5）；`published_timeline` 条目可预留 `recommendation_reason` 字段为 null，但不在本 story 填充。AI 解读挂在 HotEvent 上（5.1），timeline 投影时关联其 latest version。
- 不采用全量幂等覆盖写入作为主刷新路径（评审 A1：会引入可见性窗口，违背闸门原子范式）。
- 不把折叠阈值放进全局 `env.ts`（评审决策：归 `event-assembly` 模块配置）。
- 不改变 `event-assembly`/`source-ingest` 既有写拥有权与表结构；只读其 published 投影。
- 不让 Web 请求路径触发同步刷新或同步 LLM/抓取（AD-4）。
- 不新增 `enum`/namespace/参数属性；不内联 SQL 绕过 Prisma。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 发布增量 upsert（AC1） | `decideReview` approve 一个带 N 条 EvidenceSource 的 HotEvent | 事务内 upsert 该 HotEvent 的 per-event 折叠条目（N≥2 折叠为"同事件精选"，N=1 独立条目）；与 `refreshPublishedReadModel` 同事务 | 事务失败=整体回滚，无半成品 |
| 下线增量 delete（AC3） | `decideReview` takedown 一个已发布 HotEvent | 事务内 delete 该 HotEvent 的 timeline 条目；详情页与首页同事务消失 | 事务失败=整体回滚 |
| 折叠阈值（AC2） | HotEvent 关联 1 条 vs ≥2 条 EvidenceSource | 1 条→独立条目（`folded_evidence_ids` 空）；≥2 条→折叠为单条，保留被折叠 id 集合 | 阈值由 event-assembly 配置（默认 2） |
| Web 只读（AC4） | Web 首页请求读取时间流 | 经 `listPublishedTimeline` 读契约返回；不拼时间序 SQL，不触发同步刷新 | 读模型为空→返回空列表（非错误） |
| session_tag/trade_date 派生（AC5） | 证据 occurred_at 落在盘前/盘中/盘后/非交易日 | `deriveSessionTag`/`deriveTradeDate` 纯函数返回对应 tag 与交易日；非交易日按自然日 fallback | 边界时刻按 A 股时段定义 |
| 自愈 job 幂等（AC6） | 周期性自愈 job 连续跑 | 全量重算覆盖，不产生重复条目，旧条目不残留 | job 失败→可重试，既有读模型仍可读 |
| 自愈失败不阻塞读（AC6） | 自愈 job 抛错 | job 标记失败、可重试；公开页读旧版本不崩 | 错误按 domain/adapter/transient 分类；带 trace_id |

</intent-contract>

## Acceptance Criteria

**AC1 — 发布增量 upsert（闸门原子）**
**Given** 系统中存在待发布 `HotEvent` 与其 `EvidenceSource`
**When** `decideReview` approve 提交（`$transaction` 内）
**Then** 事务内 upsert 该 HotEvent 的 per-event 折叠条目，与 `refreshPublishedReadModel` 同事务
**And** 每条条目至少含：`hot_event_id`、`trade_date`、`occurred_at`、`session_tag`、`source_name`、`title`、`summary`、`evidence_count`、`folded_evidence_ids`、`trace_id`
**And** `trace_id` 非空且等于该 `decideReview` 事务的 trace_id
**And** 不采用全量覆盖写入

**AC2 — 同事件精选折叠（阈值归 event-assembly）**
**Given** 同一 `HotEvent` 关联多条 `EvidenceSource`
**When** 证据源数量达到折叠阈值（event-assembly 配置，默认 = 2，PRD §12 Q6 已收口）
**Then** 多条证据源折叠为单条"同事件精选"条目
**And** `folded_evidence_ids` 保留被折叠证据源 id 集合
**And** 未达阈值的单源事件独立成条

**AC3 — 下线增量 delete（公开可见性隔离）**
**Given** 存在 `publication_status != published` 的 `HotEvent`（含 takedown）
**When** `decideReview` takedown 提交
**Then** 事务内 delete 该 HotEvent 的 timeline 条目
**And** `published_timeline` 不含任何非 published 内容（AD-3/AD-6）

**AC4 — Web 只读、不拼 SQL**
**Given** `published_timeline` 存在数据
**When** Web 首页请求读取时间流
**Then** 经 `listPublishedTimeline` 读契约返回，不直接拼时间序 SQL
**And** 不在请求路径触发同步刷新或外部调用（AD-4）

**AC5 — session_tag / trade_date 派生**
**Given** 证据 `occurred_at`（UTC）落在盘前 / 盘中 / 盘后 / 非交易日
**When** `deriveSessionTag` / `deriveTradeDate` 纯函数执行
**Then** 返回对应 `session_tag`（PreOpen/Intraday/PostClose/NonTrading）与 `trade_date`
**And** 非交易日按自然日 fallback 分组
**And** 派生函数单独可测（A 股交易时段边界明确定义）

**AC6 — 自愈 job 幂等与读路径隔离**
**Given** 周期性自愈 job 连续执行或失败
**When** 重复执行或 job 抛错
**Then** 重复执行不产生重复条目、旧条目不残留（全量重算覆盖）
**And** job 失败时既有 `published_timeline` 旧版本仍可读，公开页不崩
**And** 事务内刷新失败=整体回滚（无"旧版本仍可读"那一档，由自愈 job 单独保读路径可用）

## Code Map（预拟，dev 前可调）

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 `PublishedTimelineEntry` 模型（UUIDv7 主键、`hot_event_id`、`trade_date`、`occurred_at`、`session_tag`、`source_name`、`title`、`summary`、`evidence_count`、`folded_evidence_ids`（数组）、`trace_id`、UTC 时间）；复合索引 `(trade_date, session_tag, occurred_at desc)`（4.3 筛选会用，一次建好）
- `packages/core/prisma/migrations/<ts>_add_published_timeline/migration.sql` -- NEW：`published_timeline_entries` 表 + 复合索引
- `packages/core/src/modules/publish-orchestrator/session-tag.ts` -- NEW：`deriveSessionTag(occurredAtUtc)` + `deriveTradeDate(occurredAtUtc)` 纯函数（A 股盘前/盘中/盘后/非交易日边界，单独可测）
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- NEW：`refreshPublishedTimelineForEvent({prisma, traceId, hotEventId})`（per-event 增量 upsert/delete，供 `decideReview` 事务内调用）+ `refreshPublishedTimelineAll({prisma, traceId})`（全量自愈，供周期 job）+ `listPublishedTimeline({prisma, tradeDate, sessionTag?, category?, cursor})`（Web 读契约）
- `packages/core/src/modules/publish-orchestrator/types.ts` -- MODIFY：`TimelineSessionTag`（`{PreOpen, Intraday, PostClose, NonTrading} as const` + union）、`PublishedTimelineEntry`、`TimelineListQuery` 类型
- `packages/core/src/modules/publish-orchestrator/index.ts` -- MODIFY：barrel re-export timeline fns + 类型
- `packages/core/src/index.ts` -- MODIFY：re-export timeline fns + 类型（worker 经 dynamic import `@aguhot/core` 消费）
- `packages/core/src/modules/review-workflow/review-service.ts` -- MODIFY：`decideReview` 的 `$transaction` 内，在 `refreshPublishedReadModel` 旁并列调用 `refreshPublishedTimelineForEvent`（publish→upsert，takedown→delete）
- `packages/core/src/modules/event-assembly/timeline-fold-config.ts` -- NEW：`TIMELINE_FOLD_THRESHOLD` 模块配置（默认 2），event-assembly 拥有；publish-orchestrator 只读
- `apps/worker/src/queues/publish-timeline-queue.ts` -- NEW：**仅自愈 job**（`refreshPublishedTimelineAll` 周期调度）；不是主刷新路径
- `apps/worker/src/index.ts` -- MODIFY：注册自愈 worker + 周期 schedule（仿现有 6 个 worker 的 close 顺序）
- `apps/worker/src/verify-timeline.ts` -- NEW：确定性集成验证脚本：建/连本地 PG+Redis、播种 published HotEvent + 多源 EvidenceSource、跑 `decideReview` approve/takedown（验事务内增量 + 零窗口）、跑自愈 job（验幂等）、查库断言（交易日分组/倒序/折叠/可见性隔离/session_tag 派生/读契约）、打印 PASS/FAIL、非零退出

## Verification

- `pnpm --filter @aguhot/worker verify:timeline` 集成脚本全绿（覆盖 I/O 矩阵 7 场景 + 事务原子性 + 自愈幂等）。
- `pnpm typecheck` 全绿（`erasableSyntaxOnly` + `verbatimModuleSyntax`）。
- `deriveSessionTag` / `deriveTradeDate` 纯函数单测（盘前/盘中/盘后/非交易日边界时刻）。
- 现有 1.x/2.x/3.x e2e 不回归（首页空态/导航/设计 token/详情/日报/主题/搜索/关注保持）—— 本 story 不改公开 UI，首页在 4.2 前仍维持既有形态。
- 读模型为空时 Web 不崩（`listPublishedTimeline` 返回空列表，首页 4.2 落地前显示既有空态）。

## Dependencies & Sequencing

- **依赖（已存在）**：`event-assembly` 的 `HotEvent`、`source-ingest` 的 `EvidenceSource`、`publish-orchestrator` 既有 `refreshPublishedReadModel`、`review-workflow` 的 `decideReview` 事务、BullMQ/Redis/PG 基座（1.4 引入）。
- **PM 前置（非架构）**：SM-8 基线冻结（评审 P2），Epic 4 dev 启动前由 PM 完成。
- **被依赖**：4.2（首页与卡片读 `listPublishedTimeline`）、4.3（筛选读模型字段 + 复合索引）、4.4（搜索覆盖时间流条目）、5.1（AI 解读挂在 HotEvent 上，timeline 投影时关联其 latest version——5.1 不依赖 timeline 条目存在，但依赖本 story 的 `listPublishedTimeline` 能投影出 AI 解读字段）。
- **顺序**：Epic 4 → Epic 5；Epic 4 内 4.1 → 4.2 → 4.3 → 4.4。
