---
title: '时间流条目改无边框编辑型纵栏 (6.3)'
type: 'feature'
created: '2026-07-12'
status: 'ready-for-dev'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-timeline-home-and-card-component.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** UX-DR4b 已改写为「无边框纵栏条目（时间轨 + 海军蓝竖线 + 正文）」，但 `timeline-card.tsx` 仍是边框卡（`rounded-lg border-border-hairline bg-surface-raised`），时间戳弱化（`ink-tertiary`），无日期分节，密度低。与参考站编辑型纵栏根本不同。

**Approach:** 重构 `TimelineCard` 为三栏无边框条目：左时间轨（HH:mm 加粗 `ink-1` + 时段弱化）→ 海军蓝 1px 竖线（`border-left: 1px solid brand`，呼应 `evidence-row` 可追溯证据语义）→ 右正文（来源名提级 `ink-2` / 标题 / 多句摘要 / 来源数 + 关联 chips / AI 解读签名块）。整条 hairline 分隔（`border-top`），行 hover `bg-surface-base` 微亮（150ms，respect reduced-motion）。新增 `DateSectionDivider`，按 `trade_date` 分组渲染日期节标题。时间格式弃 `YYYY-MM-DD HH:mm UTC`，改 `HH:mm`。视觉以 `demo-ui-redesign.html` `.entry`/`.e-rail`/`.e-body` 为准。

## Boundaries & Constraints

**Always:**
- 复用既有 token（`ink-*`/`brand`/`border-hairline`/`surface-*`/`font-mono`）。`globals.css` 零改动。
- 三栏结构：`<li class="entry"><div class="e-rail">HH:mm + 时段</div><div class="e-body">...</div></li>`；`e-body` `border-left: 1px solid brand`；`e-rail` 固定宽（~68px）。
- 时间戳以 `HH:mm` 领头，`font-mono` + `ink-1`（加粗，提级）；时段（盘前/盘中/盘后/非交易）`ink-tertiary` 弱化，无底色 chip。
- 来源名 `ink-2`，提级为一等扫描元素（标题上方独立行）。
- 摘要允许多句密度（`body-sm` + `ink-2` + `line-height 1.7`）；不强制单行。
- 按交易日分节：`page.tsx` 按 `entry.tradeDate` 分组，每组前渲染 `<DateSectionDivider>`（serif + `ink-2`，如「7 月 12 日 · 周六（非交易日）」）。
- 行 hover：`hover:bg-surface-base`，`transition: background-color 150ms ease-out`；`@media (prefers-reduced-motion: reduce)` 既有全局规则降级为即时（`globals.css` 已覆盖，无需 per-component）。
- 整条点击进详情（`<Link href="/events/{hotEventId}">`）不变；`<details>` 同事件精选仍为 Link 的 sibling（4.2 既定 pattern，不回退）。
- 诚实状态（NFR-2）：摘要为空→不渲染摘要行（不造词）；读模型空→page 级空态（4.2 既有，不动）。

**Block If:**
- `pnpm typecheck` 相关类型错误不可自愈 → HALT。
- `home.spec`/`design.spec`/`themes.spec` 翻修后仍红 → HALT。

