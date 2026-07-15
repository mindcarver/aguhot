---
title: '大跌日判定 + 前瞻收益计算 (8.2)'
type: 'feature'
created: '2026-07-15'
status: 'done'
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-15b.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-market-history-daily-bars-sidecar.md'
  - '{project-root}/packages/core/src/modules/market-reaction/market-reaction-service.ts'
warnings: ['new-table-crash-days', 'reads-8.1-market-bars']
---

<intent-contract>

## Intent

**Problem:** Epic 8 大跌日历公开页(8.3)需要"哪天是大跌日 + 大跌后市场实际表现如何"两条事实。8.1
刚把历史行情日线落进 `index_daily_bars`(三大宽基)/`sector_daily_bars`(申万一级),但库中没有任何
"大跌日"判定结果,也没有任何"大跌后 T+N 实际收益"统计。本 story 是 Epic 8 的判定 + 统计层:把
8.1 的裸日线序列翻译成 `CrashDay` 行(每个大跌交易日一行,含触发指数 + T+1/T+5/T+20 历史实际收益),
供 8.3 公开页只读消费。

**Approach:** 新增 `crash-review` 模块(`packages/core/src/modules/crash-review/`),它是 `CrashDay`
表的**单一写拥有者**(AD-2)。模块只**读** `index_daily_bars`(8.1 拥有),不读 `sector_daily_bars`
(领跌板块展示归 8.3 直接读 sector_daily_bars,本 story 不碰)。判定规则:三大宽基(上证综指
`sh000001` / 深证成指 `sz399001` / 创业板指 `sz399006`)任一日 `pct_change ≤ CRASH_THRESHOLD`
(默认 `-2.0`%,运营可调,模块内配置常量,**不进全局 env**,对齐 `TIMELINE_FOLD_THRESHOLD` 范式)即
记一个 `CrashDay`。前瞻收益按**实际交易日序列**计算:T+N 收益 = `(close[t+N] / close[t] - 1) × 100`,
N∈{1,5,20};序列不足 N 个未来交易日时该字段为 `null`(**不编造**,NFR-5)。每行带 `source="akshare"`
(行情血缘可追溯,NFR-2)、`threshold`(审计所用阈值)、`computedAt`(重算时间)。判定 + 收益计算是纯
函数,无 BullMQ / 无 SDK,可由 selfcheck 与 dev runner 直接调用(同 `generateMarketReaction` /
`saliency` 先例);prod 运行时载体(挂 BullMQ/cron)出本 story 范围。

## Boundaries & Constraints

**Always:**
- 单一写拥有者(AD-2):`crash_days` 表由 `crash-review` 模块拥有 + Prisma 迁移创建。Node 侧任何
  其他模块不得写 `crash_days`;8.3 公开页只读(经 `published_crash_days` 投影,投影归 8.3 /
  publish-orchestrator,**本 story 不建 published_crash_days**)。
- 第三方数据经只读(AD-7):`crash-review` 只**读** `index_daily_bars`;不直接调 AkShare,不引入
  Python sidecar 调用(那是 8.1 的写路径)。
