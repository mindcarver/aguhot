---
title: '证据源采集与归档 (1.4)'
type: 'feature'
created: '2026-07-10'
status: 'done'
baseline_revision: '99c9651f23098b141f4bcf69bd08a372fe527383'
final_revision: '28e474dfc5e7c1c18bae17d1c2ba10b31a4ace4f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-3-visual-tokens-and-typography-foundation.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 1.1–1.3 只交付了 `apps/web` 公共壳层；worker 侧管道（`apps/worker`、`packages/core`）仍是空 stub，没有 Prisma/PostgreSQL schema、没有 Redis/BullMQ 队列、没有 `source-ingest` 领域模块。候选热点生成（1.5）与发布闸门（1.6）都需要"可追溯、可复核的原始证据"作为输入，但目前系统连一条证据都采集不到。同时 1.1 为绕过 `unrs-resolver` 卡网设了全局 `.npmrc ignore-scripts=true`，会静默跳过本 story 引入的 Prisma postinstall（引擎下载），导致 `@prisma/client` 运行时缺件（见 deferred-work 绑定项）。

**Approach:** 在 `packages/core` 落地 Prisma 7 基座（`schema.prisma` + `prisma.config.ts` + 初始迁移 + 驱动适配器 `@prisma/adapter-pg`），建立 `source-ingest` 模块（`EvidenceSource` 配置 + `EvidenceRecord` 归档 + `SourceAdapter` 端口 + RSS 适配器 + 归一化/去重/隔离的采集服务）；在 `apps/worker` 落地 BullMQ `source-ingest` 队列与 worker 运行时（经 `@aguhot/config` 的 `requireEnv` 解析 `DATABASE_URL`/`REDIS_URL`）。先把 `.npmrc` 的 `ignore-scripts=true` 换成 pnpm 10 原生的 `onlyBuiltDependencies` 白名单（放行 prisma、保留 unrs/resolve 跳过），让 Prisma postinstall 恢复执行。AC2 中的"聚类与候选事件生成"按 epic 显式拆分归 1.5；本 story 只交付去重 + "采集产物与公开读路径结构隔离"。

## Boundaries & Constraints

**Always:**
- 写拥有权单一（AD-2）：`source-ingest` 模块只写 `EvidenceSource`/`EvidenceRecord`；不得触碰 `HotEvent`、`published_*` 读模型或任何其它模块的聚合（HotEvent 归 `event-assembly`，1.5 才引入）。
- 外部源经端口（AD-7）：领域/worker 不得直连第三方抓取 SDK；采集只通过 `SourceAdapter` 端口，具体适配器（RSS 等）在 worker/装配层解析。切源只改适配器，不改采集服务。
- 重活异步（AD-4）：采集/归一化/去重以 BullMQ job 执行；web 请求路径不感知（web 不依赖 `@aguhot/core`，保持 `DATABASE_URL`-free 构建）。
- 公开站只读发布态读模型（AD-3/AD-6）：采集只写 `evidence_*` 表；公开首页读模型在本 story 仍为空，首页维持"暂无可公开展示的热点"空态——候选证据/事件绝无路径泄漏到公开页。
- 主键 UUIDv7；时间存 UTC（`DateTime`，Prisma 默认 UTC）；表名 snake_case 复数；队列名/job 名 kebab-case；每条记录与每个 job 带 `trace_id`。
- 不变性（`erasableSyntaxOnly` + `verbatimModuleSyntax`）：状态/种类用 `const … as const` + union 类型，禁用 TS `enum`；类型导入用 `import type`；相对导入带 `.js` 后缀（沿用 `packages/config` 既有约定）。
- 错误隔离（AC3）：每个源的采集包在独立 try/catch 内；单源异常只在源行记 `last_error`（不产记录），绝不中断其余源的归档；缺必填字段的记录以 `missing_fields` 落库（可追溯，不静默丢弃）。

