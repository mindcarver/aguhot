---
title: '广度投影 + runner: published_crash_days.breadth + run-market-breadth (8.7)'
type: 'feature'
created: '2026-07-16'
status: 'done'
baseline_revision: '0afdf6b3c621a93dad76c20bee7c099caf1e0d27'
final_revision: '881da51a8d6889bfc368fcdd758159564023d122'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-16.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-6-market-breadth-daily-sidecar.md'
  - '{project-root}/packages/core/src/modules/publish-orchestrator/publish-service.ts'
  - '{project-root}/apps/worker/src/run-crash-review.ts'
warnings: ['first-node-spawns-python', 'nullable-json-projection']
---

<intent-contract>

## Intent

**Problem:** 8.6 交付了 `market_breadth_daily` 原始广度行,但大跌日读模型 `published_crash_days`(8.3)还不知道它——公开页/详情页(8.8)消费的是 `published_crash_days`,不是原始表。广度数据缺一条从「原始行」到「已发布读模型」的投影链路,也没有任何 runner 把「采集 → 投影」串起来(8.6 的 sidecar 至今只能手动跑)。本 story 补上这条链路:加 `breadth Json?` 列 + 投影 + runner,镜像 8.2/8.3 的「detect → project + runner」范式。

**Approach:** 三步,最小 diff:(1) `PublishedCrashDay` 加 `breadth Json?`(nullable:缺广度→null,页显式空状态);(2) `refreshPublishedCrashDays` 在既有 per-date try 循环里**追加**一次 `market_breadth_daily.findUnique({where:{tradeDate}})` 读,命中→物化 `CrashDayBreadth` 对象,缺/失败→`breadth:null`(inner try/catch,**绝不阻塞** published 行);(3) 新 runner `apps/worker/src/run-market-breadth.ts` 用 `node:child_process.spawnSync` spawn `uv run python -m market_sidecar ingest --incremental --scope breadth`(cwd=`apps/market-sidecar`,继承 stdio,查退出码)→ 调 `refreshPublishedCrashDays` 重投影。**不碰** crash 检测(`crash_days`)、不做页(8.8)、不加新依赖(execa 等)。

## Boundaries & Constraints

**Always:**
- AD-3 单一写:`published_crash_days.breadth` **仅** `refreshPublishedCrashDays`(publish-orchestrator)写;行存在=已公开。runner 只调 refresh,不直写 published 表。
- NFR-5 诚实空/不伪造:`market_breadth_daily` 缺该日行 → `breadth:null`(非空对象);breadth 内 nullable 字段(advancing/declining/flat/totalTurnover/marginBalanceChange/dragonTiger,8.6 已 nullable)的 null 原样透传,**不补零、不补占位**。
- 不阻塞:`breadth` 读取包在**独立 inner try/catch**,失败→`breadth:null`,该 published 行照常 upsert(复用既有外层 per-date try 保护 upsert)。
- 幂等:`upsert` by `tradeDate` PK,重跑不产生重复行。
- 可追溯:投影写 `traceId`(既有);Decimal 字段(`totalTurnover`/`marginBalanceChange`)`.toNumber()` 转 number(对齐 `leadingSectors.pctChange` 既有范式)。
- spawn 零新依赖:用 Node 内置 `node:child_process.spawnSync`;cwd=`apps/market-sidecar`;`stdio:"inherit"`(sidecar 日志透出);`env: process.env`(DATABASE_URL + proxy 变量继承给 Python 子进程)。
- 合规护栏继承 8.3/8.6:refresh 内**不加**任何合规门;门禁是「prod 不跑 runner 直到 §12 Q9/Q10 清」(行不存在→页空态)。律所复核范围已含龙虎榜/涨跌停(8.6 已记 action item)。

**Block If:**
- 本地 Python 3.12 / uv 不可用 → spawn 失败,runner 无法验证 → HALT(实测 8.6 已确认可用)。
- `prisma migrate deploy`(forward-only,因 Epic-7 dev-DB drift 阻 `migrate dev`)加 `breadth` 列失败且非自愈 → HALT。

