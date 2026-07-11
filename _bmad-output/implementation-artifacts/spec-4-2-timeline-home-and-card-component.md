---
title: '时间流首页与时间流卡组件 (4.2)'
type: 'feature'
created: '2026-07-11'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: 'f62667b74c9eef826d803e66c64fb3d21f5b7b7a'
final_revision: '639f4b6461f0fc7f247263946326faa34857543c'
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-timeline-read-model-and-publish-refresh.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/EXPERIENCE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 4 把首页从"优先级热点事件流"改为"分钟级时间流 + 同事件精选"。Story 4.1 已交付 `published_timeline` 读模型与 `listPublishedTimeline` 读契约；当前首页 (`apps/web/app/(public)/page.tsx`) 仍渲染旧的 `listPublishedHotEvents` 优先级 feed，没有时间流卡、没有"今日重点/市场主线"置顶带、也没有时间流空态。

**Approach:** 把首页 body 改为经 `listPublishedTimeline` 读最新 `trade_date` 的时间流条目（已按 `occurredAt DESC` 返回），用新增的 `timeline-card` 组件按固定阅读顺序渲染（时间戳→来源→标题→摘要→`AI 解读` 槽→证据数）；顶部新增常驻 `main-line-band`（"今日重点/市场主线"），复用既有 `listPublishedHotEvents` 的 saliency 排序取 top-N，回答"市场正在交易什么"。整卡可点进事件详情页（1.8 既有能力）。折叠条目用原生 `<details>` 做"同事件精选"渐进披露。本 story 不做筛选（4.3）、搜索打通（4.4）、AI 解读生成（5.1，仅渲染槽位）。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3/AD-3b/AD-6）：首页只读 `listPublishedTimeline` 与 `listPublishedHotEvents`；请求路径不拼时间序 SQL、不触发同步刷新或外部调用（AD-4）。匿名可用（AD-8）：用户身份不得 gate 时间流。
- `force-dynamic` 保留；masthead H1「AGUHOT」+「可信热点发布闭环」原样保留（`home.spec.ts` 断言）。`(public)/layout.tsx` 公共骨架不动。
- 诚实状态（NFR-2）：读模型为空→明确空态文案 + 最近更新时间，绝不渲染占位/假数据；DB 不可达=getPrisma 抛错（loud route error，非静默空态）。
- 服务端组件直读 core 读函数（无 API route、无 fetch、无 client state）。复用既有 token（`bg-surface-raised`/`border-border-hairline`/`text-ink-tertiary`/`font-mono`/`bg-brand`）与既有 `@/components/chips`（`AiLabel`）。不引入 shadcn/ui（项目未装）。
- 时间戳视觉降权（`ink-tertiary` + `font-mono`）；`AI 解读` 视觉权重 ≤ 事实标题/摘要（PRD §10）；`AI 解读` 与 `AiLabel` 仅在 `recommendationReason` 非空时渲染（5.1 前 default null→不渲染，不留空营销位）。
- 理由标签只在偏离纯时间序时出现且必须与真实数据一致（FR-3 revised）：折叠条目→"同事件精选"标签；main-line-band 置顶项→复用 `event-card` 的诚实 rankingReason（"近期升温"/"多源覆盖"，无信号则不渲染）。纯时间线条目（单源、非置顶）不带任何理由标签。
- 导入约定：`@aguhot/core` barrel 取 `listPublishedTimeline`/`listPublishedHotEvents`/`PublishedTimelineEntry`/`TIMELINE_FOLD_THRESHOLD`；`@/` 别名取 app 内模块；`import type`；无 TS `enum`。

**Block If:**
- `listPublishedTimeline` 在本地 PG 集成验证失败（4.1 已绿，回归即阻塞）→ HALT。
- `pnpm typecheck` 出现与本 story 改动相关的类型错误且不可自愈 → HALT。

