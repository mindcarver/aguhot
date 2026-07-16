---
title: '市场广度数据采集 sidecar --scope breadth (8.6)'
type: 'feature'
created: '2026-07-16'
status: 'done'
baseline_revision: '7047f46695c4cf30bb96e0f49d5baed0fb796b00'
final_revision: 'db7d63741cf562543fb161224b662c2937074b98'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-16.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-market-history-daily-bars-sidecar.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
warnings: ['external-data-source', 'new-table-migration', 'non-breaking-scope-extension', 'oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 8 大跌日深度详情页(Story 8.8)需要大跌日「市场广度」事实——涨停/跌停/连板/炸板家数、涨跌家数、两市成交额、龙虎榜(机构 vs 游资)、融资融券——而库里只有 8.1 的三大宽基 + 申万行业日线,完全没有广度数据品类。本 story 是 8.7(投影)/8.8(详情页)的数据地基:把外部 AkShare 广度源翻译成行,写入新表 `market_breadth_daily`,完全镜像 8.1 范式(sidecar + 新表 + 单一 schema 拥有)。

**Approach:** 在既有 `apps/market-sidecar` **非破坏性**扩展 `--scope breadth`(保留已发布 `index|sector|both` 不动),新增 5 类 AkShare 广度 fetch(涨跌停/炸板池、涨跌家数+成交额、龙虎榜、融资融券),按交易日聚合为 `market_breadth_daily` 单行(`trade_date` unique)。新表由 Node/Prisma 模型 + 迁移创建,Python 只 psycopg 裸 SQL upsert(AD-2)。北向资金砍掉(2024-08-19 起交易所停披露实时北向,展示即伪造空数据)。fixture 验证不触外网。**不交付 runner(8.7)、不投影 `published_crash_days.breadth`(8.7)、不做页(8.8)。**

## Boundaries & Constraints

**Always:**
- 单一 schema 拥有(AD-2):`market_breadth_daily` 由 `packages/core/prisma/schema.prisma` 模型 + Prisma 迁移创建;Python 只写不建表,不在 Python 侧引入 ORM。
- 外部源经端口(AD-7):广度 AkShare 调用全部隔离在 sidecar 的 `akshare_client.py`;Node 领域模块不直连 AkShare。
- 诚实空 / 不伪造(NFR-5):`margin_balance_change`(T-1)与 `dragon_tiger` 可空;核心计数源缺失 → 该交易日缺行,不伪造。无龙虎榜上榜日写 `{stockCount:0,...}`(真零),fetch 失败写 `NULL`。
- 可追溯(NFR-2):每行 `source="akshare"`、`ingested_at`(UTC ISO8601)、`trace_id`。
- 幂等:`ON CONFLICT (trade_date) DO NOTHING`,重跑同日不产生重复行、不改写既有行。
- 主键 UUIDv7(复用 `uuid_extensions`);时间 UTC;表名 snake_case 单数(`market_breadth_daily`),列 snake_case(Prisma camelCase + `@map`)。
- per-source 错误隔离:5 类广度源各自 try/except,一类失败记 skip 不中断其他;整批失败比例 > `FAILURE_THRESHOLD`(0.5,复用 8.1 常量)则非零退出(调度重试信号)。
- 钉 akshare 版本 1.18.64(列名漂移防御,对齐 8.1)。

**Block If:**
- 本地 Python 3.12 或 uv 不可用 → HALT。
- `prisma migrate dev` 创建 `market_breadth_daily` 失败且非自愈 → HALT。
- live smoke `--scope breadth --smoke` 时 AkShare 后端(push2.eastmoney.com 等)持续不可达 → 仅 smoke 跳过并记 warning,不阻塞 fixture 测试与迁移。

**Never:**
- 不在 Python 侧引入 Prisma / SQLAlchemy / Alembic(表结构归 Prisma 单一拥有)。
- 不交付 worker runner(`run-market-breadth.ts` 归 8.7);不投影 `published_crash_days.breadth`(8.7);不做 `/crash-calendar/[date]` 详情页(8.8)。
- 不抓北向资金 `stock_hsgt_*`(2024-08-19 后失效)。
- 不抓个股分钟级 / 龙虎榜逐笔明细(单日聚合即可,YAGNI)。
- **不重命名既有 `--scope index|sector|both`**(非破坏性;只新增 `breadth`)。
- 不把 live 外网抓取作为 CI/测试依赖(测试用 fixture)。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 回填广度(AC1) | `ingest --backfill --scope breadth` | 近 N 日每日 1 行入 `market_breadth_daily`,核心计数非空,`source=akshare` | per-source try/except |
| 增量幂等(AC2) | 同日重跑 `--incremental --scope breadth` | 第 2 次不产生新行、不改写既有行 | `ON CONFLICT DO NOTHING` |
| margin 缺(AC3) | 当日 margin(T-1)不可得 | `margin_balance_change=NULL`,其余字段照写,整行不缺 | 该源 skip 不中断 |
| lhb 无上榜(AC3) | 当日无个股触发龙虎榜 | `dragon_tiger={stockCount:0,institutionalNetBuy:0,hotMoneyNetBuy:0,topStocks:[]}` 或 `NULL`(诚实,不伪造) | 不抛、不中断 |
| smoke(AC5,非 CI) | `ingest --smoke --scope breadth` | 近 5 日 T1 数据入库 | 后端不可达 → skip+warn |
| fixture 验证(AC4) | canned breadth frames | 解析 → 单日聚合 → 断言计数/字段,无外网 | 无外网、无 live DB |

</intent-contract>

## Code Map

```
packages/core/prisma/schema.prisma                                                 # +model MarketBreadthDaily (Node 拥有, 插入 SectorDailyBar 之后)
packages/core/prisma/migrations/20260716000001_add_market_breadth_daily/migration.sql  # CREATE TABLE + unique(trade_date) + index(trade_date)
apps/market-sidecar/src/market_sidecar/akshare_client.py                           # +5 breadth fetch wrappers + probe 记录更新 (fixture-injectable)
apps/market-sidecar/src/market_sidecar/db.py                                       # +MarketBreadthRow dataclass + upsert_market_breadth (ON CONFLICT trade_date DO NOTHING)
apps/market-sidecar/src/market_sidecar/ingest.py                                   # +ingest_breadth(mode): per-source 隔离 + 单日聚合 + window 复用
apps/market-sidecar/src/market_sidecar/__main__.py                                 # +"breadth" 进 --scope choices; dispatch; --smoke 不再强制 index
apps/market-sidecar/src/market_sidecar/fixtures/__init__.py                        # +breadth 形态 DataFrames (zt pools/spot/lhb/margin) + expected 计数 map
apps/market-sidecar/tests/test_parse.py                                            # +breadth 解析/聚合/per-source 隔离测试 (FakeAk, 无外网无 DB)
apps/market-sidecar/tests/test_upsert.py                                           # +breadth 幂等 upsert 测试 (throwaway schema)
apps/market-sidecar/README.md                                                      # +breadth scope 段 + verified akshare 函数表 + 砍北向资金说明
```

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` -- ADD `model MarketBreadthDaily`(`@@map("market_breadth_daily")`, `@@unique([tradeDate])`, `@@index([tradeDate])`; `tradeDate @db.Date`, 计数 `Int`, `totalTurnover Decimal @db.Decimal(20,2)`, `marginBalanceChange Decimal? @db.Decimal(20,2)`, `dragonTiger Json?`, `source String`, `ingestedAt`, `traceId String?`, app-assigned `id String @id`) -- Node 拥有新表;nullable margin/dragon_tiger 承载 NFR-5。
- `packages/core/prisma/migrations/20260716000001_add_market_breadth_daily/migration.sql` -- CREATE TABLE + `UNIQUE(trade_date)` + `INDEX(trade_date)` DDL(照抄 8.1 迁移模板) -- forward-only 迁移,不 reset。
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` -- ADD 5 breadth fetch wrappers(`fetch_limit_pool`/`fetch_broken_board`/`fetch_spot_breadth`/`fetch_dragon_tiger`/`fetch_margin`,内部调 `stock_zt_pool_em`/`stock_zt_pool_dtgc_em`/`stock_zt_pool_zbgc_em`/`stock_zh_a_spot_em`/`stock_lhb_*`/`stock_margin_*`),顶部 probe 记录补 akshare 1.18.64 + 探测日期 + 函数清单;保持 `ak_module` 可注入 -- 广度数据采集,fixture 注入无外网。
- `apps/market-sidecar/src/market_sidecar/db.py` -- ADD `MarketBreadthRow` frozen dataclass + `upsert_market_breadth(conn, rows)`(`ON CONFLICT (trade_date) DO NOTHING`,Decimal 绑定) -- 广度持久化,镜像 `upsert_index_bars`。
- `apps/market-sidecar/src/market_sidecar/ingest.py` -- ADD `ingest_breadth(mode, conn)`:复用 `_window()`/`_new_id()`/`_utc_now_iso()`;per-source try/except 聚合为单日 `MarketBreadthRow`;`IngestReport` 失败比例阈值复用 -- 单日聚合编排 + per-source 隔离。
- `apps/market-sidecar/src/market_sidecar/__main__.py` -- 把 `--scope` choices 由 `("index","sector","both")` 改为 `("index","sector","both","breadth")`;dispatch 增加 `scope=="breadth"` → `ingest_breadth`;`--smoke` 不再无条件强制 index(scope==breadth 时走 breadth smoke 通道,`SMOKE_DAYS=5`) -- 非破坏性 CLI 扩展。
- `apps/market-sidecar/src/market_sidecar/fixtures/__init__.py` -- ADD breadth 形态 DataFrames(zt 涨停/跌停/炸板池、spot、lhb、margin 各一份)+ expected 计数/聚合断言 map -- 确定性测试源,镜像 8.1 fixtures 范式。
- `apps/market-sidecar/tests/test_parse.py` -- ADD breadth 测试:`fetch_*` 解析正确性、单日聚合(`limit_up_count`/`advancing_count`/`total_turnover` 等)、per-source 隔离(一源抛错其他照常)、margin/lhb 缺数据路径(FakeAk,无外网无 DB) -- 验证 AC3/AC4。
- `apps/market-sidecar/tests/test_upsert.py` -- ADD `test_breadth_upsert_is_idempotent`:同 `trade_date` 重跑行数不变、原值保留(throwaway `market_sidecar_test` schema) -- 验证 AC2。
- `apps/market-sidecar/README.md` -- ADD breadth scope 运行说明 + verified akshare 函数表 + 「北向资金已砍(2024-08-19 停披露)」说明 -- 运行文档对齐 8.1。

**Acceptance Criteria:**
- **AC1** Given 本地 PG 可用 + akshare 可达,when `python -m market_sidecar ingest --backfill --scope breadth`,then 近 N 日每日 1 行写入 `market_breadth_daily`,核心计数(`limit_up_count`/`limit_down_count`/`advancing_count`/`declining_count`/`total_turnover`)非空,`source="akshare"`,`ingested_at` 非空。
- **AC2** Given 某交易日广度行已写入,when 同日重跑 `--incremental --scope breadth`,then 表行数不变、既有字段值不变(`ON CONFLICT (trade_date) DO NOTHING` 幂等)。
- **AC3** Given 当日 margin(T-1)不可得 或 龙虎榜无上榜,when ingest,then `margin_balance_change=NULL` / `dragon_tiger` 为诚实空(零对象或 NULL),其余字段照写,整行不缺、不伪造(NFR-5)。
- **AC4** Given 某 breadth 源 fetch 抛错(如 lhb),when ingest,then 该源 skip 记 log,其他 4 源照常聚合写入该日行;失败比例未超阈值时退出码 0(per-source 隔离)。
- **AC5** Given canned breadth fixtures,when `uv run pytest`,then 全绿;测试不触外网、不强依赖 live DB(throwaway schema 或无 DB)。
- **AC6** Given 新迁移,when `pnpm --filter @aguhot/core db:migrate && db:generate && typecheck`,then `market_breadth_daily` 在本地 PG 创建成功;`@prisma/client` 含 `MarketBreadthDaily`;`tsc --noEmit` clean。
- **AC7**(非 CI)Given AkShare 后端可达,when `python -m market_sidecar ingest --smoke --scope breadth`,then 近 5 日 T1 广度数据入库;后端不可达 → skip+warn,不阻塞 fixture 测试与迁移。

## Spec Change Log

### 2026-07-16 — Review pass 1 (step-04 四层评审)
- **触发发现**: adversarial / edge-case / verification-gap / intent-alignment 四层一致发现 (a) `stock_zh_a_spot_em()` 仅当日、无 date 参数，backfill 把当日涨跌家数/成交额 stamp 到每个历史 trade_date（造假，违反 NFR-5）；(b) `fetch_margin` 算出 SSE+SZSE 余额合计后丢弃，`margin_balance_change` 结构性恒 NULL（死代码 + 死测试）。
- **修订（intent-contract 之外）**:
  - **AC1 偏离（NFR-5 强制）**: AC1 把 `advancing_count`/`declining_count`/`flat_count`/`total_turnover` 列为「核心计数非空」。但 `stock_zh_a_spot_em` 仅当日可得，历史日无法诚实回填这 4 字段。按 NFR-5「绝不造假」，这 4 列改为 nullable（`schema.prisma` model + migration `20260716000001`），仅窗口末日（`day == end`）填值，其余历史日 NULL。`limit_up_count`/`limit_down_count`/`consecutive_board_max`/`broken_board_count` 仍非空（date-specific 池端点 `stock_zt_pool_em(date)` 可回填）。已用测试钉住「历史日 spot 字段 NULL、不造假」。
  - **`margin_balance_change` 现为真实日间差**: `fetch_margin` 改为返回当日融资余额合计（复用既有 SSE-yuan/SZSE-亿元 单位归一，不再丢弃），`ingest_breadth` 在日期循环内 `change = total[D] - total[D-1]`（窗口首日或前日不可得 → NULL；当日 margin fetch 失败 → 重置 prev，次日不对照脏值）。
  - **`Json(None)` → SQL NULL**: breadth upsert 参数构建改 `None if r.dragon_tiger is None else Json(r.dragon_tiger)`（原 `Json(None)` 出 JSON `null`，非 SQL NULL）。
- **避免的已知坏态**: 历史日不再被注入当日快照（造假）；margin 列不再恒 NULL（死特性）；nullable 字段存 SQL NULL 而非 JSON null。
- **KEEP（再派生须保留）**: spot 仅窗口末日填充 + 历史日 NULL 的 NFR-5 门；margin 日间差在 ingest 循环跨日计算（失败重置 prev）；date-specific 源（zt_pool/lhb/margin_sse/szse）可回填 vs latest-day-only 源（spot）不可回填的区分；dragon_tiger 真零（`{stockCount:0,...}`）vs fetch 失败 NULL 的区分。

## Review Triage Log

### 2026-07-16 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 1, medium 2, low 5)
- defer: 6: (medium 3, low 3)
- reject: 3 (all low — ingested_at 误导注释 / consecutive_board `or 0` 良性 / assert 兜底)
- addressed_findings:
  - `[high]` `[patch]` P1: backfill spot 造假 → spot 单次取、仅窗口末日（`day==end`）填、历史日 4 字段 NULL（schema/migration nullable + 测试钉「不造假」）。
  - `[medium]` `[patch]` P2: `margin_balance_change` 死代码 → `fetch_margin` 返回余额合计、ingest 循环算日间差（diff-implement 路径，失败重置 prev）。
  - `[medium]` `[patch]` P8: PG-skip 验证脆弱 → 加 always-run（无 PG/无网）SQL 契约测试钉 `ON CONFLICT DO NOTHING` + null/dict 适配。
  - `[low]` `[patch]` P3: `Json(None)` → SQL NULL。
  - `[low]` `[patch]` P4: dragon_tiger `top_stocks` 上限 20（按净买排序）。
  - `[low]` `[patch]` P5: `_BoomLhb` 测试 stub 签名对齐 `(start_date, end_date)`。
  - `[low]` `[patch]` P6: 删 ingest 循环死 `bars_written += 1`。
  - `[low]` `[patch]` P7: `dragon_tiger_json = None` 前置初始化（防 BaseException UnboundLocalError）。
  - `[low]` `[patch]` P9: 复核非交易日 skip guard（spot 历史日 NULL 后仍正确 skip 非交易日 / 写交易日，加测试）。
  - `[medium]` `[defer]` 龙虎榜 机构/游资 拆分未实现（institutionalNetBuy 误标 total、hotMoneyNetBuy 恒 0）→ 见 deferred-work。
  - `[medium]` `[defer]` `ON CONFLICT DO NOTHING` 自愈缺口（瞬时失败锁死 NULL/坏值）→ 见 deferred-work。
  - `[medium]` `[defer]` 历史涨跌家数/成交额无免费源（spot 仅当日；8.8 历史 crash day 永显空态）→ 见 deferred-work。
  - `[low]` `[defer]` A 股交易日历（`_iter_dates` 遍历非交易日 + 失败比例分母偏移）→ 见 deferred-work。
  - `[low]` `[defer]` SZSE margin 单位漂移无 sanity 上限 → 见 deferred-work。
  - `[low]` `[defer]` `trace_id` 恒 NULL，失败 log 不回链持久化行 → 见 deferred-work。

## Design Notes

- **非破坏性 scope 扩展(重要决策):** `epic-8-context.md` line 42 写作 `--scope {quotes|breadth}` 是编译期对 scope 命名的过度解读;权威的 `sprint-change-proposal-2026-07-16.md` 通篇只说 `--scope breadth` 且明确要求「镜像 8.1」。重命名已发布的 8.1 CLI(`index|sector|both` → `quotes`)是**未要求的破坏性变更**(会动到已合并的 8.1 代码、README、测试)。故本 story:**只新增 `breadth` choice,保留 `index|sector|both` 原义不动**;`both` 仍 = index+sector(不含 breadth,breadth 为独立 opt-in scope)。
- **单日聚合 vs 逐项循环:** 8.1 是 per-index / per-sector 逐项循环写 N 行;breadth 是 per-`trade_date` 把 5 源聚合为**单行**。故 8.1 的 per-item 错误隔离语义在 breadth 映射为 **per-source 隔离**(每类 akshare 调用独立 try/except,一类失败不污染其他源的计数)。
- **`dragon_tiger` 可空(NFR-5 > 表格草图):** 提案 §4 表格把 `dragon_tiger JSON` 列为非空,但同节 AC 文本「缺数据该行缺字段不伪造(NFR-5)」覆盖表格草图。故 `margin_balance_change` 与 `dragon_tiger` **均为 nullable**:真·无上榜日写 `{stockCount:0,institutionalNetBuy:0,hotMoneyNetBuy:0,topStocks:[]}`(诚实零),fetch 失败写 `NULL`。
- **`dragon_tiger` Json 结构(黄金示例):**
  `{ "stockCount": <int>, "institutionalNetBuy": <decimal>, "hotMoneyNetBuy": <decimal>, "topStocks": [ { "code": "<6位>", "name": "<名称>", "netBuy": <decimal>, "reason": "<上榜原因>" } ] }`
- **列精度:** `total_turnover` / `margin_balance_change` 用 `Decimal(20,2)`(对齐提案;两市成交额可达万亿级);计数列用 `Int`。
- **`--smoke` + breadth 交互:** 既有 `--smoke` 无条件强制 index-only;本 story 改为 `scope==breadth` 时走 breadth smoke 通道(`SMOKE_DAYS=5`,拉近 5 日 T1 数据),`scope` 为 index/sector/both 时行为不变。
- **不重建 core dist / 不重启 next dev 的判断:** 本 story 改 `packages/core/prisma/schema.prisma`(加模型)+ 迁移。按 `aguhot-core-dist-and-prisma-rebuild` 记忆:`db:migrate → db:generate → 重建 core dist → 重启 next dev`(Prisma client 缓存)。实现 agent 须执行完整序列;`typecheck`(含 `prisma generate`)clean 即为客户端已再生。

## Verification

**Commands:**
- `pnpm --filter @aguhot/core db:migrate` -- expected: `market_breadth_daily` 在本地 PG 创建,无报错(forward-only)。
- `pnpm --filter @aguhot/core db:generate && pnpm --filter @aguhot/core typecheck` -- expected: `tsc --noEmit` clean;`@prisma/client` 导出 `MarketBreadthDaily`。
- `cd apps/market-sidecar && uv sync --extra dev && uv run pytest` -- expected: 全绿;无外网调用(live akshare 不被测试触达)。
- (非 CI,可选)`uv run python -m market_sidecar ingest --smoke --scope breadth` -- expected: 近 5 日 breadth 行入库,或后端不可达时 skip+warn。

**Manual checks (if live PG/akshare unavailable):**
- 确认 `market_breadth_daily` 迁移 SQL 含 `UNIQUE(trade_date)` 与 `INDEX(trade_date)`,且 `margin_balance_change` / `dragon_tiger` 列可空。
- 确认 `__main__.py` 的 `--scope` choices 含 `breadth` 且 `index|sector|both` 行为不变(既有 8.1 测试仍绿)。
