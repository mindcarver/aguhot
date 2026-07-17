---
title: '历史两市成交额改由指数日线派生 (breadth.total_turnover)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '69b3e57f51e22a06a00c5220b00c32d95ec3ed6c'
context:
  - '{project-root}/apps/market-sidecar/src/market_sidecar/akshare_client.py'
  - '{project-root}/apps/market-sidecar/src/market_sidecar/ingest.py'
  - '{project-root}/apps/market-sidecar/src/market_sidecar/db.py'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-6-market-breadth-daily-sidecar.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-7-crash-breadth-projection-and-runner.md'
warnings: []
---

<frozen-after-approval>

## Intent

**Problem:** `market_breadth_daily.total_turnover` 当前由 `stock_zh_a_spot_em` 派生（全 A spot 成交额求和），但 spot 接口**只返回最新交易日**，导致每个历史大跌日的 `total_turnover` 恒为 NULL，`/crash-calendar/[date]` 页「两市成交额」段恒为「—」。

**Approach:** 在 sidecar（`apps/market-sidecar`，本就拥有 `market_breadth_daily` 写权）层，把 `total_turnover` 改由 `stock_zh_index_daily_em` 的指数日线成交额派生：`上证综指 sh000001`（覆盖全沪市）+ `深证综指 sz399107`（覆盖全深市）的当日成交额之和 = 两市全市场成交额，**有完整历史**。ingest 内每个指数**只取一次**（窗口化），按日期建 `dict[date,Decimal]` 映射，逐日查表写进 `total_turnover`。`advancing/declining/flat` 三计数**仍走 spot**（历史日仍可空，NFR-5）——本任务只改 `total_turnover` 一个字段。

## Boundaries & Constraints

**Always:**
- AD-1/AD-7：新外部源（`stock_zh_index_daily_em`）隔离在 `akshare_client.py`（唯一 import akshare 处），ingest 层只见稳定形状。
- AD-2：sidecar 只写 `market_breadth_daily`；**不读/不写 `index_daily_bars`**（派生在 breadth ingest 内现取，不污染 8.1 的表）。
- NFR-5 诚实空：某日成交额取不到（指数日线缺该日行 / fetch 失败）→ `total_turnover=None`，**不补零、不拿 spot 兜底冒充**。
- per-source 隔离（镜像 8.6 AC4）：`fetch_index_amounts` 包在独立 try/except，失败→空 dict + log，**绝不阻塞**当日 breadth 行（其余字段照常）。
- fetch-once：`stock_zh_index_daily_em` 每个指数**每轮 ingest 只调用一次**（窗口化，建 date→amount 映射），绝不逐日重复拉全历史（镜像 `latest_spot` 范式）。
- `sz399107` **不进** `BROAD_INDICES`（8.1/8.2 crash 检测的三大宽基集）——它仅供成交额派生，避免改变 crash 判定结果。

**Block If:**
- `stock_zh_index_daily_em` 在 pinned akshare(1.18.64) 下不返回「成交额」列（列名漂移）→ HALT（实现前用 fixture 钉死列名；若实测列名不符，按 8.6 先例在 `_parse` 层归一化）。

**Never:**
- 不给 `index_daily_bars` 加 `amount` 列（不扩表、不迁移、不 backfill 8.1）——派生在 breadth ingest 内现取，避免触碰 crash 检测表（比用户初选的「扩表」方案范围更小、零波及，精度相同）。
- 不改 `packages/core`（`toCrashDayBreadth` 已 `.toNumber()` 透传 `total_turnover`）、不改 web（8.8 页已按亿格式化）、不改 `db.py` 的 `MarketBreadthRow`/upsert（`total_turnover Decimal|None` 列已存在）。
- 不动 `advancing/declining/flat`（仍 spot 当日派生，历史日 NULL）。
- 不把 `spot.total_turnover` 作兜底写回（total_turnover 统一走 index 源；`SpotBreadth.total_turnover` 字段保留但不再写进行）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 历史交易日命中(AC1) | breadth ingest 处理某历史日 D，sh000001+sz399107 该日均有成交额行 | `total_turnover = sh.amount + sz.amount`（Decimal，元） | 无 |
| 最新交易日(AC1) | D == end（最新日），同上 | 同样用 index 成交额之和（与历史日同源，口径一致；不再用 spot 的 turnover） | 无 |
| 某指数缺该日行(AC2) | sh 或 sz 之一在 D 无成交额行 | `total_turnover=None`（两市口径下缺一不可，不补半值） | 映射缺该日→None |
| 指数 fetch 整体失败(AC2) | `fetch_index_amounts` 抛错 | 该轮 ingest `turnover_by_day={}`，**所有日** `total_turnover=None`，其余 breadth 字段照常、行照写 | 独立 try/except→空 dict+log，不阻塞 |
| 非交易日(既有) | 三池皆空 | 既有「skip 非交易日」逻辑不变；total_turnover 不参与该判定 | 既有 |

