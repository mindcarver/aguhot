---
title: '候选热点聚类与待复核生成 (1.5)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '3622fb8923721fb5e2e1f4c749db24183f17f4f1'
final_revision: '35f7d4488f7125916a74ea6af75010b51b46606a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.4 交付了 `source-ingest`（采集 + 归档 `EvidenceRecord`），但 worker 侧还没有 `event-assembly` 模块——已归档证据只是一条条扁平记录，没有被聚成"事件级"候选。运营复核（1.6）与公开流（1.7）都需要"待复核候选 `HotEvent`"作为输入，但目前系统连一个候选热点都生成不了（`hot_events` 表不存在、无聚类 job）。

**Approach:** 在 `packages/core` 新增 `event-assembly` 模块（AD-2 下 `HotEvent` 聚类的单一写拥有者）：新增 `hot_events` + `hot_event_evidence` 两张表（迁移），把已归档且未被聚类的 `EvidenceRecord` 按标题 token 的 overlap-coefficient 相似度 + 时间窗口 union-find 聚成候选 `HotEvent`（`publication_status="candidate"`，绝不写入 `published_*`），候选与证据经链接表保持可追溯；在 `apps/worker` 落地 BullMQ `event-cluster` 队列与 worker（AD-4），并新增确定性集成验证脚本。聚类纯逻辑（无 DB）带一个 tsx 自检。本 story 不调 LLM、不生成解释、不做发布（分别属 explain job / 1.8 / 1.6）。

## Boundaries & Constraints

**Always:**
- 写拥有权单一（AD-2）：`event-assembly` 只写 `hot_events` / `hot_event_evidence`；只读 `evidence_records`（及经链接表反向导航），绝不写 `EvidenceRecord` / `EvidenceSource` / `published_*` / 任何其它模块聚合。
- 公开站只读发布态读模型（AD-3/AD-6）：本 story 只写候选工作表 `hot_events`，绝不创建或写入任何 `published_*` 读模型；候选 `publication_status` 恒为 `"candidate"`（非 `"published"`），故结构上无路径出现在公开页。
- 重活异步（AD-4）：聚类以 BullMQ `event-cluster` job 执行；web 请求路径不感知（web 不依赖 `@aguhot/core`，保持 `DATABASE_URL`-free 构建——本 story 不动 web）。
- 候选可追溯（AC1）：每条候选 `HotEvent` 经 `hot_event_evidence` 链接表关联 ≥1 条 `EvidenceRecord`，链接带 FK 保证引用完整、带 `trace_id`。
- 幂等：聚类 job 重复运行不产生重复候选、不重复建链（以"未被链接的 archived 记录"为处理集；`@@unique([hot_event_id, evidence_record_id])` 兜底）。
- 不变性：状态/种类用 `const … as const` + union（禁 TS `enum`）；类型导入 `import type`；相对导入带 `.js`；camelCase 字段 `@map("snake_case")`、表 `@@map("snake_case_plural")`；主键 UUIDv7（`newTraceId()`）；时间 UTC；每条记录与每个 job 带 `trace_id`（沿用 1-4 全部约定）。

**Block If:**
- `prisma migrate dev --name add_hot_events` 针对本地 PostgreSQL 失败且非可自愈原因（本地 PG 不可达等）→ HALT。1-4 已确认本地 PG（16/17，`/tmp:5432` accepting）、Redis（`ping`→PONG）可用；当前 schema 对 16/17/18 兼容。
- 验证期本地 Redis 不可达（`requireEnv("REDIS_URL")` 连接失败）→ HALT，不得跳过集成验证。