**Block If:**
- `.npmrc` 改为 `onlyBuiltDependencies` 白名单并 `pnpm install` 后，Prisma 引擎/客户端 `postinstall` 仍失败（沙箱阻断 `prisma` 引擎 CDN 下载）→ HALT（无客户端无法继续）。
- `prisma migrate dev` 针对本地 PostgreSQL 失败且非"dev 库不存在"类可自愈原因（如本地 PG 不可达、版本硬不兼容）→ HALT。本环境实测本地 PG（16/17，`/tmp:5432` accepting）与 Redis（`ping` → PONG）可用；目标栈 PG 18，本地 16/17 对当前 schema 完全兼容。
- 验证期本地 Redis 不可达（`requireEnv("REDIS_URL")` 连接失败）→ HALT，不得跳过集成验证。

**Never:**
- 不实现聚类、候选 `HotEvent` 生成、解释生成、发布（分别属 1.5/1.6 及之后）；不创建 `HotEvent`/`published_*` 表。
- 不引入真实外部财经源采购清单（epic 明确 defer）；RSS 适配器以提交在仓的 fixture XML 为确定性验证源，不依赖实时外网抓取。
- 不重构 `packages/config/src/env.ts`（其 `cached`/`requireEnv` 设计缺陷已登记 deferred-work，修法取决于未来用法，过早修补属过度设计）；本 story 仅以 `loadEnv`/`requireEnv` 消费之，测试用 `resetEnvCache()`。
- 不为 web 引入 `@aguhot/core`/Prisma 依赖（保持 web 构建无 `DATABASE_URL`）；不新增 `enum`/namespace/参数属性；不内联 SQL 绕过 Prisma。
- 不改 1.1 `home.spec`、1.2 `navigation.spec`、1.3 `design.spec` 既有断言（首页空态/导航/设计 token 不回归）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 正常采集归档（AC1） | 一条 enabled `EvidenceSource`(kind=rss, feed_url=fixture)；worker 处理 `source-ingest` job | 每条 RSS item → 一条 `EvidenceRecord`，含 source_id、url、title、summary、published_at、ingested_at、content_hash、status=`archived`、trace_id | 无错误预期 |
| 去重不重复归档 | 对同一源连续跑两次 `source-ingest` job | 第二次不产生新记录（`content_hash` 命中既有）；既有记录不被改写 | 无错误预期 |
| 缺字段可追溯（AC3） | RSS item 缺 `url` 或 `published_at` | 仍落库，status=`missing_fields`，`failure_reason` 记缺哪个字段；不丢弃 | 不抛、不中断 |
| 单源异常隔离（AC3） | 两个 enabled 源，A 的 feed 解析抛错、B 正常 | A：源行记 `last_error`、无记录产出；B：照常归档；job 整体成功（非 fail） | per-source try/catch；job resolve |
| 采集产物与公开读路径隔离（AC2 1.4 部分） | job 完成后查库 + 访问公开首页 | 仅 `evidence_*` 表有写入；无 `published_*`/`HotEvent`；公开首页仍为"暂无热点"空态 | 无错误预期 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` -- NEW：`generator client`(provider=`prisma-client`, output=`../generated`)、`datasource db`(provider=`postgresql`，url 由 `prisma.config.ts` 注入)、`EvidenceSource`、`EvidenceRecord` 模型（UUIDv7 主键、UTC 时间、trace_id、唯一 content_hash）
- `packages/core/prisma.config.ts` -- NEW：`defineConfig`（schema/migrations 路径、`datasource.url = process.env.DATABASE_URL`），CLI 配置入口
- `packages/core/prisma/migrations/<ts>_init/migration.sql` -- NEW：`prisma migrate dev` 生成的初始迁移（两张表 + 索引 + 唯一约束）
- `packages/core/src/shared/ids.ts` -- NEW：无依赖 UUIDv7 生成 + `newTraceId()`（复用 v7 串）
- `packages/core/src/db.ts` -- NEW：Prisma 客户端单例（`@prisma/adapter-pg` 驱动适配器，`connectionString: requireEnv("DATABASE_URL")`），`getPrisma()`
- `packages/core/src/modules/source-ingest/types.ts` -- NEW：`IngestStatus`(`{Archived:"archived", MissingFields:"missing_fields"} as const` + union)、`SourceKind`(`{Rss:"rss"} as const` + union)、`EvidenceItem`、`contentHash()`、归一化助手
- `packages/core/src/modules/source-ingest/adapter.ts` -- NEW：`SourceAdapter` 端口（`fetch(): Promise<EvidenceItem[]>`）—— AD-7 切源边界
- `packages/core/src/modules/source-ingest/rss-adapter.ts` -- NEW：`RssAdapter implements SourceAdapter`（`fast-xml-parser` 解析 RSS XML → `EvidenceItem[]`）
- `packages/core/src/modules/source-ingest/ingest-service.ts` -- NEW：`ingestSources({prisma, traceId, adapterFor})`——遍历 enabled 源、解析适配器、归一化、按 `content_hash` 去重、落库带状态、per-source try/catch 隔离
- `packages/core/src/modules/source-ingest/index.ts` + `packages/core/src/index.ts` -- NEW/MODIFY：模块桶导出 + 包桶导出（`db`、`source-ingest`、`shared/ids`）
- `apps/worker/src/queues/connection.ts` -- NEW：`getRedis()`（ioredis，`requireEnv("REDIS_URL")`）单例
- `apps/worker/src/queues/source-ingest-queue.ts` -- NEW：`sourceIngestQueue`(Queue) + `enqueueSourceIngest()` + `registerSourceIngestWorker()`（Worker job 调 `ingestSources`，按 kind 选适配器：rss→`RssAdapter`）
- `apps/worker/src/index.ts` -- MODIFY：替换 stub——`getRedis()` + 注册 worker + 启动日志（import-free 不再成立，预期接入 Redis/DB）
- `apps/worker/src/verify-ingest.ts` -- NEW：确定性集成验证脚本（`tsx` 直跑）：建/连本地 PG+Redis、播种 fixture 源、进程内启 worker、入队、await job、查库断言（archived/去重/missing_fields/单源隔离/仅 evidence_* 写入）、打印 PASS/FAIL、非零退出
- `packages/core/test/fixtures/sample-feed.xml` -- NEW：提交在仓的 RSS fixture（含正常 item、缺 url item、缺 published_at item）—— 离线确定性源
- `.npmrc` -- MODIFY：删除 `ignore-scripts=true`（保留前 3 行）
- `pnpm-workspace.yaml` -- MODIFY：追加 `onlyBuiltDependencies: ["@prisma/client", "prisma", "@prisma/engines"]`
- `packages/core/package.json` -- MODIFY：加 deps(`@prisma/client`、`@prisma/adapter-pg`、`pg`、`fast-xml-parser`)、devDeps(`prisma`、`@types/pg`、`tsx`)、scripts(`db:generate`、`db:migrate`、`typecheck` 前置 `prisma generate`)
- `apps/worker/package.json` -- MODIFY：加 deps(`@aguhot/core`、`bullmq`、`ioredis`、`fast-xml-parser`)、devDeps(`tsx`、`@types/pg`)、scripts(`dev`、`verify:ingest`)
- `.env.example` -- MODIFY：补 `DATABASE_URL`/`REDIS_URL` 示例值（本地 PG/Redis）

## Tasks & Acceptance

**Execution:**
- `.npmrc` + `pnpm-workspace.yaml` -- 删 `ignore-scripts=true`；在 `pnpm-workspace.yaml` 加 `onlyBuiltDependencies: ["@prisma/client","prisma","@prisma/engines"]`（放行 prisma postinstall，仍跳过 unrs-resolver/resolve）；`pnpm install` 使引擎下载执行 -- 解 deferred-work 绑定项，Prisma 运行时不再缺件
- `packages/core/prisma/schema.prisma` + `prisma.config.ts` -- 落地 `prisma-client` 生成器(output=`../generated`)、postgresql datasource、`EvidenceSource` / `EvidenceRecord` 模型（camelCase 字段一律 `@map("snake_case")`、模型 `@@map("snake_case_plural")`——如 `sourceId@map("source_id")`、表 `evidence_sources`/`evidence_records`，兑现"表 snake_case 复数"约定）；`EvidenceSource`(id、name、kind、feed_url、enabled、last_error?、trace_id?、created_at/updated_at)、`EvidenceRecord`(id、source_id FK、url、title?、summary?、published_at?、ingested_at、content_hash、status、failure_reason?、raw_payload Json、trace_id?、@@unique([content_hash])、@@index([source_id])、@@index([status]))；`prisma.config.ts` 用 `defineConfig` 注入 `DATABASE_URL` -- Prisma 7 基座 + 采集/归档表
- `packages/core` 依赖与脚本 -- `pnpm --filter core add @prisma/client @prisma/adapter-pg pg fast-xml-parser`、`-D prisma @types/pg tsx`；`package.json` 加 `db:generate`(`prisma generate`)、`db:migrate`(`prisma migrate dev`)；`typecheck` 前置 `prisma generate`（保证 generated 客户端存在）；`generated/` 入 `.gitignore` -- 依赖到位 + typecheck 不缺生成物
- `packages/core/src/shared/ids.ts` -- 无依赖 UUIDv7（`Date.now`+`crypto.getRandomValues` 填版本/变体位）+ `newTraceId()` 复用其串 -- 主键/追踪约定
- `packages/core/src/db.ts` -- `getPrisma()` 单例：`new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv("DATABASE_URL") }) })` -- 运行时显式连接串（规避 Prisma 7 env-加载歧义，对齐 `requireEnv` 模式）
- `packages/core/src/modules/source-ingest/types.ts` -- `IngestStatus = {Archived:"archived", MissingFields:"missing_fields"} as const` + 同名 union（源级失败走源行 `last_error`，不产记录，故无 `Failed` 记录态）；`SourceKind = {Rss:"rss"} as const` + union；`EvidenceItem`；`contentHash(item)`=sha256(normalized url+title+published_at) -- 状态/种类无 enum、可去重
- `packages/core/src/modules/source-ingest/adapter.ts` + `rss-adapter.ts` -- `SourceAdapter` 端口(`fetch(): Promise<EvidenceItem[]>`)；`RssAdapter({feedUrl})` 用 `fast-xml-parser` 解析 RSS→`EvidenceItem[]`（title/link/pubDate/description），容错缺字段 -- AD-7 端口 + 真实源格式适配器
- `packages/core/src/modules/source-ingest/ingest-service.ts` -- `ingestSources({prisma, traceId, adapterFor})`：查 enabled 源 → for each：try{ adapter.fetch()→归一化→for each item `contentHash`→`prisma.evidenceRecord.upsert`(where content_hash, create 带 status，skip 既有)/缺字段→status=`missing_fields` }catch(e){ 源行写 `last_error` }；不中断下个源；返回每源摘要 -- AC1 归档 + AC3 隔离/缺字段可追溯
- `packages/core/src/index.ts`(+模块桶) -- 桶导出 `getPrisma`、`ingestSources`、`SourceAdapter`、`RssAdapter`、types、`newTraceId` -- 对外 API
- `apps/worker/src/queues/connection.ts` + `source-ingest-queue.ts` -- `getRedis()`(ioredis `requireEnv("REDIS_URL")`)；`sourceIngestQueue`(Queue，名 `source-ingest`)、`enqueueSourceIngest(traceId)`、`registerSourceIngestWorker()`(Worker job：按源 kind 选适配器 rss→`RssAdapter`，调 `ingestSources`) -- AD-4 异步管道 + AD-7 适配器装配在 worker 层
- `apps/worker/src/index.ts` -- 替换 stub：`requireEnv` 校验 REDIS_URL/DATABASE_URL → `getRedis()` → `registerSourceIngestWorker()` → 启动日志 + 优雅关闭(SIGTERM 断开) -- worker 运行时入口
- `apps/worker` 依赖与脚本 -- `pnpm --filter worker add @aguhot/core@workspace:* bullmq ioredis fast-xml-parser`、`-D tsx @types/pg`；加 `dev`(`tsx watch src/index.ts`)、`verify:ingest`(`tsx src/verify-ingest.ts`) -- 依赖 + 可跑验证
- `packages/core/test/fixtures/sample-feed.xml` -- 提交 RSS fixture：≥2 正常 item + 1 缺 `<link>` + 1 缺 `<pubDate>` -- 离线确定性验证源
- `apps/worker/src/verify-ingest.ts` -- 集成脚本：`resetEnvCache()`→`getPrisma()`→清旧测试行→播种 2 源(A=fixture feed_url=`file://.../sample-feed.xml` 或内联内容路径；B=故意坏 feed_url 触发解析错)→`new IORedis`+`registerSourceIngestWorker`+`enqueueSourceIngest`→`job.waitUntilFinished`→查库断言：A 正常 item=archived、缺字段 item=missing_fields、B 源 last_error 非空且 A 仍归档、再跑一次记录数不增（去重）、仅 `evidence_*` 有写入→打印 PASS/FAIL、cleanup、`process.exit` -- AC1/AC2/AC3 的 surface-anchored 端到端验证
- `.env.example` -- 补 `DATABASE_URL="postgresql://...@localhost:5432/aguhot_dev"`、`REDIS_URL="redis://localhost:6379"` -- 本地连接示例（implementer 注意该文件在受限目录，按需编辑）