**Never:**
- 不实现筛选（盘前/盘中/盘后、类别）—— 4.3；不在本 story 引入 `?date=`/`?session=` 筛选 UI（首页 default = 最新 trade_date）。
- 不实现搜索覆盖时间流条目 —— 4.4。
- 不生成 `AI 解读` 文案 —— 5.1；`recommendationReason` 为 null 时不渲染该槽，不造词。
- 不在卡内"展开列出每条证据源的时间"做完整逐源清单：`published_timeline` 读模型只携带 `evidenceCount` + `foldedEvidenceRecordIds`（仅 id）+ 代表性 `sourceName`，无逐源 name/time（4.1 残留风险，记录于 4.1 Review Triage Log 与 deferred-work）。逐源时间线是详情页（1.8 `证据时间线`）的职责；卡内 `<details>` 只披露"精选自 N 条证据源（代表来源：{sourceName}）"+ 进详情的引导，不伪造逐源清单。
- 不新增 client JS / `useState` / loading skeleton（公开页均为 server component + `force-dynamic`，既有无 skeleton 约定）。
- 不删除 `feed-filters.tsx`（4.3 可能复用），仅停止在首页 import 它。
- 不新增 `enum`/namespace/参数属性；不内联 SQL 绕过 Prisma。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 时间流默认视图 | `published_timeline` 有数据，首页 GET / | 渲染 main-line-band（top-N saliency）+ 最新 trade_date 的时间流条目列表（`occurredAt DESC`），每条 `TimelineCard` 固定阅读顺序 | 读模型返回空数组→空态 |
| 折叠条目 | 条目 `foldedEvidenceRecordIds.length >= TIMELINE_FOLD_THRESHOLD`(=2) | 卡片显示「同事件精选」标签；原生 `<details>` 可展开，披露"精选自 N 条证据源（代表来源：{sourceName}）"，引导进详情看完整逐源时间线 | 阈值由 event-assembly 拥有，default 2 |
| 单源条目 | `foldedEvidenceRecordIds.length < 2` | 独立条目，无「同事件精选」标签、无理由标签 | — |
| AI 解读槽（5.1 前） | `recommendationReason` 为 null | 不渲染 `AI 解读` 槽与 `AiLabel`（不留空营销位） | — |
| 空态 | `published_timeline` 完全无数据 | 明确空态文案 + 最近更新时间，不渲染卡片/skeleton；main-line-band 仍按 hot-events 读模型渲染（若也为空则各自独立空态） | `listPublishedTimeline` 返回 `[]` 非错误 |
| main-line-band 置顶项 | `listPublishedHotEvents` 有数据 | top-N（V1 取 3）saliency 条目，每项可点进详情，诚实 rankingReason（无信号不渲染） | hot-events 为空→band 不渲染（不造词） |

</intent-contract>

## Code Map

