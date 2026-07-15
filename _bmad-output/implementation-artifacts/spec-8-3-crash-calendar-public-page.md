---
title: '大跌日历公开页 /crash-calendar (8.3)'
type: 'feature'
created: '2026-07-15'
status: 'done'
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-15b.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2-crash-day-detection-and-forward-returns.md'
  - '{project-root}/packages/core/src/modules/publish-orchestrator/publish-service.ts'
  - '{project-root}/apps/web/app/(public)/daily/page.tsx'
warnings: ['new-table-published-crash-days', 'reads-8.1-sector-daily-bars', 'compliance-gate-noindex']
---

<intent-contract>

## Intent

**Problem:** Epic 8 把「市场反应」从 per-HotEvent 单点快照升级为历史序列回顾。8.1 落了行情日线
(`index_daily_bars` / `sector_daily_bars`)，8.2 把裸日线翻译成 `crash_days`(每大跌日一行 +
T+1/T+5/T+20 历史实际收益)。但**没有任何公开读模型、没有页面**——用户看不到。本 story 是 Epic 8
的展示层:把 `crash_days` + `sector_daily_bars` 投影成 `published_crash_days` 读模型(AD-3),
并在 `/crash-calendar` 渲染三段视图(日历 + 领跌板块 + 前瞻收益),带显式「非预测/非投资建议」护栏。

**Approach:**
- **新增 `published_crash_days` 读模型**(publish-orchestrator 拥有,AD-3 单一写者;tradeDate 键,
  完全镜像 `PublishedDailyDigest` 的 coverageDate-keyed 范式——大跌日不是 hotEvent 聚合,是
  tradeDate-keyed 统计投影)。投影函数 `refreshPublishedCrashDays` 是 `refreshPublishedDailyDigest`
  的 sibling(同模块、同键族、独立函数,不塞进 hotEventId-keyed `refreshPublishedReadModel`)。
- 投影**只读** `crash_days`(8.2 拥有)+ `sector_daily_bars`(8.1 拥有,领跌板块 8.3 首个 Node 消费者);
  物化 `indices`(从 crash_days 原样拷贝)+ `leadingSectors`(当日 Top-N 跌幅申万一级)进 published 行。
  物化而非页面实时读:历史日线不变,投影期物化既保持页面为纯 published 消费者(AD-3 一致),又给合规
  门禁单一控制点(行存在 = 已公开)。
- **触发接线**:8.2 的 dev runner `run-crash-review.ts` upsert 完 `crash_days` 后调一次
  `refreshPublishedCrashDays`——runner 是 wiring,投影写仍归 publish-orchestrator(crash-review 模块
  本身永远不写 published_crash_days,边界不变)。prod 载体(BullMQ/cron)出范围。
- **页面** `app/(public)/crash-calendar/page.tsx`:server component + `force-dynamic`(同 daily/topics),
  读 `listPublishedCrashDays`,渲染(1)月度日历网格(大跌日高亮,可点选 `?d=` 切换详情);
  (2)所选大跌日的领跌板块榜(`ReactionChip tone="down"`,复用涨跌 token,红涨绿跌);(3)前瞻收益表
  (T+1/T+5/T+20,`font-mono`,缺数据 `—` 不编造 NFR-5);+ 显式合规说明块(镜像
  `EditorialReasonBlock` 视觉契约:hairline 分隔 + 标签 + body-sm,但静态文案非 AI 解读 → 用中性
  `bg-surface-muted` 而非 `accent-warm`「AI 解读」标签)+ `robots noindex`(§12 Q10 未清前不被索引)。
- 桌面 side-nav 入口已存在(side-nav.tsx:30);**移动端抽屉入口归 8.4**,本 story 不碰 PublicNav。

## Boundaries & Constraints

**Always:**
- AD-3 单一写拥有者:`published_crash_days` 仅 publish-orchestrator 写;页面只读 published_*。
- 第三方数据经只读(AD-7):投影只**读** `crash_days` + `sector_daily_bars`;不调 AkShare、不引 Python。
- 行存在 = 当前已公开(无 status 列);缺 crash_days 源行 → 投影 deleteMany(自愈,同 published_* 范式)。
- 可追溯(NFR-2)+ 不编造(NFR-5):每行 `source` / `traceId` / `publishedAt`;T+N 缺未来数据时为 null
  → 页面显式 `—`;领跌板块缺数据 → 明确「该日领跌板块数据暂不可用。」不补 0 不外推。
- 涨跌色复用既有 token(红涨 `text-market-up` / 绿跌 `text-market-down`),**不新增 token**(SM:复用
  `reaction-chip-down`)。数字一律 `font-mono`。