**Never:**
- 不调 LLM、不生成解释/摘要/标题文案（候选标题由证据记录派生，非 AI；解释生成是独立 explain job / 1.8 范围）；不引入 `LLMAdapter`。
- 不实现发布、复核决策、合并/拆分/下线（属 1.6 / 1.9 / 1.10）；不创建 `ReviewDecision` / `PublicationDecision` / `ExplanationVersion` / `published_*` 表；不把 `publication_status` 置为 `"published"`（该转移归 review-workflow，1.6）。
- 不改 1-4 的 `home.spec` / `navigation.spec` / `design.spec` 既有 e2e 断言（首页空态不变）；不为 web 引入 `@aguhot/core` / Prisma 依赖。
- 不重构 `packages/config/src/env.ts`、不重构 1-4 `source-ingest` 写路径（仅按需在 schema 给 `EvidenceRecord` 加一条**只读反向关系**字段 `evidenceLinks`，不改变其写拥有权）；不内联 SQL 绕过 Prisma（迁移 SQL 除外）；不新增第三方依赖（tokenize/union-find 手撸）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 正常聚类生成候选（AC1） | 多条 archived 记录：≥2 条属同一事件（标题 token overlap ≥ 阈值且 published_at 在时间窗内）、1 条属不同事件 | cluster job 产出候选 `HotEvent`：同事件记录归同一候选（经 `hot_event_evidence` 多条链），不同事件自成候选；每候选 `publication_status="candidate"`；候选标题取簇内最新 published_at 记录的标题 | 无错误预期 |
| 候选不泄漏到公开面（AC2） | 候选已写入 `hot_events`（`publication_status="candidate"`） | 公开首页仍渲染"暂无可公开展示的热点"空态；无 `published_*` 表被写入；`hot_events` 不被 web 读取 | 无错误预期（结构隔离） |
| 幂等/去重 | 对同一证据集连续跑两次 cluster job | 第二次不产生新候选、不新建链（未链接 archived 集合已空） | 无错误预期 |
| 增量合并 | 已有候选 C 后，新归档一条与 C 标题签名 overlap ≥ 阈值且在时间窗内的记录 | 该记录并入 C（新增一条链、不新建候选、候选标题不变、签名按簇内记录重算）；不产生重复候选 | 无错误预期 |
| 时间窗分隔 | 两条记录标题高度相似但 published_at 相距 >72h | 不并入同一候选（各自成候选），避免跨日同标题误并 | 无错误预期 |
| 标题长短不一（subset） | 简短标题 A（如"央行降准"）与详尽标题 B（如"央行宣布降准0.5个百分点"，含 A 的全部 token）属同一事件 | 用 overlap-coefficient（非 Jaccard）判定为高相似 → 并入同一候选 | 无错误预期 |
| 空标题归档记录 | archived 记录 title 为 null | tokenize 得空集 → 不与任何记录合并，自成单链候选；候选标题回退为 summary 片段或占位"未命名候选" | 不抛、不丢弃 |
| 无可聚类证据 | 无未链接的 archived 记录 | cluster job no-op（返回 0 new / 0 merged） | 无错误预期 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- MODIFY：新增 `HotEvent`(id/title/cluster_signature/publication_status/trace_id/created_at/updated_at、`@@index([publicationStatus])`、`@@map("hot_events")`) 与 `HotEventEvidence`(id/hot_event_id/evidence_record_id/trace_id/created_at、`@@unique([hotEventId,evidenceRecordId])`、`@@index([evidenceRecordId])`、`@@index([hotEventId])`、`@@map("hot_event_evidence")`)；给 `EvidenceRecord` 加只读反向关系 `evidenceLinks HotEventEvidence[]`（导航元数据，不改写拥有权）
- `packages/core/prisma/migrations/<ts>_add_hot_events/migration.sql`(+`migration_lock.toml` 复用) -- NEW：`prisma migrate dev --name add_hot_events` 生成（两张表 + FK + 唯一约束 + 索引）
- `packages/core/src/modules/event-assembly/types.ts` -- NEW：`PublicationStatus = {Candidate:"candidate"} as const` + union（"published"/"taken_down" 等归 1.6+，此处不枚举）、`ClusterOptions`(similarityThreshold 默认 0.7、timeWindowMs 默认 72h)、`ClusterInput`(聚类输入记录形状：id/title/publishedAt/ingestedAt)
- `packages/core/src/modules/event-assembly/clustering.ts` -- NEW：纯函数 `tokenize(title)`（lowercase；Latin `[a-z0-9.]+` token；CJK 单字 `一-鿿` 减极小停用词集）、`signatureOf(records)`（簇 token 并集 → 排序去重串）、`clusterRecords(inputs, opts)`（overlap-coefficient `|A∩B|/min(|A|,|B|)≥threshold` AND `|ΔpublishedAt|≤timeWindow` 的 union-find，返回组列表）。无 DB、无副作用、可单测
- `packages/core/src/modules/event-assembly/clustering.selfcheck.ts` -- NEW：tsx 自检（无 infra）：合成记录（同事件长短标题对 / 不同事件 / 跨时间窗 / 空标题）→ 断言 `clusterRecords` 分组正确、overlap-coefficient 合并 subset 对、时间窗分隔、空标题自成一组；打印 PASS/FAIL、非零退出 iff 失败
- `packages/core/src/modules/event-assembly/cluster-events.ts` -- NEW：`clusterEvents({prisma, traceId})` DB 服务——查未链接 archived 记录（`where:{status:"archived", evidenceLinks:{none:{}}}`，编译为 NOT EXISTS）→ `clusterRecords` 分组 → 每组按签名 overlap 匹配既有候选（命中则加链+重算签名+不改标题；未命中则建 `HotEvent`(title=簇内最新 publishedAt 记录标题，空则回退)）→ `prisma.hotEventEvidence.create` 建链（`@@unique` 兜底跳过已存在）；返回 `{traceId, newCandidates, mergedInto, linksCreated}`。AD-2 单一写拥有者
- `packages/core/src/modules/event-assembly/index.ts` -- NEW：模块桶导出（`clusterEvents`、`clusterRecords`、`tokenize`、`signatureOf`、`PublicationStatus`、types）
- `packages/core/src/index.ts` -- MODIFY：包桶追加 event-assembly 导出
- `packages/core/package.json` -- MODIFY：加 `verify:cluster-logic`(`tsx src/modules/event-assembly/clustering.selfcheck.ts`)
- `apps/worker/src/queues/event-cluster-queue.ts` -- NEW：`EVENT_CLUSTER_QUEUE_NAME`/`EVENT_CLUSTER_JOB_NAME`="event-cluster"、`getEventClusterQueue()`、`enqueueEventCluster(traceId)`(带 `removeOnComplete:100`/`removeOnFail:500`)、`registerEventClusterWorker()`(Worker job 内动态 `import("@aguhot/core")` 调 `clusterEvents`)
- `apps/worker/src/index.ts` -- MODIFY：`requireEnv` 校验 → `getRedis().ping()` → 同时注册 `registerSourceIngestWorker()` + `registerEventClusterWorker()` → 启动日志 + 优雅关闭（两 worker 都 close）
- `apps/worker/src/verify-cluster.ts` -- NEW：确定性集成验证（镜像 `verify-ingest.ts`）：`resetEnvCache`→`getPrisma`/`getRedis`→清旧测试行→**直接播种 archived `EvidenceRecord`**（同事件长短标题对、不同事件、跨时间窗、空标题各若干，不经 RSS）→入队 `event-cluster`→`waitUntilFinished`→断言：候选数/每候选链数/`publication_status="candidate"`/无 `published_*` 写入/幂等(再跑不增)/增量合并(新加同签名记录并入既有候选、标题不变)/时间窗分隔/空标题自成候选→打印 PASS/FAIL、cleanup、非零退出
- `apps/worker/src/verify-ingest.ts` -- MODIFY：把第 5 条断言从"非 evidence_ 表不存在"重构为"写隔离"——记录 run 前后所有非 `evidence_*`/非 `_prisma_migrations` 表的行数，断言 ingest 不改其行数（因 1-5 迁移会让 `hot_events`/`hot_event_evidence` 表存在，原断言会假阳失败；写隔离是更强且前向兼容的 AD-2 断言）
- `apps/worker/package.json` -- MODIFY：加 `verify:cluster`(`tsx src/verify-cluster.ts`)
- `_bmad-output/implementation-artifacts/deferred-work.md` -- MODIFY：追加 1-5 defer（见 Design Notes 列表）

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- 加 `HotEvent` / `HotEventEvidence` 模型（`@map`/`@@map` snake_case、UUIDv7 id 由 app 赋值、`createdAt`/`updatedAt`、`traceId?`；链接表 `@@unique([hotEventId,evidenceRecordId])` + 两向索引；`EvidenceRecord` 加 `evidenceLinks HotEventEvidence[]` 反向关系）；`HotEvent.publicationStatus` 为 String 列（TS union，无 `@default`——app 赋值 `"candidate"`，与 1-4 status 处理一致） -- AD-2 候选表 + 可追溯链接
- `packages/core` 迁移 -- `pnpm --filter core exec prisma migrate dev --name add_hot_events`（需 `DATABASE_URL` 指向本地 PG、库已建）生成迁移、本地建出两表（含 FK 到 `evidence_records`/`hot_events`、唯一约束、索引） -- schema 落库
- `packages/core/src/modules/event-assembly/clustering.ts` -- 纯 `tokenize`/`signatureOf`/`clusterRecords`（overlap-coefficient + 时间窗 + union-find；阈值/窗口为命名常量，注释标 `ponytail:` 说明 O(N²) 两两比对与粗粒度 CJK 分词的 ceiling 及升级路径） -- 可测的聚类核心（无 DB）
- `packages/core/src/modules/event-assembly/clustering.selfcheck.ts` + `package.json:verify:cluster-logic` -- 合成记录自检：subset 长短标题合并、不同事件不合并、跨时间窗不合并、空标题自成一组 -- 非平凡逻辑留一个可跑检查（解 1-4 "无纯单测" defer 模式），无 infra、可入任意门
- `packages/core/src/modules/event-assembly/cluster-events.ts` -- `clusterEvents({prisma,traceId})`：未链接 archived 查询 → `clusterRecords` → 命中既有候选则加链+重算签名+不改标题，否则建候选（标题回退处理 null）→ 建链（`@@unique` 兜底）→ 返回摘要 -- AC1 候选生成 + 幂等 + 增量合并
- `packages/core/src/modules/event-assembly/{index.ts}` + `src/index.ts` -- 桶导出 `clusterEvents`/`clusterRecords`/`tokenize`/`signatureOf`/`PublicationStatus`/types -- 对外 API
- `apps/worker/src/queues/event-cluster-queue.ts` -- BullMQ `event-cluster` Queue/Worker（镜像 `source-ingest-queue.ts`：lazy Queue、`enqueueEventCluster` 带 job 保留上限、`registerEventClusterWorker` 内动态 import `getPrisma`） -- AD-4 异步聚类
- `apps/worker/src/index.ts` -- 注册两个 worker（source-ingest + event-cluster）+ ping + 优雅关闭 -- worker 运行时入口
- `apps/worker/src/verify-cluster.ts` + `package.json:verify:cluster` -- 直接播种 archived 记录 → 入队 → 断言候选/链/状态/无 published/幂等/增量合并/时间窗/空标题 -- AC1/AC2 surface-anchored 端到端验证
- `apps/worker/src/verify-ingest.ts` -- 第 5 断言改写隔离（run 前后非 evidence_ 表行数不变） -- 解 1-4 评审前瞻不兼容（1-5 加表后原断言假阳）
- `_bmad-output/implementation-artifacts/deferred-work.md` -- 追加 1-5 defer 项 -- 诚实登记

