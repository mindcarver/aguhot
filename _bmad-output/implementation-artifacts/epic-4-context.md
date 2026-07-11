# Epic 4 Context: 时间流首页与同事件精选

<!-- Generated from planning artifacts (Sprint Change Proposal 2026-07-11). Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 4 replaces the V1 priority-sorted hot-event home feed with a minute-level chronological `时间流`: users open the home page and see today's market dynamics in reverse time order, grouped by trading day, with multi-source evidence for the same `热点事件` folded into a single "同事件精选" entry. It adds session (盘前/盘中/盘后) and category (概念/行业/个股/公告/研报) filtering, and wires timeline entries into search. This is the home-surface half of the Sprint Change Proposal 2026-07-11 pivot; it deliberately keeps the event-explanation machinery (evidence timeline, market reaction, operator review) as the timeline's deep-read backbone rather than discarding it. Success is measured by timeline→detail conversion (SM-1) and session length without depth loss (SM-8), not by raw feed PV (SM-C1).

## Stories

- Story 4.1: 时间流读模型与发布刷新
- Story 4.2: 时间流首页与时间流卡组件
- Story 4.3: 盘前/盘中/盘后与类别筛选
- Story 4.4: 时间流条目与搜索打通

## Requirements & Constraints

- Home default view is the `时间流`, reverse time order, grouped by trading day (natural day as non-trading fallback). (FR-1 revised)
- Same-`热点事件` multi-source evidence folds into one "同事件精选" entry; folded sources are expandable; single-source items stay independent. Fold threshold defaults to 2 (`TIMELINE_FOLD_THRESHOLD`, pending PRD §12 Q6). (FR-1, FR-3 revised)
- Each timeline entry shows at minimum: timestamp, source name, title, one-line summary, `AI 解读` (AI-labeled), evidence count. (FR-1) — Note: `AI 解读` is produced by Epic 5 / Story 5.1; Story 4.2 renders the slot, 5.1 fills it.
- Filtering by session (盘前/盘中/盘后/全天) and category (概念/行业/个股/公告/研报); filter state is visible, clearable, URL-shareable, restored on return. (FR-2, UX-DR5 revised)
- Public site reads only published read models — the timeline is a new `published_timeline` read model; no ad-hoc time-order SQL on the request path. (AD-3, AD-3b, AD-6)
- Only `publication_status = published` content appears in the timeline. (AD-3/AD-6, traceability)
- Search must cover timeline entry titles/summaries in addition to hot-event titles and theme names. (FR-12, Story 4.4)
- Empty state must show explicit message + last-updated time, no placeholder fake data. (FR-1, UX state patterns)

## Technical Decisions

