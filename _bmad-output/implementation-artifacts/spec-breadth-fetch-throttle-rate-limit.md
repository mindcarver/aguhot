---
title: 'breadth fetch 全局限流：防止触发 eastmoney IP 封禁'
type: 'feature'
created: '2026-07-17'
status: 'done'
baseline_revision: '63bebddfb29199785fb13449f681d66ca81b458a'
final_revision: '535f9cb346b2f0e01aa4bd19dfda621b4df4a195'
context:
  - '{project-root}/apps/market-sidecar/src/market_sidecar/akshare_client.py'
  - '{project-root}/apps/market-sidecar/src/market_sidecar/ingest.py'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-breadth-fetch-retry-backoff.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-breadth-turnover-from-index-amount.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** breadth runner 对 eastmoney 的请求是**裸爆发**——`_aggregate_breadth_day` 逐日循环里 5 个源（涨停池/跌停池/炸板池/龙虎榜/融资融券）的 `ak.*()` 调用背靠背无间隔，跨 ~7 个交易日 = ~35+ 次请求在数秒内打完，叠加 spot 的内部分页。eastmoney 的 anti-scraping 据此对该 IP 临时封禁（实测：跑完一轮后 push2his/push2 等 host 全部 `RemoteDisconnected`/`ProxyError` 持续不可达）。这是**预防**问题——retry（已加）只在封禁后兜底恢复，本 story 从源头**不触发封禁**。

**Approach:** 在 `akshare_client.py` 加一个全局请求限流器 `_throttle()`（`MIN_REQUEST_INTERVAL` 常量，默认 ~0.5s，按 `time.monotonic()` 强制两次 akshare 调用间的最小间隔），并把它**折进**现有 `_with_retry`（重命名为 `_call_ak`：每次 attempt 先 `_throttle()` 再调 fn）——这样所有 breadth fetch 的每次网络调用（含重试）都经过限流。把 8 个 breadth 调用点（涨停/跌停/炸板池、spot、龙虎榜、融资融券 ×2、index-em）的裸 `ak.*()` 全部改走 `_call_ak`。akshare 自身的分页内部已有 `sleep(0.5~1.5s)`（已确认），故只需限流**我们的**调用边界，聚合速率即降到 ~1–2 req/s 的安全区。

## Boundaries & Constraints

**Always:**
- AD-7：限流只作用在 sidecar 的 akshare 调用边界（`_call_ak` 内），不改 akshare 内部、不 monkeypatch 第三方、不引入新依赖（仅 stdlib `time`）。
- 全局限流：用模块级 `_last_call_at`（`time.monotonic()`）+ `MIN_REQUEST_INTERVAL` 强制**任意两次 akshare 调用间的最小间隔**；`_throttle()` 在 interval≤0 时不 sleep（可配置关闭/测试免等）。
- 单一助手：`_call_ak(label, fn)` = throttle-then-retry（fold 进 `_with_retry` 并重命名），所有 breadth fetch 统一经过它（一处限流 + 重试逻辑，覆盖全部调用点）。
- 有界：限流只增固定 ≤interval 的延迟，**绝不无限等待**；retry 既有界不变（runner 终态退出）。
- 可调：`MIN_REQUEST_INTERVAL` 为模块常量（默认 0.5s），可改不写死散落。
- NFR-5 不变：限流/重试不改任何 fetch 的返回契约或空态语义。

**Block If:**
- 无（纯 sidecar 容错/限流增强，无 schema/core/web 改动，无不可自决决策）。

