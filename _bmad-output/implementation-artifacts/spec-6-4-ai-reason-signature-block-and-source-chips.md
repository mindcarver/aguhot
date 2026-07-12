---
title: 'AI 解读实线签名块 + 来源 chip 外显 (6.4)'
type: 'feature'
created: '2026-07-12'
status: 'ready-for-dev'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-6-3-timeline-borderless-editorial-column.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-card-recommendation-reason.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** UX-DR8 已扩展为「AI 解读实线 hairline 独立成段（签名式），但字号/字色 ≤ 事实标题」；参考站「关联讨论 N 条」+ 来源 chips 是签名元素。当前 `timeline-card.tsx` 的 AI 解读是内联（`body-sm ink-secondary` + AiLabel），无分隔线签名感；同事件精选是纯文本 `<details>`，关联来源未以 chip 外显。

**Approach:** 新增 `EditorialReasonBlock`（实线 hairline + `AiLabel` + `body-sm ink-secondary`，签名式独立段）与 `SourceChipList`（「关联讨论 N 条」+ 来源 chips；同事件精选展开后 chip 列表）。在 6.3 重构的 `TimelineCard` 内集成。AI 解读命名保持「AI 解读」（不回退「推荐理由」）。视觉以 `demo-ui-redesign.html` `.ai-block`/`.e-chips` 为准。

## Boundaries & Constraints

**Always:**
- 复用既有 token（`accent-warm`/`accent-warm-foreground`/`border-hairline`/`ink-*`/`surface-*`）。`globals.css` 零改动。复用既有 `@/components/chips` 的 `AiLabel`。
- `EditorialReasonBlock`：`border-top: 1px solid border-hairline`（实线，非虚线）；`AiLabel` + `body-sm ink-secondary`；`margin-top` 与上方摘要留呼吸。
- **权重护栏（PRD §10 / UX-DR8）**：AI 解读字号/字色 ≤ 事实标题——`body-sm`(13.5px) + `ink-secondary`，不加粗；分隔线仅做视觉分段，不做权重提升。
- 命名保持「AI 解读」（AiLabel 文案不变；不回退参考站「推荐理由」，PM P5）。
- `SourceChipList`：「关联讨论 N 条」chip + 各来源 chip（`border` + `ink-3` 小字）；同事件精选 `<details>` 展开后以 chip 列出代表来源（不伪造逐源时间线）。
- 诚实状态（NFR-2）：`recommendationReason` 为 null/空 → 不渲染 `EditorialReasonBlock`（不留空营销位，沿用 4.2/5.1 既定）；来源数 0 → 不渲染 `SourceChipList`。
- a11y：AiLabel 有 `aria-label`；chip 文本可读，不依赖颜色。

**Block If:**
- `pnpm typecheck` 相关类型错误不可自愈 → HALT。
- AI 解读视觉权重 > 事实标题（review 时用 bounding-box/字号校验）→ HALT。

