---
title: '大跌日 ↔ 当日已发布 HotEvent 关联 (8.5)'
type: 'feature'
created: '2026-07-15'
status: 'ready-for-dev'
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-15b.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-3-crash-calendar-public-page.md'
  - '{project-root}/apps/web/app/(public)/crash-calendar/page.tsx'
  - '{project-root}/packages/core/src/modules/publish-orchestrator/publish-service.ts'
  - '{project-root}/packages/core/src/modules/publish-orchestrator/types.ts'
warnings: ['deferred-v1.2-pulled-forward', 'date-filter-tz-drift', 'compliance-gate-still-open']
---

<intent-contract>

## Intent

**Problem:** 8.3 交付了 `/crash-calendar` 公开页 + `published_crash_days` 读模型,但大跌日是**孤立的**
统计回顾——和 aguhot 的核心资产「热点事件流」断开。用户看一个大跌日时,看不到当日市场在关注什么
(哪些 HotEvent 当日已发布)。epics.md Story 8.5 原文:「把大跌日历与现有热点事件流打通:大跌日
高亮关联当日已发布 HotEvent,复用 Epic 7 saliency / market reaction」(原 deferred v1.2,因「避免
与 saliency 调参期耦合」;Carver 2026-07-15 显式点名拉前执行)。

**Approach (最小 diff,纯 web 渲染层):**
- **不改 core / 不改 schema / 不新增读模型。** 复用既有 `listPublishedHotEvents`(返回全部已发布
  HotEvent,**已按 saliency DESC 排序**,含 `hotEventId`/`title`/`publishedAt`)。
- 复用页面既有的 UTC 安全 `formatDay(d)` helper,在 **web 层 JS 过滤**当日事件——这正是
  `ListPublishedHotEventsOptions` 注释锁定的设计:「the web layer applies any date-window
  filtering in JS … windowing is a UI concern, not a domain rule」(不把窗口塞进查询)。
- 「当日」= `formatDay(event.publishedAt) === formatDay(crashDay.tradeDate)`(首次发布日 == 大跌
  交易日,UTC 午夜对齐)。复用 saliency:返回顺序即 saliency 序,渲染为 #1/#2… 顺位(不暴露原始
  分数,summary 类型本就不含 saliency 字段)。复用 market reaction:大跌日详情已展示宽基涨跌
  chip;关联的 HotEvent 详情页(`/events/[hotEventId]`)自带 reaction——本 story 不在列表项里加
  per-event reaction chip(需 join `published_hot_event_reactions`,超 MVP,见 Enhancement)。
- 在 `CrashDayDetail` 加第四段「当日热点事件」:顺位 + 标题 + 链接 `/events/{hotEventId}`;无关联
  时诚实空状态(NFR-5,从不渲染假数据);> CAP 时诚实截断标注(镜像 `MONTH_GRID_CAP` 范式)。

**Done when:**
- 选中任一大跌日,详情区出现「当日热点事件」段;列出当日(UTC 发布日 == 该大跌交易日)已发布
  HotEvent,按 saliency 顺位,每条可点进 `/events/{hotEventId}`。
- 当日无已发布 HotEvent 时,渲染诚实空状态(不省略段落、不报错、不造假)。
- saliency 顺位正确(复用既有 orderBy,无新排序逻辑);TZ 不漂移(复用 UTC `formatDay`)。
- `apps/web` `tsc --noEmit` clean;无新 token;220px 左栏 / 既有三段视图不变。
- 不触碰 core 包 / schema / migration(纯 web)→ 无需重建 core dist 或重启原因。

## Boundaries & Constraints

**Always:**
- 纯 web 渲染层改动(AD-3:公开页只读 published_*;`listPublishedHotEvents` 已是合规读路径)。
- 复用既有 `listPublishedHotEvents` + 既有 UTC `formatDay`;日期过滤放 web 层(锁定设计)。
- 诚实空状态 + 诚实截断(NFR-2 / NFR-5,镜像 8.3 既有范式)。
- 复用既有 chip / token / 排版;不新增 token。
- 合规护栏继承 8.3:页面 `robots: noindex`(§12 Q10 未清前不公开);措辞不暗示预测/建议(SM-C4)。

**Never:**
- 不改 `packages/core`、`schema.prisma`、migration、`published_*` 读模型或 `listPublishedHotEvents`
  签名(若确需 per-event reaction chip,开新 story,不在本 story 内 join reaction 读模型)。
- 不引入「当日 = 已上线(live)窗口」的 fuzzy 语义(Interpretation B,publishedAt <= tradeDate 的
  滑窗)——MVP 用 crisp 的「首次发布日 == 大跌日」(Interpretation A);B 留作 future。
- 不为关联列表加 saliency 原始分数显示(summary 不含该字段,不为此扩字段)。
- 不改 220px 左栏 / 既有三段(日历网格 / 领跌板块 / 前瞻收益)视图与排布。

## Acceptance Criteria