- 阈值不写死:`CRASH_THRESHOLD` 是 `crash-review` 模块内配置常量(导出、可覆盖),不进全局 env
  (对齐 spine Deferred 段 "TIMELINE_FOLD_THRESHOLD 由 event-assembly 模块配置拥有(不进全局 env)"
  范式,及 2026-07-15b 提案 #3 "阈值 CRASH_THRESHOLD 走配置项不写死")。
- 可追溯(NFR-2) + 不编造(NFR-5):每行 `source` / `threshold` / `computedAt` / `traceId`;
  缺未来数据时 T+N 字段显式 `null`,不补 0 不外推。
- 涨跌/比率以 decimal 存储(spine Consistency):`pct_change` / `close` / 前瞻收益均按 decimal 语义
  参与计算(`Prisma.Decimal`),写库以 `@db.Decimal` / Json 内 number 双轨——**前瞻收益表是只读统计投影、
  无跨行查询需求,按 2026-07-15b 提案 #2 存单行 Json 列**(每个指数一份)。
- 幂等可重算:`CrashDay` 按 `tradeDate` unique upsert。重跑同一区间会**更新**既有行(前瞻收益随新
  日线到位而填充/刷新)——这是物化投影语义(同 `published_*`),**不是** append-only 领域事件(区别于
  `market_reaction_snapshots` 的 AD-5 append-only)。
- 主键 UUIDv7(`newTraceId`);时间 UTC;表名 snake_case 复数(`crash_days`);列 snake_case。
- 错误隔离:单指数读取/计算异常 per-item try/catch,记 skip 不中断整批;某交易日三大宽基全缺则该日
  不产 CrashDay(不伪造)。

**Block If:**
- `prisma migrate dev` 创建 `crash_days` 失败且非自愈原因 → HALT。(本地 PG `localhost:5432` open,
  8.1 已验证。)
- `@prisma/client` 重新生成后 `packages/core` `tsc --noEmit` 不绿 → HALT。

**Never:**
- 不建 `published_crash_days`(归 8.3 / publish-orchestrator)。
- 不做领跌板块计算/存储(归 8.3 直接读 `sector_daily_bars`)。
- 不做大跌日 ↔ HotEvent 关联(8.5,deferred v1.2)。
- 不做调度接线(挂 BullMQ/cron)——只交付可手动运行的 dev runner + 纯函数。
- 不抓个股 / 不预测 / 不做抄底建议(前瞻收益是历史实际值统计,措辞护栏归 8.3 展示层)。
- 不在 Node 侧调 AkShare / 不引入 Python(行情写路径归 8.1)。
- 不改 `index_daily_bars` / `sector_daily_bars` schema 或既有 18+ 迁移。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|---|---|---|---|
| 判定大跌日(AC1) | 三大宽基某日 pct_change 均 > 阈值 | 该日不产 CrashDay | 无 |
| 判定大跌日(AC1) | 任一宽基某日 pct_change ≤ -2.0% | 该日产 1 个 CrashDay,`crashCount`∈[1,3],`indices` 含三指数明细 | per-index try/catch |
| 前瞻收益已足(AC2) | crash 日后该指数 ≥20 个交易日 | T+1/T+5/T+20 全为实际值(decimal) | 无 |
| 前瞻收益不足(AC3) | crash 日为最近 5 日,未来不足 20 交易日 | T+1/T+5 可能填,T+20 为 `null` | 不编造 |
| 缺指数数据(AC4) | 某日某指数 index_daily_bars 无行 | 该指数从 `indices` 明细中缺(不伪造 0);若三指数全缺则该日无 CrashDay | skip log,不中断 |
| 幂等重算(AC5) | 同区间重复跑 runner | 按 tradeDate upsert,既有行被刷新(computedAt 更新),不产生重复行、不丢历史判定 | 无 |
| 阈值可调(AC6) | 覆盖 CRASH_THRESHOLD=-3.0 重跑 | 仅更深的下跌日入选;`threshold` 列记录所用值 | 无 |
| 纯函数确定性(AC7) | canned 日线序列 → detectCrashDays/computeForwardReturns | 同输入同输出,无 DB/无外网 | 无 |

</intent-contract>

## Code Map

```
packages/core/prisma/schema.prisma            # +model CrashDay (crash-review 拥有;Json indices;unique tradeDate)
packages/core/prisma/migrations/<ts>_add_crash_days/migration.sql
packages/core/src/modules/crash-review/
  types.ts                                    # CrashDayRecord / IndexCrashDetail / ForwardReturns / 配置常量 CRASH_THRESHOLD
  crash-logic.ts                              # 纯函数: detectCrashDays + computeForwardReturns (无 DB/无外网)
  crash-review-service.ts                     # 编排: 读 index_daily_bars → 调纯函数 → upsert crash_days (per-item 隔离)
  index.ts                                    # 模块 barrel
  crash-logic.selfcheck.ts                    # 确定性 assert 自检 (canned 序列)
packages/core/src/index.ts                    # +re-export crash-review
apps/worker/src/run-crash-review.ts           # dev runner (tsx, root .env, getPrisma) — 镜像 run-digest.ts
packages/core/package.json                    # +verify:crash-logic script
```

## Acceptance Criteria

- **AC1** `detectCrashDays` 对 canned 三大宽基日线序列,仅在任一指数 `pct_change ≤ CRASH_THRESHOLD`
  的交易日产出候选;`crashCount` 正确统计触发指数数(1..3);无大跌日返回空数组。
- **AC2** `computeForwardReturns` 对序列中每个 crash 日,按**实际交易日偏移**算出 T+1/T+5/T+20
  `(close[t+N]/close[t]-1)×100`(decimal 语义);未来足 N 日的字段为实际数值。
- **AC3** 序列不足 N 个未来交易日时,对应 T+N 字段为 `null`(不补 0、不外推)——NFR-5 不编造。
- **AC4** `upsertCrashDays` 服务:某指数该日缺 `index_daily_bars` 行时,该指数不入 `indices` 明细且不
  伪造;三指数全缺的交易日不产 CrashDay;per-item 异常不中断整批。
- **AC5** 按 `tradeDate` 幂等 upsert:同区间重复跑不产重复行、刷新既有行的前瞻收益与 `computedAt`。
- **AC6** `CRASH_THRESHOLD` 为模块导出常量(默认 `-2.0`),可被调用方覆盖;`crash_days.threshold` 列
  记录每次判定所用值(阈值变更可追溯)。
- **AC7** `verify:crash-logic`(tsx 跑 selfcheck)全绿;基于 canned 序列,无外网、不强依赖 live DB。
- **AC8** Prisma 迁移在本地 PG 成功创建 `crash_days`;`@prisma/client` 重生成后 `packages/core`
  `tsc --noEmit` clean。

## Dev Notes

- 大跌定义(2026-07-15b locked):三大宽基**任一**日跌幅 `≤ CRASH_THRESHOLD`(默认 `-2.0`%,运营可调)。
  "跌幅 ≤ -2%" 即 `pct_change ≤ -2.0`(已带负号,直接比较)。
- 三大宽基代码(对齐 8.1 / AkShare 前缀):上证综指 `sh000001`、深证成指 `sz399001`、创业板指 `sz399006`。
  导出 `CRASH_INDEX_CODES` 常量数组。
- T+N 偏移按**该指数自身**的交易日序列(index_daily_bars 该 indexCode 按 tradeDate 升序的行),不是
  日历日。`close[t+N]` = crash 日之后第 N 个交易日的 close。N∈{1,5,20}。
- decimal:`Prisma.Decimal` 有 `.add/.sub/.mul/.div/.minus` 等;`close[t+N].div(close[t]).minus(1).mul(100)`
  得前瞻收益,存 Json 时 `.toNumber()`(展示精度足够;底层 close/pct_change 仍以 Decimal 存于 8.1 表)。
  阈值比较用 `pctChangeDecimal.toNumber() <= CRASH_THRESHOLD` 或 Decimal 比较,二选一保持一致。
- `CrashDay.indices` Json 形状(每个指数一份,缺数据的指数不入数组):
  ```ts
  type IndexCrashDetail = {
    indexCode: string;
    pctChange: number;        // crash 日涨跌幅 % (signed)
    close: number;            // crash 日收盘
    crashed: boolean;         // 是否 ≤ 阈值(便于 8.3 高亮触发指数)
    forwardReturns: { t1: number | null; t5: number | null; t20: number | null };
  };
  ```
- `crashCount` = `indices.filter(i => i.crashed).length`(去重 sanity:`crashCount>=1` 才落行)。
- prod 运行时载体(挂 BullMQ/cron spawn)出范围,记入 8.x 后续;本 story 交付 dev runner
  `run-crash-review.ts`(扫全量 index_daily_bars 区间或 `--from/--to` 参数)。
- 措辞护栏(非预测/非建议)归 8.3 展示层;本 story 只产历史实际收益数值,不带任何 advisory 文案。
- **阈值重调的陈旧行特性(upsert 副作用):** `crash_days` 按 `tradeDate` upsert,正常流程是**固定
  阈值**反复重算以填充 T+N —— 这条路径完全幂等、无陈旧。`--threshold` 是手动 override;**调窄**阈值
  (例 -2.0 → -3.0)后,原先因更宽阈值入选但不再达标的交易日不会被自动删除(留陈旧行)。这是有意的
  YAGNI 选择:产品锁定单一配置阈值、重调是低频 deliberate 操作,自动 prune 属于未要求能力。若运营正式
  改阈值,在全量区间重算后人工对账(或后续 story 加 prune)。`crash_days.threshold` 列让陈旧行可被识别。

## File List

### Prisma schema + migration (crash-review owns the table)

- `packages/core/prisma/schema.prisma` — **modified**: added `model CrashDay` (table `crash_days`,
  @@unique([tradeDate]), Decimal(8,4) threshold, Int crash_count, Json indices, source, computed_at,
  trace_id). Json indices holds per-index IndexCrashDetail; NO FK to index_daily_bars (derived
  projection). Upsert-by-tradeDate semantics (materialized projection, NOT append-only).
- `packages/core/prisma/migrations/20260715000002_add_crash_days/migration.sql` — **new**: CREATE TABLE
  crash_days + unique(index trade_date) + trade_date idx. Applied to local PG via `prisma migrate
  deploy` (forward-only). `@prisma/client` regenerated; `packages/core` `tsc --noEmit` clean.

### crash-review module (`packages/core/src/modules/crash-review/` — new)

- `types.ts` — module config (CRASH_THRESHOLD=-2.0, FORWARD_RETURN_HORIZONS=[1,5,20],
  CRASH_INDEX_CODES=[sh000001,sz399001,sz399006], CRASH_SOURCE="akshare") + read/projection/service
  types. Config is module-local, NOT global env (mirrors TIMELINE_FOLD_THRESHOLD).
- `crash-logic.ts` — pure functions: `detectCrashDays` (union trade days → per-index detail → crash
  day iff ≥1 index ≤ threshold; missing index omitted not faked), `computeForwardReturns` (T+1/T+5/T+20
  over the index's own trading-day series; null when too few future bars, NFR-5), `tradeDayKey`,
  `compareTradeDayKey`. No DB, no network.
- `crash-review-service.ts` — `upsertCrashDays` (read index_daily_bars → detectCrashDays → per-day
  upsert keyed by tradeDate with per-item try/catch isolation AC4; refreshes forward returns +
  bumps computedAt on recompute AC5), `getCrashDay` read helper.
- `crash-logic.selfcheck.ts` — 10 deterministic assertions (AC1/2/3/6/7 + NFR-5 omission + forward-
  return sufficiency + determinism). No DB, no network.
- `index.ts` — module barrel.

### Package wiring

- `packages/core/src/index.ts` — **modified**: re-export crash-review (pure core + service + config +
  types).
- `packages/core/package.json` — **modified**: `verify:crash-logic` script.

### Dev runner

- `apps/worker/src/run-crash-review.ts` — **new**: tsx runner mirroring run-digest.ts; loads root
  `.env`, `--from/--to` (YYYY-MM-DD) range bound, `--threshold` override; idempotent upsert.

### Story spec

- `_bmad-output/implementation-artifacts/spec-8-2-crash-day-detection-and-forward-returns.md` —
  **modified**: status `ready-for-dev` → `in-review`; File List + threshold-retune note added.

## File List

(to be filled during dev)