- 合规护栏:页面显式「历史统计回顾,非预测、非投资建议」;`metadata.robots.noindex`;不以「大跌后
  涨幅最大化」为展示目标(SM-C4 对冲——排序按 tradeDate 倒序,不按反弹幅度排)。
- 主键 tradeDate(镜像 PublishedDailyDigest coverageDate @id);时间 UTC;表名 snake_case 复数
  (`published_crash_days`);列 snake_case。
- 错误隔离:投影 per-date try/catch,单日失败 skip 不中断整批。

**Block If:**
- `prisma migrate deploy` 创建 `published_crash_days` 失败且非自愈原因 → HALT。(本地 PG open,8.1/8.2 验证。)
- `@prisma/client` 重生成后 `packages/core` `tsc --noEmit` 不绿 → HALT。

**Never:**
- 不在 crash-review 模块内写 published_crash_days(归 publish-orchestrator)。
- 不做移动端 PublicNav 抽屉入口(归 8.4)。
- 不做大跌日 ↔ HotEvent 关联(8.5,deferred v1.2)。
- 不做调度接线(挂 BullMQ/cron)——只交付投影函数 + runner 触发 + 页面。
- 不抓个股 / 不预测 / 不做抄底建议(前瞻收益是历史实际值,措辞护栏在展示层)。
- 不改 `crash_days` / `index_daily_bars` / `sector_daily_bars` schema 或既有迁移。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|---|---|---|---|
| 日历视图(AC1) | published_crash_days 有数据 | 月度网格;大跌日高亮(`bg-market-down-soft`)+ 可点选 | 无 |
| 详情默认(AC1) | 无 `?d=` 参数 | 展示最近一个大跌日详情 | 无 |
| 详情点选(AC1) | `?d=YYYY-MM-DD` 命中 | 展示该日详情 | 非法/不命中 → 回落最近 |
| 领跌板块(AC2) | 当日 sector_daily_bars 有跌幅行 | Top-N 跌幅板块榜(ReactionChip down) | 无 |
| 领跌板块缺(AC2) | 当日无 sector 跌幅行 | 「该日领跌板块数据暂不可用。」不伪造 | 不编造 NFR-5 |
| 前瞻收益足(AC3) | T+N 有值 | font-mono 数字,正红负绿 | 无 |
| 前瞻收益缺(AC3) | T+N 为 null | `—`(text-ink-tertiary) | 不编造 NFR-5 |
| 空状态(AC4) | published_crash_days 为空 | 「暂无已记录的大跌日。」+ 上线提示 | 无 |
| 移动端(AC5) | 窄屏 | 7 列网格 + 堆叠详情可用 | 无(NFR-4) |
| 投影自愈(AC6) | crash_days 源行被删/不再达标 | 对应 published 行被 prune | 无 |
| 合规(AC7) | 任何状态 | 显式非预测说明 + noindex | 无 |

</intent-contract>

## Code Map

```
packages/core/prisma/schema.prisma                                       # +model PublishedCrashDay (publish-orchestrator 拥有;tradeDate @id;Json indices/leadingSectors)
packages/core/prisma/migrations/20260715000003_add_published_crash_days/migration.sql
packages/core/src/modules/publish-orchestrator/types.ts                  # +LeadingSector +PublishedCrashDay +Refresh/List options
packages/core/src/modules/publish-orchestrator/publish-service.ts        # +refreshPublishedCrashDays +listPublishedCrashDays (sibling to refreshPublishedDailyDigest)
packages/core/src/modules/publish-orchestrator/index.ts                  # +export new fns/types
packages/core/src/index.ts                                               # +re-export
apps/worker/src/run-crash-review.ts                                      # after upsertCrashDays → refreshPublishedCrashDays
apps/web/app/(public)/crash-calendar/page.tsx                            # NEW 公开页
```

## Acceptance Criteria

- **AC1** `/crash-calendar` 渲染月度日历网格,大跌日高亮;点选大跌日(`?d=`)或默认展示最近大跌日详情
  (触发指数 + 跌幅)。非法 `?d=` 回落最近,不报错。
- **AC2** 详情含「领跌板块榜」:当日 Top-N 申万一级跌幅板块,复用 `ReactionChip tone="down"`,
  红涨绿跌 token;无数据时明确空状态不伪造。
