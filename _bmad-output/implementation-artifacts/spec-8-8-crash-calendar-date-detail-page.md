---
title: '/crash-calendar/[date] 深度详情页 (8.8)'
type: 'feature'
created: '2026-07-16'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'bd6b3173a7acb353c7a9e35ebdb1c45df6855de5'
final_revision: '5c39765975bbd3f525f47d625eadc64d7bb3da6d'
warnings: ['oversized']
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-16.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-7-crash-breadth-projection-and-runner.md'
  - '{project-root}/apps/web/app/(public)/crash-calendar/page.tsx'
  - '{project-root}/apps/web/app/(public)/events/[hotEventId]/page.tsx'
  - '{project-root}/apps/web/components/chips.tsx'
---

<intent-contract>

## Intent

**Problem:** `/crash-calendar` 现为单页 + `?d=` 内联详情，只展示 4 段（宽基 / 领跌板块 / 前瞻收益 / 当日热点）。8.7 已把市场广度（涨跌停 / 涨跌家数 / 成交额 / 龙虎榜 / 融资融券）物化进 `published_crash_days.breadth`，但还没有任何页面消费它——大跌日最有信息量的广度事实无处可看。

**Approach:** 新增动态路由 `apps/web/app/(public)/crash-calendar/[date]/page.tsx`，server component + `force-dynamic` + `robots noindex`，只读 `listPublishedCrashDays` + `listPublishedHotEvents`（既有 core fn，零 core 改动——8.7 AC6 已为此暴露 `breadth`）。按 `formatDay(tradeDate)===date` 在 JS 里 find 命中行（V1 体量极小，镜像 index 页 list+filter 范式），非法/不存在的 date → `notFound()`。渲染广度 5 段 + 继承的 4 段（宽基 / 领跌板块 / 前瞻收益 / 当日热点）。索引页 `crash-calendar/page.tsx` 同步瘦身为纯日历：去掉内联 `CrashDayDetail` 与 `?d=` focus 逻辑，日历格子改链 `/crash-calendar/{dayKey}`，补一行「点选大跌日查看详情」提示。

## Boundaries & Constraints

**Always:**
- AD-3 只读 `published_*`：详情页**仅**调 `listPublishedCrashDays` + `listPublishedHotEvents`（既有导出），**绝不**直读 `market_breadth_daily` / `crash_days` / `index_daily_bars` / `sector_daily_bars`。行存在 = 已公开。
- NFR-5 诚实空 / 不伪造：`breadth===null` → 广度 5 段统一显示「该日广度数据暂不可用」，**但继承的 4 段照常渲染**（breadth 缺失不阻塞整页）。`breadth` 内 nullable 字段（`advancingCount`/`decliningCount`/`flatCount`/`totalTurnover`/`marginBalanceChange`，历史日多为 null）原样显示「—」，**不补零、不拼占位**。`dragonTiger===null` 或形态不符 → 龙虎榜段诚实空。
- NFR-4 移动端可用：沿用 `mx-auto max-w-3xl px-6` 纵栏；所有表格 `overflow-x-auto`（镜像 `ForwardReturnsTable`）。
- 合规护栏（§10 / §12 Q9/Q10 / SM-C4）：`generateMetadata` 返回 `robots:{index:false,follow:false}`；显式「历史统计回顾，非预测、非投资建议」说明块（镜像 index 页既有说明块：hairline + 「说明」标签 + body-sm + `bg-surface-muted`）；不按反弹幅度排序（继承 `listPublishedCrashDays` 的 tradeDate DESC）。
- 复用既有 token / 组件，**不新增 token**：红涨绿跌用 `text-market-up`/`text-market-down` + `ReactionChip`（`tone="up"/"down"/"flat"`）；所有数字 / 收益 / 金额用 `font-mono`。
- 路由范式镜像 `/events/[hotEventId]`：`export const dynamic = "force-dynamic"`；`params: Promise<{ date: string }>`；`await params` 后校验 `^\d{4}-\d{2}-\d{2}$` 且命中已发布行，否则 `notFound()`（不报错、不回退——与 index 页 `?d=` 的回退语义**不同**，详情段缺则 404）。

**Block If:**
- 无（纯 web 渲染层，零 core / 零迁移 / 零 sidecar；无不可自决决策）。

