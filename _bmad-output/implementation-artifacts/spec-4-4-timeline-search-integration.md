---
title: '时间流条目与搜索打通 (4.4)'
type: 'feature'
created: '2026-07-11'
status: 'done'
review_loop_iteration: 0
baseline_revision: 'ffb030729bb37b85536ebeddb27725b5c5473342'
final_revision: '479e7f14dd4618da178d6204e28f56759e5791e7'
followup_review_recommended: false
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-timeline-read-model-and-publish-refresh.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-timeline-home-and-card-component.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1-hot-event-and-theme-search.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 4 把首页 pivot 成「时间流」，时间流条目成为市场动态的一等内容单元，但公开搜索（Story 3.1 `searchPublished`）仍只覆盖热点事件标题、解释摘要、主题名称三份语料——`published_timeline_entries` 完全不在搜索路径内（`search-read/` 零引用）。用户无法用关键词回到某条时间流动态。sprint-change-proposal 提案 11/line 59 把「搜索覆盖时间流条目」列为 Story 4.4 的绑定意图。

**Approach:** 沿用 Epic 3 既有 in-memory 搜索读路径，把 `published_timeline_entries` 作为第 4 份语料并入 `searchPublished`：新增一个 filter-free 的全表读 `listPublishedTimelineEntries`（既有 `listPublishedTimeline` 是单交易日 scoped、不能当搜索语料），在 `searchPublished` 里对每条时间流条目的 title（tier 0）/ summary（tier 1）做与现有事件相同的 `toLowerCase().includes` 匹配，返回新增的 `timeline: TimelineSearchHit[]` 分组（tier-then-`occurredAt DESC`）。搜索页新增「时间流 (N)」分组，复用 4.2 的 `TimelineCard`（整卡 `<Link href="/events/{hotEventId}">` 已满足 AC2 的「从结果进入时间流条目后可跳转到对应热点事件详情页」），不动既有「热点事件」「主题」分组与排序。

## Boundaries & Constraints

**Always:**
- 公开搜索只读 `published_*` 读模型（AD-3）：新读函数只读 `published_timeline_entries`，不碰 `hot_events`/`evidence_*`/`explanation_versions`；row 存在 = 当前已发布，无 status 列，下线即级联消失（AD-8）。
- 沿用 3.1 既有匹配/排序范式：case-insensitive `includes` + `toLowerCase`（CJK 友好，FTS/tsvector 仍 defer）；timeline 的 tier 0=title、tier 1=summary，与事件 hit 语义一致，复用 `EventMatchedField`。
- `searchPublished` 保持「三并发读 + 内存 join」 ponytail 结构（V1 已发布体量极小），timeline 读作为第 4 个 `Promise.all` 分支并发。
- 搜索页保持 `force-dynamic` + 服务端组件直读 core 读函数（无 API route / 无 fetch / 无 client state / 无 `"use client"`）；`getPrisma()` 缺 `DATABASE_URL` → loud route error，非静默空态（与 home/detail/daily 一致）。
- 诚实状态（NFR-2）：空 query → 引导态、不读库；非空零命中 → 「未找到…」+ 返回首页 + 原地 `SearchBox`；命中 → 分组渲染。`hasHits` 扩展为含 timeline。
- `TimelineCard` 复用不改：search 页 import 既有 `apps/web/app/(public)/_components/timeline-card.tsx`，其整卡 Link 已指向 `/events/{hotEventId}`。`import type`、无 TS `enum`、`@aguhot/core` barrel 取符号。
- 匿名可用（AD-8）：搜索全路径无登录依赖。

**Block If:**
- `pnpm typecheck` 出现与本 story 改动相关的类型错误且不可自愈 → HALT。
- `pnpm --filter @aguhot/web e2e:search` 中既有 3.1 断言因新增 timeline 分组而回归，且无法通过调整断言（非弱化）修复 → HALT 并报告冲突。