</frozen-after-approval>

## Code Map

- `apps/market-sidecar/src/market_sidecar/akshare_client.py` — 加 `MARKET_TURNOVER_INDICES`、`fetch_index_amounts(start,end,ak_module)`、`AkModule.stock_zh_index_daily_em`；更新顶部 probe 记录。
- `apps/market-sidecar/src/market_sidecar/ingest.py` — `ingest_breadth` fetch-once 取 turnover 映射；`_aggregate_breadth_day` 改用映射查表写 `total_turnover`。
- `apps/market-sidecar/tests/` — breadth ingest fixture 加 `stock_zh_index_daily_em` canned 帧；钉 AC1/AC2。

## Tasks & Acceptance

**Execution:**
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` -- ADD `MARKET_TURNOVER_INDICES: tuple[str,...] = ("sh000001","sz399107")`（旁注：沪市综指覆盖全 SH、深证综指覆盖全 SZ → 两市全市场）；ADD `AkModule.stock_zh_index_daily_em(self, symbol, start_date, end_date)`；ADD `fetch_index_amounts(*, start: date, end: date, ak_module=None) -> dict[date, Decimal]`：对每个指数调 `stock_zh_index_daily_em(symbol, start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"))`，解析「成交额」列（Decimal，按 8.6 `_parse` 先例容错列名），按日期累加两指数之和入 dict；任一指数 fetch 抛错→该指数视为空贡献（不致整个函数失败，但调用方仍以整体 try/atch 兜底）；更新顶部 probe 记录注明 `stock_zh_index_daily_em` 列含「成交额」-- 暴露两市成交额的历史化派生入口，隔离 akshare。
- `apps/market-sidecar/src/market_sidecar/ingest.py` -- 在 `ingest_breadth` 内（`latest_spot` 旁）ADD `turnover_by_day: dict[date,Decimal] = {}` 的 fetch-once 块（独立 try/except，失败→空 dict + `report.failures.append("index_amounts ...")` + log，**不阻塞**）；把 `turnover_by_day` 透传进 `_aggregate_breadth_day`；在 `_aggregate_breadth_day` 把 `total_turnover=spot.total_turnover if spot is not None else None` 改为 `total_turnover=turnover_by_day.get(day)`（去掉对 spot 的依赖）-- total_turnover 改由指数成交额派生（全日期可得）。
- `apps/market-sidecar/tests/` -- 在 breadth ingest 浄件里 ADD `stock_zh_index_daily_em` 的 canned DataFrame（sh000001 + sz399107，含「成交额」列，覆盖窗口内交易日 + 缺某日场景）；新增/扩展断言：AC1 历史日 `total_turnover == sh.amount+sz.amount`；AC2 缺某指数该日 → None；fetch 抛错 → 全 None 且该日其余字段照常、行仍写；既有 spot 桩保留供 advancing/declining/flat -- 钉死 I/O Matrix 边界，防回归。

**Acceptance Criteria:**
- **AC1** Given breadth ingest 处理某交易日 D（含历史日与最新日），sh000001 与 sz399107 的指数日线均有 D 的成交额行，when 写 `market_breadth_daily`，then `total_turnover = sh.amount + sz.amount`（元，Decimal→列）；投影到 `published_crash_days.breadth.totalTurnover` 后，`/crash-calendar/[date]` 页「两市成交额」段显示该日真实成交额（亿元），而非「—」。
- **AC2** Given sh/sz 任一在 D 缺成交额行，**或** `fetch_index_amounts` 整体抛错，when 写该日行，then `total_turnover=None` 且该 breadth 行**照常写**（limit_up/down/连板/炸板/龙虎榜/margin 等其余字段不受影响）。
- **AC3** `cd apps/market-sidecar && uv run pytest` 全绿（含新增 index-amount fixture，不触外网）；既有 breadth 用例不回归。
- **AC4** 端到端（需 live PG + 可用代理）：`run-market-breadth.ts` 后 `curl /crash-calendar/2026-07-13` 的「两市成交额」段为真实数字（非「—」）；`advancing/declining/flat` 仍维持历史日「—」（本任务不改）。

## Spec Change Log

<!-- 空，首轮规划（review patches 为代码/测试/注释修正，未改 frozen intent）。 -->

## Review Triage Log

### 2026-07-17 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 5: (low 5)
- defer: 1: (low 1)
- reject: ~20 (low — 见下)
- addressed_findings:
  - `[low]` `[patch]` P1: `_index_amount_map` 的 `date_col` 由 `or "日期"` 改为 None 守卫——双列皆缺时返回 `{}`（守「never raises」契约），不再冒 `KeyError` 经外层 try/except 把所有日 turnover 置空。
  - `[low]` `[patch]` P2: `fetch_index_amounts` 改为消费 `MARKET_TURNOVER_INDICES`（循环 + 交集求和），常量不再 dead，单一真相源（消除「常量与字面量各一份」的漂移风险）。
  - `[low]` `[patch]` P3: 加强 `test_fetch_index_amounts_empty_or_missing_column_returns_empty`——除 empty frame 外，新增「有行无 成交额 列」「有行无 日期 列」两路断言，钉死 P1 的列漂移守卫。
  - `[low]` `[patch]` P4: 「no fabrication 历史日」测试新增正向断言——有指数数据的历史日（07-13/07-10）`total_turnover` = 指数和、指数帧外的历史日（07-09）= None，正面验证 headline outcome（此前只「不伪造」，未「证正确填充」）。
  - `[low]` `[patch]` P5: `db.py` 的 `MarketBreadthRow` docstring + 字段注释更正——`total_turnover` 不再是 spot 派生/历史日 None，改为 index-em 派生（历史日可得）；原注释与行为正好相反，会误导后续维护者回退代码。
- deferred（见 deferred-work.md，本 pass 新增 1 条）:
  - `[low]` index_amounts 静默全 None 的可观测性：单指数列名漂移 / `stock_zh_index_daily_em` 被 akshare 改名时，`fetch_index_amounts` 返回空 dict 且**无 failure log**（仅异常路径有 log），与「真无数据」不可区分；且新依赖 `_em` 函数未进 sidecar 的 probe 验证纪律（verify-index 脚本）。NFR-5 空结果是正确的，仅观测性欠缺。
- rejected（silently dropped，择要）:
  - `SpotBreadth.total_turnover` 成 dead computation：spec Design Notes 明示「保留字段、缩小 diff、未来再清理」，且 `test_fetch_spot_breadth` 仍验证 spot 解析正确——非本任务引入的可疑死码。
  - 顺序 fetch / 无并发重试 / backfill 内存：realistic 路径是 `--incremental`（~7 日，极小）；backfill 罕见且手动；akshare 自带 `request_with_retry`；失败已隔离。过度设计。
  - 「no half-sum 是延迟地雷」：即 spec 明选的 NFR-5 不补半值；替代是伪造。
  - `iterrows` 慢：与文件既有 idiom 一致（`_parse_index_frame`/`fetch_spot_breadth`/`_sum_margin_balance` 均 iterrows）；realistic 体量 ms 级；不单独换 idiom。
  - EXPECTED_BREADTH 死 21e9 vs 活 890e9「42× gap」：两者是不同 fixture（spot 是 6 只假股、index 是真实量级），均 yuan，非单位错；死键保留以维持 spot 测试有效。
  - 8.7 selfcheck 历史 fixture `totalTurnover:null` stale：8.7 纯投影单测，null 仍是合法投影输入；staleness 属 cosmetic 且非本变更引入。
  - 「部分重叠日期集 / SH-missing 不对称」未测：字典推导式 `{d:... if d in sz}`（现已改交集）对两向对称，中段缺失亦由成员判定覆盖。
  - ingest 注释「mirrors spot」blast radius 不同：注释描述的是隔离范式（成立）；blast radius 差异非误导。
  - 日期 NaT / 非 ISO 串 / df 无 len / start>end / end 非交易日：endpoint 不产此类形态，或被外层 try/except 兜底，或属既有逻辑非本变更引入。
  - 持久化/页面 handoff 未测（monkeypatch upsert）：repo 8.6 breadth 测试一致惯例；db.py/web 未改（Never 约束）；AC4 端到端已尝试但被代理/eastmoney 限流阻断。

## Design Notes

- **为何不扩 `index_daily_bars`（偏离用户初选「扩表」措辞）**：用户目标是「最准的两市成交额 + 有历史」。扩 8.1 表需：加 `amount` 列（迁移）+ 改 8.1 adapter 采集（且现用 `stock_zh_index_daily` 不返回成交额，还得换源）+ 加 sz399107 进 8.1 + backfill + 重建 core dist + 重启 dev——范围大且波及 crash 检测表。**派生在 breadth ingest 内现取**达到完全相同的精度（沪市综指+深证综指=两市全市场），却：零迁移、零 core 改动、零 web 改动、零 8.1 波及、`sz399107` 不进 crash 判定集。精度同、范围最小（ponytail：不为投机性复用扩表）。
- **成交额口径**：`上证综指 sh000001` 成交额 ≈ 沪市全部 A 股成交额（综指覆盖全 SH）；`深证综指 sz399107` 成交额 ≈ 深市全部成交额（综指覆盖全 SZ）。二者之和即「沪深两市成交额」，与 spot 全 A 求和同义、且有完整历史。B 股占比可忽略。
- **fetch-once 而非逐日**：`stock_zh_index_daily_em` 返回的是区间内完整日线，逐日重复拉全历史是浪费；窗口化调一次、建 date→amount 映射、逐日 O(1) 查表——镜像 `latest_spot` 的 fetch-once 范式。
- **`SpotBreadth.total_turnover` 字段**：保留（`fetch_spot_breadth` 仍算），但不再写进行；避免在本任务里动 spot 解析（缩小 diff）。未来若 spot 口径废弃可再清理。
- **代理瞬时故障**：本机 `127.0.0.1:7890` 对 eastmoney host 偶有 `RemoteDisconnected`（已在 8.8 验证时观察到）。sidecar 已有 per-source 隔离 + akshare `request_with_retry`；若实测端到端时 index fetch 被代理瞬时挡，重跑即可，不属代码缺陷。

## Verification

**Commands:**
- `cd apps/market-sidecar && uv run pytest` -- expected: 全绿（含新 index-amount fixture；AC1/AC2 覆盖；无外网）。
- 端到端（需 live PG + 可用代理）：`set -a && . .env && set +a && export NODE_USE_ENV_PROXY=1 && cd apps/worker && node --import tsx/esm src/run-market-breadth.ts` -- expected: log 中历史日 `turnover=<number>`（非 None）；随后 `curl -s http://localhost:3000/crash-calendar/2026-07-13` 的「两市成交额」段为数字。

**Manual checks (if CLI/网络不可用):**
- 确认 `_aggregate_breadth_day` 的 `total_turnover=turnover_by_day.get(day)`（不再引用 `spot.total_turnover`）。
- 确认 `fetch_index_amounts` 在 ingest 内包在独立 try/except、fetch-once、失败→空 dict 不阻塞。
- 确认 `sz399107` 仅出现在 `MARKET_TURNOVER_INDICES`，未进 `BROAD_INDICES`（crash 检测不变）。

## Suggested Review Order

**派生源（两市成交额 = 沪综指 + 深综指 成交额）**

- 新常量刻意与 crash 判定集分离（不波及 8.1/8.2）
  [`akshare_client.py:88`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L88)

- 入口：消费常量循环 + 交集求和，两市口径缺一不可（NFR-5 不补半值）
  [`akshare_client.py:351`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L351)

- 帧解析：双列 None 守卫（列漂移→空，never raises）
  [`akshare_client.py:555`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L555)

**ingest 接线（fetch-once + per-source 隔离）**

- 取一次建映射，独立 try/except 失败→空 dict 不阻塞 breadth 行
  [`ingest.py:214`](../../../apps/market-sidecar/src/market_sidecar/ingest.py#L214)

- 单行赋值改用映射查表（唯一的生产代码行为变更）
  [`ingest.py:356`](../../../apps/market-sidecar/src/market_sidecar/ingest.py#L356)

**测试（fixture 钉边界，不触外网）**

- AC1 求和 + AC2 缺一指数/空列/失败隔离
  [`test_parse.py:272`](../../../apps/market-sidecar/tests/test_parse.py#L272)

- 历史日正向断言（有指数数据→真实成交额；无→None）
  [`test_parse.py:636`](../../../apps/market-sidecar/tests/test_parse.py#L636)
