# Sprint Change Proposal — 2026-07-16

> 大跌日历：大跌日「点进去」深度详情页 + 市场广度数据（龙虎榜 / 涨跌停 / 成交量等）
> Scope: **Moderate** · 触发: Carver 提议（Epic 8 已 done 后的产品深化）
> Workflow: `bmad-correct-course`

---

## 1. Issue Summary（变更触发）

**问题：** `/crash-calendar` 现为单页 + `?d=` 内联详情，只展示 4 段（宽基 / 领跌板块 / 前瞻收益 / 当日热点事件）。Carver 希望大跌日能**点进独立详情页**，看更厚的当日市场事实：**龙虎榜多少、涨跌停家数、成交量**等大跌日广度信号。

**证据：** 当前页 `apps/web/app/(public)/crash-calendar/page.tsx` 的 `CrashDayDetail` 仅消费 `published_crash_days.indices` + `leadingSectors`，底层只有 `index_daily_bars` + `sector_daily_bars` 两张表。龙虎榜 / 涨跌停池 / 涨跌家数 / 两市成交额 / 融资融券——这些大跌日最有信息量的广度数据**库里完全没有**。

**研究结论（已与 Carver 确认）：**
- 想要的数据 **~90% 在 AkShare 免费可得，且已在技术栈**（`stock_zt_pool_*` 涨跌停/炸板池、`stock_lhb_*` 龙虎榜、`stock_zh_a_spot_em` 涨跌家数、`stock_margin_*` 融资融券）。
- **北向资金已失效**：2024-08-19 起沪深交易所停披露实时北向 → `stock_hsgt_*` 近端缺失。**本提案砍掉北向资金**，避免展示空数据。
- 合规门禁（§12 Q9/Q10，行情/金融信息服务边界，GA 前须外部律所意见）**不变**：继续 `noindex` + prod 不投影，但律所复核范围需**扩大到「龙虎榜 / 涨跌停」**。
- 付费备选仅在 AkShare 被限流时启用：Tushare Pro ≈200 元/年（2000 积分）最便宜兜底；Choice/iFinD/Wind 机构向（0.58 万–4 万/年），现阶段无必要。

---

## 2. Impact Analysis

### Epic Impact
- **epic-8**（大跌日历与历史回顾，现状 done）→ 重开为 in-progress，追加 stories 8-6 / 8-7 / 8-8。

### Story Impact（新增 3 条，不复用旧 story）

| 新 Story | 职责 | 镜像先例 |
|---|---|---|
| **8-6 市场广度数据采集（sidecar `--scope breadth`）** | Python sidecar 拉 T1 五类数据 → 写新表 `market_breadth_daily`；fixture 测试，不触外网 | 8-1（sidecar + 新表 + 单一 schema 拥有权） |
| **8-7 广度投影 + runner** | `published_crash_days` 加 `breadth Json` 列；`refreshPublishedCrashDays` 读 `market_breadth_daily` 物化；新 runner `run-market-breadth` | 8-2/8-3（投影 sibling + runner wiring） |
| **8-8 `/crash-calendar/[date]` 深度详情页** | 新动态路由渲染 T1 五段；日历索引改链 `[date]`；合规 noindex | 8-3（公开页）+ `/events/[id]`（动态段范式） |

### Artifact Conflicts
- **PRD**：无需改定位层；Epic 8 已是「历史回顾」，深度详情是其自然延展。仅需在 Epic 8 描述补一句「大跌日深度广度详情」。
- **Architecture（ARCHITECTURE-SPINE）**：**不碰**不变量（AD-1 第三运行时边界、AD-2 单一 schema 拥有、AD-3 published_* 单一写、AD-7 外部源经端口）。新表 `market_breadth_daily` 归 Node/Prisma，Python 裸 SQL 写——完全照抄 8-1。
- **UX**：新增一个详情页路由；复用既有 token（红涨绿跌 `text-market-up/down`、`ReactionChip`、`font-mono`、`EditorialReasonBlock` 视觉契约的 hairline+标签）。**不新增 token**。
- **合规（§10/§12）**：复用既有 noindex 门禁；律所复核 action item 范围 +1 条（龙虎榜/涨跌停属金融信息）。