**Acceptance Criteria:**
- Given 本地 PG `aguhot_dev` 可达且 1-4 迁移已应用，When 执行 `pnpm --filter core exec prisma migrate dev --name add_hot_events`，Then 生成迁移并建出 `hot_events`/`hot_event_evidence` 两表（含到 `evidence_records` 的 FK、`@@unique([hot_event_id,evidence_record_id])` 与索引），And `pnpm --filter core exec prisma validate` 通过。
- Given 系统中已存在可追溯的 archived `EvidenceRecord`（含同事件多条 + 不同事件），When worker 处理一次 `event-cluster` job，Then 生成 `publication_status="candidate"` 的候选 `HotEvent`，And 每个候选经 `hot_event_evidence` 与其证据记录保持可追溯关系（链接数 = 簇内记录数），And 简短标题与含其全部 token 的详尽标题被并入同一候选（overlap-coefficient）。
- Given 某候选尚未经过发布决策（`publication_status="candidate"`），When 公共用户访问首页或详情，Then 该候选不出现在公开页（首页仍为"暂无可公开展示的热点"空态、`home.spec` 不回归），And 系统未写入任何 `published_*` 读模型。
- Given 已有一次聚类产物，When 再次运行 `event-cluster` job（无新证据），Then 不产生新候选、不新建链（幂等）；And 当新归档一条与既有候选签名 overlap ≥ 阈值且在时间窗内的记录后再次运行，Then 该记录并入既有候选（链数 +1、候选数不变、标题不变），And 跨时间窗（>72h）的同标题记录不并入同一候选。
- Given `event-cluster` job 运行，When 验证查库，Then 仅 `hot_events`/`hot_event_evidence` 被写入（无 `EvidenceRecord`/`EvidenceSource`/`published_*` 被本 job 改写），And `pnpm --filter worker verify:ingest`（断言重构后）与 `verify:cluster` 均打印 PASS。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 0
- reject: 22
- addressed_findings:
  - `[low]` `[patch]` `PublicationStatus` 类型union 此前含 `"published"/"taken_down"`（实现者在 type 层枚举了未来值，偏离 spec"此处不枚举"，且使 `publicationStatus:"published"` 在本模块内通过类型检查、削弱单写拥有者的类型保证）→ 收窄 union 仅由 const 派生（=`"candidate"`）；DB 列仍为 String、可被 review-workflow(1.6) 写其它值，读取走 Prisma `string` 不受影响。typecheck 5/5 通过。
  - `[low]` `[patch]` 两处 `$queryRawUnsafe` 动态表名插值（`verify-cluster.tableRowCount` + `verify-ingest.nonEvidenceTableRowCounts`）加 lower-snake 标识符校验（SQL 标识符不可参数化，校验是唯一安全形态；当前输入来自 pg_tables 受信，但消除 copy-paste footgun）。
  - `[low]` `[patch]` `verify-cluster` Run-1 候选标题断言由"仅稳定"加强为 `title === 最新 publishedAt 记录标题`（rLong="央行宣布降准0.5个百分点"），钉住 `deriveTitle` 契约；`seedRecord` 返回值随之带上 `title`。
  - `[low]` `[patch]` `clustering.selfcheck` 加两条断言：无 token 含签名分隔符 `|`（round-trip safe）、`signatureOf` 经 split 回环等于 token 并集——分隔符不变量是增量合并的承重点，此前无测试。15/15 通过。
  - `[low]` `[patch]` `cluster-events` 幂等注释补充候选级幂等的串行执行前提（worker 并发=1、单进程）；`@@unique` 只防同候选的重复链，不防跨并发 job 的重复候选——标注 ceiling 与升级路径（行级锁/claim）。
