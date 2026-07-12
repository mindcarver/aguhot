---
title: 'Epic 6 Context — 视觉对齐参考站：编辑型纵栏'
type: 'epic-context'
created: '2026-07-12'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
---

# Epic 6 Context — 视觉对齐参考站：编辑型纵栏

## Why this epic exists

Epic 4（时间流首页）+ Epic 5（AI 分析层）交付后，事后对照参考站 AI HOT (`aihot.virxact.com`)，发现**信息架构已对、视觉形态未对**：当前仍是 V1「暖底边框卡片金融编辑台」，参考站是「无边框编辑型纵栏」。用户判断「太不像」。

2026-07-12 correct-course 产出 `sprint-change-proposal-2026-07-12.md`（scope: **Moderate**，已批准）。ui-ux-pro-max `--design-system` 对账印证：aguhot 现有 token（暖底 `#F5F1E8` / 海军蓝 `#213B63` / 暖琥珀 `#B86633` / Source Han Serif/Sans + IBM Plex Mono）与推荐的 `Banking/Traditional Finance` 配色 + `Magazine/Blog` editorial 字体情绪**一对一**——**token 正确，缺口在视觉处理方式**。

## Scope invariant（Epic 6 全 story 共守）

- **不动 design token**：`apps/web/app/globals.css` `@theme` 零改动。所有新组件复用既有 token（`bg-canvas`/`surface-*`/`ink-*`/`border-hairline`/`brand`/`accent-warm`/`market-*`）。
- **不动 architecture**：无新读模型、无 schema 变更、无 AD 增删。`published_timeline`（AD-3b）与 `listPublishedHotEvents` 读契约不变。
- **不动 PRD 定位层**：Vision/Non-Goals/Metrics 不动（2026-07-11 Major 已定）。仅 FR-1/FR-3 追加视觉形态约束句（已同步 `prd.md`）。
- **视觉规格唯一基准**：`_bmad-output/demo-ui-redesign.html`（方案 A，用户 2026-07-12 确认「更舒服」）。所有 story 实现以此为准。
- **护栏（不可破）**：
  - AI 解读视觉权重 ≤ 事实标题/摘要（PRD §10 / UX-DR8）——签名块用分隔线分段，字号/字色不提级。
  - 红绿仅市场语义（UX-DR1）——不得用于品牌/结构。
  - 「AI 解读」命名保持，不回退参考站「推荐理由」（PM P5，规避投资建议意味）。
  - NFR-2 不造假——不伪造「精选 NN」编辑质量分，用「来源 N」chip 替代；`recommendationReason` 为 null 时不渲染槽位。
  - UX-DR15——无 carousel / 无满屏红绿 / 无强干扰动画 / 无连续多层弹窗。
  - UX-DR13 a11y 基线——键盘可达、焦点环、红绿非唯一语义、触控热区、reduced-motion。

## UX-DR 改写（已同步 `epics.md`，本 epic 落地依据）

- **UX-DR3**：左栏 → 顶部窄条极简导航。
- **UX-DR4**：event-card 同步无边框化（搜索等非流表面）。
- **UX-DR4b**：时间流卡 → 无边框纵栏条目（时间轨 + 海军蓝竖线 + 正文）。
- **UX-DR8**：AI 解读实线签名块 + 权重 reconciliation。
- **UX-DR16**（新增）：编辑型纵栏视觉形态总则。

## Story 依赖与顺序

```
6.1 顶部窄条导航 ──┐
6.2 编号热点排行 ──┼─→ 6.5 e2e + event-card
6.3 时间流纵栏 ────┤
6.4 AI签名块+chips ─┘ (6.4 依赖 6.3：渲染在纵栏条目内)
```

6.1 / 6.2 / 6.3 可并行；6.4 依赖 6.3；6.5 依赖 6.1-6.4 全部落地后翻修 e2e。

## 关键代码现状（改前基线）

- `apps/web/app/(public)/layout.tsx` — 公共壳层（左栏导航所在）。
- `apps/web/app/(public)/page.tsx` — 首页：masthead + `<MainLineBand>` + `<TimelineFilters>` + `<TimelineCard>` 列表。
- `apps/web/app/(public)/_components/timeline-card.tsx` — 边框卡（`rounded-lg border-border-hairline bg-surface-raised`），时间戳弱化。
- `apps/web/app/(public)/_components/main-line-band.tsx` — 「今日重点/市场主线」卡片带。
- `apps/web/app/(public)/_components/event-card.tsx` — 边框卡（搜索/列表复用）。
- `apps/web/app/globals.css` — `@theme` token 单一来源（**不动**）。
- E2E：`home.spec` / `design.spec` / `themes.spec` / `navigation.spec` / `a11y.spec` — 会因 IA/卡结构变化而红，6.5 统一翻修。