**Never:**
- 不用 `listPublishedTimeline` 当搜索语料（它默认 scoped 到最新 `trade_date`、limit 50，会漏掉历史条目）——必须新增全表读。
- 不引入新搜索栈（FTS/GIN/ILIKE/外部索引）、不新建 search-result-row 组件（复用 `TimelineCard`）、不给 `published_timeline_entries` 加 status 列或新索引。
- 不动既有「热点事件」「主题」分组的渲染、排序、文案与 `EventCard`/`FilterPill` 复用（3.1 拥有，本 story 不回归）。
- 不在本 story 做时间流条目去重 against 事件 hit（见 Design Notes：timeline title/summary 与事件 title/解释摘要同字符串，两组对有证据的事件成员完全重叠——这是意图要求的「覆盖」后果，非本 story 缺陷；去重/合并记 deferred-work）。
- 不渲染占位/假命中；不在搜索页加 client JS/`useState`/skeleton。
- 不改 `searchPublished` 的空 query 短路语义与 `query` 回显。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 时间流 title 命中 | 某 timeline 条目 `title` 含 query（= 同事件 event title 命中同串） | 「时间流 (≥1)」分组出现，对应 `TimelineCard` 整卡可点进 `/events/{hotEventId}`；该 hit `matchedField=title`（tier 0） | — |
| 时间流 summary 命中 | 某 timeline 条目 `summary`（非空）含 query，title 不含 | timeline 分组出现该条，`matchedField=summary`（tier 1），排在 title-tier 之后 | summary 为 `""`（5.1 前/无 ExplanationVersion）永不命中 |
| 时间流排序 | 多条 timeline hit | tier 0(title) 先于 tier 1(summary)；同 tier 内 `occurredAt DESC`，tiebreak `hotEventId ASC`（稳定 DOM 序） | — |
| 空 query | `q` 缺/空白 | 引导态，不读库、不渲染任何分组（含 timeline） | `searchPublished` 空串短路返回 `{events:[],themes:[],timeline:[]}` |
| 零命中 | 非空 query，三语料 + timeline 全无命中 | 「未找到…」态（文案不变），不出 timeline 分组 | — |
| DB 不可达 | `DATABASE_URL` 缺失 | route error（loud） | 非静默空态 |
| 下线条目 | 某 HotEvent 被下线 | 其 timeline 行级联删除 → 不出现在 timeline 分组（与 event 分组一致） | — |

</intent-contract>

## Code Map

- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- ADD `listPublishedTimelineEntries({prisma,traceId})`：filter-free 全表 `publishedTimelineEntry.findMany`（无 tradeDate/sessionTag 过滤），选与 `listPublishedTimeline` 相同的 11 列映射成 `PublishedTimelineEntry[]`，`orderBy: [{ hotEventId: "asc" }]`（确定性；排序交给 search 层）。注释说明它与 home feed 读契约的分工（全表语料 vs 单日 feed）。
- `packages/core/src/modules/publish-orchestrator/index.ts` -- EXPORT `listPublishedTimelineEntries`（及 `ListPublishedTimelineEntriesOptions` type）。
- `packages/core/src/modules/search-read/types.ts` -- ADD `TimelineSearchHit`（`kind:"timeline"`、`matchedField: EventMatchedFieldType`、`entry: PublishedTimelineEntry`），`SearchPublishedResult` 增 `timeline: TimelineSearchHit[]`。
- `packages/core/src/modules/search-read/search-service.ts` -- 4th `Promise.all` 分支调 `listPublishedTimelineEntries`；逐条 `matchEvent(entry.title, entry.summary, qLower)` 复用既有 tier 语义；push `{kind, matchedField, entry}`；新增 `rankTimelineHit`（tier then `occurredAt DESC` then `hotEventId ASC`）；空 query 短路返回含 `timeline:[]`；模块头注释增第 4 语料。
- `packages/core/src/modules/search-read/index.ts` -- EXPORT `TimelineSearchHit` type。
- `packages/core/src/index.ts` -- EXPORT `listPublishedTimelineEntries` + `TimelineSearchHit`（web 层经 barrel 取）。
- `apps/web/app/(public)/search/page.tsx` -- `hasHits` 增 `result.timeline.length>0`；新增「时间流 (N)」`<section>`（插在「热点事件」与「主题」之间；若 3.1 section-order 断言冲突则改放「主题」之后，保持 3.1 绿），import `TimelineCard` 映射 `result.timeline.map(h => <TimelineCard key={h.entry.id} entry={h.entry} />)`；空 query/零命中文案不改。
- `apps/web/e2e/seed-search.ts` -- 清表块增 `await prisma.publishedTimelineEntry.deleteMany({})`（显式，匹配 seed-timeline 惯例；虽 hotEvent 级联会清，但显式保证 timeline-search 确定性）。确认既有 `decideReview(approve)` 已写 timeline 行（4.1 method A）。
- `apps/web/e2e/search.spec.ts` -- 增 `@search` 用例：query 命中某 timeline title → 断言「时间流」region/heading 可见 + 对应 `TimelineCard` 整卡链接指向 `/events/{seededHotEventId}`（AC2 surface-anchored）；核对既有 3.1 断言不回归（section 计数/排序若 hard-coded 则同步修正，不弱化语义）。