**Acceptance Criteria:**
- Given 本地 PG 已建 `aguhot_dev` 库且 `DATABASE_URL`/`REDIS_URL` 可达，When 执行 `pnpm --filter core db:migrate`，Then 生成初始迁移并建出 `evidence_sources`/`evidence_records` 两表（含唯一 `content_hash` 与索引），And `pnpm --filter core exec prisma validate` 通过。
- Given 一条 enabled RSS 源指向 fixture，When worker 处理一次 `source-ingest` job，Then 每个 fixture item 落为一条 `EvidenceRecord`，含来源(source_id)、时间(published_at/ingested_at)、原始链接(url)、采集状态(status)，且 url+title+published_at 相同的 item 不重复归档。
- Given 采集期某源解析抛错或某 item 缺必填字段，When job 运行完成，Then 异常源在 `evidence_sources.last_error` 记失败、缺字段 item 以 `missing_fields` 可追溯落库，And 其余源/记录照常归档（单源异常不阻塞）。
- Given 本 story 仅交付采集/归档，When 验证查库，Then 仅 `evidence_*` 表有写入（无 `published_*`/`HotEvent`），And 公开首页仍渲染"暂无可公开展示的热点"空态（`home.spec` 不回归）。

## Spec Change Log

<!-- 空，直至首次 bad_spec 回路。 -->