**Never:**
- 不把 AI 解读字号/字色提到 ≥ 事实标题（权重护栏不可破）。
- 不把命名改回「推荐理由」。
- 不伪造逐源时间线（`published_timeline` 仅 sourceName + count + ids；`SourceChipList` 用代表来源 + 计数，不造逐源 name/time）。
- 不引入「精选 NN」分数。
- 不改 `globals.css` token；不引入 client JS（`<details>` 原生，零 JS）。
- 不在 `recommendationReason` 为 null 时渲染空槽位或营销占位。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 有 AI 解读 | `recommendationReason` 非空 | 渲染 `EditorialReasonBlock`（实线 hairline + AiLabel + body-sm ink-secondary） | — |
| 无 AI 解读 | `recommendationReason` null/空 | 不渲染 block（不留空位） | — |
| 关联来源 | `evidenceCount > 1` | `SourceChipList`：「关联讨论 N 条」+ 代表来源 chips | 仅 1 源→可不渲染关联 chip |
| 同事件精选展开 | 用户点 `<details>` | 展开后 chip 列出代表来源 + 「+N」 | 不造逐源时间线 |
| 权重护栏 | 渲染后 | AI 解读字号(13.5px)/字色(ink-2) < 事实标题(17px/ink-1) | review 校验 |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/editorial-reason-block.tsx` -- NEW：实线 hairline 签名块（AiLabel + body-sm ink-secondary）；权重 ≤ 事实
- `apps/web/app/(public)/_components/source-chip-list.tsx` -- NEW：「关联讨论 N 条」+ 来源 chips；同事件精选展开 chip 列表
- `apps/web/app/(public)/_components/timeline-card.tsx` -- MODIFY：集成 `EditorialReasonBlock`（替换 4.2 既有内联 AI 槽）+ `SourceChipList`；`<details>` body 改为 chip 列表
- `apps/web/e2e/home.spec.ts` -- MODIFY：AI 解读签名块断言（实线分隔、AiLabel、权重）；关联 chip 断言

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/editorial-reason-block.tsx` -- NEW -- 实线 hairline + AiLabel + body-sm ink-secondary；null→不渲染
- `apps/web/app/(public)/_components/source-chip-list.tsx` -- NEW -- 「关联讨论 N 条」+ 来源 chips；展开 chip 列表
- `apps/web/app/(public)/_components/timeline-card.tsx` -- MODIFY -- 集成两个新组件；`<details>` body 改 chip 列表
- `apps/web/e2e/home.spec.ts` -- MODIFY -- 签名块 + chip 断言

**Acceptance Criteria:**
- Given `recommendationReason` 非空，when 渲染，then `EditorialReasonBlock` 以实线 hairline 独立成段，AiLabel + body-sm ink-secondary，字号/字色 < 事实标题。
- Given `recommendationReason` 为 null，when 渲染，then 不渲染 block（无空槽位，NFR-2）。
- Given `evidenceCount > 1`，when 渲染，then `SourceChipList` 显示「关联讨论 N 条」+ 代表来源 chips。
- Given 同事件精选 `<details>` 展开，when 展开，then 显示代表来源 chip 列表 + 「+N」（不伪造逐源时间线）。
- Given AiLabel，when 渲染，then 文案为「AI 解读」（非「推荐理由」）。
- Given `home.spec` 翻修，when 运行 e2e，then 全绿。

## Design Notes

**权重护栏如何校验。** `EditorialReasonBlock` 文本 `text-sm`(13.5px) + `ink-secondary`；事实标题 `text-lg`(17px) + `ink-primary` + `font-semibold`。实线 hairline 是分段，不是权重——review 时断言 AI 块无 `font-semibold`/`font-bold`、字号 < 标题字号。

**实线 vs 虚线。** demo 用 `border-top: 1px solid border-hairline`（实线，非 dashed）。参考站用 `* * *` 三点，但实线更干净且与 hairline 分隔体系统一。

**SourceChipList 数据。** `published_timeline` 携带 `evidenceCount` + `foldedEvidenceRecordIds`(ids) + 代表性 `sourceName`。chip 列表只能展示「代表来源：{sourceName}」+ 「+N」——不伪造其他来源名（无数据）。若未来需要全来源 chip，需 source-ingest 新增按 id 批量取 published 投影读路径（超 6.4，记 deferred）。

**与 5.1 衔接。** 5.1 已生成 `recommendationReason`（上限 40 字 + 黑名单）。本 story 仅改渲染样式（内联→签名块），不动生成链。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿
- `pnpm --filter @aguhot/web e2e` -- expected: home.spec 翻修后绿

**Manual checks:**
- 目视确认 AI 解读实线分隔、AiLabel「AI 解读」、字号 < 标题；关联来源 chip；展开 `<details>` 见 chip 列表；reason 为 null 时不渲染。