- `apps/web/app/(public)/page.tsx` -- REWRITE：改读 `listPublishedTimeline`（default 最新 trade_date）+ `listPublishedHotEvents`（main-line-band top-N saliency）；渲染 `<MainLineBand>` + `<TimelineCard>` 列表；空态文案 + 最近更新；保留 masthead + `force-dynamic`；移除 `FeedFilters`/window/association 优先级 filter UI（4.3 接管新筛选）
- `apps/web/app/(public)/_components/timeline-card.tsx` -- NEW：server component，渲染单条 `PublishedTimelineEntry`，固定阅读顺序；整卡 `<Link href="/events/{hotEventId}">`；`<details>` 折叠披露；`AiLabel`+`recommendationReason` 仅非空时渲染
- `apps/web/app/(public)/_components/main-line-band.tsx` -- NEW：server component，`listPublishedHotEvents` top-3 saliency 置顶带，复用诚实 rankingReason，每项 Link 进详情
- `apps/web/e2e/timeline.spec.ts` -- NEW：匿名首页时间流面断言（空态面 + main-line-band/timeline 区块结构，masthead 不回归），surface-anchored，无需播种；另含 `@timeline` tagged 播种数据块（覆盖折叠/单源/AI 槽 null/band 置顶）
- `apps/web/e2e/seed-timeline.ts` -- NEW：`@timeline` e2e 的播种脚本，经 `decideReview` 产出 1 个折叠事件（2 源）+ 1 个单源事件；仿 `seed-revision.ts`，清表含 `published_timeline_entries`
- `apps/web/package.json` -- MODIFY：`e2e` --grep-invert 增 `@timeline`；新增 `e2e:timeline` / `seed:timeline` 脚本

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/timeline-card.tsx` -- NEW -- 时间流卡（固定阅读顺序：时间戳+session 标签 / 来源 / 标题 / 摘要 / AI 解读槽（仅非空）/ 证据数；折叠→「同事件精选」`<details>`；整卡 Link 进详情；`ink-tertiary`+`font-mono` 降权时间戳）
- `apps/web/app/(public)/_components/main-line-band.tsx` -- NEW -- 常驻置顶带（top-3 `listPublishedHotEvents` saliency；诚实 rankingReason；每项 Link）
- `apps/web/app/(public)/page.tsx` -- REWRITE -- 读取时间流 + hot-events top-N；组装 main-line-band + timeline 列表；空态 + 最近更新；保留 masthead/`force-dynamic`；移除旧优先级 filter UI
- `apps/web/e2e/timeline.spec.ts` -- NEW -- 空态面与区块结构断言（断言 masthead 不回归、空态文案、无残留优先级 filter pill）

**Acceptance Criteria:**
- Given `published_timeline` 有数据，when 匿名访问 `/`，then 渲染 main-line-band + 时间流卡列表，每张卡按 时间戳→来源→标题→摘要→(AI 解读)→证据数 顺序，整卡可点进 `/events/{hotEventId}`。
- Given 同事件 ≥2 源折叠条目，when 渲染该卡，then 显示「同事件精选」标签且 `<details>` 可展开披露"精选自 N 条证据源（代表来源：{sourceName}）"，不伪造逐源 name/time 清单。
- Given `recommendationReason` 为 null（5.1 前 default），when 渲染时间流卡，then 不渲染 `AI 解读` 槽与 `AiLabel`（视觉权重规则 vacuously 成立）。
- Given `published_timeline` 无数据，when 匿名访问 `/`，then 渲染明确空态文案 + 最近更新时间，不渲染卡片或 skeleton，masthead 仍可见，不触发 `/login` 重定向（AD-8）。
- Given 纯时间线单源条目（非折叠、非置顶），when 渲染，then 不带任何理由标签（FR-3 revised：理由只在偏离纯时间序时出现）。
- Given 既有 1.x/2.x/3.x e2e，when 运行 `home.spec.ts` 等，then masthead 断言全绿不回归。

## Design Notes

**main-line-band 的数据源决策。** `published_timeline` 无 saliency/pin 字段（它是纯时间序投影）。"今日重点/市场主线"需要 top-N saliency，复用既有 `listPublishedHotEvents`（已按 `evidenceCount DESC + latestEvidenceAt DESC` 排序）取 top-3，是诚实且零新读路径的选择。两个读模型并存：band 回答"市场在交易什么"，timeline 回答"分钟级动态"。若 hot-events 也为空，band 不渲染（不造词），timeline 空态独立呈现。

**折叠披露与逐源清单的边界。** UX-DR4b 期望"展开列出每条证据源的时间"，但 `published_timeline` 读模型刻意只携带 `foldedEvidenceRecordIds`（id 集合）+ `evidenceCount` + 代表性 `sourceName`，无逐源 name/time（4.1 残留风险，记录于 deferred-work）。逐源时间线是详情页 `证据时间线`（1.8）的既定职责。卡内用原生 `<details>` 披露"精选自 N 条证据源（代表来源：{sourceName}）· 查看完整证据时间线 →"，诚实、零 client JS、无 N+1。完整卡内逐源清单若未来需要，需在 source-ingest 新增按 id 批量取 published 投影的读路径（超出 4.2，记 deferred）。

**session 标签呈现。** `sessionTag`（pre_open/intraday/post_close/non_trading）折进时间戳 meta 行（如「盘前 · 09:25 UTC」），`font-mono` + `ink-tertiary`，无额外视觉成本；不作为筛选 UI（4.3）。

**整卡可点与折叠展开共存。** 整卡 `<Link>` 包裹正文；`<details>` 的 `<summary>`（「同事件精选」标签）位于 Link 内部——`<summary>` 不是交互式 button/form，嵌套于 `<a>` 合法且不阻断卡片点击；展开内容也随卡进详情无意义，故展开仅做静态文案披露（无 client JS）。时间戳格式复用 `event-card.tsx` 的 locale-stable UTC 格式函数（抽到 card 内本地 helper 或复用；倾向各 card 自带 `formatDateTime`，与 event-card 一致）。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿（`erasableSyntaxOnly` + `verbatimModuleSyntax`）
- `pnpm --filter @aguhot/web e2e` -- expected: 默认公共面不回归（home/navigation/design + 时间流面结构/空态断言全绿，`@timeline` 被 invert-grep 排除）
- `pnpm --filter @aguhot/web e2e:timeline` -- expected: 播种数据面 5/5（折叠/单源/AI 槽 null/main-line-band/阅读顺序）
- `pnpm --filter @aguhot/worker verify:timeline` -- expected: 4.1 数据层 31/31 不回归

**Manual checks (if no CLI):**
- 本地 PG 有播种 published_timeline 时，目视确认卡片阅读顺序、折叠 `<details>` 展开、空态文案 + 最近更新时间；`AI 解读` 在 5.1 前不出现。

## Spec Change Log

<!-- No bad_spec loopback in this run; the section stays empty. -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (low 3)
- defer: 0
- reject: 22
- addressed_findings:
  - `[low]` `[patch]` Fold disclosure body rendered `精选自 N 条证据源（代表来源：{sourceName}）· 查看完整证据时间线 →` as plain text, but the `<details>` is a SIBLING of the whole-card `<Link>` (non-clickable), so the `→` implied a dead navigation affordance. Reworded to `· 完整证据时间线请见详情页` (keeps the intent-mandated "进详情引导", drops the misleading link affordance); updated the matching JSDoc reference.
  - `[low]` `[patch]` `feed.spec.ts` / `seed-feed.ts` were deleted in the prior pass but `@feed` remained in the `e2e` script's `--grep-invert` list (dead config — no test carries `@feed` anymore). Removed `@feed` from the invert pattern.
  - `[low]` `[patch]` The `@timeline` empty-state test cleared `publishedTimelineEntry` rows and asserted the timeline empty copy, but never asserted the band stayed visible — the intent's "各自独立空态" independence invariant (band reads a separate read model) was unpinned. Added `expect(region "今日重点 / 市场主线").toBeVisible()` to that test (hot-events rows are still seeded at that point, so the band genuinely stays).

### 2026-07-11 — Review pass (prior)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (medium 4, low 2)
- defer: 1: (low 1)
- reject: 15
- addressed_findings:
  - `[medium]` `[patch]` `<details>`/`<summary>` lived inside the whole-card `<a>` — clicking the「同事件精选」tag toggled disclosure AND navigated, so the disclosure body was unreachable by mouse. Moved the `<details>` to a SIBLING of the `<Link>` (card footer, outside the anchor hit area); added a `@timeline` test that clicks the summary, asserts the body text appears, and asserts the URL stays on `/`.
  - `[medium]` `[patch]` The untagged empty-state test asserted nothing whenever the local DB held any timeline row (`if (cardsPresent === 0)` with no else) — NFR-2 empty-state copy was pinned only opportunistically. Replaced it with a deterministic `@timeline` test that clears `published_timeline_entries`, reloads, and asserts the empty copy + 「最近更新」unconditionally; the untagged suite now covers structure only.
  - `[medium]` `[patch]` `feed.spec.ts` + `seed-feed.ts` (+ `e2e:feed`/`seed:feed` scripts) tested the V1 priority-feed home surfaces (`?window=`, filter pills, `来源数 1` EventCard) that this story removed — `e2e:feed` would now fail wholesale. Deleted the dead suite + seed + scripts (4.3 owns the new filter UI; `feed-filters.tsx` itself is kept per spec Never).
  - `[medium]` `[patch]` The `@timeline` seeded suite under-exercised the Acceptance Criteria / I-O matrix (presence-only, not ordinal). Strengthened: ordinal reading order via bounding-box y positions (timestamp→source→title→count), single-source card whole-card link href, band top-3 slice (seed extended to 4 published events, assert band `li` count = 3), band honest reason tag positive branch (「近期升温」visible), `<details>` toggle interaction, summary paragraph presence.
  - `[low]` `[patch]` Band `<section aria-label="今日重点 / 市场主线">` duplicated its inner `<h2>` text → screen readers announced twice. Switched to `aria-labelledby` pointing at the heading.
  - `[low]` `[patch]` Removed a redundant `as PublishedHotEventSummary[]` cast in `page.tsx` (`listPublishedHotEvents` already returns that type) and its now-unused type import.

## Auto Run Result

Status: done

**Follow-up review pass (2026-07-11):** Independent 4-layer review (blind-hunter / edge-case-hunter / verification-gap / intent-alignment) of the committed baseline..final_revision diff. Triaged 3 low-severity patches applied, 0 defer, 22 reject.

Follow-up patches:
- `apps/web/app/(public)/_components/timeline-card.tsx` — reworded the fold-disclosure body from `· 查看完整证据时间线 →` to `· 完整证据时间线请见详情页` (the disclosure is a non-clickable sibling of the whole-card Link, so the `→` implied a dead link); JSDoc reference synced.
- `apps/web/package.json` — removed dead `@feed` from the `e2e` `--grep-invert` list (the feed suite was deleted in the prior pass).
- `apps/web/e2e/timeline.spec.ts` — added a band-stays-visible assertion to the `@timeline` empty-state test, pinning the "各自独立空态" independence invariant (band reads a separate read model).

Notable rejects (spectrum, not exhaustive): the `Promise.all` "loud failure" is intent-mandated (DB unreachable = route error, not silent degradation) — the suggested `Promise.allSettled` graceful-degradation contradicts the NFR; the `今日重点` heading + undated `listPublishedHotEvents` are both intent-mandated and defensible under the daily-publish model; `formatDateTime` per-card duplication and the kept-but-orphaned `feed-filters.tsx` are both intent-endorsed; `SESSION_TAG_LABEL` exhaustiveness is compile-time-guarded by `Record<>`; the headline "default e2e doesn't cover the timeline surface" finding rested on a misunderstanding of `--grep-invert` (it excludes only `@timeline`-tagged tests, not the untagged structure block in `timeline.spec.ts`, which runs by default). No new deferred findings this pass — existing deferred-work ledger entries were not touched.

Follow-up verification performed:
- `pnpm --filter @aguhot/web typecheck` — green (`tsc --noEmit` + e2e tsconfig).
- `pnpm --filter @aguhot/web e2e` / `e2e:timeline` — **not run this session**: the dev environment has no `.env` / `DATABASE_URL`, so the Playwright `webServer` (Next) cannot start. Consistent with the spec's documented "本地 PG" prerequisite; the prior pass's 29/29 + 6/6 e2e results stand. This pass's changes are low-risk (one copy string, one `--grep-invert` token removal, one `@timeline`-gated assertion reusing an existing selector) and typecheck covers the compile contract.

Follow-up review recommendation: **false** — only three localized low-consequence patches (copy reword, dead-config cleanup, one test assertion); no behavior/API/security/data impact.

**Summary:** Delivered the Epic 4 时间流 home surface — Story 4.2. The public home (`/`) now reads the 4.1 `published_timeline` read model via `listPublishedTimeline` (default = latest trade_date, `occurredAt DESC`) and renders a minute-level timeline of `<TimelineCard>` (fixed reading order: timestamp+session → source → title → summary → `AI 解读` slot → evidence count; whole-card link to detail; native `<details>`「同事件精选」fold disclosure as a card-footer sibling of the link). A persistent `<MainLineBand>` ("今日重点 / 市场主线") above the feed reuses `listPublishedHotEvents` saliency for the top-3, answering "what is the market trading". Honest empty state (explicit copy + 最近更新). `AI 解读` slot renders only when `recommendationReason` is non-null (NULL pre-5.1 → no slot, no AiLabel). The V1 priority-feed filter UI is removed from the home (4.3 owns the new filters).

**Files changed:**
- `apps/web/app/(public)/page.tsx` — REWRITE: reads `listPublishedTimeline` + `listPublishedHotEvents` concurrently; composes `<MainLineBand>` + `<TimelineCard>` list; honest empty state + 最近更新; masthead + `force-dynamic` preserved; V1 filter UI removed.
- `apps/web/app/(public)/_components/timeline-card.tsx` — NEW: server component, fixed reading order, whole-card `<Link>`, `<details>` fold disclosure as link sibling, `AI 解读` slot only when non-null.
- `apps/web/app/(public)/_components/main-line-band.tsx` — NEW: top-3 saliency band, honest rankingReason, `aria-labelledby` heading.
- `apps/web/e2e/timeline.spec.ts` — NEW: untagged surface/structure suite + `@timeline` seeded suite (reading order, fold toggle, single-card link, band top-3 + reason, AI-null, deterministic empty state).
- `apps/web/e2e/seed-timeline.ts` — NEW: seeds 4 published events (1 folded + 3 single) via the real publish pipeline.
- `apps/web/package.json` — `@timeline` added to `e2e` invert-grep; `e2e:timeline`/`seed:timeline` added; `e2e:feed`/`seed:feed` removed.
- `apps/web/e2e/feed.spec.ts`, `apps/web/e2e/seed-feed.ts` — DELETED (tested the removed V1 priority-feed home; dead after the pivot).

**Review findings breakdown:** 6 patches applied (4 medium — `<details>`-in-anchor interaction bug, empty-state test determinism, dead `feed.spec` cleanup, seeded-suite coverage strengthening; 2 low — redundant aria-label+heading, redundant cast). 1 deferred (timeline 50-row cap / no home affordance — 4.1's deferred pagination). 15 rejected (single-writer-invariant-backed casts, deliberate `formatDateTime` duplication, request-scoped traceId, spec-mandated saliency proxy, cosmetic copy/staleness, and other non-defects).

**Follow-up review recommendation:** true — this pass applied a medium-severity interaction fix (the `<details>`-inside-`<a>` toggle-navigates bug that the original implementation and the step-03 matrix audit both missed) plus a substantial seeded-test rewrite and a dead-suite deletion; an independent follow-up pass would add confidence that the disclosure-sibling restructure and the expanded `@timeline` assertions are clean.

**Verification performed:**
- `pnpm typecheck` — green across all 5 workspace packages.
- `pnpm --filter @aguhot/web e2e` — **29/29 passed** (default public surface: home/navigation/design + untagged timeline structure; `@timeline` and the deleted `@feed` excluded).
- `pnpm --filter @aguhot/web e2e:timeline` — **6/6 passed** (seeded: band top-3 slice + 近期升温, ordinal reading order, fold `<details>` toggle + N-source disclosure, single-card link, AI-slot null, deterministic empty state).
- `pnpm --filter @aguhot/worker verify:timeline` — **PASS, 31/31** (4.1 data-layer regression).

**Residual risks:**
- Timeline 50-row cap with no "more" affordance (4.1 deferred cursor pagination; logged in deferred-work).
- `<details>` fold disclosure shows count + representative source only; the full per-source-by-time list remains on the detail page (1.8) — `published_timeline` carries no per-source name/time (4.1 residual; logged).
- The `@timeline` seed trusts `clusterEvents` to keep the 4 topics distinct; the seed asserts `>= 4 candidates` and finds 半导体/稀土 by name, so a clustering change fails loudly rather than silently.

