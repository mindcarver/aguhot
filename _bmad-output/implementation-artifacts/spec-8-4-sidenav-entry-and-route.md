---
title: '左栏 SideNav 入口 + 路由 + 移动端导航一致性 (8.4)'
type: 'feature'
created: '2026-07-15'
status: 'ready-for-dev'
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-15b.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-3-crash-calendar-public-page.md'
  - '{project-root}/apps/web/app/(public)/_components/side-nav.tsx'
  - '{project-root}/apps/web/app/(public)/_components/public-nav.tsx'
  - '{project-root}/apps/web/app/(public)/layout.tsx'
warnings: ['mobile-nav-consistency', 'active-state-startsWith']
---

<intent-contract>

## Intent

**Problem:** Epic 8 把「市场反应」升级为历史序列回顾。8.3 已交付 `/crash-calendar` 公开页 + 读模型
`published_crash_days`,并**已**在桌面 `<SideNav>` CONTENT 里加了 `/crash-calendar` 导航项
(side-nav.tsx:30)。但 8.3 的边界明确把「移动端抽屉入口」留给 8.4。当前移动端导航 `<PublicNav>`
的 `PRIMARY_NAV_ITEMS` 只有 [首页/日报/主题/收藏] —— **移动端用户无法从导航进入大跌日历页**,
桌面/移动端导航不一致。

**Approach:** 最小 diff:在 `public-nav.tsx` 的 `PRIMARY_NAV_ITEMS` 加一项
`{ href: "/crash-calendar", label: "大跌日历" }`。`DesktopNav` 与 `DrawerNav` 都遍历同一数组,
所以一次加入同时覆盖桌面顶栏链与移动抽屉(`PublicNav` 被 layout 包在 `md:hidden` 里 → 实际只在
移动端渲染,但顶栏/抽屉共用数组,逻辑一致)。`isActive` 用 startsWith,`/crash-calendar` 的
active 态自动正确(无子路由前缀冲突)。220px 左栏不动(SideNav 已含该项)。路由 `/crash-calendar`
由 8.3 落地,已存在。

**Done when:**
- 桌面 SideNav + 移动 PublicNav 抽屉都含「大跌日历」入口(label/icon 一致或语义一致)。
- active 态在 `/crash-calendar` 正确高亮,不影响其它项。
- `apps/web` `tsc --noEmit` clean。
- 220px 左栏布局不变。

## Boundaries & Constraints

**Always:**
- 导航一致性是核心 AC(成功标准原文:桌面/移动端导航一致;active 态正确)。
- 复用既有 `isActive(pathname, href)` startsWith 启发;`/` 仍 exact-only,不被新项影响。
- 不新增 token / 不改 220px 布局 / 不改路由(路由归 8.3)。
- 最短 diff:只改 `PRIMARY_NAV_ITEMS` 一处,不复制链渲染逻辑。

**Never:**
- 不做 8.5(大跌日 ↔ HotEvent 关联,deferred v1.2)。
- 不改 `/crash-calendar` 页面本身或 `published_crash_days` 读模型(归 8.3)。
- 不接入 BullMQ/cron 调度。

## Acceptance Criteria

- **AC1** 移动端(<md)打开导航抽屉,列表中出现「大跌日历」入口,点击跳转 `/crash-calendar`。
- **AC2** 桌面(md+)左栏 `<SideNav>` 已含「大跌日历」入口(8.3 已落地);本 story 不回退。
- **AC3** active 态:位于 `/crash-calendar` 时,该入口高亮(`aria-current="page"`);其它入口
  (首页/日报/主题/收藏/运营台)active 行为不变。
- **AC4** 220px 左栏布局与 SideNav 视觉不变;`PublicNav` 顶栏高度/抽屉宽度不变。
- **AC5** `apps/web` `tsc --noEmit` clean。

## Dev Notes

- `PublicNav` 被 `layout.tsx` 的 `<div className="md:hidden">` 包裹 → 仅移动端渲染。但
  `DesktopNav`(顶栏横排)与 `DrawerNav`(抽屉纵排)共用 `PRIMARY_NAV_ITEMS`,加一项即两处生效,
  语义一致(移动端顶栏横排在 <md 不显示 `DesktopNav`,实际只有抽屉可见)。
- label 用「大跌日历」与 SideNav 一致;PublicNav 其它项用短词(日报/主题),「大跌日历」略长但抽屉
  纵排无宽度问题,顶栏横排在移动端不显示 → 无溢出风险。
- `isActive("/crash-calendar")`:`href !== "/"` → 走 `pathname === href || startsWith("/crash-calendar/")`。
  `/crash-calendar` 无嵌套子路由,故等价精确匹配;`?d=` query 不影响 pathname → active 正确。
- 不需要 icon:PublicNav 的 `NavItem` 类型只有 `{ href, label }`,与 SideNav 的 `{ href, label, icon }`
  不同 → 不强行加 icon(类型不要求,保持最短 diff)。

## File List

- `apps/web/app/(public)/_components/public-nav.tsx` — **modified**: `PRIMARY_NAV_ITEMS` 加
  `{ href: "/crash-calendar", label: "大跌日历" }`(置于 `/daily` 日报之后,与 SideNav 顺序一致)。
- `_bmad-output/implementation-artifacts/spec-8-4-sidenav-entry-and-route.md` — **new**: 本文件。
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — **modified**: 8-4 backlog → review。
</intent-contract>

## Code Map

```
apps/web/app/(public)/_components/public-nav.tsx   # PRIMARY_NAV_ITEMS +1 项 (大跌日历)
```

## Review Notes

- 桌面 SideNav 入口已在 8.3 落地(side-nav.tsx:30),本 story 仅补移动端一致性。
- active 态由既有 `isActive` 启发覆盖,无需新逻辑。
- 无 schema / migration / 核心包改动 → 无需重建 core dist 或重启原因(纯 web 渲染层)。
</content>
</invoke>