**Never:**
- 不改 `packages/core`（schema / service / types 一律不动——8.7 已交付 `breadth` 读路径；本 story 仅消费）。
- 不直读任何非 `published_*` 表（AD-3）。
- 不做「放量 vs 近 5/20 日均值」文字比对（见 Design Notes：AD-3 下读模型无多日成交额序列，NFR-5 禁止伪造比对 → 只渲染当日绝对成交额，比对 deferred）。
- 不重算 / 重写 crash 检测、不触发 sidecar、不动 runner。
- 不在索引页保留 `?d=` 内联详情（详情整体迁至 `[date]`；索引页不再读 `listPublishedHotEvents`）。
- 不新增任何依赖。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| 命中已发布大跌日 + breadth 齐全 | `/crash-calendar/2026-07-14`，该日有 published 行且 `breadth!=null` | 渲染广度 5 段（涨跌停 / 涨跌家数 / 成交额 / 龙虎榜 / 融资融券）+ 继承 4 段；说明块；noindex | 无 |
| 命中但 `breadth===null` | 该日 published 行存在，`breadth` 为 null（sidecar 未跑该日 / 早于广度采集） | 广度 5 段统一「该日广度数据暂不可用」；继承 4 段照常渲染 | 无（诚实空，非报错） |
| breadth 部分字段 null | `breadth` 对象存在，但 `advancingCount`/`totalTurnover`/`marginBalanceChange`/`dragonTiger` 等为 null（历史日 spot/margin 源 NULL） | 对应字段渲染「—」/ 段内诚实空；其余字段正常 | null 原样透传，不补零 |
| date 非法 | `/crash-calendar/2026-7-14` 或 `/crash-calendar/foo`（不符 `YYYY-MM-DD`） | `notFound()` → 404 | 不回退、不报 500 |
| date 合法但无已发布行 | `/crash-calendar/2026-07-14` 格式合法但该日非大跌日 / 未投影 | `notFound()` → 404 | 同上 |
| 索引页点选 | 日历格子点击 | 导航至 `/crash-calendar/{dayKey}`（不再是 `?d=`） | 无 |

</intent-contract>

## Code Map

