---
title: 'breadth index-amount fetch: retry + exponential backoff'
type: 'feature'
created: '2026-07-17'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'e7d328bb47c7924f33aa89ee46c802219e0e35af'
context:
  - '{project-root}/apps/market-sidecar/src/market_sidecar/akshare_client.py'
  - '{project-root}/apps/market-sidecar/src/market_sidecar/ingest.py'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-breadth-turnover-from-index-amount.md'
warnings: []
---

<frozen-after-approval>

## Intent

**Problem:** `fetch_index_amounts`（8.7+turnover change 的两市成交额派生入口）对 `stock_zh_index_daily_em` 的调用**零重试**——akshare 内置 `request_with_retry` 过快放弃，本机代理 + eastmoney 的瞬时 `RemoteDisconnected`/`ProxyError` 直接抛出 → 整轮 ingest 的 `total_turnover` 全 NULL，`/crash-calendar/[date]`「两市成交额」恒为「—」。多次实跑观察到「同轮部分源成功、index-amount 失败」的瞬时抖动模式（非持续硬宕）。

**Approach:** 在 `akshare_client.py` 加一个通用 `_with_retry(label, fn)` 网络重试助手（N 次尝试 + 指数退避，复用给所有 breadth fetch），`fetch_index_amounts` 用它包住每个 `ak.stock_zh_index_daily_em(...)` 调用。瞬时连接重置/代理抖动在退避后常能恢复；全部重试失败仍抛出（由 ingest 的 per-source try/except 兜底 → `breadth: null`，NFR-5 不变）。

## Boundaries & Constraints

**Always:**
- AD-7：重试只 wrap akshare 调用（端口内），不改 akshare 内部、不引入新依赖（仅 stdlib `time`/`logging`）。
- NFR-5 不变：全部重试失败 → 抛出 → ingest 兜底 `total_turnover=None`（绝不伪造、绝不无限挂起）。
- 退避必须有上限（bounded attempts × exponential cap），**绝不无限重试**（runner 须终态退出）。
- 重试对**幂等 GET**安全（akshare index daily 是只读查询，重试无副作用）。
- 常量可调（模块级 `FETCH_RETRY_ATTEMPTS` / `FETCH_RETRY_BACKOFF_BASE`），不写死魔法数散落代码。

**Block If:**
- 无（纯 sidecar 容错增强，无 schema/core/web 改动，无不可自决决策）。

**Never:**
- 不改 `packages/core` / web / schema / `db.py`。
- 不改 `fetch_index_amounts` 的返回契约（仍是 `dict[date, Decimal]`，两市交集求和）。
- 不在重试里 fallback 到**单位不符**的替代源（tencent `stock_zh_index_daily_tx.amount` 实为成交量级，用作成交额会 wrong-magnitude → 违 NFR-5；保持 eastmoney 成交额为唯一口径）。
- 不重试非网络类逻辑（重试只包 akshare 调用边界，不包解析/求和）。
- 不为「让 AC4 现在出数字」而伪造/缓存/兜底写入假值。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 瞬时抖动恢复(AC1) | 首次/前几次 `stock_zh_index_daily_em` 抛 ConnectionError/ProxyError，之后某次成功 | `_with_retry` 退避后重试命中，`fetch_index_amounts` 返回完整 dict（含该日成交额之和） | 退避 log，最终成功 |
| 持续失败(AC2) | 所有重试均抛错（eastmoney 持续宕机/IP 封锁） | `_with_retry` 抛最后一个异常 → `fetch_index_amounts` 抛出 → ingest try/except → `total_turnover=None`，breadth 行照常写 | 抛出（不吞），上层兜底 |
| 非网络异常不特殊处理 | akshare 抛任意异常（含解析类） | 与持续失败同路径：重试耗尽后抛出 | 同上（重试对幂等 GET 安全，多试无害） |
| 有界性(AC3) | 最坏情况 | attempts × 退避有上限（默认 3 次 × 2/4/8s ≈ 14s 上限/指数），runner 必终态退出，绝不挂起 | 退避封顶 |

</frozen-after-approval>

## Code Map

- `apps/market-sidecar/src/market_sidecar/akshare_client.py` — 加 `FETCH_RETRY_ATTEMPTS`/`FETCH_RETRY_BACKOFF_BASE` 常量 + `_with_retry(label, fn)` 助手；`fetch_index_amounts` 用它包每个 `ak.stock_zh_index_daily_em(...)`。
- `apps/market-sidecar/tests/test_parse.py` — 加 retry 单测（前 N 次抛、后成功；全抛→抛出）；`monkeypatch` `time.sleep` 免等待。

## Tasks & Acceptance