### Technical Impact
- 新表 1 张（`market_breadth_daily`）+ 1 次前向迁移。
- Python sidecar 扩 `--scope breadth`（新增 fetch 函数 + fixture + 测试）。
- `published_crash_days` 加 1 列 `breadth Json`（1 次迁移）。
- 新路由 `apps/web/app/(public)/crash-calendar/[date]/page.tsx`；索引页 `page.tsx` 去掉内联 `CrashDayDetail`，日历格子改链 `/crash-calendar/[date]`。
- 新 runner `apps/worker/src/run-market-breadth.ts`（spawn sidecar → 再 refresh 投影）。

---

## 3. Recommended Approach

**Direct Adjustment（在既有计划内新增 stories，非回滚、非缩 MVP）。** Epic 8 已 done 但其范式（8-1 数据 → 8-2 判定 → 8-3 投影/页）可直接复用，新增三 story 风险低。

- **工作量估计：** 3 story ≈ 与 8-1+8-2+8-3 一档（sidecar 扩展最重，页/投影较轻）。
- **风险：** 低-中。主要风险是 AkShare 接口列名漂移（`stock_zt_pool_em` 历史有过）→ 以 fixture 为验证源、akshare 钉版本（对齐 8-1）。
- **时间线影响：** 不阻塞 V1 GA（深度详情继续 noindex，prod 不投影，与 8.3 同门禁）。

---

## 4. Detailed Change Proposals

### Story 8-6：市场广度数据采集（sidecar breadth scope）

**Boundaries：** 单一 schema 拥有（AD-2）— `market_breadth_daily` 由 Prisma 拥有，Python 只写；外部源经端口（AD-7）；不抓个股分钟级；不抓北向资金（已失效）；钉 akshare 版本；fixture 验证不触外网。

**新表 `market_breadth_daily`（tradeDate unique，单行聚合 + 龙虎榜 Json）：**
```
trade_date DATE unique
limit_up_count INT              -- 涨停家数 (stock_zt_pool_em 行数)
limit_down_count INT            -- 跌停家数 (stock_zt_pool_dtgc_em 行数)
consecutive_board_max INT       -- 最高连板高度 (涨停池 连板数 max)
broken_board_count INT          -- 炸板家数 (stock_zt_pool_zbgc_em 行数)
advancing_count INT             -- 上涨家数 (spot pctChange>0 count)
declining_count INT             -- 下跌家数
flat_count INT                  -- 平盘家数
total_turnover DECIMAL(20,2)    -- 两市成交额(元) (spot 成交额 sum)
margin_balance_change DECIMAL(20,2) NULL  -- 融资融券余额变化(T-1，可空 NFR-5)
dragon_tiger JSON               -- {stockCount, institutionalNetBuy, hotMoneyNetBuy, topStocks:[{code,name,netBuy,reason}]}
source TEXT                     -- 'akshare'
ingested_at TIMESTAMPTZ
trace_id TEXT
```

**Acceptance：** `ingest --scope breadth --backfill` 写近 N 日广度行；`--incremental` 幂等 upsert；缺数据该行缺字段不伪造（NFR-5）；北向资金不抓；fixture 测试全绿无外网；Prisma 迁移本地 PG 成功 + core `tsc` clean。

### Story 8-7：广度投影 + runner

**Boundaries：** AD-3 — `published_crash_days.breadth` 仅 publish-orchestrator 写；投影只读 `market_breadth_daily`；行存在=已公开。

**改动：**
- `schema.prisma`：`PublishedCrashDay` + `breadth Json?`（nullable：缺广度时为 null，页显式空状态）。
- `refreshPublishedCrashDays`：读 `market_breadth_daily`（tradeDate 匹配）→ 物化进 `breadth`；缺则 null（不阻塞 published 行）。
- 新 runner `run-market-breadth.ts`：spawn `uv run market_sidecar ingest --scope breadth` → 调 `refreshPublishedCrashDays` 重投影。镜像 `run-crash-review.ts`。