```
apps/web/app/(public)/crash-calendar/[date]/page.tsx                 # NEW 动态详情页: force-dynamic + generateMetadata(noindex) + notFound(); 渲染广度5段 + 继承4段
apps/web/app/(public)/crash-calendar/_components/crash-day-shared.tsx  # NEW(tsx,可 collocate 于 [date] 亦可): 抽出共享 helper(formatDay/INDEX_LABEL/WEEKDAY_CN/signTone/absPct/signedPct) + 详情子组件(LeadingSectors/ForwardReturnsTable/ReturnCell/LinkedHotEvents) + 广度5段组件
apps/web/app/(public)/crash-calendar/page.tsx                       # 改: 删 CrashDayDetail + ?d= focus + listPublishedHotEvents 读; 格子链 /crash-calendar/{dayKey}; 补「点选大跌日查看详情」; 保留月历网格 + 说明块 + 空状态
```

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/crash-calendar/_components/crash-day-shared.tsx` -- NEW：把现 `page.tsx` 里的纯 helper（`formatDay`、`INDEX_LABEL`、`WEEKDAY_CN`、`signTone`、`absPct`、`signedPct`）与详情子组件（`LeadingSectors`、`ForwardReturnsTable`、`ReturnCell`、`LinkedHotEvents`）抽出共享，供索引页月历与 `[date]` 详情页复用；并新增广度 5 段渲染组件（见下）-- 消除重复 + 为详情页提供渲染件。
- `apps/web/app/(public)/crash-calendar/[date]/page.tsx` -- NEW：`export const dynamic = "force-dynamic"`；`generateMetadata({ params })` 返回 `{ title: \`${date} 大跌日回顾\`, robots:{index:false,follow:false} }`；`Page({ params })` await params → 校验 `/^\d{4}-\d{2}-\d{2}$/.test(date)` 不符 `notFound()`；`const [crashDays, hotEvents] = await Promise.all([listPublishedCrashDays({prisma,traceId}), listPublishedHotEvents({prisma,traceId})])`；`const day = crashDays.find(c => formatDay(c.tradeDate) === date)`，`!day → notFound()`；`linkedEvents = hotEvents.filter(e => formatDay(e.publishedAt) === date)`（保序，cap 8，镜像现 index 范式）；渲染：说明块 → 当日宽基/触发 → 领跌板块 → 前瞻收益 → **广度 5 段** → 当日热点 -- 大跌日深度详情页（消费 8.7 `breadth`）。
- 广度 5 段渲染（`crash-day-shared.tsx` 内 `BreadthSections({ breadth }: { breadth: CrashDayBreadth | null })`）：`breadth===null` → 整组渲染单条「该日广度数据暂不可用」并 return；否则渲染：(1) 涨跌停广度：`ReactionChip tone="up"` limitUpCount + `tone="down"` limitDownCount + 文本「最高连板 {consecutiveBoardMax} / 炸板 {brokenBoardCount} 家」（`font-mono`）；(2) 涨跌家数：涨/跌/平三项，全 null → 「—」，均非 null 时附加「涨跌比 {advancing}/{declining}」；(3) 两市成交额：`totalTurnover` null → 「—」，非 null 按「亿」格式化（`/1e8` 保留 2 位），**不**做放量比对；(4) 龙虎榜：从 `breadth.dragonTiger`（`unknown`）**防御性解析** `{stockCount, institutionalNetBuy, hotMoneyNetBuy, topStocks?:[{code,name,netBuy,reason}]}`（字段缺失/null → 该项「—」），渲染上榜家数 + 机构净买 vs 游资净买（字符串金额按「亿/万」格式化）+ Top-N 个股（cap 8）；`dragonTiger===null` → 段内「该日龙虎榜数据暂不可用」；(5) 融资融券余额变化：`marginBalanceChange` null → 「—」（T-1，标注「前一交易日」），非 null 按「亿」格式化 -- 广度事实渲染 + 诚实空 + 防御性解析 `unknown` Json。
- `apps/web/app/(public)/crash-calendar/page.tsx` -- 改：删除 `CrashDayDetail` 及其调用、`?d=` focus 解析、`listPublishedHotEvents` 读与 `focusLinked`；`CrashMonthGrid` 的格子 `<Link href={\`?d=${dayKey}\`}>` 改为 `<Link href={\`/crash-calendar/${dayKey}\`}>`（去掉 `scroll={false}`，跨页导航）；`focusKey` 相关高亮逻辑删除；月历网格下方补一行 `font-mono text-xs text-ink-tertiary` 提示「点选大跌日查看详情」；共享 helper 改从 `_components/crash-day-shared` 导入；空状态（`crashDays.length===0`）与说明块保留 -- 索引页瘦身为纯日历入口，详情迁出。

**Acceptance Criteria:**
- **AC1** Given 某 date 有已发布 `published_crash_days` 行且 `breadth!=null`，when 访问 `/crash-calendar/{date}`，then 页面渲染广度 5 段（涨跌停 / 涨跌家数 / 成交额 / 龙虎榜 / 融资融券）+ 继承的宽基 / 领跌板块 / 前瞻收益 / 当日热点；数字用 `font-mono`，涨跌用 `ReactionChip`，红涨绿跌复用既有 token，无新增 token。
- **AC2** Given 该日 `breadth===null`，when 访问，then 广度 5 段统一显示「该日广度数据暂不可用」**且继承 4 段照常渲染**（breadth 缺失不阻塞整页）；`breadth` 内 nullable 字段为 null 时该项显示「—」，不补零、不伪造。
- **AC3** Given date 不符 `YYYY-MM-DD` **或** 格式合法但无已发布行，when 访问，then `notFound()` 返回 404（不报 500、不回退到最近大跌日）。
- **AC4** Given `breadth.dragonTiger` 为 `null` 或形态不符预期，when 渲染龙虎榜段，then 段内诚实空（「该日龙虎榜数据暂不可用」或字段级「—」），不抛错、不伪造个股。
- **AC5** `generateMetadata` 对所有 `[date]` 请求返回 `robots:{index:false,follow:false}`（§12 Q10 合规门禁）；页面 `force-dynamic`。
- **AC6** Given 用户在索引页点击日历格子，when 导航，then 跳转至 `/crash-calendar/{dayKey}`（不再是 `?d=`）；索引页不再渲染内联详情、不再读 `listPublishedHotEvents`；保留月历网格 + 说明块 + 空状态 + 「点选大跌日查看详情」提示。
- **AC7** 移动端（窄屏）可读：纵栏 + 表格横向滚动（NFR-4）；`pnpm --filter web build` 或 `tsc --noEmit` clean（无 core 改动，无需 migrate / generate）。

## Spec Change Log

<!-- 空，首轮规划。 -->

## Review Triage Log

### 2026-07-16 — Review pass 1
- intent_gap: 0
- bad_spec: 0
- patch: 3: (low 3)
- defer: 2: (medium 1, low 1)
- reject: 16 (low — 见下)
- addressed_findings:
  - `[low]` `[patch]` P1: `generateMetadata` 对 date 段做 `^\d{4}-\d{2}-\d{2}$` 校验，非法段（如 `/crash-calendar/foo-bar`）返回中性标题「大跌日回顾」而非把原始垃圾串插值进 per-date 标题（页体随后 `notFound()`→404）。
  - `[low]` `[patch]` P2: `narrowDragonTiger` 收紧 plausibility gate——由「任一已知键在」改为「`stockCount` 为 number」（8.6 golden shape 的规范性在场信号）。非 null 但 wrong-shape 的对象（如 `{error,...}`）现落段级「该日龙虎榜数据暂不可用」而非冒充真实但空的列表渲染「—」占位（NFR-5 不伪造）。
  - `[low]` `[patch]` P3: 索引页说明块去掉 stale 的「T+1/T+5/T+20 为大跌后该指数历史实际收益」（前瞻收益已随 refactor 迁至 `[date]`，索引页不再渲染）；改为描述索引实际内容（阈值 + 「点选大跌日查看领跌板块/前瞻收益/市场广度」）。
- deferred（见 deferred-work.md，本 pass 新增 2 条）:
  - `[medium]` crash-calendar 路由族无 e2e/seed；populated-breadth 渲染路径 + narrowDragonTiger + 404/noindex 契约无回归网（repo 8.3–8.8 一贯如此，manual 验证；延后到独立 crash-calendar e2e+seed story，镜像 e2e:daily）。
  - `[low]` `[defer]` `[date]` list+find 受 `listPublishedCrashDays` 默认 `limit=200` 上限——>200 大跌日后更早的已存在日期 deep-link 会假 404（pre-existing 8.3 范式；正解 = core `getPublishedCrashDay` getter，本 story Never「不改 core」范围外；V1 体量极小当前不可达）。
- rejected（silently dropped，择要）:
  - NaN/Infinity 未守卫（`fmtYi`/`fmtCount`/`signedPct`/`absPct`）：源自 Prisma Decimal `.toNumber()` 与 Int 列，源契约保证有限；`fmtAmount` 已守 `!isFinite`。不可达。
  - `breadth === undefined`（非 null）→ throw：8.7 投影 absent 用 `Prisma.DbNull`（SQL NULL→JS null），类型 `CrashDayBreadth | null`；undefined 不可达。
  - 龙虎榜金额字符串 `1e308`→荒谬亿值：源是 AkShare 龙虎榜净买入额（现实 ~10^8–10^10），有界；防御性偏执。
  - 「数据来源：AkShare」文案未读 `source` 字段：镜像 8.3 索引页既有硬编码文案惯例（source 架构上即 AkShare）；非本 story 引入。
  - `publishedAt` UTC-midnight 关联假设：8.5 既有 linkage 逻辑，逐字 lift，非本 story 引入。
  - `fmtAmount` 单位（元 vs 万）未来脆弱性：投机性；8.6 契约现为元。
  - 索引「不按反弹幅度排序」doc-comment stale：code comment 仅，非渲染；churn。
  - 月历 12 月截断 + 老日期不可达：pre-existing 8.3 `MONTH_GRID_CAP` 行为，未恶化；hint 为增量且对所展示内容正确。
  - `[date]` 页无返回链接：`BackLink` 依赖不含 `/crash-calendar` 的 list-route allowlist（永不 scroll-restore），且返回 chrome 不在 intent 页面内容范围（Approach 明列 5+4 段）；浏览器后退服务主流程（日历→详情）。非缺陷，scope-additive，drop。
  - 冗余 key 后缀 `${code??i}:${i}`、non-null `!`、`WEEKDAY_CN/INDEX_LABEL` 未 `as const`、BreadthSections 顺序仅文本、涨跌比 bare-text a11y（方向语义已在带标签 ReactionChip）、`_components/` 半 utils 半 UI 命名、`next-env.d.ts` 构建产物路径漂移、两 render 路径无共享测试（即 deferred 的 e2e 缺口）：cosmetic / 不可达 / 既有惯例 / 测试缺口已归 deferred。

## Design Notes

- **零 core 改动依据**：8.7 的 AC6 明示「`listPublishedCrashDays` 返回项含 `breadth` 字段（命中→对象/缺→null），供 8.8 详情页消费」。故 8.8 仅消费既有读路径，不新增 `getPublishedCrashDay` getter——详情页用 `listPublishedCrashDays` + JS `find(c => formatDay(c.tradeDate)===date)`（V1 体量极小，镜像 index 页 list+filter 范式；detail getter 与「list 无 filter param」ponytail 注记不冲突，后者约束 feed/search list）。
- **`?d=` 回退 vs `[date]` 404 的语义差异**：index 页 `?d=` 非法/未命中时回退到最近大跌日（honest-fallback，同 `/daily`）。`[date]` 详情段语义不同——它是「这一天的详情」，缺则 `notFound()`，不静默回退（避免给用户一个 URL 与内容不符的页面；镜像 `/events/[hotEventId]` 的 notFound 范式）。
- **放量比对 deferred（约束强制取舍，非开放问题）**：sprint-change-proposal §4 Story 8-8 第 3 段提「是否放量：与近 5/20 日均值比对，文字标注」。但 AD-3 禁止详情页直读 `market_breadth_daily`/`index_daily_bars`，而 `published_crash_days.breadth.totalTurnover` 只是单日标量——读模型**没有**多日成交额序列可供比对。NFR-5 禁止伪造比对。故唯一可行读法：渲染当日绝对成交额，放量比对 deferred（未来需在读模型新增近 N 日成交额均值投影，另开 story，不在 8.8 web-only 范围）。约束已选定读法，非 intent gap。
- **「炸板率」诚实为「炸板家数」**：§4 描述写「炸板率」，但底层 `broken_board_count` 是家数计数、非比率。NFR-5 下渲染为「炸板 N 家」，不伪造率值。
- **`dragonTiger` 防御性解析**：8.7 把 `dragonTiger` 作 `unknown | null` 透传（不在投影层重验 Json 形态）。8.6 的 golden 形态为 `{stockCount:number, institutionalNetBuy:string, hotMoneyNetBuy:string, topStocks?:[{code,name,netBuy,reason}]}`（金额为字符串，如 `"120000000"`）。渲染层须对 `unknown` 做类型 narrowing + 字段缺失/null 降级，绝不 `as any` 直取。金额格式化（亿/万）只用于展示，不改变语义。
- **共享件抽取边界**：仅抽**纯展示** helper + 详情子组件；月历网格 `CrashMonthGrid` 留在索引页（仅索引页用）。避免新建为「以后复用」的空抽象（ponytail）。

## Verification

**Commands:**
- `pnpm --filter web exec tsc --noEmit` -- expected: clean（无 core 改动，不涉及 migrate/generate；`CrashDayBreadth` / `PublishedCrashDay` 类型已在 core 导出）。
- `pnpm --filter web build` -- expected: 构建通过；`/crash-calendar/[date]` 因 `force-dynamic` 不在 build 期求值 DATABASE_URL（同 `/events/[hotEventId]`、`/daily`）。

**Manual checks:**
- 本地 dev：访问一个已投影且带 breadth 的大跌日 `/crash-calendar/{YYYY-MM-DD}` → 5 段 + 4 段齐显；访问一个 `breadth:null` 的日 → 广度段空、继承段在；访问 `/crash-calendar/foo` 或合法但非大跌日 → 404。
- 索引页：格子点击跳 `/crash-calendar/{dayKey}`；页面不再有内联详情段；移动端窄屏纵栏 + 表格可横滚。
- 查看页面源码确认 `<meta name="robots" content="noindex,nofollow">` 存在。

## Auto Run Result

Status: done

**实现摘要：** 新增 `/crash-calendar/[date]` Next.js 动态详情路由（server component + `force-dynamic` + `robots noindex`），消费 8.7 的 `published_crash_days.breadth`，渲染市场广度 5 段（涨跌停 / 涨跌家数 / 两市成交额 / 龙虎榜 / 融资融券）+ 继承 4 段（宽基 / 领跌板块 / 前瞻收益 / 当日热点）。索引页瘦身为纯日历入口，格子改链 `[date]`。web-only，零 `packages/core` 改动。

**改动文件：**
- `apps/web/app/(public)/crash-calendar/[date]/page.tsx` — NEW 动态详情页（generateMetadata noindex + 格式守卫；notFound on 非法/无行；list+find 命中行；渲染 5+4 段）。
- `apps/web/app/(public)/crash-calendar/_components/crash-day-shared.tsx` — NEW 共享 helper + 详情子组件 + `BreadthSections`（含 `narrowDragonTiger` 防御性收窄）。
- `apps/web/app/(public)/crash-calendar/page.tsx` — 瘦身为纯日历；删 `CrashDayDetail`/`?d=`/`listPublishedHotEvents`；格子链 `[date]`；说明文案去 stale。
- `apps/web/next-env.d.ts` — `next build` 再生（构建产物路径归一，非行为改动）。

**Review（pass 1，四路并行：adversarial / edge-case / verification-gap / intent-alignment）：**
- patch 3（皆 low）：generateMetadata 格式守卫、`narrowDragonTiger` 闸门收紧（`stockCount` 为 number 作规范性在场信号）、索引页 stale「T+1/T+5/T+20」文案移除。
- defer 2（见 deferred-work.md）：crash-calendar 路由族无 e2e/seed（medium，repo 8.3–8.8 一贯 manual，延后到独立 e2e story）；`list+find` 受 `limit=200` 上限（low，pre-existing 8.3 范式，V1 不可达，正解 = core getter，本 story Never 范围外）。
- reject 16：NaN/Infinity（源契约保证有限）、`breadth undefined`（8.7 DbNull 保证 null）、龙虎榜金额 1e308（有界源）、`source` 文案惯例、`publishedAt` 关联（8.5 既有）、单位脆弱性、doc-comment stale、月历截断（8.3 既有）、无返回链接（BackLink allowlist 不含本路由 + 非 intent 页面内容范围；drop）、cosmetic 项若干。
- follow-up review：**不推荐**（仅 3 处 localized low-consequence patch，无 behavior/API/security/data 影响）。

**验证：**
- `pnpm --filter web exec tsc --noEmit` — clean（patch 前后均通过）。
- `pnpm --filter web build` — 成功；路由表 `ƒ /crash-calendar/[date]` 与 `ƒ /crash-calendar`（动态，build 不触 DB）。
- 运行时 curl（dev server）：`/crash-calendar/foo`、`/crash-calendar/2026-7-14`、`/crash-calendar/2099-01-01` → 404；`/crash-calendar/2026-07-13` → noindex meta + breadth===null 诚实空 + 继承段齐显；索引格子链 `/crash-calendar/{dayKey}`。

**残留风险：**
- `breadth!==null` 渲染路径（5 段真实数字、`fmtYi` 亿格式、`narrowDragonTiger`、龙虎榜 Top-N）经 tsc/build 验证但未被运行时真实 breadth 数据触达（dev DB 唯一已发布大跌日 2026-07-13 的 `breadth===null`，sidecar 未投影该日广度）。逻辑直接、镜像已验证的空态兄弟路径；待 `run-market-breadth` 投影一个真实广度日后为最终确认（已归 deferred 的 e2e 缺口）。
- `list+find` `limit=200` 上限：>200 已发布大跌日后，更早的已存在日期 deep-link 会假 404（V1 体量极小，当前不可达；见 deferred）。
- 未提交的残留产物（非本次变更，按规约保留原处）：根目录若干 `.png` 截图 / `design-artifacts/*.html` demo / `.playwright-mcp/`（先前视觉工作产物）。