## Review Triage Log

### 2026-07-10 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 4
- reject: 12
- addressed_findings:
  - `[low]` `[patch]` `contentHash` 注释与实现矛盾（声称用"RFC 9562 uuidv7 string of the date"且"drops sub-second precision"，实为 `publishedAt.toISOString()` 全精度 ISO 串）→ `packages/core/src/modules/source-ingest/types.ts` 注释改为如实描述（url/title trim+lowercase、publishedAt ISO 全精度），并标注更宽归一化（尾斜杠折叠/亚秒截断）为按需——3 位评审一致指出。
  - `[low]` `[patch]` `uuidv7` 零测试覆盖（手撸 RFC 9562 位运算、系统级 id 生成器，正是静默掩码 bug 藏身处）→ `apps/worker/src/verify-ingest.ts` 新增 4 条自检（版本位=`7`、变体高位 8/9/a/b、嵌入时间戳≈`Date.now()`、1000 样本唯一）；嵌入时间戳 1783624832830 解码正确，反向验证了位提取实现。
  - `[low]` `[patch]` BullMQ job 永不清理（`enqueueSourceIngest` 未设 `removeOnComplete`/`removeOnFail`，每次 ingest/verify 在 Redis 留存 job，无界增长）→ 加 `removeOnComplete:100`/`removeOnFail:500` 保留短尾供运营查看。
