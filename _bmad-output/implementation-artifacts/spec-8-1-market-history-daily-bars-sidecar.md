---
title: '行情历史日线采集 sidecar (8.1)'
type: 'feature'
created: '2026-07-15'
status: 'in-review'
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-15b.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-aguhot-2026-07-09/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-aguhot-2026-07-09/prd.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-4-evidence-source-ingest-and-archive.md'
warnings: ['new-runtime-python', 'external-data-source']
---

<intent-contract>

## Intent

**Problem:** Epic 8 大跌日历(Story 8.2 判定 + 8.3 公开页)依赖**历史行情日线序列**(三大宽基指数 + 申万一级行业),而库里完全没有该数据品类——现有 `MarketReactionSnapshot`(schema.prisma:498)是 per-HotEvent 单时段快照,生产从未产出。本 story 是 Epic 8 的数据地基:把外部行情源翻译成行,写入两张新表,供 Node 侧 8.2 只读消费。

**Approach:** 新增 `apps/market-sidecar`(Python 3.12 + uv),用 AkShare 拉取三大宽基(上证综指 000001/深证成指 399001/创业板指 399006)+ 申万一级行业日线,upsert 进 `index_daily_bars` / `sector_daily_bars`。两张表由 **Node/Prisma 迁移拥有**(schema.prisma 加模型 + 新迁移),Python 只通过 psycopg v3 裸 SQL upsert——**不在 Python 侧引入 Prisma 或 ORM**,保持单一 schema 拥有权(AD-2 一致性)。提供 CLI 入口(`--backfill` 回填近 3 年 / `--incremental` 每日增量),调度接线(挂 BullMQ/cron)出本 story 范围。验证以**确定性 fixture**(canned AkShare 形态数据)为准,照抄 1.4 "RSS 适配器以 fixture 为验证源、不依赖实时外网" 先例;另保留一个 live smoke 命令(非 CI 必跑)。

## Boundaries & Constraints

**Always:**
- 单一 schema 拥有权(AD-2):`index_daily_bars` / `sector_daily_bars` 表由 `packages/core/prisma/schema.prisma` 模型定义 + Prisma 迁移创建;Python 只写不建表。`CrashDay` 不在本 story(归 8.2 的 `crash-review` 模块)。
- 第三运行时受 AD-1 约束:`apps/market-sidecar` 是运行时不是微服务,不拥有任何领域聚合根,不复制领域规则;边界等同 RSSHub 自建采集器(只"把外部源翻译成行")。
- 外部源经端口(AD-7):Python sidecar 是 `MarketDataAdapter` 的实现侧;Node 领域模块不直连 AkShare,只读库。切数据源只改 sidecar,不动 Node。
- 可追溯(NFR-2):每行带 `source="akshare"`、`ingested_at`(UTC);数据缺失明确标记,不编造(NFR-5)。
- 幂等:upsert on unique `(index_code, trade_date)` / `(sector_code, trade_date)`;重跑同日不产生重复、不改写既有行(除非重算)。
- 主键 UUIDv7(Python 侧用 `uuid7` 库或等价生成);时间 UTC ISO8601;表名 snake_case 复数;列 snake_case。
- 错误隔离:单指数/单行业异常 per-item try/catch,记 skip 不中断整批;整批 job 的失败比例若超阈值则非零退出(供调度重试)。
- Python 工具链锁定:uv + `pyproject.toml`,依赖钉版本(akshare / psycopg[binary] / python-dotenv / uuid7);`apps/market-sidecar/` 自带 `.python-version` (3.12)。

**Block If:**
- 本地 Python 3.12 或 uv 不可用 → HALT。(实测:Python 3.12.13、uv 0.6.5 可用。)
- `prisma migrate dev` 创建 `index_daily_bars`/`sector_daily_bars` 失败且非自愈原因 → HALT。(实测本地 PG `localhost:5432` open。)
- live smoke 时 AkShare 后端(push2.eastmoney.com)持续不可达 → 仅 live smoke 跳过并记 warning,不阻塞 fixture 测试与迁移。(实测 reachable。)

