---
title: '编号式「当前热点」排行替换 MainLineBand (6.2)'
type: 'feature'
created: '2026-07-12'
status: 'done'
baseline_commit: 'dc75c39f50ec125abc7bea3bb8f9430fc33acd51'
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

## Dev Agent Record

### Implementation Plan
- `NumberedHotList` (NEW): server component replacing `MainLineBand` (4.2). Renders `<section aria-labelledby>` + heading「当前热点」+ subtitle「多信源热度 · 随时间消退」+ `<ol>` of top-5 `PublishedHotEventSummary`. Each item: explicit index `{i+1}` (font-mono ink-tertiary) → title (Link to detail, ink-primary semibold, hover→brand) → `{evidenceCount} 信源` (ink-tertiary) → relative time (right-aligned, ink-tertiary).
- Data source unchanged: reuses `listPublishedHotEvents` saliency read (evidenceCount DESC + latestEvidenceAt DESC). NO new read model/field (sprint-change-proposal 提案 14 — architecture untouched).
- `page.tsx`: `<MainLineBand>` → `<NumberedHotList>` (NumberedHotList renders its own `<section class="mt-8">` + returns null when empty, so the page-level `hotEvents.length > 0` guard + wrapping section were dropped). Import + JSDoc reference updated.
- Index rendering: explicit `{i+1}` (NOT CSS counter) — Tailwind Preflight resets `<ol>` list-style to none (`::marker` hidden), so an explicit number span is the reliable cross-browser choice (simpler than counter-reset/increment + `::before`, same visual).
- Relative time: `formatRelative(d, now)` — pure number math (no toLocaleString), locale-stable. <60s→「刚刚」, <60min→「N 分钟前」, <24h→「N 小时前」, else→「N 天前」.
- Ranking-reason chips dropped (4.2 band had「近期升温」/「多源覆盖」; the reference-site numbered list doesn't, spec 6.2 AC drops them). FR-3's "同事件精选" half still lives on the timeline card fold tag. The number conveys rank.
- `main-line-band.tsx` now orphaned (no code imports it) — KEPT per spec 6.2「保留待 6.5 清理」; deletion coupled with `timeline.spec` band-test rewrite in Story 6.5 (e2e 收口).

### Debug Log
- Visual verification: home `/` needs DATABASE_URL (500 without DB). Created DB-free scratch route `dev-hotlist-preview` with 6 mock `PublishedHotEventSummary` (fixed `now` for deterministic relative times) rendering the REAL `NumberedHotList`. Verified top-5 slice (6th event dropped), numbering, relative times, 来源数. Scratch DELETED after capture.
- `PublishedHotEventSummary` type confirmed: `{ hotEventId, title, evidenceCount, latestEvidenceAt, publishedAt }`.

### Completion Notes
- **Typecheck + lint + prettier:** all green.
- **Visual verification (scratch route, DB-free mock, deleted after):** numbered list renders — 「当前热点」heading + subtitle + 5 ranked items (number + title + 信源 + relative time), 6th event sliced off by top-5. Matches `demo-ui-redesign.html` `.hot-list`. See `_bmad-output/dev-6-2-hotlist.png`.
- **E2E:** NOT run — no `DATABASE_URL`. `home.spec` has NO band assertions (only Story 1.1: 200 + masthead + no-login), so no home.spec change needed. `timeline.spec`'s `@timeline` band test (region "今日重点 / 市场主线", top-3, reason tags) is now stale — deferred to Story 6.5 (e2e 收口) along with the 6.3 timeline-card UTC→HH:mm update + main-line-band.tsx deletion.
- **Token/architecture:** `globals.css` untouched; no schema/read-model/AD change (Epic 6 scope invariant holds).
- **Guardrails:** NFR-2 (empty→no render, no fabricated「精选分」); reuses saliency read (no new field); UX-DR16 (borderless editorial form).

## File List
- `apps/web/app/(public)/_components/numbered-hot-list.tsx` — NEW (ordered list, top-5 saliency, relative time, replaces MainLineBand; subtitle「多信源热度排序」— Codex P2 fix, drops inaccurate「随时间消退」decay claim)
- `apps/web/app/(public)/page.tsx` — MODIFY (`<MainLineBand>` → `<NumberedHotList>`; import + JSDoc reference updated; page-level empty guard dropped — NumberedHotList self-guards)
- `apps/web/e2e/timeline.spec.ts` — MODIFY (Codex P1: band test → numbered-hot-list test — region「当前热点」, top-5, 4 li, no reason tags; empty-state test region updated; seed/header comments synced)
- `apps/web/app/(public)/_components/main-line-band.tsx` — UNCHANGED (orphaned, no imports; kept per spec — deletion deferred to Story 6.5)
- `apps/web/app/(public)/dev-hotlist-preview/` — CREATED then DELETED (scratch visual verification, DB-free mock; removed before commit)

## Change Log
- 2026-07-12: Story 6.2 implemented — MainLineBand replaced by NumberedHotList (编号式「当前热点」排行, UX-DR16); reuses listPublishedHotEvents saliency read (no new read model); top-5 + relative time. typecheck + lint + prettier green; visual verified via DB-free scratch (deleted); e2e deferred (no DB, 6.5 收口). main-line-band.tsx orphaned, deletion deferred to 6.5. Status → review.
- 2026-07-12: Codex review follow-up — P1 (timeline.spec band test updated for NumberedHotList: region「当前热点」, top-5, 4 li, no reason tags; empty-state + comments synced) + P2 (subtitle「多信源热度 · 随时间消退」→「多信源热度排序」— the decay claim was inaccurate; listPublishedHotEvents orders by evidenceCount DESC + latestEvidenceAt DESC, no time-decay). typecheck + lint + prettier green.

## Review Triage Log

### 2026-07-12 — Codex review (working-tree, 6.2+6.3 diff)
Findings touching 6.2:
- **[P1] timeline.spec band test guaranteed-fail** — ADDRESSED. The `@timeline` band test asserted region「今日重点 / 市场主线」+ top-3 li; NumberedHotList replaced both. Updated: region→「当前热点」, top-3→top-5 (4 seeded events → 4 li, 稀土 no longer drops), reason-tag absence assertions kept (NumberedHotList carries none — pins the intentional drop). Empty-state independence test + file-header/seed comments synced. (Originally deferred to 6.5; Codex correctly flagged a guaranteed-failing committed suite — moved the timeline.spec update into 6.2/6.3 rather than leaving it broken.)
- **[P2] subtitle「随时间消退」misrepresents algorithm** — ADDRESSED. `listPublishedHotEvents` orders by `evidenceCount DESC, latestEvidenceAt DESC` (no time-decay — an older high-evidence event stays ranked first). Subtitle changed「多信源热度 · 随时间消退」→「多信源热度排序」(accurate, NFR-2: don't misrepresent). The「随时间消退」copy was copied verbatim from the reference site without checking aguhot's algorithm.
- **[P2] multi-date grouping unreachable** — see spec-6-3 (page.tsx grouping; acknowledged there, kept as future-proof).

### 2026-07-12 — Codex re-review (round 2, code-only diff)
- **[P2] future timestamp misreported as「刚刚」** — ADDRESSED. `formatRelative` had `if (diffMs < 60_000) return "刚刚"` which implicitly caught negative diff (future latestEvidenceAt). Ingestion does not reject future `publishedAt`, so clock skew / malformed feeds could land a future timestamp displayed as「刚刚」, concealing the anomaly. Added an EXPLICIT `if (diffMs < 0) return "刚刚"` branch (first) with a comment documenting the anomaly + deferring the real fix (reject future timestamps at ingestion) — the branch is now visible in code, not silently caught. Display「刚刚」is the least-bad fallback for slight skew.
- **[P2] `<ol>` lost list semantics after Preflight reset** — ADDRESSED. Tailwind Preflight's `ol { list-style: none }` causes Safari/VoiceOver to stop exposing a marker-less `<ol>` as a list. The numbered list relies on that reset (explicit `{i+1}` numbers, no `::marker`) but omitted `role="list"`. Added `role="list"` to the `<ol>` so assistive-tech users hear an ordered 5-item ranking, not unrelated rows.