- reject 22（要点）：无事务/部分候选（未链接记录下次 run 重入处理集自愈，1.5 无消费方）；`publishedWindowsOverlap`"不一致"（计算有误：range-gap 是 point-gap 的正确泛化，>72h 断言通过）；NaN publishedAt"跨期合并"（`NaN<=x` 恒 false，损坏日期安全地永不合并）；签名无界增长 / CJK 单字 `降准`≠`降息` 假合并 / 全候选扫描（V1 初步聚类 ceiling，运营复核+1.10 合并纠正，已登记 defer ②）；worker 无 failed-handler/retry、双 SIGINT 重入、吞 close rejection（既有 1-4 worker 硬化 defer，共享运行时）；verify 脚本未入 recurring gate（跨 story defer ③，与 1-1/1-4 同根，piecemeal 接入不一致）；断言 harness 三处重复（premature DRY、pre-gate、ponytail）；`ON DELETE RESTRICT`（安全默认、护 AC1 可追溯、与 1-4 一致）；多候选首匹配歧义（罕见、按 id 实际确定、运营合并纠正）；astral CJK 代理对（V1 CJK ceiling、罕见、已登记）；verify waitUntilFinished 未 catch（dev-tool、fatal 已暴露错误、与 1-4 verify 模式一致）；`deriveTitle slice(0,40)` UTF-16（astral CJK 落在 null-title 兜底摘要切片边界，可忽略）；AC2 web-e2e 未被 diff 脚本链接（spec Verification 已列、step-03 已跑 17/17、diff 未改 home.spec）。
- defer 0：本 pass 无新增 defer——所有 ceiling 类发现已被实现者既有 4 条 deferred-work 条目（② O(N²)/粗 CJK/停用词/无界签名、③ verify 门、① 自动触发、④ 朴素标题）或既有 1-4 worker-硬化 defer 覆盖；不新增重复条目。