- defer（详见 `deferred-work.md`）：verify:ingest/web-e2e 未入 recurring gate + 无纯单测；source-ingest 适配器置于 core（AD-7 纯度）；RssAdapter 仅处理 RSS 2.0 文本 `<link>`；worker 运行时硬化（关闭重入/unhandledRejection/并发与 stalled 配置）。
- reject 12：contentHash 碰撞/提升（defensible append-only 设计）；missingField 不查 title（spec 一致，title 非必填）；`ON DELETE RESTRICT`（安全默认）；tsconfig/typecheck 耦合 `prisma generate`（spec 指定、确定性，直达 tsc 的陈旧为次要 DX）；dedup 断言"弱"（run-2 用 `traceId2≠traceId` 令 trace_id 不变断言成立，已核）；uuidv7 位运算"脆弱"/单调性（理论性、当前实现正确且现已测）；`lastError` 成功无条件清写（V1 小表可忽略、行为正确）；`prisma.config.ts` 用 `process.env`（文档化的 CLI/runtime 拆分，可辩护）；worker job 内 `getPrisma` 动态 import（无害死复杂度）；verify-ingest "only evidence_" 断言前瞻不兼容（自发现、1.5 重写该区域）；`.env.example` 无法编辑（权限受限、既有示例够用，记残留）；`prisma.config` DATABASE_URL 缺失的清晰报错（次要 CLI DX）。