**Acceptance：** 投影 per-date try/catch；广度缺 → `breadth` null + 页空状态；幂等；core `tsc` clean。

### Story 8-8：`/crash-calendar/[date]` 深度详情页

**Boundaries：** AD-3 只读 `published_*`；force-dynamic；`robots noindex`；红涨绿跌 token 复用、`font-mono`、不新增 token；缺数据 `—` / 空状态（NFR-5）；不按反弹幅度排序（SM-C4）。

**改动：**
- 新 `apps/web/app/(public)/crash-calendar/[date]/page.tsx`：server component，`generateMetadata` + 非法/不存在 date → `notFound()`；渲染 T1 五段：
  1. 涨跌停广度（涨停/跌停家数、最高连板、炸板率）— `ReactionChip tone="down/up"` + `font-mono`
  2. 涨跌家数 / 涨跌比
  3. 两市成交额（是否放量：与近 5/20 日均值比对，文字标注）
  4. 龙虎榜：上榜个股数 + 机构净买 vs 游资净买 + Top-N 个股
  5. 融资融券余额变化（T-1，可空）
  - 保留：宽基 / 领跌板块 / 前瞻收益 / 当日热点事件（迁移自现 `CrashDayDetail`）
  - 合规说明块（镜像 `EditorialReasonBlock`：hairline + 标签 + body-sm，中性 `bg-surface-muted`）
- 索引页 `crash-calendar/page.tsx`：去掉内联 `CrashDayDetail`，日历格子 `<Link href="?d=">` → `<Link href={'/crash-calendar/'+dayKey}>`；index 退化为纯日历 + 提示「点选大跌日查看详情」。

**Acceptance：** `[date]` 渲染五段，缺数据诚实空状态；非法 date `notFound()` 不报错；移动端可读（NFR-4）；noindex；tsc clean。

---

## 5. Implementation Handoff

- **Scope = Moderate**（新表 + sidecar 扩展 + 新路由 + 投影列 + 合规复核扩范围）。
- **Route to：** Developer（实现 8-6/8-7/8-8）+ PM（合规 action item 范围扩大，律所复核纳入龙虎榜/涨跌停）。
- **Success criteria：**
  1. 三个 story 各自 `tsc --noEmit` clean + fixture/迁移本地 PG 通过。
  2. `python -m market_sidecar ingest --scope breadth --smoke` 拉近 5 日 T1 数据入库。
  3. `/crash-calendar/[date]` 渲染五段，缺数据不伪造、不报错。
  4. 合规：继续 noindex + prod 不投影；律所复核 action item 已记录扩大范围。
- **合规 action item（追加 epic-8）：**「龙虎榜 / 涨跌停 / 融资融券属金融信息，§12 Q9/Q10 律所复核范围须覆盖；GA 前须外部律所书面意见。」

---

## 附：数据源决策记录（Carver 已确认）

| 指标 | T1 MVP | 源 | 状态 |
|---|---|---|---|
| 涨跌停家数 / 连板 / 炸板 | ✅ | AkShare `stock_zt_pool_em` / `dtgc_em` / `zbgc_em` | 免费稳定 |
| 涨跌家数 / 涨跌比 | ✅ | AkShare `stock_zh_a_spot_em` 派生 | 免费稳定 |
| 两市成交额 | ✅ | AkShare spot 聚合 + index 成交量 | 免费稳定 |
| 龙虎榜（机构 vs 游资） | ✅ | AkShare `stock_lhb_*` | 免费稳定 |
| 融资融券余额变化 | ✅ | AkShare `stock_margin_*`（T-1） | 免费稳定 |
| ~~北向资金~~ | ❌ 砍 | `stock_hsgt_*` 2024-08-19 后失效 | 已停披露 |
| HV20（T2，deferred） | v1.2 | 自算自 `index_daily_bars` | 零新增源 |
| 板块资金流 / 期指基差（T2，deferred） | v1.2 | AkShare | 免费略糙 |
| 付费兜底（限流时） | 备选 | Tushare Pro ≈200 元/年 | 仅兜底 |