## Design Notes

**为何 overlap-coefficient 而非 Jaccard：** 财经标题常出现"简短头条 ⊂ 详尽标题"（"央行降准" vs "央行宣布降准0.5个百分点"）。Jaccard `|A∩B|/|A∪B|` 在 subset 下被分母放大而偏低（上例 ≈0.36），会错误拆分同一事件；overlap-coefficient `|A∩B|/min(|A|,|B|)` 在 subset 下为 1.0，正确合并。阈值 0.7、时间窗 72h 为命名常量（`SIMILARITY_THRESHOLD`/`TIME_WINDOW_MS`），可调；`ponytail:` 注释标明 O(N²) 两两比对与粗粒度 CJK 单字分词（+ 极小停用词集）的 ceiling，升级路径为真实分词 / min-hash / embedding（真实源采购为 epic defer，1.5 不引入）。

**为何不调 LLM / 不生成解释：** epic 的 worker job 划分为 ingest / cluster / explain / publish / digest；"explain"（AI 解释/摘要）是独立 job，属 1.8 详情页范围。1.5 的候选标题由证据记录派生（簇内最新 published_at 记录的标题，非 AI），无需 `LLMAdapter`、无 NFR3 AI 标识义务（派生非生成）。候选 `summary` 留空，由后续 explain job 填充。