## Design Notes

**AC2 与 1.5 的边界（显式拆分，非 intent gap）：** epic 的 Cross-Story Dependencies 已决定 `1.4 采集/归档 → 1.5 聚类/候选生成`。AC2 文本里的"去重、初步聚类、候选事件生成"是管道叙事；本 story 标题"采集与归档"为约束 scope——交付去重 + "采集产物与公开读路径结构隔离"（ingest 只写 `evidence_*`、公开首页读模型仍空、AD-3/AD-6 结构成立）。聚类逻辑与候选 `HotEvent` 生成归 1.5；候选"不出现在公开页"的完整端到端证明在 1.5 候选生成后复用同一闸门时给出。此拆分由 epic 明确，非歧义。

**Prisma 7 要点（与 5/6 不同，避免 implementer 猜测）：** ① 配置走 `prisma.config.ts`(`defineConfig`，schema/migrations 路径 + `datasource.url` 由 env 注入)，schema 的 `datasource` 只留 `provider`。② 生成器是 `prisma-client`(非 `prisma-client-js`)，`output = "../generated"`。③ 运行时用驱动适配器：`new PrismaClient({ adapter: new PrismaPg({ connectionString: requireEnv("DATABASE_URL") }) })`——连接串显式经 `@aguhot/config`，规避 Prisma 7 的 env-加载歧义，对齐既有 `requireEnv` 模式。④ 生成物在 `packages/core/generated/`（gitignore），`typecheck` 前置 `prisma generate` 保证存在。

**`.npmrc` → `onlyBuiltDependencies`（解 1.1 绑定的 deferred-work）：** 1.1 为绕 `unrs-resolver` 卡网设全局 `ignore-scripts=true`，但会连带跳过 Prisma 引擎下载。pnpm 10 原生方案：删 `ignore-scripts=true`，于 `pnpm-workspace.yaml` 设 `onlyBuiltDependencies: ["@prisma/client","prisma","@prisma/engines"]`——仅放行 prisma 的构建脚本，`unrs-resolver`/`resolve` 仍不在白名单故继续跳过（原绕过不变）。改后 `pnpm install` 触发引擎下载。

**PG 版本：** 目标栈 PG 18；本地实测为 brew PG 16/17（`/tmp:5432` accepting）。当前 schema（UUID、Json、索引、唯一约束）对 16/17/18 完全兼容，开发期用本地 16/17 无碍；生产部署版本属 epic defer。

**`erasableSyntaxOnly`/`verbatimModuleSyntax`：** 状态/种类一律 `const … as const` + union（无 TS `enum`，避免与 Prisma 生成 enum 的潜在摩擦，故 status/kind 用 `String` 列 + TS union 而非 Prisma `enum`）；类型导入 `import type`；相对导入带 `.js`（沿用 `packages/config`）。

**RSS 适配器为何够用 + 离线：** RSS 是合法财经证据源格式；`fast-xml-parser`（单一小依赖）正确解析优于手撸 XML。验证用提交在仓的 fixture XML，不依赖实时外网——既"真采集"又确定性。未来 web/API 源经同一 `SourceAdapter` 端口接入（AD-7），不改 `ingest-service`。

**golden example — `ingest-service` 单源骨架：**
```ts
for (const src of await prisma.evidenceSource.findMany({ where: { enabled: true } })) {
  try {
    const items = await adapterFor(src.kind)(src).fetch();
    for (const it of items) {
      const hash = contentHash(it);
      const missing = !it.url ? "url" : !it.publishedAt ? "published_at" : null;
      await prisma.evidenceRecord.upsert({
        where: { content_hash: hash },
        update: {},                       // ponytail: 命中即跳过，不改写（去重）
        create: { id: newTraceId(), sourceId: src.id, url: it.url, title: it.title,
          summary: it.summary, publishedAt: it.publishedAt, contentHash: hash,
          status: missing ? IngestStatus.MissingFields : IngestStatus.Archived,
          failureReason: missing ? `missing ${missing}` : null, rawPayload: it.raw,
          traceId: traceId },
      });
    }
  } catch (e) {
    await prisma.evidenceSource.update({ where: { id: src.id }, data: { lastError: String(e) } });
  } // 单源异常不中断下个源
}
```