**Never:**
- 不在 Python 侧引入 Prisma / SQLAlchemy ORM / Alembic(表结构归 Prisma 单一拥有)。
- 不创建 `CrashDay` / `published_crash_days` / 任何读模型(归 8.2/8.3)。
- 不做调度接线(挂 BullMQ/cron/systemd timer)——只交付可手动运行的 CLI。
- 不抓个股 / 分钟级 / 沪深300/中证500(三大宽基 + 申万一级即可,YAGNI)。
- 不改任何 Node 领域模块的行为;不动既有 17 个迁移。
- 不把 live 外网抓取作为 CI/测试依赖(测试用 fixture)。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|---|---|---|---|
| 回填三大宽基(AC1) | `ingest --backfill --scope index` | 近 3 年交易日 × 3 指数行入 `index_daily_bars`,`pct_change`/`close` 非空,`source=akshare` | per-index try/catch |
| 回填申万一级行业(AC2) | `ingest --backfill --scope sector` | 近 3 年 × ~31 申万一级行业行入 `sector_daily_bars` | per-sector try/catch |
| 增量幂等(AC3) | 同日重复跑 `--incremental` | 第二次不产生新行、不改写既有行(unique upsert) | 无 |
| 缺数据可追溯(AC4) | AkShare 某指数某日缺行 | 该日缺行即缺(不伪造);若整段缺失则记 skip log | 不抛、不中断 |
| fixture 确定性验证(AC5) | canned Akshare 形态 CSV/JSON | 测试解析→upsert→断言行数与字段,无外网 | 无外网依赖 |

</intent-contract>

## Code Map

```
packages/core/prisma/schema.prisma            # +model IndexDailyBar, +model SectorDailyBar (Node 拥有)
packages/core/prisma/migrations/<ts>_add_market_daily_bars/migration.sql
apps/market-sidecar/
  pyproject.toml                              # uv, 钉版本依赖
  .python-version                             # 3.12
  README.md                                   # 运行说明 + live smoke 指引
  src/market_sidecar/
    __init__.py
    __main__.py                               # CLI 入口 (argparse: --backfill/--incremental/--scope/--smoke)
    config.py                                 # 读 root .env 的 DATABASE_URL (python-dotenv)
    db.py                                     # psycopg 连接 + upsert IndexDailyBar/SectorDailyBar 裸 SQL
    akshare_client.py                         # 封装 AkShare 调用 + 列名归一化 + retry;支持 fixture 注入
    ingest.py                                 # 回填/增量编排;per-item 错误隔离;失败比例阈值
    fixtures/
      index_daily_sample.*                    # canned 三大宽基样本
      sector_daily_sample.*                   # canned 申万行业样本
  tests/
    test_parse.py                             # fixture → 解析 → 结构断言(无外网、无 DB)
    test_upsert.py                            # fixture → 临时 DB upsert → 幂等断言(用本地 PG 或事务回滚)
```

## Acceptance Criteria

- **AC1** `python -m market_sidecar ingest --backfill --scope index` 把近 3 年三大宽基日线写入 `index_daily_bars`(含 `pct_change`、`close`、`source="akshare"`、`ingested_at`)。
- **AC2** `--scope sector` 把近 3 年申万一级行业日线写入 `sector_daily_bars`。
- **AC3** 同日重复 `--incremental` 不产生重复行、不改写既有行(unique upsert 验证)。
- **AC4** 缺数据时该行缺(不伪造),整段缺失记 skip log 且不中断。
- **AC5** `uv run pytest` 全绿,基于 fixture,不触外网、不强依赖 live DB(用事务回滚或 test schema)。
- **AC6** Prisma 迁移在本地 PG 成功创建两张表;`@prisma/client` 能查到模型(Node 侧只读可见性确认)。

## Dev Notes