**Never:**
- 不改 `packages/core` / web / schema / `db.py` / ingest 的聚合逻辑。
- 不 monkeypatch `akshare.utils.request` 或注入 requests session（脆弱、绑 akshare 内部实现）。
- 不改任何 fetch 的返回值/空态契约（throttle/retry 只影响调用时机，不影响结果）。
- 不把限流应用到 8.1 的 `fetch_index_daily`/`fetch_sector_daily`（属独立 quotes runner，非本次封禁触发源；YAGNI）。
- 不为「不限流」而减少采集的源/天数（数据完整性优先；用限流降速而非砍量）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 限流生效(AC1) | 连续两次 `_throttle()`，间隔 < MIN_REQUEST_INTERVAL | 第二次 sleep `≈ MIN_REQUEST_INTERVAL - 已耗elapsed`（聚合速率被压到 ≤ 1/interval req/s） | sleep 后更新 `_last_call_at` |
| 间隔已够(AC1) | 连续两次 `_throttle()`，实际间隔 ≥ interval | `wait ≤ 0`，不 sleep（零开销），仅更新时间戳 | 无 |
| interval 关闭(AC2) | `MIN_REQUEST_INTERVAL = 0` | `_throttle()` 不 sleep（测试/按需关闭限流） | 无 |
| 所有调用点覆盖(AC3) | breadth 的 8 个 `ak.*()` 调用点 | 全部经 `_call_ak`（throttle+retry）；裸 `ak.*()` 不再残留于 breadth fetch | 无 |
| 全链路(AC4) | runner 跑 incremental（~7 日） | 请求被 spacing 到 ≤ ~2 req/s；不再爆发触发封禁（best-effort，eastmoney 阈值未公开） | retry 兜底（既有） |

</intent-contract>

## Code Map

```
apps/market-sidecar/src/market_sidecar/akshare_client.py
  - +MIN_REQUEST_INTERVAL 常量、+_last_call_at 模块状态、+_throttle()
  - _with_retry → 重命名 _call_ak：每次 attempt 先 _throttle() 再 fn()（throttle+retry 合一）
  - 8 个 breadth ak.*() 调用点改走 _call_ak("label", lambda: ak.*(...))
apps/market-sidecar/tests/test_parse.py
  - 既有 retry 测试：patch MIN_REQUEST_INTERVAL=0（throttle 免 sleep，[2.0,4.0] backoff 断言不变）
  - +_throttle 限流单测（interval>0 时 sleep、间隔够时不 sleep、interval=0 不 sleep）
```

## Tasks & Acceptance