## Verification

**Commands:**
- `pnpm install` -- expected: 安装后 Prisma 引擎下载执行（`onlyBuiltDependencies` 放行）；无 `ignore-scripts` 跳过告警阻断
- `pnpm --filter core exec prisma validate` -- expected: schema 合法通过
- `pnpm --filter core db:migrate` -- expected: 生成初始迁移、本地 `aguhot_dev` 建出两表（需 `DATABASE_URL` 指向本地 PG；implementer 先 `createdb aguhot_dev`）
- `pnpm -r typecheck` -- expected: 全 workspace 通过（core 前置 `prisma generate`；含 `tsconfig.e2e.json`）
- `pnpm -r lint` -- expected: 无错误
- `pnpm --filter web build` -- expected: Next 构建成功、web 仍 `DATABASE_URL`-free（确认 web 未被引入 core/Prisma）
- `pnpm --filter web e2e` -- expected: `home.spec`/`navigation.spec`/`design.spec` 全绿、无回归（首页空态不变）
- `pnpm --filter worker verify:ingest` -- expected: 集成脚本打印 PASS、非零退出 iff 任一断言失败（archived/去重/missing_fields/单源隔离/仅 evidence_* 写入）

**Manual checks (if no CLI):**
- 本地 PG `aguhot_dev` 两表结构正确（`content_hash` 唯一、`source_id`/`status` 索引）；跑两次 verify 记录数不增；坏源 `last_error` 有值且好源已归档；公开首页仍为空态。

## Auto Run Result

Status: done
Final revision: 28e474dfc5e7c1c18bae17d1c2ba10b31a4ace4f

### 实施变更摘要
交付 Story 1-4（证据源采集与归档）——worker 侧管道基座。在 `packages/core` 落地 Prisma 7（`schema.prisma` + `prisma.config.ts` + 初始迁移 + `@prisma/adapter-pg` 驱动适配器），建立 `source-ingest` 模块（`EvidenceSource` 配置 + `EvidenceRecord` 归档 + `SourceAdapter` 端口 + `RssAdapter` + 归一化/去重/隔离采集服务）；在 `apps/worker` 落地 BullMQ `source-ingest` 队列与 worker 运行时（经 `@aguhot/config` `requireEnv` 解析 `DATABASE_URL`/`REDIS_URL`）。先把 `.npmrc` 的 `ignore-scripts=true` 换成 pnpm 10 原生 `onlyBuiltDependencies` 白名单（放行 prisma、保留 unrs/resolve 跳过），解 1.1 绑定的 deferred-work。AC2 的聚类/候选生成按 epic 拆分归 1.5；本 story 交付去重 + 采集产物与公开读路径的结构隔离。