- **Where the code lives.** Timeline read model lives in `packages/core` (`publish-orchestrator` module owns `published_timeline`); public home route in `apps/web/(public)`; refresh worker in `apps/worker`. (Capability → Architecture Map: 时间流 → `apps/web/(public)` + `event-assembly` + `publish-orchestrator`.)
- **Governed by AD-3b plus AD-2, AD-3, AD-4 (architect review: method A).** AD-3b: `published_timeline` is a time-ordered projection, read-only to web. **刷新遵循闸门原子范式（method A）**：`decideReview` 事务内对 per-HotEvent 折叠条目增量 upsert（publish）/ delete（takedown），与 `refreshPublishedReadModel` 并列调用，零可见性窗口；周期性全量自愈 job（BullMQ）仅纠偏，非主刷新路径。AD-2: `publish-orchestrator` sole writer; reads (never writes) `event-assembly`'s `HotEvent` + `source-ingest`'s `EvidenceSource`. AD-4: 自愈 job 走 BullMQ；web 请求路径不等待刷新、不触发同步重算。
- **Single ownership boundary.** `event-assembly` owns `HotEvent`; `source-ingest` owns `EvidenceSource`; `publish-orchestrator` owns `published_timeline`. Cross-module changes flow via commands/queue events, not direct writes.
- **Data model.** New `PublishedTimelineEntry` (UUIDv7, `hot_event_id`, `trade_date`, `occurred_at` UTC, `session_tag`, `source_name`, `title`, `summary`, `evidence_count`, `folded_evidence_ids` array, `trace_id`); composite index `(trade_date, session_tag, occurred_at desc)`（4.3 筛选用，一次建好）。`session_tag`/`trade_date` 由纯函数派生（A 股交易时段边界，codebase 现无此定义，本 epic 新建）。Folded entries retain the set of folded `evidence_source_id`s for traceability (AD-5).
- **Self-heal job (method A).** 周期性 `refreshPublishedTimelineAll` 全量重算覆盖，不产生重复、旧条目不残留；job 失败时既有读模型旧版本仍可读，公开页不崩。主刷新路径是 `decideReview` 事务内增量（`refreshPublishedTimelineForEvent`），非此 job。
- **Stack & conventions.** Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui 4; PostgreSQL 18 + Prisma 7; UUIDv7; UTC times; `data / meta / error` envelope; `trace_id` per record and job; `const … as const` unions (no TS `enum`); `import type`; relative imports with `.js` suffix.
- **Fold threshold (PRD §12 Q6 closed).** = 2: a `HotEvent` with ≥2 `EvidenceSource` folds into one "同事件精选" entry; 1-source or unclustered stays independent. Owned by `event-assembly` module config (folding is clustering semantics, architect review decision), not global env; operator-adjustable.

## UX & Interaction Patterns

- **Timeline card (`{components.timeline-card}`, UX-DR4b new).** Distinct from `event-card`. Reading order: timestamp → source → title → one-line summary → `AI 解读` hook → evidence count. "同事件精选" tag with expand interaction; expanded view lists each evidence source by time. Whole card clicks into the hot-event detail page. Timestamp priority over source. No horizontal carousel (UX-DR15).
- **Main-line top band (UX, PM review decision).** 时间流顶部"今日重点/市场主线"置顶带（top-N saliency，常态启用），主动回答"市场正在交易什么"，避免首页退化为纯扫描。复用 FR-3 置顶机制。
- **Filter pills (UX-DR5 revised).** Session + category dimensions; URL-shareable, restored on return.
- **AI label (UX-DR8 revised).** `AI 解读` carries the unified AI label, adjacent to its copy, visually separated from factual summary.
- **State patterns.** Empty timeline → explicit empty state + last-updated time. Non-trading day → natural-day grouping fallback.
- **Voice and tone.** Restrained, verifiable. 文案定稿为"AI 解读"（解读 = explanation ≠ recommendation，证券投资咨询构造风险最低，与 §1 "AI 解释产品"同源）。Forbidden 黑名单六类见 PRD §10。AI `AI 解读` 视觉权重 <= 事实摘要。
- **Responsive behavior.** Left rail nav on desktop, top nav + drawer on mobile; timeline cards collapse to single column; session/category filters remain usable across breakpoints.

## Cross-Story Dependencies

- **Depends on Epic 1/2 outputs.** `published_timeline` projects published `HotEvent` + `EvidenceSource` (Epic 1 publish pipeline + read models) and uses trading-day/session framing aligned with Epic 2 daily digest.
- **`published_timeline` is a hard prerequisite for 4.2/4.3/4.4.** Story 4.1 delivers the read model + refresh; 4.2 (home + card), 4.3 (filters), 4.4 (search integration) all read it.
- **Feeds Epic 5.** Story 5.1 (`AI 解读`) attaches to timeline entries produced here; the 4.2 card renders the `AI 解读` slot, 5.1 fills it. Epic 4 must precede Epic 5.
- **Search extension (4.4) consumes `search-read` (Epic 3).** Timeline entries become an additional searchable corpus; Story 4.4 extends the existing search read path rather than introducing a new search stack.
- **Pending external gates.** Story 4.1 spec is `pending-approval`: PM/Architect approval of Sprint Change Proposal 2026-07-11 is the remaining prerequisite to dev (PRD §12 Q6 fold threshold is now closed at 2).
