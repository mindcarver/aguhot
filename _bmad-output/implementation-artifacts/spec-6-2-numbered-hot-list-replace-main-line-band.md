---
title: '编号式「当前热点」排行替换 MainLineBand (6.2)'
type: 'feature'
created: '2026-07-12'
status: 'ready-for-dev'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-12.md'
visual_spec: '_bmad-output/demo-ui-redesign.html'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-timeline-home-and-card-component.md'
  - '{project-root}/_bmad-output/planning-artifacts/prds/prd-aguhot-2026-07-09/prd.md'
warnings: []
---

<intent-contract>

## Intent

**Problem:** 首页顶部 `MainLineBand`（「今日重点/市场主线」卡片带）是卡片形态，与参考站编号式「当前热点」紧凑排行不符。FR-1 已追加「顶部以编号式当前热点排行呈现 top-N，复用既有 saliency 读模型」。

**Approach:** 新增 `NumberedHotList` server component（ordered list + CSS counter 编号 1. 2. 3…），每项 = 标题（Link 进详情）+ 来源数 + 相对时间（如「2 小时前」）。复用 `listPublishedHotEvents`（既有 saliency 读，按 `evidenceCount DESC + latestEvidenceAt DESC`）取 top-N（V1 取 5）。替换 `page.tsx` 中 `<MainLineBand>` 调用。视觉以 `demo-ui-redesign.html` `.hot-list` 为准。

## Boundaries & Constraints

**Always:**
- 复用 `listPublishedHotEvents` saliency 读模型——**不新增读模型/字段**（对齐 sprint-change-proposal 提案 14）。Web 请求路径不拼 SQL（AD-3/AD-4）。
- ordered list + CSS `counter-reset`/`counter-increment` 编号；编号 `font-mono` + `ink-tertiary`。
- 每项：标题（Link `/events/{hotEventId}`，`ink-primary` semibold，hover 变 `brand`）+ 来源数（`ink-tertiary` 小字）+ 相对时间（`ink-tertiary` 小字，右对齐）。
- 相对时间格式：「N 分钟前」/「N 小时前」/「N 天前」；用页面既有 `now = new Date()` 与 `latestEvidenceAt` 计算（locale-stable，无 toLocaleString 依赖）。
- 诚实状态（NFR-2）：`listPublishedHotEvents` 为空 → `NumberedHotList` 不渲染（不造「精选」文案、不造数据）。
- a11y：`<ol>` 语义；编号不依赖颜色；链接键盘可达。

**Block If:**
- `pnpm typecheck` 相关类型错误不可自愈 → HALT。
- `home.spec` 翻修后仍红 → HALT。

**Never:**
- 不引入「精选 NN」编辑质量分（NFR-2——aguhot 未算该分，用「来源 N」chip/文案替代；参考站的「精选 82」不复制）。
- 不新增读模型/字段/SQL。
- 不删除 `main-line-band.tsx` 文件除非确认无其他引用（先停 import 再清理；记录于 spec change log）。
- 不在排行项做卡片容器（无边框，hairline 分隔）。
- 不改 `globals.css` token。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 默认视图 | `listPublishedHotEvents` 有数据 | 渲染 `<ol>` top-5，每项 编号+标题+来源数+相对时间 | 读返回空→不渲染 |
| top-N 切片 | 返回 >5 条 | 取前 5（V1 取 5） | — |
| 相对时间 | `latestEvidenceAt` 距 `now` | <60min→「N 分钟前」；<24h→「N 小时前」；否则→「N 天前」 | 跨度边界四舍五入 |
| 空读模型 | 返回 `[]` | `NumberedHotList` 不渲染（不造词） | `[]` 非错误 |
| 标题超长 | 长标题 | 自然换行，不截断丢信息 | — |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/numbered-hot-list.tsx` -- NEW：server component，`<ol>` + CSS counter，top-N saliency，相对时间
- `apps/web/app/(public)/page.tsx` -- MODIFY：`<MainLineBand>` → `<NumberedHotList>`；保留 masthead + force-dynamic；hot-events 空时不渲染
- `apps/web/app/(public)/_components/main-line-band.tsx` -- STOP-IMPORT（后续清理）：保留文件待确认无引用
- `apps/web/e2e/home.spec.ts` -- MODIFY：断言编号排行而非 band 卡片

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/numbered-hot-list.tsx` -- NEW -- `<ol>` + counter 编号 + 标题 Link + 来源数 + 相对时间；复用 `listPublishedHotEvents`
- `apps/web/app/(public)/page.tsx` -- MODIFY -- swap `<MainLineBand>`→`<NumberedHotList>`；空态不渲染
- `apps/web/e2e/home.spec.ts` -- MODIFY -- 编号排行断言（ol 结构、top-5 切片、相对时间、空态不渲染）

**Acceptance Criteria:**
- Given `listPublishedHotEvents` 有 ≥5 条，when 匿名访问 `/`，then 渲染 `<ol>` top-5，每项编号(1-5)+标题+来源数+相对时间，标题 Link 进 `/events/{hotEventId}`。
- Given 返回 >5 条，when 渲染，then 仅取前 5。
- Given `latestEvidenceAt` 距 `now` 2 小时，when 渲染相对时间，then 显示「2 小时前」。
- Given `listPublishedHotEvents` 为空，when 渲染，then `NumberedHotList` 不渲染（不造「精选」文案，NFR-2）。
- Given 既有 masthead，when 渲染，then H1「AGUHOT」+「可信热点发布闭环」不回归（`home.spec` masthead 断言绿）。

## Design Notes

**相对时间 formatter。** 纯函数 `formatRelative(d, now)`：diff < 60s→「刚刚」；<60min→「N 分钟前」；<24h→「N 小时前」；否则→「N 天前」。locale-stable，无 toLocaleString。放 `numbered-hot-list.tsx` 本地 helper（与 timeline-card 的 `formatDateTime` 同 pattern，各组件自带）。

**编号用 CSS counter。** `ol { counter-reset: hot } li { counter-increment: hot } li::before { content: counter(hot) }`。编号 `font-mono` + `ink-tertiary`，`min-width` 对齐。不用手写 `1.` `2.` 文本（counter 语义 + 可维护）。

**top-N 取值。** V1 取 5（对齐 demo）。复用 4.2 的 `listPublishedHotEvents` 调用（page.tsx 已并行读取）；slice(0,5) 在组件内。

**与 6.1 衔接。** `NumberedHotList` 在 `page.tsx` masthead 之后、TimelineFilters 之前渲染；宽度沿用 6.1 内容区窄栏。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿
- `pnpm --filter @aguhot/web e2e` -- expected: home.spec 翻修后绿，其余公共面不回归

**Manual checks:**
- 目视确认编号 1-5、相对时间、标题 hover 变品牌色、空读模型时不渲染。