### 变更文件（一行描述）
- `.npmrc` — MODIFY：删 `ignore-scripts=true`，改由 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 白名单管控（解 Prisma postinstall）
- `pnpm-workspace.yaml` — MODIFY：加 `onlyBuiltDependencies: ["@prisma/client","prisma","@prisma/engines"]`
- `.gitignore` — MODIFY：加 `packages/core/generated/`
- `packages/core/prisma/schema.prisma` — NEW：`prisma-client` 生成器 + postgresql datasource + `EvidenceSource`/`EvidenceRecord`（`@map`/`@@map` snake_case、唯一 `content_hash`、索引）
- `packages/core/prisma.config.ts` — NEW：Prisma 7 `defineConfig`（schema/migrations/`datasource.url`）
- `packages/core/prisma/migrations/20260709185438_init/migration.sql`(+`migration_lock.toml`) — NEW：初始迁移
- `packages/core/src/shared/ids.ts` — NEW：无依赖 UUIDv7 + `newTraceId()`
- `packages/core/src/db.ts` — NEW：`getPrisma()` 单例（`@prisma/adapter-pg` + `requireEnv("DATABASE_URL")`）
- `packages/core/src/modules/source-ingest/{types,adapter,rss-adapter,ingest-service,index}.ts` — NEW：状态/种类 union、`SourceAdapter` 端口、`RssAdapter`、`ingestSources`（去重/缺字段可追溯/per-source 隔离）
- `packages/core/src/index.ts` — MODIFY：桶导出
- `packages/core/test/fixtures/sample-feed.xml` — NEW：确定性 RSS fixture（正常/缺 link/缺 pubDate）
- `packages/core/{package.json,tsconfig.json}` — MODIFY：Prisma 7 依赖、`db:generate`/`db:migrate` 脚本、typecheck 前置 generate、`generated/` 入 include
- `apps/worker/src/queues/{connection,source-ingest-queue}.ts` — NEW：`getRedis()` 单例 + BullMQ `source-ingest` Queue/Worker（`enqueueSourceIngest` 带 job 保留上限）
- `apps/worker/src/{index.ts,verify-ingest.ts}` — MODIFY/NEW：worker 运行时入口（含优雅关闭）+ 确定性集成验证脚本（13 断言）
- `apps/worker/package.json` — MODIFY：`@aguhot/core`/bullmq/ioredis/fast-xml-parser 依赖、`dev`/`verify:ingest` 脚本
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFY：登记 1.1 `.npmrc ignore-scripts` 已解决 + 4 条新 defer

### 评审结论分布
- patch：3（全 low，均已应用并复验 13/13 全绿）——`contentHash` 注释与实现矛盾改如实；`uuidv7` 加 4 条自检；BullMQ job 加 `removeOnComplete`/`removeOnFail`
- defer：4（verify 门/纯单测缺失、适配器置于 core 的 AD-7 纯度、RssAdapter 仅 RSS 2.0、worker 运行时硬化）
- reject：12（defensible 设计 / 理论性 / spec 一致 / 次要 DX）
- intent_gap / bad_spec：0

### 是否建议跟进评审
false —— 本评审 pass 的改动仅为 3 处 localized low-consequence 修补（types.ts 注释订正、verify-ingest.ts 加性自检、source-ingest-queue.ts 一行 job 保留选项），无产品代码行为/API/安全/数据面变更，范围窄、全部复验 13/13 + typecheck/lint 全绿。

### 验证执行
- `pnpm install`：Prisma 引擎经 `onlyBuiltDependencies` 白名单下载执行
- `pnpm --filter core exec prisma validate`：schema 合法
- `prisma generate` + `prisma migrate dev --name init`：迁移 `20260709185438_init` 应用到本地 `aguhot_dev`
- `pnpm -r typecheck`：5/5 workspace 通过（core 前置 `prisma generate`；含 `tsconfig.e2e.json`）
- `pnpm -r lint`：5/5 通过
- `pnpm --filter web build`（无 `DATABASE_URL`）：Next 16.2.10 构建成功、7 路由 `○ (Static)`，web 仍 `DATABASE_URL`-free
- `pnpm --filter web e2e`：17/17 通过（home/navigation/design 全无回归）
- `pnpm --filter worker verify:ingest`：13/13 通过（uuidv7 自检×4 + archived/去重/missing_fields/单源隔离/仅 evidence_*）

### 残留风险 / 残留产物
- `.env.example` 因所在目录权限受限无法编辑（既有示例已含 `DATABASE_URL`/`REDIS_URL`，但指向 `aguhot` 库而非 spec 的 `aguhot_dev`，为文档漂移；本地 dev 库为 `postgresql://carver@localhost:5432/aguhot_dev`）。
- Prisma 引擎由 `prisma generate`/CLI 拉取并缓存（非 postinstall 路径）；本环境已确认 CDN 可达。沙箱若阻断引擎 CDN 将命中 spec Block-If。
- 本地 Node v26.3.0 vs engines 声明 24.18.0（pnpm 警告，功能无碍）。
- 目标栈 PG 18，本地为 brew PG 16/17（当前 schema 兼容；生产部署版本属 epic defer）。
- `pnpm-lock.yaml` 仍携带两份 ioredis（5.10.1 worker 用、5.11.1 传递性冗余），无害。
- 4 条 defer 与 worker 运行时硬化、适配器放置、RSS 真实源、验证门——见 `deferred-work.md`。