- **AC1** 选中一个「当日确有已发布 HotEvent」的大跌日 → 详情区第四段「当日热点事件」列出这些
  事件,按 saliency 顺位(#1、#2 …),每条标题可点跳 `/events/{hotEventId}`。
- **AC2** 选中一个「当日无任何已发布 HotEvent」的大跌日 → 第四段渲染诚实空状态文案(如「该日暂无
  关联热点事件」),段落仍在,不报错,不渲染占位假数据。
- **AC3** saliency 顺位 = `listPublishedHotEvents` 返回顺序(无新排序);UTC 日期对齐用既有
  `formatDay`,无 TZ 漂移(大跌交易日与事件发布日都按 UTC 午夜比)。
- **AC4** 关联事件数 > CAP(默认 8)→ 截断到 CAP 并诚实标注「共 N 条,仅展示前 CAP」(镜像
  `MONTH_GRID_CAP` 范式);<= CAP 时无标注。
- **AC5** 视觉:复用既有 chip / token / `font-mono` 序号范式;不新增 token;既有三段视图与 220px
  左栏不变。
- **AC6** `apps/web` `tsc --noEmit` clean。
- **AC7** 纯 web 改动:无 core / schema / migration 变更(git diff 仅 `apps/web/**` + 本 spec +
  sprint-status)。

## Dev Notes

- **读路径已就绪**:`listPublishedHotEvents({ prisma, traceId })` → `PublishedHotEventSummary[]`
  = `{ hotEventId, title, evidenceCount, latestEvidenceAt, publishedAt }`,orderBy =
  `saliency DESC nulls last → evidenceCount DESC → latestEvidenceAt DESC`。**无需也不能**从 summary
  读 saliency 原始分;顺位由数组下标隐含。
- **页面结构**:`CrashCalendarPage`(server component, `force-dynamic`)已 `getPrisma()` + 调
  `listPublishedCrashDays`。再追加一次 `listPublishedHotEvents` 调用,在 page 层算出 focus 日关联集,
  作为新 prop 传入 `CrashDayDetail`(保持其为纯展示组件,与现 `day` prop 一致)。
- **UTC 日期对齐**:必须复用页内已有 `formatDay(d)`(用 `getUTCFullYear/Month/Date`),**禁止**用
  `toDateString()` / local getter——TZ 漂移会把临界日事件错配到相邻日(已知 footgun)。
- **CAP 与截断**:定义模块级常量(如 `LINKED_EVENTS_CAP = 8`),镜像 `MONTH_GRID_CAP` 的「截断即
  诚实标注」范式;V1 published 体量极小,CAP 主要为防御性。
- **顺位渲染**:用 `font-mono` 序号(#1/#2)与既有 `text-ink-secondary` 标题色;链接用 `next/link`
  `Link`(页面已 import)。无 reaction chip(见 Enhancement)。
- **合规**:页面 `metadata.robots = { index:false, follow:false }` 已由 8.3 设定,本 story 不动;
  关联段文案中性,不暗示「大跌后这些事件会涨」(SM-C4)。
- **Next.js 提示**:`apps/web/AGENTS.md` 警告「This is NOT the Next.js you know」。本改动只在既有
  `force-dynamic` server component 内加一段渲染 + 一次既有读函数调用,无新 client/route/api 面;
  动笔前若有疑问读 `node_modules/next/dist/docs/` 对应章节。

## File List

- `apps/web/app/(public)/crash-calendar/page.tsx` — **modified**:
  - 顶部 import 增 `listPublishedHotEvents` + 类型 `PublishedHotEventSummary`(从 `@aguhot/core`)。
  - 模块级加 `const LINKED_EVENTS_CAP = 8;`。
  - `CrashCalendarPage` 内追加 `const hotEvents = await listPublishedHotEvents({ prisma, traceId })`。
  - 算 focus 日关联集:`hotEvents.filter(e => formatDay(e.publishedAt) === focusKey)`(focusKey 已
    存在;focus 为 undefined 时跳过),取前 CAP,记 total 用于截断标注。
  - `CrashDayDetail` 增 prop `linkedEvents: { hotEventId: string; title: string }[]` + `linkedTotal: number`,
    渲染第四段「当日热点事件」(顺位 + `Link` to `/events/{hotEventId}` + 空状态 + 截断标注)。
- `_bmad-output/implementation-artifacts/spec-8-5-crash-day-hot-event-linkage.md` — **new**: 本文件。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — **modified**: 8-5 backlog → review。

## Code Map

```
apps/web/app/(public)/crash-calendar/page.tsx   # +listPublishedHotEvents 调用 / JS 当日过滤 / CrashDayDetail 第四段
```

## Review Notes

- **纯 web**:无 core/schema/migration → 不重建 core dist、不重启原因(对齐 8.4 Review Notes 范式)。
- **设计一致性**:日期过滤放 web 层是 `ListPublishedHotEventsOptions` 注释锁定的既有决策,本 story
  遵守而非打破(不往 core 查询塞 `since`/date 参数)。
- **saliency 复用而非重算**:顺位 = 既有 orderBy 的返回顺序;不读 / 不显示原始分(summary 无此字段)。
- **deferred 拉前说明**:8.5 原 deferred v1.2(避免 saliency 调参期耦合);saliency 评分已落地
  (`event-assembly/saliency.ts` + schema 字段),Carver 2026-07-15 显式点名执行 → 拉前合理。
- **合规门仍开**:§12 Q9/Q10 行情数据合规未清 → `/crash-calendar` 仍 `noindex` 且 prod 不投影
  `published_crash_days`(行不存→空状态);本关联段在同一页面、同一护栏下,不改变公开状态。
- **Enhancement(不在本 story)**:为关联项加 per-event market-reaction chip 需 join
  `published_hot_event_reactions` → 应开独立 story 扩 summary 或新增按日读 helper。

</intent-contract>