**Execution:**
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` -- ADD `MIN_REQUEST_INTERVAL = 0.5` 常量（旁注：聚合速率上限 ≈ 1/0.5 = 2 req/s，叠加 akshare 分页内部 0.5–1.5s/page → 全局安全区）；ADD 模块级 `_last_call_at: float = 0.0` + `_throttle()`：`elapsed = time.monotonic() - _last_call_at; wait = MIN_REQUEST_INTERVAL - elapsed; if wait > 0: time.sleep(wait); _last_call_at = time.monotonic()`（interval≤0 时 wait 必 ≤0 不 sleep）；RENAME `_with_retry` → `_call_ak`，在每次 `fn()` attempt 前 ADD `_throttle()`（docstring 更新为「throttle + retry」）；把 8 个 breadth 调用点的裸 `ak.*()` 改为 `_call_ak("<label>", lambda ...: ak.<fn>(...))`（涨停池 289 / 跌停池 308 / 炸板池 323 / spot 341 / 龙虎榜 457 / index-em 395 已用 retry→改 `_call_ak` / 融资融券 SSE+SZSE 在 `_sum_margin_balance` 内 2 处）-- 全局压低请求速率，从源头不触发 eastmoney IP 封禁。
- `apps/market-sidecar/tests/test_parse.py` -- 既有两个 retry 测试（`test_fetch_index_amounts_retries_through_transient_failures` / `_persistent_failure_raises_after_retries`）ADD `monkeypatch.setattr(akc, "MIN_REQUEST_INTERVAL", 0.0)`（throttle 免 sleep，使 `delays == [2.0,4.0,...]` backoff 断言不被 throttle sleep 污染）；ADD `_throttle` 限流单测：interval>0 时连续两次 `_throttle()` 第二次 sleep `> 0`（用小 interval 如 0.05s + 捕获 sleep），间隔已够时不 sleep，`MIN_REQUEST_INTERVAL=0` 时不 sleep -- 钉住 AC1/AC2 限流边界 + 保证 retry 测试不被污染。

**Acceptance Criteria:**
- **AC1** Given `MIN_REQUEST_INTERVAL > 0`，when 连续两次 `_throttle()` 且实际间隔 < interval，then 第二次 `time.sleep(>0)`（聚合速率被限到 ≤ 1/interval req/s）；间隔已够时不 sleep。
- **AC2** Given `MIN_REQUEST_INTERVAL = 0`，when `_throttle()` 跑，then 不 sleep（可配置关闭/测试免等）。
- **AC3** Given breadth 的 8 个 `ak.*()` 调用点，when 检视源码，then 全部经 `_call_ak`（无裸 `ak.*()` 残留于 breadth fetch；8.1 的 quotes fetch 不在范围）。
- **AC4** `cd apps/market-sidecar && uv run pytest` 全绿（含新 throttle 单测 + 既有 33 用例不回归；retry 测试用 interval=0 patch 保持原 backoff 断言）。
- **AC5（best-effort，env-gated）** eastmoney 可达时 `run-market-breadth.ts` 不再触发封禁（请求被 spacing），跑完后 eastmoney host 仍可达（不出现新一轮 `RemoteDisconnected`）；总耗时因限流增加（~0.5s × ~50 调用 ≈ +25s，可接受）。**注**：eastmoney 阈值未公开，限流值是保守启发（2 req/s）；若仍偶发封禁，调高 interval。

## Spec Change Log

<!-- 空，首轮规划（review patches 为错误消息修正 + 组合测试加强，未改 frozen intent 与运行时行为）。 -->

## Review Triage Log

### 2026-07-17 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 2: (low 2)
- defer: 1: (low-medium 1)
- reject: ~13 (low — 见下)
- addressed_findings:
  - `[low]` `[patch]` P1：`_call_ak` 末尾的 `RuntimeError(f"_with_retry({label})...")` 消息漏改（rename 残留）→ 更正为 `_call_ak`（这是 FETCH_RETRY_ATTEMPTS<1 误配时抛出的消息，准确性最关键）。
  - `[low]` `[patch]` P2：加组合测试 `test_call_ak_throttles_before_each_retry_attempt`——驱动 `_call_ak` 经 fail-then-succeed（interval=0.05），断言**每次 attempt 前**各一次 throttle sleep（≤interval）+ 一次 2.0s backoff。钉住「throttle 在 retry loop 内、每次 attempt 都 pace」的核心组合契约（此前 `_throttle` 直测 + retry 测试 throttle=0，删掉 loop 里 `_throttle()` 会绿过）。
- deferred（见 deferred-work.md，本 pass 新增 1 条）:
  - `[low-medium]` 非交易日请求浪费：runner 逐日遍历日历（8.6 既有设计，无 A 股交易日历，靠空池判定非交易日），对每个周末/节假日仍发起 6 个 breadth 调用（涨停/跌停/炸板/龙虎榜/融资融券×2）。throttle 让这些浪费调用变慢（~3s/非交易日）但不减量；引入 A 股交易日历来 skip 非交易日能同时**降请求量（额外防封禁）+ 提速**。与 throttle 互补，但属独立 calendar 关注点。
- rejected（silently dropped，择要）:
  - 「retry 不 throttle」（#2）：误诊——`_throttle` 用 `time.monotonic() - _last_call_at`，backoff 的真实墙钟流逝被正确计入（2s backoff > 0.5s interval → 下次 throttle wait<0 不补睡，正因已被 pace）；P2 组合测试证实每次 attempt 都 pace。
  - 0.5s 未实测对 eastmoney 阈值（#1）：认知缺口（无法不触发封禁来测量）；0.5s 据 akshare 自身分页 sleep 0.5–1.5s（被容忍）推得，spec 已标 best-effort 启发式。
  - throttle 测错边界（分页未被 pace，#3）：akshare 自身分页已自 pace（0.5–1.5s/page）；观测到的封禁源自**逻辑调用爆发**（逐日循环），throttle 正对此。
  - spot 重/8.1 未 pace（#4）：spot 外层 throttle + akshare 内部分页已足；8.1 属独立 quotes runner，非本次封禁触发源（spec 明示 YAGNI 范围）。
  - 全局 `_last_call_at` 无锁（#5/#6）：sidecar 实测单线程（grep 无 threading/asyncio）；加锁 YAGNI；no-op 分支写 state 无害（值=now 正确）。
  - autouse patch `time.sleep` 污染其它模块（#7）：autouse 仅作用 test_parse.py（模块级 fixture）；retry/throttle 测试用捕获 stub 覆盖之；该文件无测试依赖真实 sleep。
  - retry backoff 对 stubbed clock 测试（#8）：delay 捕获断言 `[2.0,4.0]` 同时钉住**值**与**sleep 被调用**（删 sleep → delays 空 → 断言失败）。
  - opt-out=0 是 test-driven 设计（#9）：opt-out 是合法 config 旋钮（测试/调试/紧急关闭），非死代码。
  - margin getattr+retry 掩盖 TypeError（#11）：akshare 版本 pinned；broad-except-retry 是既有接受的折中；margin 正确降级 None。
  - cold-start sentinel 0.0（#13）：首调用不补睡（正确，前面无调用）；保守、无害的一次性。
  - throttle 无日志（#15）：每次调用 log 太噪；retry 已 log；throttle 是预期常态行为。

## Design Notes

- **为何 fold 进 `_with_retry` 而非新助手**：retry 的每次 attempt 也是一次网络调用，同样需要限流（避免重试加剧爆发）。fold 成单一 `_call_ak`（throttle+retry）覆盖「每次网络调用」语义，一处逻辑、全部调用点统一；`_with_retry` 重命名为 `_call_ak` 以反映双职责（同分支未合并，重构成本低）。
- **限流值 0.5s 的依据**：eastmoney 无公开阈值；akshare 自身分页用 `sleep(0.5–1.5s)` ≈ 1–2 req/s（已确认源码），说明该速率被 eastmoney 容忍。我们的调用边界用 0.5s → ≤2 req/s，与 akshare 分页速率同量级，叠加后全局仍在 ~1–2 req/s 安全区。
- **为何不 monkeypatch akshare.session**：脆弱、绑 akshare 内部实现（版本升级即坏）；限流我们的调用边界 + 依赖 akshare 自身分页 sleep，已足够降速，无需侵入第三方。
- **测试隔离**：retry 测试 patch `MIN_REQUEST_INTERVAL=0` 使 throttle 免 sleep，保留 `[2.0,4.0]` backoff 断言纯净；throttle 行为由独立单测覆盖（小 interval + 捕获 sleep）。避免两类逻辑的 sleep 互相污染断言。
- **不在 ingest 层加 sleep**：限流在 akshare 调用边界（`_call_ak`）比在 `_aggregate_breadth_day` 循环加 sleep 更精确——覆盖到每次实际网络调用（含 margin 的双交易所调用、index 的双指数、重试 attempt），不漏不重。

## Verification

**Commands:**
- `cd apps/market-sidecar && uv run pytest tests/test_parse.py -q` -- expected: 全绿（含 throttle 单测；既有 33 用例不回归）。注：本机 next dev 占 8GB 堆，pytest 在 sandbox 内存上限下会被 SIGKILL（EXIT 137），需关 sandbox 跑。
- 静态：`grep -nE "ak\.(stock_zt_pool|stock_zh_a_spot|stock_lhb|stock_margin|stock_zh_index_daily_em)" apps/market-sidecar/src/market_sidecar/akshare_client.py` -- expected: breadth fetch 内的命中行均包裹在 `_call_ak(...)` 内（AC3）。
- 端到端（env-gated）：`set -a && . .env && set +a && export NODE_USE_ENV_PROXY=1 && cd apps/worker && node --import tsx/esm src/run-market-breadth.ts` -- expected（eastmoney 可达时）：请求被 spacing，跑完后 push2his/push2 仍可达（不再触发封禁）。

**Manual checks:**
- 确认 `_call_ak` 在每次 attempt 前 `_throttle()`（throttle+retry 合一）。
- 确认 8 个 breadth 调用点均走 `_call_ak`，8.1 quotes fetch（189/212）未动。
- 确认 `MIN_REQUEST_INTERVAL=0` 时 `_throttle` 不 sleep（可关闭）。

## Suggested Review Order

**限流助手 + retry 组合**

- 全局速率上限常量（默认 0.5s ⇒ ≤2 req/s）
  [`akshare_client.py:116`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L116)

- `_throttle()`：monotonic 强制最小间隔，interval≤0 时 no-op
  [`akshare_client.py:419`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L419)

- `_call_ak()`：throttle+retry 合一，每次 attempt 先 pace
  [`akshare_client.py:436`](../../../apps/market-sidecar/src/market_sidecar/akshare_client.py#L436)

**测试（钉住组合契约）**

- throttle 限流 + `_call_ak` 每次 attempt 都 pace（含 retry）
  [`test_parse.py:439`](../../../apps/market-sidecar/tests/test_parse.py#L439)

## Auto Run Result

Status: done

**实现摘要：** 在 sidecar 的 `akshare_client.py` 加全局请求限流器 `_throttle()`（`MIN_REQUEST_INTERVAL=0.5s`，`time.monotonic()` 强制任意两次 akshare 调用间最小间隔），fold 进既有 retry 助手并重命名为 `_call_ak`（throttle+retry 合一，每次 attempt 先 pace），把 8 个 breadth 调用点（涨停/跌停/炸板池、spot、龙虎榜、融资融券 SSE+SZSE、index-em）全部改走 `_call_ak`。聚合请求速率从「数秒内 ~35+ 爆发」降到 ≤2 req/s，从源头预防 eastmoney anti-scraping 的 IP 封禁。

**改动文件：**
- `apps/market-sidecar/src/market_sidecar/akshare_client.py` — `MIN_REQUEST_INTERVAL`/`_last_call_at`/`_throttle()`；`_with_retry`→`_call_ak`（fold throttle）；8 调用点包裹。
- `apps/market-sidecar/tests/test_parse.py` — autouse fixture（throttle+sleep 免等，retry 测试 backoff 断言不污染）；`_throttle` 直测（pace/no-op）；`_call_ak` 组合测试（每次 attempt 都 throttle）。

**Review（pass 1，四路并行）：**
- patch 2（皆 low）：rename 残留错误消息 `_with_retry`→`_call_ak`；加组合测试钉「_call_ak 每次 attempt 都 throttle」（反驳 review #2「retry 不 throttle」误诊——monotonic 已正确计入 backoff 时长）。
- defer 1（low-medium）：非交易日请求浪费（runner 逐自然日遍历，靠空池判非交易日；需 A 股交易日历 skip，降量+提速，独立关注点）。
- reject ~13：0.5s 未实测对阈值（认知缺口，据 akshare 分页速率推得）、throttle 测错边界（分页自 pace，封禁源是逻辑调用爆发）、8.1 不 pace（独立 runner 非触发源）、全局 state 无锁（单线程实测）、autouse 污染（模块级 scoped）、opt-out 非死码、cold-start sentinel 无害等。
- follow-up review：不推荐（仅 low patch，测试/消息层，无 behavior/API/data 影响）。

**验证：**
- `uv run pytest tests/test_parse.py` — 36 passed in 0.58s（含 throttle 直测 + `_call_ak` 组合测试；既有 33 不回归）。
- 静态 grep：8 个 breadth 调用点全部经 `_call_ak`，无裸 `ak.*()` 残留；8.1 quotes fetch（189/212）未动。
- AC5（端到端「不触发封禁」）：env-gated，未当次验证——eastmoney 仍处上轮封禁冷却期（push2his 持续不可达），无法跑通验证「不再被封」。throttle 逻辑已由单测+组合测试钉死；待 eastmoney 恢复后重跑 runner 验证「跑完后 host 仍可达」。

**残留风险：**
- 0.5s interval 是据 akshare 自身分页速率（0.5–1.5s/page，被 eastmoney 容忍）推得的启发式，未实测对 eastmoney 真实阈值（无法不触发封禁来测量）；若仍偶发封禁，调高 `MIN_REQUEST_INTERVAL`。
- 非交易日仍发起全部 6 个源请求（8.6 逐自然日设计，见 deferred）——throttle 减速不减量；引交易日历可进一步降量。
- eastmoney 当前持续封禁中，本变更的预防效果需待其恢复后经实跑确认。