- **AC3** 详情含「前瞻收益表」:三大宽基 × T+1/T+5/T+20,`font-mono`,正红负绿,缺数据 `—`(NFR-5)。
- **AC4** `published_crash_days` 为空时页面显示明确空状态(「暂无已记录的大跌日。」),不渲染假数据不留白。
- **AC5** 移动端可用(NFR-4):7 列日历网格 + 堆叠详情在窄屏可读可点。
- **AC6** 投影自愈:crash_days 源行不存在时,对应 published_crash_days 行被 prune;按 tradeDate 幂等 upsert。
- **AC7** 合规护栏:页面显式「历史统计回顾,非预测、非投资建议」说明 + `robots noindex`;不按反弹幅度排序(SM-C4)。
- **AC8** Prisma 迁移本地 PG 成功;`@prisma/client` 重生成后 `packages/core` `tsc --noEmit` clean;
  `apps/web` `tsc --noEmit` clean。

## Dev Notes

- `published_crash_days` 完全镜像 `PublishedDailyDigest`(coverageDate @id,无独立 id 列,`updatedAt`,
  无 FK);投影是 sibling 函数(键族 = tradeDate,非 hotEventId),**不**塞进 `refreshPublishedReadModel`。
- 领跌板块查询:`sectorDailyBar.findMany({ where:{ tradeDate, pctChange:{ lt:0 } }, orderBy:{
  pctChange:"asc" }, take: LEADING_SECTOR_LIMIT=5 })`;`Prisma.Decimal.toNumber()` 入 Json。
- 投影把 `crash_days.indices` Json **原样拷贝**(不解释类型;页面端 `as unknown as IndexCrashDetail[]`)。
- 触发指数高亮:`IndexCrashDetail.crashed` 标识是否 ≤ 阈值;`pctChange` 符号定 chip tone(跌=down)。
- 日期一律用 UTC getter(`getUTCFullYear/Month/Date/Day`)格式化,避免 @db.Date 的 TZ 漂移。
- `metadata.robots = { index:false, follow:false }`:§12 Q10 合规复核未清前不被搜索引擎索引;
  合规门禁 = prod 暂不跑 `refreshPublishedCrashDays`(行不存 → 页面空状态),dev 可跑用于预览。
- side-nav 桌面入口已存在(side-nav.tsx:30);移动端抽屉入口、BullMQ/cron 接线均不在本 story。

## File List

### Prisma schema + migration (publish-orchestrator owns the table)

- `packages/core/prisma/schema.prisma` — **modified**: added `model PublishedCrashDay`
  (table `published_crash_days`, tradeDate @id, Decimal threshold, Int crash_count, Json
  indices + Json leading_sectors @map("leading_sectors"), source, published_at, trace_id,
  updated_at). Mirrors PublishedDailyDigest (coverageDate→tradeDate @id). NO FK to
  crash_days / sector_daily_bars — derived projection.
- `packages/core/prisma/migrations/20260715000003_add_published_crash_days/migration.sql` —
  **new**: CREATE TABLE published_crash_days (trade_date DATE PK). Applied to local PG via
  `prisma migrate deploy` (forward-only). `@prisma/client` regenerated; core `tsc` clean.

### publish-orchestrator projection + reads

- `packages/core/src/modules/publish-orchestrator/types.ts` — **modified**: +LeadingSector,
  +PublishedCrashDay, +RefreshPublishedCrashDaysOptions, +ListPublishedCrashDaysOptions;
  imports IndexCrashDetail type from crash-review (dependency points publish→domain, no cycle).
- `packages/core/src/modules/publish-orchestrator/publish-service.ts` — **modified**:
  +`refreshPublishedCrashDays` (sibling to refreshPublishedDailyDigest; reads crash_days +
  sector_daily_bars Top-N down → upsert published_crash_days; per-date try/catch; self-heal
  prunes stale rows) + `listPublishedCrashDays` (tradeDate desc read for the page).
- `packages/core/src/modules/publish-orchestrator/index.ts` — **modified**: exports the new
  functions + types.
- `packages/core/src/index.ts` — **modified**: re-exports to the @aguhot/core barrel.

### Runner wiring

- `apps/worker/src/run-crash-review.ts` — **modified**: after `upsertCrashDays`, calls
  `refreshPublishedCrashDays` in the same date range so the public read model tracks the
  recompute. Runner is wiring; the projection write stays owned by publish-orchestrator.

### Public page

- `apps/web/app/(public)/crash-calendar/page.tsx` — **new**: server component, force-dynamic,
  robots noindex. Reads listPublishedCrashDays; renders compliance note + (empty state | month
  calendar grids + crash-day detail = 当日宽基 chips + 领跌板块 + 前瞻收益表). Red-up/green-down
  tokens reused; font-mono numerics; null T+N → 「—」 (NFR-5); touch-target h-11 (44px, 3-6 baseline).

### Story spec + sprint status

- `_bmad-output/implementation-artifacts/spec-8-3-crash-calendar-public-page.md` — **new**:
  this file; status ready-for-dev → in-review.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — **modified**: 8-3 backlog → review.