**Never:**
- 不回退为边框卡——无边框是 UX-DR16/DR4b 核心。
- 不改 `globals.css` token；不新增 token（海军蓝竖线用既有 `brand`）。
- 不伪造逐源时间线（`published_timeline` 仅 sourceName + count + ids；逐源时间线是详情页 1.8 职责）。
- 不改读模型/读契约（AD-3b 不动）；不改 `published_timeline` schema。
- 不引入 client JS / `useState`（server component + force-dynamic 既有约定）。
- 不用横向 carousel（UX-DR15）。
- 不让 AI 解读视觉权重 > 事实标题（PRD §10 / UX-DR8）——AI 解读块由 6.4 落地，本 story 预留槽位但 6.4 前不渲染（沿用 4.2 null→不渲染约定）。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 默认条目 | `PublishedTimelineEntry` 有 summary | 三栏：HH:mm+时段 / 来源 / 标题 / 摘要 / chips / (AI 槽 6.4) | — |
| 日期分节 | 多个 `tradeDate` | 按 trade_date 分组，每组前 `<DateSectionDivider>` | 单日无分节标题也合规 |
| 摘要为空 | `summary === ""` | 不渲染摘要行（不造词） | — |
| 折叠条目 | `foldedEvidenceRecordIds.length >= 2` | 「同事件精选」`<details>` sibling of Link（4.2 pattern 保留） | — |
| 单源条目 | `foldedEvidenceRecordIds.length < 2` | 无「同事件精选」标签 | — |
| hover | 鼠标悬停条目 | `bg-surface-base` 微亮 150ms | reduced-motion→即时 |
| 时间格式 | `occurredAt: Date` | `HH:mm`（locale-stable，从 ISO 取 `slice(11,16)`） | UTC 后缀不再显示 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/timeline-card.tsx` -- REWRITE：三栏无边框条目（rail + 海军蓝竖线 + body）；HH:mm 领头；来源提级；多句摘要；行 hover bg
- `apps/web/app/(public)/_components/date-section-divider.tsx` -- NEW：交易日分节标题（serif + ink-2）
- `apps/web/app/(public)/page.tsx` -- MODIFY：按 `entry.tradeDate` 分组渲染 `<DateSectionDivider>` + 时间流条目；保留 masthead/filters/空态/force-dynamic
- `apps/web/e2e/home.spec.ts` -- MODIFY：断言三栏结构、HH:mm、来源行、日期分节
- `apps/web/e2e/design.spec.ts` / `themes.spec.ts` -- MODIFY：对齐新纵栏形态

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/timeline-card.tsx` -- REWRITE -- 三栏（rail HH:mm+时段 / 海军蓝竖线 / body 来源/标题/摘要/chips/AI槽）；行 hover bg；整卡 Link；`<details>` sibling
- `apps/web/app/(public)/_components/date-section-divider.tsx` -- NEW -- 交易日分节标题
- `apps/web/app/(public)/page.tsx` -- MODIFY -- 按 tradeDate 分组 + 分节
- `apps/web/e2e/home.spec.ts` / `design.spec.ts` / `themes.spec.ts` -- MODIFY -- 纵栏结构断言

**Acceptance Criteria:**
- Given `published_timeline` 有数据跨多个 trade_date，when 匿名访问 `/`，then 按交易日分节，每组前有日期标题，组内条目按 `occurredAt DESC`。
- Given 单条时间流条目，when 渲染，then 三栏：左 HH:mm+时段 → 海军蓝竖线 → 右正文（来源/标题/摘要/chips），整条 hairline 分隔，hover bg 微亮。
- Given `occurredAt`，when 渲染时间，then 显示 `HH:mm`（非 `YYYY-MM-DD HH:mm UTC`）。
- Given `summary === ""`，when 渲染，then 不渲染摘要行（不造词）。
- Given 折叠条目（≥2 源），when 渲染，then 「同事件精选」`<details>` 为 Link sibling 可展开（4.2 pattern 不回退）。
- Given `home.spec`/`design.spec`/`themes.spec` 翻修，when 运行 e2e，then 全绿。

## Design Notes

**三栏布局。** `display: flex; align-items: stretch`；`e-rail` `flex: 0 0 68px`；`e-body` `flex: 1; border-left: 1px solid var(--color-brand); padding-left: 18px`。海军蓝竖线即 `e-body` 左 border——零新元素、零新 token。

**日期分节分组。** `page.tsx` 已读 `filteredEntries`（按 `occurredAt DESC`）；按 `entry.tradeDate`（读模型已有字段）reduce 为 `Map<tradeDate, entries[]>`，依次渲染 `<DateSectionDivider date={tradeDate}>` + 该组条目。非交易日（周末/假日）节标题标注「（非交易日）」——若 `tradeDate` 携带 session/non_trading 信号则用，否则仅日期。

**HH:mm 格式。** `formatHHmm(d)`：`d.toISOString().slice(11,16)`（locale-stable，与 4.2 `formatDateTime` 同 pattern）。弃 UTC 后缀（参考站用 HH:mm 无时区后缀；aguhot V1 全 UTC，HH:mm 足够）。

**hover 与 reduced-motion。** `hover:bg-surface-base transition-colors duration-150`；`globals.css` 既有 `@media (prefers-reduced-motion: reduce)` 全局规则把 `transition-duration` 降为 0.01ms，无需 per-component 处理。

**与 6.4 衔接。** 本 story 重构卡结构并预留 AI 解读槽位（`recommendationReason` 非空时渲染——但 6.4 才把槽位改为签名块样式；6.3 完成时若 5.1 已有 reason，先用 4.2 既有内联样式，6.4 再升级为 `EditorialReasonBlock`）。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿
- `pnpm --filter @aguhot/web e2e` -- expected: home/design/themes 翻修后绿，navigation/a11y 不回归

**Manual checks:**
- 目视确认三栏、海军蓝竖线、HH:mm 领头、来源行、多句摘要、日期分节、hover 微亮；reduced-motion 下 hover 即时。