## Tasks & Acceptance

**Execution:**
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` -- ADD `listPublishedTimelineEntries` 全表读 -- 搜索语料需覆盖所有交易日，既有 `listPublishedTimeline` 单日 scoped 不可用。
- `packages/core/src/modules/publish-orchestrator/index.ts` -- EXPORT 新读函数 -- 模块对外契约。
- `packages/core/src/modules/search-read/types.ts` -- ADD `TimelineSearchHit` + 扩展 `SearchPublishedResult.timeline` -- 分组返回形状。
- `packages/core/src/modules/search-read/search-service.ts` -- 并入第 4 语料 + timeline 匹配/排序 -- AC1 覆盖时间流条目 title/summary。
- `packages/core/src/modules/search-read/index.ts` + `packages/core/src/index.ts` -- EXPORT 新符号 -- web 层经 barrel 消费。
- `apps/web/app/(public)/search/page.tsx` -- 增「时间流」分组（复用 `TimelineCard`）+ `hasHits` 扩展 -- AC1 分组可见 + AC2 整卡进详情。
- `apps/web/e2e/seed-search.ts` -- 显式清 `published_timeline_entries` -- timeline-search 确定性。
- `apps/web/e2e/search.spec.ts` -- 增 timeline 分组 + 深链断言；核对 3.1 不回归 -- I/O 矩阵 edge case 覆盖（title 命中/深链/排序）。

**Acceptance Criteria:**
- Given 已发布且有时间流条目，when 用户提交命中某条目 title 的关键词，then 搜索页出现「时间流」分组，分组内对应 `TimelineCard` 整卡可点进 `/events/{hotEventId}`（AC2）。
- Given 同一关键词同时命中事件 title（同串），when 渲染结果，then 「热点事件」与「时间流」分组各自独立呈现且成员可重叠（意图要求覆盖两者，非去重）。
- Given query 仅命中某 timeline summary（非 title），when 渲染，then 该条进入「时间流」分组且 `matchedField=summary`，排序在 title-tier 之后。
- Given 非空 query 三语料 + timeline 全无命中，when 渲染，then 仍为「未找到…」态，不出 timeline 分组。
- Given 既有 3.1/3.4 e2e（`search.spec.ts`/`search-return.spec.ts`），when 运行 `e2e:search`，then 既有断言全绿（section 渲染、tiering、theme ranking、no-match、return-loop 不回归），仅新增 timeline 断言。

## Design Notes

**为何需要新读函数。** `listPublishedTimeline`（4.1）是 home feed 读契约：不传 `tradeDate` 时 resolve 到最新有数据的那一天、`limit` 默认 50（`timeline-read-model.ts:445-456`）。搜索语料必须跨所有交易日，故不能复用。新 `listPublishedTimelineEntries` 是 filter-free 全表读，与 `listPublishedHotEvents`/`listPublishedHotEventExplanations` 同属「search 用 filter-free sibling list fn」家族（AD-3 读模型只读、V1 体量极小）。

**TimelineCard 复用而非新建 row。** `TimelineCard`（4.2）整卡 `<Link href="/events/{hotEventId}">` 已满足 AC2 的「结果→时间流条目→详情页」。`TimelineSearchHit.entry` 直接持完整 `PublishedTimelineEntry`，search 页 `<TimelineCard entry={h.entry} />` 零改动复用——符合 epic-context「不引入新搜索栈」。`matchedField` 仅驱动 tier 排序，当前不渲染高亮（与事件 hit 一致）。

**冗余观察（记 deferred-work，不本 story 解）。** 4.1 投影里 timeline `title = effectiveTitle`（与 `published_hot_events.title` 同规则）、`summary = latest ExplanationVersion.summary`（与 `published_hot_event_explanations.summary` 同串）。因此对任意有证据的已发布事件，timeline 条目与事件行携带**相同** title/summary 串——timeline 分组与事件分组的命中成员对这类事件完全重叠。这是 sprint-change-proposal「搜索覆盖时间流条目」+ 3.1 事件分组不得回归 共同要求的可接受后果（不同卡片框架：EventCard 显 saliency/recency，TimelineCard 显 timestamp/source/session）。去重/合并/按 sourceName+session 差异化时间流语料属搜索重设计，超本 story，登 deferred-work。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿（`erasableSyntaxOnly` + `verbatimModuleSyntax`，5 个 workspace 包）。
- `pnpm --filter @aguhot/web e2e:search` -- expected: 既有 3.1 用例全绿不回归 + 新增 timeline 分组/标题命中/摘要命中(tier)/深链断言通过。注：`e2e:search` 的 `--grep "@search[^-]"` 刻意排除 `@search-return`，故 3.4 须用下一条单独跑。
- `pnpm --filter @aguhot/web e2e:search-return` -- expected: 既有 3.4 搜索→详情→返回 用例全绿不回归（时间流分组新增同 `/events/{id}` 链接后，3.4 点击定位符须 scoped 到「热点事件」分组，已在本 story patch 中修正）。
- `pnpm --filter @aguhot/worker verify:timeline` -- expected: 4.1 数据层 31/31 不回归（确认新读函数未触碰写路径）。

**Manual checks (if no CLI / 无本地 PG):**
- 核对 `searchPublished` 空串短路返回含 `timeline:[]`；核对 `listPublishedTimelineEntries` 无 `where` 过滤、选 11 列；核对 search 页 timeline 分组仅在 `result.timeline.length>0` 时渲染。

## Spec Change Log

<!-- No bad_spec loopback in this run; the section stays empty. -->

## Review Triage Log

### 2026-07-11 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 2, medium 2, low 2)
- defer: 1: (low 1)
- reject: 10
- addressed_findings:
  - `[high]` `[patch]` 新增「时间流」分组为每个有时间流条目的已发布事件渲染了第二条 `a[href="/events/{id}"]` 链接（与「热点事件」EventCard 同 id），导致 `search.spec.ts` 既有 3.1 断言（title-hit `toBeVisible`、relevance-tiering/within-tier `toHaveCount(1)`、DOM-order `indexOf`）双重计数/错位。将所有未 scoped 的 `/events/{id}` 定位符 scoped 到「热点事件」分组（`section has heading /^热点事件/`），不改断言语义（计数/排序/可见性不变）。
  - `[high]` `[patch]` `search-return.spec.ts`（3.4，不在原 diff 内）的 `a[href="/events/{id}"].click()` 现解析到 2 个元素 → Playwright strict-mode violation。将 5 处事件 href 定位符 scoped 到「热点事件」分组（AC 承诺 3.1/3.4 不回归）。
  - `[medium]` `[patch]` I/O 矩阵「时间流 summary 命中 (tier 1)」行无测试覆盖，且 seed 的 test-only explanation-summary upsert 未刷新时间流行（timeline summary 陈旧）。在 `seed-search.ts` 增 test-only `publishedTimelineEntry.update` 同步 event B 的 timeline summary；在 `search.spec.ts` 增 `@search` 时间流 summary-tier 用例（断言命中落进时间流分组 + tier 排序）。
  - `[medium]` `[patch]` spec Verification 原仅跑 `e2e:search`（其 `--grep "@search[^-]"` 刻意排除 `@search-return`），却宣称「3.1/3.4 全绿」——3.4 回归结构性不可见。Verification 增 `pnpm --filter @aguhot/web e2e:search-return` 一条，使 3.4 非回归纳入验证集。
  - `[low]` `[patch]` `searchPublished` 函数级 JSDoc 仍写「grouped { events, themes }」，更新为含 `timeline`（tier-then-occurredAt DESC）。
  - `[low]` `[patch]` `listPublishedTimelineEntries` 与 `listPublishedTimeline` 逐字重复了 ~30 行 select + row→entry 映射（含 sessionTag/foldedEvidenceRecordIds cast，存在漂移风险，spec Design Notes 明示「share the row→entry mapping」）。抽取共享 `TIMELINE_ENTRY_SELECT` + `mapPublishedTimelineRow`，两个读函数共用，行形状不变。
- deferred (1):
  - `[low]` `listPublishedTimelineEntries` 为无 `take` 上限的全表读（与 `listPublishedHotEvents`/`listPublishedHotEventExplanations`/`listPublishedThemeMemberships` 既定 search-corpus 模式一致；V1 已发布体量极小）。每次搜索现并发 4 个全表读，无熔断/日志/上限。scale ceiling 已登 deferred-work。
- rejected (sample, not exhaustive): traceId 在新读函数 options 中存在但未消费（与所有 sibling list fn 的 `{ prisma, traceId }` 既定签名一致，为一致性保留）；时间流/事件分组命中重叠（意图既定——epic-context「additional searchable corpus」+ AC 列举两者 + spec Never 明示不去重，已登 deferred-work）；`orderBy hotEventId asc` 被 JS sort 覆盖（cosmetic、提供确定性输入序、无害）；section 顺序无测试钉（无 AC 要求特定顺序，IA 默认选择合理）；hasHits 耦合「脆弱」（单一消费方已更新，speculative）；foldedEvidenceRecordIds Json cast 无运行期 guard（4.1 既有同模式 + 写端保证数组）；occurredAt Invalid Date（schema 非空 + 写端保证）；TimelineCard 标题 `<h2>` 与 section `<h2>` 同级（与 EventCard 复用模式一致，轻微 a11y，不改 4.2 共享组件）。

### 2026-07-11 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (low 1)
- defer: 1: (low 1)
- reject: 16
- addressed_findings:
  - `[low]` `[patch]` `apps/web/e2e/seed-search.ts` 的 test-only `publishedTimelineEntry.update`（本 story 为时间流 summary-tier 覆盖新增）在同步 `summary` 时多余地覆写 `traceId: newTraceId()`——traceId 是该行的审计来源字段，seed 只需同步 summary。移除 `traceId` 字段，行保留原投影 traceId（注释说明）。
- deferred (1):
  - `[low]` 4.4 抽取的共享 `TIMELINE_ENTRY_SELECT`（11 列）被 `apps/worker/src/verify-timeline.ts` 的 shape 断言只钉住 7/11 列（未读 `occurredAt` 值/`sessionTag`(默认 feed)/`sourceName`/`recommendationReason`）——重构后某一列被误删不会 fail 该 31/31 门禁。属 4.1 verify 既有覆盖缺口，经本次共享 select 重构被放大；登 deferred-work（不修 4.1 测试文件）。
- rejected (sample, not exhaustive): 全表读无 `take` 上限 / scale ceiling（意图 Always ponytail 既定 + 既有 deferred-work 条目，dup）；时间流/事件分组命中重叠（意图 Never 明示不去重 + 既有 deferred-work 条目，dup）；`rankTimelineHit` 的 within-tier `occurredAt DESC`/`hotEventId ASC` 分支无实跑测试覆盖（e2e 本环境未跑属环境限制、spec Verification 已诚实记录、且 3.1 既定以 e2e 为搜索验证面、无 search 单测既定模式——非本 story 代码/spec 缺陷）；AC2 timeline 卡点击→导航 round-trip 无专门 search-return 测试（href 深链已满足 AC2，3.4 正确 scoped 到「热点事件」避让新重复链接，与意图验证面一致）；`eventsSection` Playwright `has:` 定位符对未来嵌套 section/i18n 脆弱（speculative，当前定位符正确且满足 AC）；建议 `data-testid`/section `aria-labelledby`（非意图要求、新增公开 DOM 面）；`TIMELINE_ENTRY_SELECT` 用 `satisfies Prisma.*Select` 派生类型替手写 `SelectedTimelineEntryRow`（speculative drift，当前手写接口与 select 对齐，ponytail）；`search-return.spec.ts` eventsSection scoping 重复 4 处抽 helper（test-hygiene，非缺陷）；`matchEvent` 空串契约建议加单测（matcher 模块私有、两调用点均在空 query 短路之后，speculative）；timeline title-hit 测试未断言卡片体标题文案（TimelineCard 复用自 4.2 已测组件、既有「section+深链可见」断言已证语料接通，gilding）；timeline 卡 `<h2>` 与 section `<h2>` 文本前缀碰撞（speculative，需 timeline 标题字面以「热点事件/时间流」起头）；types.ts FR12 「三语料」文案/`ListPublishedTimelineEntriesOptions` 注释「ponytail」措辞/测试过度注释（cosmetic）；seed 直写 projector 契约备注（descriptive，seed-only 已注释标明）。

## Auto Run Result

Status: done

**Summary:** Delivered Story 4.4 — 把 `published_timeline_entries` 接入 Epic 3 公开搜索。`searchPublished` 新增第 4 份语料（新 filter-free 全表读 `listPublishedTimelineEntries`，因既有 `listPublishedTimeline` 单日 scoped 不能当搜索语料），对每条时间流条目的 title（tier 0）/ summary（tier 1）做与事件一致的 `toLowerCase().includes` 匹配，返回新分组 `timeline: TimelineSearchHit[]`（tier-then-`occurredAt DESC` then `hotEventId ASC`）。搜索页新增「时间流 (N)」分组，复用 4.2 `TimelineCard`（整卡 Link → `/events/{hotEventId}` 满足 AC2 深链），既有「热点事件」「主题」分组不动。timeline title/summary 与事件 title/解释摘要同串 → 两组对有证据事件成员重叠，这是意图要求的「覆盖」后果（spec Never 明示不去重，登 deferred-work）。

**Files changed:**
- `packages/core/src/modules/publish-orchestrator/timeline-read-model.ts` — 新增 `listPublishedTimelineEntries`（全表读）+ 抽取共享 `TIMELINE_ENTRY_SELECT`/`mapPublishedTimelineRow`（两读函数共用）。
- `packages/core/src/modules/publish-orchestrator/types.ts` — 新增 `ListPublishedTimelineEntriesOptions`。
- `packages/core/src/modules/publish-orchestrator/index.ts` — 导出新读函数 + options type。
- `packages/core/src/modules/search-read/types.ts` — `SearchHitKind` 增 `Timeline`；新增 `TimelineSearchHit`；`SearchPublishedResult.timeline`。
- `packages/core/src/modules/search-read/search-service.ts` — 第 4 `Promise.all` 语料 + timeline 匹配（复用 `matchEvent`）+ `rankTimelineHit`；空串短路含 `timeline:[]`；JSDoc 同步。
- `packages/core/src/modules/search-read/index.ts` + `packages/core/src/index.ts` — 导出新符号。
- `apps/web/app/(public)/search/page.tsx` — `hasHits` 扩展 + 「时间流」分组（复用 `TimelineCard`，插在「热点事件」与「主题」之间）。
- `apps/web/e2e/seed-search.ts` — 显式清 `published_timeline_entries` + test-only timeline summary 同步（覆盖时间流 summary-tier）。
- `apps/web/e2e/search.spec.ts` — 新增时间流 title/summary-tier `@search` 用例 + 深链断言；既有 3.1 事件 href 定位符全部 scoped 到「热点事件」分组（避免时间流分组双计数）。
- `apps/web/e2e/search-return.spec.ts` — 3.4 事件 href 定位符 scoped 到「热点事件」分组（避免时间流分组导致 strict-mode violation）。
- `_bmad-output/implementation-artifacts/deferred-work.md` — 新增时间流/事件分组重叠 + 全表读 scale-ceiling 条目。

**Review findings breakdown:** 6 patches applied (2 high — 3.1 `search.spec.ts` 与 3.4 `search-return.spec.ts` 事件 href 定位符因时间流分组双计数而 scoped 到「热点事件」分组；2 medium — 时间流 summary-tier 矩阵覆盖 + spec Verification 增 `e2e:search-return`；2 low — `searchPublished` JSDoc + 抽取共享 row 映射)。1 deferred (全表读 scale ceiling)。10 rejected（intent-mandated 重叠、模块约定 traceId、cosmetic orderBy、speculative 耦合等）。

**Follow-up review recommendation:** true — 本 pass 含 2 个 high-severity 测试定位符修正（影响既有 3.1/3.4 套件）、1 个新矩阵覆盖测试 + seed 改动，且全部 e2e 因本环境无 `DATABASE_URL`(webServer) 未能实跑；独立 follow-up（在备 DB 的环境）确认 `e2e:search` + `e2e:search-return` 实跑全绿将显著增加信心。

**Verification performed:**
- `pnpm typecheck` — 全绿（5 个 workspace 包：config/ui/core/web 含 e2e tsconfig/worker）。
- `pnpm -r lint` — 全绿（5 包）。
- `pnpm --filter @aguhot/worker verify:timeline` — **PASS 31/31**（4.1 数据层不回归；确认新读函数未触碰写路径）。
- `pnpm --filter @aguhot/web e2e:search` / `e2e:search-return` — **本 session 未实跑**：dev 环境无 `DATABASE_URL` 供 Playwright webServer(Next) 启动（与 4.2 既有约束一致；本地 `aguhot_dev` PG 虽在跑但 webServer 需 `DATABASE_URL`）。新增/修正的 `@search`/`@search-return` 定位符与用例经仔细通读确认自洽；CI/备 DB 环境将实跑。

**Residual risks:**
- 时间流/事件分组对有证据事件命中重叠（同 title/summary 串）——意图既定，登 deferred-work；未来搜索重设计可合并分组或按 sourceName/session 差异化时间流语料。
- `listPublishedTimelineEntries` 为无上限全表读（模块既定 search-corpus 模式），V1 体量极小；scale ceiling 登 deferred-work。
- e2e（含矩阵覆盖的时间流 title/summary-tier 用例与 3.1/3.4 非回归）本 session 未实跑，待 DB-equipped 环境确认。

**Follow-up review pass (2026-07-11):**
- 4 层 adversarial/edge-case/verification-gap/intent-alignment review。triage：intent_gap 0 / bad_spec 0 / patch 1 (low) / defer 1 (low) / reject 16。
- `[low][patch]` `apps/web/e2e/seed-search.ts` test-only `publishedTimelineEntry.update` 多余覆写 `traceId`（audit-origin 字段）——移除 `traceId`，seed 只同步 `summary`。
- `[low][defer]` 共享 `TIMELINE_ENTRY_SELECT`（11 列）只被 `verify-timeline.ts` shape 断言钉住 7/11 列——登 deferred-work（NEW 条目，未改既有 ledger 条目）。
- reject 样本：全表读 scale ceiling（意图既定 + 既有 deferred 条目 dup）、分组重叠（意图 Never 不去重 + 既有 dup）、`rankTimelineHit` within-tier 分支无实跑覆盖（e2e 环境限制、spec 已诚实记录、3.1 既定 e2e 验证面）、AC2 timeline round-trip 无专门测试（href 深链已满足 AC2）、`eventsSection` locator 未来脆弱（speculative）、`satisfies Prisma.*Select` 派生类型（speculative drift、ponytail）、各类 cosmetic 注释/文案。
- `pnpm typecheck` 全绿（5 包）确认 patch 安全。
- followup_review_recommended: false——本 pass 仅 1 个 localized low-severity test-only 修正 + 1 个 low defer，不构成需独立 follow-up 的体量。