- AkShare 函数名易变,dev 时以**已安装 akshare 版本的实际可用函数**为准并 pin 到版本:宽基指数日线优先 `ak.stock_zh_index_daily(symbol="sh000001")`(或 `index_zh_a_hist`),申万行业优先 `ak.sw_index_daily` 或 `ak.index_hist_sw`——在 `akshare_client.py` 顶部注释记录所用函数 + akshare 版本 + 探测日期。
- 三大宽基代码:上证综指 `sh000001`、深证成指 `sz399001`、创业板指 `sz399006`(AkShare 习惯前缀)。
- 申万一级行业约 31 个,代码以 AkShare 返回为准;`sector_name` 随行写入便于展示层直接用。
- `pct_change` 用 decimal(Python `Decimal`),不用 float——对齐 spine "涨跌和比率以 decimal 存储"。
- live smoke 命令 `ingest --smoke --scope index` 只拉最近 5 个交易日,用于人工/部署后验证,非 CI。
- 调度:出范围。后续可由 Node `apps/worker` 用 BullMQ 定时 spawn child_process 调 `uv run`,或独立 cron——记入 8.x 后续 story。

## File List

### Prisma schema + migration (Node owns the tables)

- `packages/core/prisma/schema.prisma` — **modified**: added `model IndexDailyBar` (table `index_daily_bars`, @@unique([indexCode, tradeDate]), Decimal(8,4) pct_change, Decimal(12,4) close, @db.Date trade_date) + `model SectorDailyBar` (table `sector_daily_bars`, @@unique([sectorCode, tradeDate]), sector_name carried per-row). No FK to hot_events (market-data time series, mirrors daily_digests no-FK invariant).
- `packages/core/prisma/migrations/20260715000001_add_market_daily_bars/migration.sql` — **new**: CREATE TABLE + unique/index DDL for both tables. Applied to local PG via `prisma migrate deploy` (forward-only; no reset). `@prisma/client` regenerated; `packages/core` `tsc --noEmit` clean.

### Python sidecar (`apps/market-sidecar/` — new tree)

- `apps/market-sidecar/pyproject.toml` — uv project, pinned deps: akshare==1.18.64, psycopg[binary]==3.2.9, python-dotenv==1.1.0, uuid7==0.1.0 (+ pytest==8.4.1 dev extra). .python-version 3.12.
- `apps/market-sidecar/.python-version` — 3.12.
- `apps/market-sidecar/README.md` — run/test instructions, verified AkShare function table, scope boundaries.
- `apps/market-sidecar/src/market_sidecar/__init__.py` — package docstring (AD-1 third-runtime boundary, AD-7 MarketDataAdapter impl).
- `apps/market-sidecar/src/market_sidecar/config.py` — reads repo-root `.env` DATABASE_URL; strips Prisma's `?schema=public` param (libpq rejects it).
- `apps/market-sidecar/src/market_sidecar/db.py` — psycopg v3 connection context + idempotent `upsert_index_bars` / `upsert_sector_bars` (ON CONFLICT DO NOTHING). Decimal binding. `IndexBar` / `SectorBar` frozen dataclasses.
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` — AkShare adapter: probe record (version 1.18.64, exact functions) at top; `fetch_index_daily` (stock_zh_index_daily + pct_change derivation), `fetch_sector_daily` (index_hist_sw bare code), `list_sectors` (sw_index_first_info → strips .SI). Fixture-injectable `ak_module` param (no network in tests).
- `apps/market-sidecar/src/market_sidecar/ingest.py` — backfill/incremental/smoke orchestration; per-item try/except isolation (AC4); IngestReport with failure-ratio threshold (0.5) → non-zero exit; UUIDv7 id via uuid_extensions.
- `apps/market-sidecar/src/market_sidecar/__main__.py` — argparse CLI (`ingest --backfill|--incremental|--smoke --scope index|sector|both`).
- `apps/market-sidecar/src/market_sidecar/fixtures/__init__.py` — canned AkShare-shaped DataFrames + expected derived pct_change maps.
- `apps/market-sidecar/tests/test_parse.py` — 7 deterministic parse/pct_change/windowing/isolation tests (fake ak module; no network, no DB).
- `apps/market-sidecar/tests/test_upsert.py` — 3 idempotent-upsert tests (AC3) against dev PG in a throwaway `market_sidecar_test` schema (created+dropped per test; never touches public.*); auto-skip if PG unavailable.

### Story spec

- `_bmad-output/implementation-artifacts/spec-8-1-market-history-daily-bars-sidecar.md` — **modified**: status `ready-for-dev` → `in-review`; this File List section added.