**Never:**
- 不改 crash 检测路径(`crash_days` / `upsertCrashDays` / `crash-logic`)——8.7 只**富化** `published_crash_days`,不重算 crash。
- 不在 `refreshPublishedCrashDays` 内加合规/状态门(breadth 继承行存在=已公开语义)。
- 不让 breadth 失败阻塞 published 行(不把 breadth 读放进会 skip 行的外层 catch)。
- 不从 runner spawn `--backfill`(runner 走 `--incremental` 拉近窗;历史 backfill 由人直跑 sidecar)。
- 不加 `execa`/任何 spawn 库依赖(用 `node:child_process`)。
- 不做 `/crash-calendar/[date]` 详情页渲染(8.8);8.7 只暴露 `breadth` 进读模型 + 投影,渲染归 8.8。
- 不伪造 breadth:缺源行/缺字段一律 null,绝不拼空对象冒充有数据。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| breadth 命中(AC1) | crash_day 有对应 `market_breadth_daily` 行 | `published_crash_days.breadth` 物化为 `CrashDayBreadth`(counts + turnover/margin `.toNumber()` + dragonTiger passthrough;8.6 nullable 字段 null 原样) | inner try,无异常 |
| breadth 缺行(AC2) | crash_day 无对应 breadth 行(sidecar 未跑该日 / 早于采集) | `breadth:null`,该 published 行照常写(row existence=published) | `findUnique→null`→`null` |
| breadth 读失败(AC2) | `market_breadth_daily` 读/解析抛错 | `breadth:null`,该 published 行照常写(不阻塞) | inner try/catch→`null`,warn log |
| runner 全流程(AC3) | `node --import tsx/esm src/run-market-breadth.ts [--from --to]` | spawn sidecar `--incremental --scope breadth`→等其退出→`refreshPublishedCrashDays`→log `{projected,pruned}` | sidecar 非零→log+`exit(1)` 不 refresh |
| 幂等(AC4) | 同日重跑 refresh | 同 `tradeDate` upsert 不产生重复、breadth 值随源更新 | upsert by PK |

</intent-contract>

## Code Map