**Execution:**
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` -- ADD 模块级 `FETCH_RETRY_ATTEMPTS = 3`、`FETCH_RETRY_BACKOFF_BASE = 2.0`（旁注：退避 = base × 2**attempt，默认序列 2/4/8s，总上限 ≈14s/指数，runner 终态退出）；ADD `_with_retry(label: str, fn: Callable[[], T]) -> T`：循环 attempts 次，`try: return fn()` except 记 `log.warning` + `time.sleep(base * 2**attempt)`，耗尽则 `raise last`；`fetch_index_amounts` 内每个 `ak.stock_zh_index_daily_em(symbol=..., start_date=..., end_date=...)` 调用用 `_with_retry(f"index_em {symbol}", lambda s=symbol, sd=s, ed=e: ak.stock_zh_index_daily_em(symbol=s, start_date=sd, end_date=ed))` 包住（其余交集求和逻辑不变）-- 给 index-amount 网络调用加有界重试+退避，吸收瞬时抖动。
- `apps/market-sidecar/tests/test_parse.py` -- ADD retry 单测（`monkeypatch.setattr(akc.time, "sleep", lambda *_: None)` 免等待）：(a) FakeAk 的 `stock_zh_index_daily_em` 前 2 次 `raise ConnectionError`、第 3 次返回正常帧 → `fetch_index_amounts` 返回完整 dict（含 07-14 求和）；(b) FakeAk 恒抛 → `fetch_index_amounts` 抛出（用 `pytest.raises`）-- 钉死 AC1（恢复）/AC2（耗尽抛出），防回归。

**Acceptance Criteria:**
- **AC1** Given `stock_zh_index_daily_em` 前几次抛 `ConnectionError`/`ProxyError` 后某次成功，when `fetch_index_amounts` 跑，then 经 `_with_retry` 退避重试命中，返回完整 `dict[date,Decimal]`（与无重试版同值）。
- **AC2** Given `stock_zh_index_daily_em` 恒抛错（eastmoney 持续不可达），when `fetch_index_amounts` 跑，then 重试耗尽后**抛出**（不吞），ingest 的 per-source try/except → `total_turnover=None` + breadth 行照常写（NFR-5 不变，不阻塞）。
- **AC3** `_with_retry` 最坏耗时有限（attempts × 指数退避封顶），runner 必终态退出（绝不无限重试/挂起）。
- **AC4** `cd apps/market-sidecar && uv run pytest` 全绿（含 retry 单测，sleep 被 stub 不触外网不等待）；既有 31 用例不回归。
- **AC5（端到端，env-gated，best-effort）** eastmoney kline host（push2his）可达时，`run-market-breadth.ts` 经重试后 log 中历史日 `turnover=<number>`；`/crash-calendar/2026-07-13`「两市成交额」段显数字。**注**：当前 push2his 处持续部分宕机/IP 限流（非代码可破），重试提高恢复概率但不保证当次成功——数据一旦落库即持久（upsert），eastmoney 恢复后任意一次重跑即填入。

## Spec Change Log

<!-- 空，首轮规划（review patches 为文档/守卫/测试加强，未改 frozen intent 与运行时行为）。 -->

## Review Triage Log

### 2026-07-17 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 4: (low 4)
- defer: 0
- reject: ~14 (low — 见下)
- addressed_findings:
  - `[low]` `[patch]` P1: backoff 文档更正——N 次尝试只有 N-1 次 sleep（3 次⇒2 次 sleep 2s+4s=**6s**，非旧文案「2s/4s/8s ≈14s」）；模块常量注释 + `_with_retry` docstring 同步更正（旧文案把末次 attempt 才算出的 8s 当成已 sleep，cost 高估 >2×）。
  - `[low]` `[patch]` P2: retry 测试加强——断言**每符号调用次数 == FETCH_RETRY_ATTEMPTS**（证 retry 真发生，非 no-op 透传）+ 捕获 `time.sleep` 的 delay 序列 `== [2.0,4.0,...]`（钉指数退避公式）。此前 transient 测试只断言终值、persistent 只断言抛出——一个 `while True` 或 1 次尝试的回归会绿过（load-bearing 终态边界完全未验证）。
  - `[low]` `[patch]` P3: `_Flaky` 由跨符号共享 `%3` 计数器改为**每符号独立计数器**（消除「全局计数器 mod 3 凑巧 == 每符号重试数」的脆弱耦合，第三符号/调序即错）。
  - `[low]` `[patch]` P4: `_with_retry` 的 `assert last_exc is not None`（生产路径，`-O` 下被 strip；`FETCH_RETRY_ATTEMPTS<1` 误配→AssertionError 或静默 no-op）改为显式 `if last_exc is None: raise RuntimeError(...)`。
- rejected（silently dropped，择要）:
  - `except Exception` 捕获非传输异常（parse bug 重试 3×6s）：spec 明选「retry 只在 ak 调用边界」「幂等 GET 安全」；akshare 调用内含解析，部分响应致 JSONDecodeError 重试是合理的；硬失败仅延后 6s 暴露（后台 runner 可接受）。
  - retry 应用到全部 sibling fetch（pools/spot/lhb/margin）：spec 明示 YAGNI——本任务只 index-amount（AC4 急性点），helper 通用可后续零成本复用。
  - 首符号成功/次符号耗尽丢部分数据：spec 的「两市缺一不可」no-half-sum——sz 不可得则不能算两市，丢弃 sh 是正确的。
  - KeyboardInterrupt/SystemExit 被吞：`except Exception` 不捕 BaseException 子类（事实错误）。
  - 空 MARKET_TURNOVER_INDICES→IndexError / delay 溢出：常量硬编码非空、attempts=3 max delay 4s，不可达。
  - 退避 MAX_CAP / env override：ops 可改常量；env 覆盖属 config.py（DB URL）范围外，YAGNI。
  - exc 截断 120 字 / 只 re-raise last 丢首因链：log 含 type+120 字足够识别；同型瞬时错误链 marginal。
  - 「upsert 持久」注释未测：8.7 AC4 已验 upsert by tradeDate PK 幂等，注释准确。
  - `_with_retry` 无直接单测 / lambda 捕获不对称 / retry-成功-但帧空：传递覆盖充分（两分支经 fetch_index_amounts 触达）；捕获正确性由 fixture 求和隐式验证（480e9+410e9=890e9）；空帧由 `_index_amount_map` 既有契约覆盖。
  - `import pytest` 局部导入：可用，cosmetic，不churn。

## Design Notes

- **为何 retry 而非换源**：实跑诊断显示失败是**瞬时**连接重置（同轮部分源成功、index-amount 失败），retry+退避正是对症；且唯一单位正确的成交额源是 eastmoney kline——tencent `stock_zh_index_daily_tx.amount` 实测为指数 volume 量级（sh000001≈5.8e8，远低于真实沪市成交额 ~5e11 元），换源会出 wrong-magnitude 数字，违 NFR-5（误导比「—」更糟）。
- **退避有界**：默认 3 次 × 指数（2/4/8s）≈14s 上限。对瞬时抖动足够；对持续 IP 封锁（eastmoney anti-scrape，常因 spot 的 ~37 页分页 burst 触发）无法当次突破——但数据 upsert 持久，封锁冷却后任意重跑即落地。
- **`_with_retry` 通用化**：置于 akshare_client 顶层、参数化 label+fn，未来可零成本复用到其他 breadth fetch（spot/pools 同样抖动）；本任务只应用到 index-amount（AC4 的急性阻塞点），不预先包装全部 fetch（YAGNI）。
- **sleep 可 stub**：`time.sleep` 经模块引用（`akc.time.sleep`）使测试可 monkeypatch 免等待。

## Verification

**Commands:**
- `cd apps/market-sidecar && uv run pytest tests/test_parse.py -q` -- expected: 全绿（含 retry 单测；既有 31 用例不回归）。注：本机 next dev 占 8GB 堆，pytest 在 sandbox 内存上限下会被 SIGKILL（EXIT 137），需关 sandbox 跑（已验证）。
- 端到端（env-gated）：`set -a && . .env && set +a && export NODE_USE_ENV_PROXY=1 && cd apps/worker && node --import tsx/esm src/run-market-breadth.ts` -- expected（eastmoney 可达时）：log 见 retry 后 `turnover=<number>`；随后 `curl -s http://localhost:3000/crash-calendar/2026-07-13` 的「两市成交额」段显数字。eastmoney 不可达时：log 见 `retry ... failed` 最终 `fail: index_amounts`（隔离成立，breadth 行仍写）。

**Manual checks:**
- 确认 `_with_retry` 退避有上限、耗尽抛出（不吞异常、不挂起）。
- 确认 `fetch_index_amounts` 返回契约未变（dict 交集求和）。
- 确认未引入 tencent 等单位不符的 fallback。

## Suggested Review Order

**重试助手 + 接线**

- 通用网络重试助手：N 次 × 指数退避、有界、耗尽抛出
  [`akshare_client.py:419`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L419)

- 入口处用它包住每个 index-em 调用（唯一 retry 应用点）
  [`akshare_client.py:390`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L390)

**测试（钉住 load-bearing 不变量）**

- 瞬时恢复：每符号调用次数 + 退避 delay 序列断言
  [`test_parse.py:333`](../../../apps/market-sidecar/tests/test_parse.py#L333)

- 持续失败：调用次数 == FETCH_RETRY_ATTEMPTS（防 while-True 回归）
  [`test_parse.py:362`](../../../apps/market-sidecar/tests/test_parse.py#L362)