**`publication_status` 归属：** 列在 `hot_events`（HotEvent 聚合的一部分，event-assembly 拥有）；1.5 仅赋初值 `"candidate"`，从不置 `"published"`。`"published"`/`"taken_down"` 等转移由 review-workflow（1.6）经应用命令驱动，不在 1.5 枚举。AC2 的"候选不公开"由结构保证（web 只读 `published_*`，本 story 不创建该读模型）+ verify-cluster 断言 + `home.spec` 不回归三重钉死。

**链接表反向关系不是写越界：** 给 `EvidenceRecord` 加 `evidenceLinks HotEventEvidence[]` 是 Prisma 导航元数据（支持 `where:{evidenceLinks:{none:{}}}` 编译为高效 NOT EXISTS 查未链接记录），不是跨模块写。event-assembly 只写自己的 `hot_event_evidence`（FK 引用 `evidence_records.id` 保引用完整），从不写 `evidence_records`（AD-2 不变）。

**幂等与增量合并的实现钥匙：** "未链接 archived 记录"即处理集（链接表即"已处理"标记），重复运行处理集为空 → 天然幂等；`@@unique([hot_event_id,evidence_record_id])` 兜底防重复链。增量合并：新记录成组后，按签名 overlap 匹配既有候选——命中则加链 + 重算签名（簇内全记录 token 并集）+ 不改标题（标题稳定，修订归 1.9 运营动作）；未命中则建候选。标题在创建时取簇内最新 published_at 记录标题（空回退 summary 片段 → "未命名候选"）。

**为何两个 verify 脚本都改/加：** 1-4 评审 triage 已标注 `verify-ingest` 第 5 断言（"非 evidence_ 表不存在"）对 1-5 前瞻不兼容——1-5 迁移加 `hot_events`/`hot_event_evidence` 后该断言假阳。改为"写隔离"（run 前后非 evidence_ 表行数不变）更强且前向兼容。`verify-cluster` 直接播种 archived 记录（不经 RSS）以精确控制聚类断言。

**defer 项（实施时追加至 `deferred-work.md`）：** ① cluster job 不由 ingest 完成自动触发（两 job 独立幂等，管道 chaining/cron 编排属后续）；② 聚类相似度 O(N²) + 粗 CJK 分词 + 静态停用词集 + 无界增长签名（大簇封顶属后续）；③ `verify:cluster`/`verify:cluster-logic` 未入 recurring gate（与 1-1/1-4 verify/e2e 门 defer 同根）；④ 候选标题为朴素派生（非 AI），真正标题/解释生成归 explain job / 1.8。

## Verification