```
packages/core/prisma/schema.prisma                                          # PublishedCrashDay +breadth Json? (after leadingSectors)
packages/core/prisma/migrations/20260716000002_add_breadth_to_published_crash_days/migration.sql  # ALTER TABLE ... ADD COLUMN breadth JSONB
packages/core/src/modules/publish-orchestrator/types.ts                     # +CrashDayBreadth interface; PublishedCrashDay +breadth: CrashDayBreadth|null
packages/core/src/modules/publish-orchestrator/publish-service.ts           # refreshPublishedCrashDays: +market_breadth_daily findUnique(inner try→null) +breadth 进 upsert; listPublishedCrashDays: +breadth select+map
apps/worker/src/run-market-breadth.ts                                       # NEW runner: spawnSync sidecar(--incremental --scope breadth) → refreshPublishedCrashDays
```

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- ADD `breadth Json? @map("breadth")` to `PublishedCrashDay`(置 `leadingSectors` 之后) -- 读模型加 nullable 广度列(缺→null,NFR-5)。
- `packages/core/prisma/migrations/20260716000002_add_breadth_to_published_crash_days/migration.sql` -- `ALTER TABLE "published_crash_days" ADD COLUMN "breadth" JSONB;`(nullable) -- forward-only 加列,既有行 breadth 自动 null。
- `packages/core/src/modules/publish-orchestrator/types.ts` -- ADD `CrashDayBreadth` interface(`limitUpCount/limitDownCount/consecutiveBoardMax/brokenBoardCount: number`;`advancingCount/decliningCount/flatCount/totalTurnover/marginBalanceChange: number|null`;`dragonTiger: unknown|null`)+ `PublishedCrashDay` 加 `breadth: CrashDayBreadth | null` -- 投影对象契约 + 读模型类型。
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` -- 在 `refreshPublishedCrashDays` 既有 per-date try 内、upsert 前,ADD inner `try { const b = await prisma.marketBreadthDaily.findUnique({where:{tradeDate: row.tradeDate}}); breadth = b ? toCrashDayBreadth(b) : null } catch { breadth = null }`,并把 `breadth` 加进 upsert 的 `create`/`update`;在 `listPublishedCrashDays` 的 `select` 加 `breadth:true` + 返回 map 加 `breadth` -- 广度投影 + 读路径暴露(供 8.8 消费)。
- `apps/worker/src/run-market-breadth.ts` -- NEW:镜像 `run-crash-review.ts` 头部(`resetEnvCache`/`requireEnv("DATABASE_URL")`/`getPrisma`/`newTraceId`)+ `arg()` 解析 `--from`/`--to`;用 `spawnSync("uv", ["run","python","-m","market_sidecar","ingest","--incremental","--scope","breadth"], { cwd: apps/market-sidecar 绝对路径, stdio:"inherit", env: process.env })`;查 `status!==0` → `console.error`+`process.exit(1)`(不 refresh);成功 → `await refreshPublishedCrashDays({prisma, traceId, fromDay, toDay})` + log;`prisma.$disconnect()` -- 采集→投影编排 runner(首个 Node spawn Python)。
- 单元测试(selfcheck,镜像 `packages/core` 既有 `.selfcheck.ts`/test 约定)-- 把 `toCrashDayBreadth` 抽成**纯导出 helper**(`MarketBreadthDaily row → CrashDayBreadth | null`),加聚焦测试覆盖:Decimal→number(`totalTurnover`/`marginBalanceChange`)、nullable 字段 null 原样保留、`dragonTiger` Json passthrough、输入 null 行→返回 null(缺行语义) -- 钉住 I/O Matrix 的映射边界(AC1/AC2 null 处理),防 Decimal/null 回归。

**Acceptance Criteria:**
- **AC1** Given 某 crash_day 有对应 `market_breadth_daily` 行,when `refreshPublishedCrashDays` 跑,then `published_crash_days.breadth` 物化为 `CrashDayBreadth` 对象(含 counts、`totalTurnover`/`marginBalanceChange` 为 number、`dragonTiger` 透传;8.6 nullable 字段的 null 原样保留,不补零)。
- **AC2** Given crash_day 无对应 breadth 行 **或** breadth 读抛错,when refresh 跑,then 该 published 行的 `breadth=null` **且该行照常被 upsert**(breadth 失败绝不阻塞 published 行;不伪造空对象)。
- **AC3** Given uv/PG 可用,when `node --import tsx/esm apps/worker/src/run-market-breadth.ts`,then 先 spawn sidecar(`--incremental --scope breadth`,cwd=market-sidecar,日志透出)再调 `refreshPublishedCrashDays`,log `{projected,pruned}`;sidecar 非零退出时 runner `exit(1)` 且不调 refresh。
- **AC4** Given 已投影某日,when 同日重跑 refresh,then `published_crash_days` 不产生重复行(`tradeDate` PK upsert),`breadth` 随源行更新。
- **AC5** `pnpm --filter @aguhot/core typecheck` clean(含 `prisma generate`);`pnpm --filter @aguhot/core db:migrate` 受阻于既有 drift 时改用 forward-only `prisma migrate deploy`,`breadth` 列在本地 PG 加成功(既有行 breadth 自动 null)。
- **AC6** `listPublishedCrashDays` 返回项含 `breadth` 字段(命中→对象/缺→null),供 8.8 详情页消费。
- **AC7** `toCrashDayBreadth` 纯 helper 有聚焦单元测试且通过:Decimal 字段转 number、nullable 字段 null 原样保留(不补零)、`dragonTiger` passthrough、null 行→null。

## Spec Change Log

<!-- 空,首轮规划。 -->

## Review Triage Log

### 2026-07-16 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 3: (medium 2, low 1)
- defer: 4: (medium 2, low 2)
- reject: 6 (all low — 见下)
- addressed_findings:
  - `[medium]` `[patch]` P1: `Prisma.JsonNull`→`Prisma.DbNull`(absent breadth 写 SQL NULL,与 8.6 一致;原 JsonNull 写 JSON null,sentinel 用反)。dist 已重建确认。
  - `[medium]` `[patch]` P2: runner `spawnSync` 加 `timeout:30min`+`killSignal`+signal-kill 分支(AkShare 挂起已知 failure mode,否则 runner 永挂)。
  - `[low]` `[patch]` P3: selfcheck 加 AC2 null-row→null 断言(现 11/11)。
  - `[medium]` `[defer]` 关键集成路径(AC2 throw→null / AC3 runner 退出逻辑 / AC4 幂等)无自动测试——repo 无 Node PG-test/prisma-mock harness → 见 deferred-work。
  - `[low-medium]` `[defer]` breadth「缺行」vs「读失败」不可区分 + per-date 警告无 traceId(breadthStatus 判别 / traceId 关联 / systemic 错误 fail-fast)→ 见 deferred-work。
  - `[low]` `[defer]` runner `--from/--to` 不传 sidecar(历史 re-project 静默读既有 breadth)→ log caveat → 见 deferred-work。
  - `[low]` `[defer]` breadth findUnique+upsert 非事务(并发竞态,V1 不可达)→ 见 deferred-work。
  - `[low]` `[reject]` 「bounded refresh clobber populated breadth」:8.6 breadth 行 append-only(ON CONFLICT DO NOTHING,永不删),present 行 re-project 读同一行→同一对象,clobber-to-null 不可达。
  - `[low]` `[reject]` `publishedAt` update 不 bump:8.3 既有语义,非 8.7 引入。
  - `[low]` `[reject]` `ADD COLUMN` 无 `IF NOT EXISTS`:`migrate deploy` 按 `_prisma_migrations` 跟踪,不重跑;dev-drift 已记忆化。
  - `[low]` `[reject]` selfcheck dragonTiger 引用相等断言 / 确定性弱:测试质量,非行为 bug。
  - `[low]` `[reject]` `toCrashDayBreadth` 导出公开面:spec AC7 明示「抽成纯导出 helper」,导出是 spec 授权。
  - `[low]` `[reject]` `dragonTiger: unknown | null` 类型(`|null` 冗余):纯 cosmetic,无行为变化。

## Design Notes

- **breadth 投影=原始行的展示子集,非全字段**:`CrashDayBreadth` 只带展示字段(counts + turnover + margin + dragonTiger),**不带** `id`/`source`/`ingestedAt`/`traceId`(这些是溯源元数据,公开读模型不需要)。Decimal→number 用 `.toNumber()`(镜像 `leadingSectors.pctChange`);`dragonTiger` 是 8.6 的 Json 对象(或 null),原样 `as unknown` 透传,不在投影层重验结构(8.6 已保证形态)。
- **inner try/catch 的位置**:breadth 读必须包在**独立 inner try**(仅 breadth 失败→null),**不能**并入会 `continue` skip 整行的外层 per-date catch——否则一次 breadth 读失败会丢掉整条 published crash-day 行(违反「不阻塞」)。外层 try 仍保护 upsert 本身。
- **spawnSync 而非 execa/async spawn**:runner 是顺序 dev/prod 脚本(非请求路径),`spawnSync` 零新依赖、与 `run-crash-review.ts` 的 await-in-order 风格一致。`stdio:"inherit"` 让 sidecar 的 per-source 失败 log 直接透出(8.6 的 `report.failures`)。cwd 必须=`apps/market-sidecar`(`pyproject.toml` + `.venv` 所在;uv 据此解析环境)。
- **sidecar 退出码语义**:8.6 的 sidecar 仅当失败比例 > `FAILURE_THRESHOLD`(0.5)才非零退出。故 runner「非零→exit(1) 不 refresh」是正确的:多数源失败时刷新只会投影大片 null,不如 fail-fast 让人看到 sidecar 报错。exit 0(多数成功)→ refresh。
- **`--from`/`--to` 只 bound refresh,不传 sidecar**:sidecar 的 `--incremental` 是固定近窗(~7 日),不接受日期参数;runner 的 `--from`/`--to` 仅传给 `refreshPublishedCrashDays` bound 投影范围(投影既有 breadth 行)。历史 backfill breadth 由人直跑 `uv run ... --backfill --scope breadth`,不进 runner。
- **代理/环境**:runner 经 `resetEnvCache()`+`requireEnv("DATABASE_URL")` 加载 repo 根 `.env`;spawn 时 `env: process.env` 使 DATABASE_URL + `HTTP_PROXY`/`HTTPS_PROXY` 透传给 Python 子进程(Python 端 requests/akshare 原生认这些)。Node 侧若需代理出口,`run-pipeline.ts` 用的 `NODE_USE_ENV_PROXY=1` 在调用 runner 时由人设置(本 story 不强制)。
- **不重建 core dist / 重启 next dev**:本 story 改 `packages/core`(schema + service + types),按 [[aguhot-core-dist-and-prisma-rebuild]]:`migrate deploy → prisma generate → 重建 core dist → 重启 next dev`(Prisma client 缓存)。实现 agent 须跑完整序列;`typecheck`(含 `prisma generate`)clean 即客户端已再生。注:`pnpm --filter @aguhot/core db:migrate`(=`migrate dev`)被 Epic-7 dev-DB drift 阻,改用 forward-only `migrate deploy`。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:generate && pnpm --filter @aguhot/core typecheck` -- expected: `tsc --noEmit` clean;`PublishedCrashDay` 含 `breadth`。
- `pnpm --filter @aguhot/core exec prisma migrate deploy --schema packages/core/prisma/schema.prisma` -- expected: `breadth` 列加到 `published_crash_days`(既有行 breadth=null);`migrate status` up to date。(不用 `db:migrate`/`migrate dev`——Epic-7 drift 阻。)
- (端到端,需 live PG + uv)`set -a && . .env && set +a && cd apps/worker && node --import tsx/esm src/run-market-breadth.ts` -- expected: sidecar 拉近窗 breadth 入库 → refresh 投影 → `{projected, pruned}` log;既有 crash_day 的 published 行现在带 `breadth`(或 null)。

**Manual checks (if live PG/uv unavailable):**
- 确认 `refreshPublishedCrashDays` 的 breadth 读在 inner try/catch(breadth 失败→null,不 skip 行);`upsert` create/update 均含 `breadth`。
- 确认 `run-market-breadth.ts` spawn 的 cwd=`apps/market-sidecar`、`stdio:"inherit"`、查退出码非零→`exit(1)`。
- 确认 `listPublishedCrashDays` select 含 `breadth:true` 且返回 map 含 breadth(命中/缺两种)。