**Commands:**
- `pnpm --filter core exec prisma validate` -- expected: 含新模型的 schema 合法通过
- `pnpm --filter core exec prisma migrate dev --name add_hot_events` -- expected: 生成迁移、本地 `aguhot_dev` 建出 `hot_events`/`hot_event_evidence`（需 `DATABASE_URL` 指向本地 PG）
- `pnpm --filter core verify:cluster-logic` -- expected: 纯聚类自检 PASS（无 infra）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（core 前置 `prisma generate`；含新 `HotEvent`/`HotEventEvidence` 客户端类型）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: Next 构建成功、web 仍 `DATABASE_URL`-free（1-5 不动 web）
- `pnpm --filter web e2e` -- expected: `home.spec`/`navigation.spec`/`design.spec` 全绿、无回归（候选不泄漏公开面）
- `pnpm --filter worker verify:ingest` -- expected: 断言重构后仍 PASS（ingest 写隔离成立）
- `pnpm --filter worker verify:cluster` -- expected: 集成脚本打印 PASS、非零退出 iff 任一断言失败（候选/链/`candidate` 状态/无 published/幂等/增量合并/时间窗/空标题）

**Manual checks (if no CLI):**
- 本地 PG `aguhot_dev` 两张新表结构正确（FK、`@@unique`、索引）；跑两次 verify-cluster 候选数/链数不增（幂等）；新加同签名记录后并入既有候选、标题不变；公开首页仍为空态。

## Auto Run Result

Status: done
Baseline revision: 3622fb8923721fb5e2e1f4c749db24183f17f4f1

### 实施变更摘要
交付 Story 1-5（候选热点聚类与待复核生成）——`event-assembly` 模块（AD-2 下 `HotEvent` 聚类的单一写拥有者）。新增 `hot_events` + `hot_event_evidence` 两表（迁移），把已归档且未链接的 `EvidenceRecord` 按标题 token 的 overlap-coefficient 相似度（非 Jaccard，正确处理简短头条⊂详尽标题）+ 72h 时间窗 union-find 聚成候选 `HotEvent`（`publication_status="candidate"`，绝不写 `published_*`），候选↔证据经链接表保持可追溯；幂等（未链接 archived 为处理集）+ 增量合并（签名 overlap 命中既有候选则加链+重算签名+不改标题）。在 `apps/worker` 落地 BullMQ `event-cluster` 队列与 worker（AD-4，与 source-ingest 共运行时），新增确定性集成验证 `verify-cluster`（直接播种 archived 记录）与纯逻辑自检 `verify:cluster-logic`（无 infra）。不调 LLM、不生成解释、不做发布。顺带重构 1-4 `verify-ingest` 第 5 断言为写隔离（前向兼容 1-5 新增的两张表）。

### 变更文件（一行描述）
- `packages/core/prisma/schema.prisma` — MODIFY：新增 `HotEvent` + `HotEventEvidence`（snake_case `@map`/`@@map`、UUIDv7、`@@unique([hotEventId,evidenceRecordId])`、索引；`EvidenceRecord` 加只读反向关系 `evidenceLinks`）
- `packages/core/prisma/migrations/20260709194341_add_hot_events/migration.sql` — NEW：两表 + FK + 唯一约束 + 3 索引
- `packages/core/src/modules/event-assembly/types.ts` — NEW：`PublicationStatus`（const+union，仅 `"candidate"`）、`ClusterOptions`、`ClusterInput`、`SIMILARITY_THRESHOLD=0.7`、`TIME_WINDOW_MS=72h`
- `packages/core/src/modules/event-assembly/clustering.ts` — NEW：纯 `tokenize`/`signatureOf`/`clusterRecords`/`overlapCoefficient`（overlap-coefficient + 时间窗 + union-find；`ponytail:` 标 O(N²)/粗 CJK ceiling）
- `packages/core/src/modules/event-assembly/clustering.selfcheck.ts` — NEW：tsx 自检 15 断言（含签名 round-trip/分隔符安全），无 infra
- `packages/core/src/modules/event-assembly/cluster-events.ts` — NEW：`clusterEvents({prisma,traceId})` DB 服务（未链接 archived 查询→聚类→命中既有候选合并/否则建候选→建链；AD-2 单一写拥有者）
- `packages/core/src/modules/event-assembly/index.ts` — NEW：模块桶导出
- `packages/core/src/index.ts` — MODIFY：包桶追加 event-assembly 导出
- `packages/core/package.json` — MODIFY：加 `verify:cluster-logic` 脚本
- `apps/worker/src/queues/event-cluster-queue.ts` — NEW：BullMQ `event-cluster` Queue/Worker（镜像 source-ingest 模式）
- `apps/worker/src/index.ts` — MODIFY：注册 source-ingest + event-cluster 两 worker、优雅关闭
- `apps/worker/src/verify-cluster.ts` — NEW：12 断言集成验证（直接播种 archived 记录；候选/链/`candidate` 状态/无 published/写隔离/幂等/增量合并/标题稳定/跨时间窗）
- `apps/worker/src/verify-ingest.ts` — MODIFY：第 5 断言重构为写隔离（非 evidence_ 表行数不变）
- `apps/worker/package.json` — MODIFY：加 `verify:cluster` 脚本
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFY：追加 4 条 1-5 defer（自动触发、O(N²)/粗 CJK/无界签名、verify 门、朴素标题）

### 评审结论分布
- patch：5（全 low，均已应用并复验全绿）——`PublicationStatus` union 收窄仅 `"candidate"`；两处 `$queryRawUnsafe` 动态表名加标识符校验；`verify-cluster` 标题断言钉"最新 publishedAt 记录标题"；selfcheck 加签名 round-trip/分隔符安全 2 断言；`cluster-events` 幂等注释补串行执行前提
- defer：0 新增（ceiling 类发现已被实现者既有 4 条 deferred-work 或 1-4 worker-硬化 defer 覆盖）
- reject：22（V1 初步聚类 ceiling / 自愈或计算有误的担忧 / dev-tool 与风格 nit / 既有 defer 已覆盖）
- intent_gap / bad_spec：0（intent-alignment 评审判定"忠实近乎逐字实现最宽可辩护读法"）

### 是否建议跟进评审
false —— 本 pass 仅 5 处 localized low-consequence 修补（1 处类型收窄无运行时行为变化、2 处 verify 脚本 SQL 标识符校验、2 处 verify/selfcheck 加性断言、1 处注释），无产品代码行为/API/安全/数据面变更，全部复验全绿。

### 验证执行
- `pnpm --filter core exec prisma validate`：含新模型 schema 合法
- `prisma migrate dev --name add_hot_events`：迁移 `20260709194341_add_hot_events` 应用到本地 `aguhot_dev`（两表 + FK + 唯一约束 + 索引）
- `pnpm --filter core verify:cluster-logic`：15/15（含评审新增的签名 round-trip/分隔符 2 断言）
- `pnpm -r typecheck`：5/5 workspace 通过（core 前置 `prisma generate`）
- `pnpm -r lint`：5/5 通过
- `pnpm --filter web build`（无 `DATABASE_URL`）：Next 构建成功、web 仍 `DATABASE_URL`-free
- `pnpm --filter web e2e`：17/17（home/navigation/design 无回归——候选不泄漏公开面，AC2）
- `pnpm --filter worker verify:ingest`：13/13（断言重构后写隔离成立）
- `pnpm --filter worker verify:cluster`：12/12（候选/链/`candidate` 状态/无 published/写隔离/幂等/增量合并/标题=最新 publishedAt/跨时间窗分隔）

### 残留风险 / 残留产物
- 4 条 defer（cluster job 不由 ingest 自动触发、O(N²)/粗 CJK 单字分词/静态停用词/无界签名、`verify:cluster`+`verify:cluster-logic` 未入 recurring gate、候选标题为朴素非 AI 派生）——见 `deferred-work.md`。
- 候选级幂等依赖串行执行（worker 并发=1、单进程）；并发>1 或多进程需行级锁/claim（`cluster-events` 注释已标 ceiling）。
- 实现期两处自纠（signature 分隔符由 NUL 改 `|`——Postgres TEXT 拒 NUL；增量合并补时间窗门——否则与 I/O 矩阵"时间窗分隔"行冲突），均经 verify-cluster 捕获并修复。
- 环境漂移（既有、非本 story 引入）：本地 Node v26.3.0 vs engines 声明 24.18.0；目标 PG 18、本地 brew 16/17（当前 schema 兼容）；`.env.example` 受限目录仍指 `aguhot` 非 `aguhot_dev`（1-4 遗留文档漂移）。
- `sprint-status.yaml` 未由 dev-auto 更新（该文件由 sprint 编排技能维护，非 dev-auto 范围）；本 story 状态以本 spec `status: done` 为准。
