# Epic 4 Context: 时间流首页与同事件精选

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Replace the V1 priority-sorted hot-event home feed with a minute-level chronological `时间流`. Users open the home page and see today's market dynamics in reverse time order, grouped by trading day, with multi-source evidence for the same `热点事件` folded into a single "同事件精选" entry. The feed adds session and category filtering and wires timeline entries into search. This epic is the home-surface half of the 2026-07-11 sprint change pivot; the Epic 1/2 event-explanation machinery (evidence timeline, market reaction, operator review) stays as the timeline's deep-read backbone, not discarded. The PRD red line holds: this is a market-dynamics + AI-explanation product, not a raw news portal — every timeline entry must trace back to at least one evidence source.

## Stories

- Story 4.1: 时间流读模型与发布刷新
- Story 4.2: 时间流首页与时间流卡组件
- Story 4.3: 盘前/盘中/盘后与类别筛选
- Story 4.4: 时间流条目与搜索打通

## Requirements & Constraints

- Home default view is the `时间流`: reverse time order, grouped by trading day; natural day is the non-trading-day fallback. (FR-1 revised)
- Same-`热点事件` evidence with ≥2 sources folds into one "同事件精选" entry; folded sources expand in-place; single-source items stay independent. Fold threshold defaults to 2 and is operator-adjustable. (FR-1, FR-3 revised)
- Each timeline entry shows at minimum: timestamp, source name, title, one-line summary, `AI 解读` hook (AI-labeled), and evidence-source count. The `AI 解读` content itself is produced by Epic 5 Story 5.1; Story 4.2 renders the slot, 5.1 fills it. (FR-1)
- Reason labels ("多源覆盖"/"近期升温"/"市场反应明显") only appear when an entry deviates from pure time order (folded or top-pinned) and must match the event's real data state. (FR-3 revised)
- A persistent "今日重点/市场主线" top band (top-N saliency) sits above the feed so the home still proactively answers "what is the market trading". (PRD Vision)
- Session filter (盘前/盘中/盘后/全天) is implemented in full.
- **Category filter V1 scope (2026-07-11 PM decision):** category dimension ships V1 with concept/industry/stock only, reusing the existing `AssociationKind` and the in-memory filter pattern from Story 2.2 feed-filter (server SQL filter now; Json-column reshape to a sub-table is a scale-ceiling defer). `announcement` and `research_report` are explicitly **V1 out-of-scope** — the codebase has no data source, enum value, field, or ingestion path for them, so rendering them would violate "absence as absence". They are logged in deferred-work pending real data sourcing + data-model landing.
- Active filter state is visible, clearable, URL-shareable, and restored on return without losing scroll position. (FR-2)
- Search must cover timeline entry titles and summaries in addition to hot-event titles and theme names. (FR-12, Story 4.4)
- Only `publication_status = published` content appears; every public entry traces back to ≥1 valid evidence source. Empty state shows an explicit message plus last-updated time, never placeholder data. (NFR-2)
- Public path stays anonymous — user identity must not gate the timeline feed. (AD-8)
- All AI-generated copy carries explicit + implicit-metadata labels; `AI 解读` visual weight ≤ factual summary. (NFR-3, PRD §10)

## Technical Decisions

- **Read model, not request-path SQL.** The home reads a new `published_timeline` read model only; no ad-hoc time-order SQL on the web request path. `publish-orchestrator` is the sole writer; it reads (never writes) `event-assembly`'s `HotEvent` and `source-ingest`'s `EvidenceSource` published projections. (AD-3, AD-3b, AD-2)
- **Transactional refresh (architect review method A).** Per-HotEvent folded entries are incrementally upserted (on publish) / deleted (on takedown) *inside the `decideReview` transaction*, alongside the existing `refreshPublishedReadModel` — zero visibility window between approve and takedown. A separate periodic full self-heal BullMQ job exists only for correction, not as the main refresh path; if it fails the stale read model stays readable. Do NOT use full idempotent overwrite as the main refresh — it introduces a visibility window. (AD-3b, AD-4)
- **Re-projection trigger chain.** Once method A lands, appending a reason triggers a per-hotEvent timeline incremental re-projection.
- **Code location.** `published_timeline` model + read contract `listPublishedTimeline` + refresh logic live in `packages/core` `publish-orchestrator`; public home route in `apps/web/(public)`; self-heal job in `apps/worker`.
- **Derived fields.** `session_tag` (盘前/盘中/盘后/non-trading) and `trade_date` are derived by pure functions from A-share session boundaries; the codebase has no such definition today, so this epic introduces it. Composite index `(trade_date, session_tag, occurred_at desc)` supports Story 4.3 filter queries (build it once in 4.1).
- **Fold threshold ownership.** Folding is clustering semantics → owned by `event-assembly` module config (default 2, adjustable), NOT global env.
- **Category filter reuses `AssociationKind`.** V1 category filter (concept/industry/stock) reuses the existing `AssociationKind` union type and the Story 2.2 feed-filter pattern — no new enum, no new table. announcement/research_report are not added to the union (no data source).
- **AI content is decoupled.** `AI 解读` attaches to the `HotEvent`, not the timeline entry; the timeline projection links the HotEvent's latest reason version. Story 4.1 may leave the `recommendation_reason` field null; filling it is Epic 5's job.
- **Conventions.** UUIDv7 PKs; UTC times; `data / meta / error` envelope; `trace_id` on every record and job; `const … as const` unions (no TS `enum`); `import type`; relative imports with `.js` suffix; table names snake_case plural.
- **Stack.** Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui 4; PostgreSQL 18 + Prisma 7; Redis 8 + BullMQ 5.79; Playwright 1.60.

## UX & Interaction Patterns

- **Timeline card (`timeline-card`, UX-DR4b) — distinct from the event card.** Fixed reading order: timestamp → source → title → one-line summary → `AI 解读` hook → evidence count. Timestamp has priority over source (visually de-emphasized via `ink-tertiary`). "同事件精选" tag with an expand interaction listing each evidence source by time. Whole card clicks into the hot-event detail page. No horizontal carousel for the core feed (UX-DR15).
- **Main-line top band (`main-line-band`).** Persistent, lightweight, does not steal the scan rhythm from timeline cards; reuses the FR-3 pin mechanism, always on.
- **Filter pills (`filter-pill`, UX-DR5 revised).** Default light, brand-color only when active; clear path always visible; URL-shareable. V1 surfaces session pills fully and category pills for concept/industry/stock only.
- **AI label (`ai-label`, UX-DR8).** Unified AI marker adjacent to `AI 解读` copy; visually separated from the factual summary; restrained, not a marketing highlight.
- **Voice and tone.** Restrained, verifiable copy. `AI 解读` (= explanation, not recommendation) is the finalized wording — lowest securities-advisory construction risk. The PRD §10 blacklist (six classes: action / return-prediction / manipulation-frame / recommendation-strength / timing-advice / over-certainty) is enforced at generation time (Epic 5), not by this epic.
- **States.** Empty feed → explicit empty message + last-updated time. Non-trading day → natural-day grouping.
- **Responsive.** Desktop left-rail nav; mobile top-nav + drawer; timeline cards stack to a single column; filters stay usable across all three breakpoints.

## Cross-Story Dependencies

- **Story 4.1 is the hard prerequisite.** It delivers the read model + transactional refresh + read contract. Stories 4.2 (home + card), 4.3 (filters), and 4.4 (search) all read `published_timeline` and cannot land before it.
- **Consumes Epic 1/2 outputs.** Projects published `HotEvent` + `EvidenceSource` from the Epic 1 publish pipeline; trading-day/session framing aligns with Epic 2 daily digest.
- **Feeds Epic 5.** Story 5.1 (`AI 解读`) attaches to timeline entries produced here; 4.2 renders the slot, 5.1 fills it. Epic 4 must precede Epic 5.
- **Search extension (4.4) reuses Epic 3 `search-read`.** Timeline entries become an additional searchable corpus — extend the existing read path, do not introduce a new search stack.
- **Pending external gate (non-dev blocker).** PRD §10 compliance review (algorithm-recommendation filing + AI-labeling rule + financial-info-service filing) blocks GA and commercialization, not dev. Epic 4/5 run as "internal beta, not public" until the legal opinion lands. §12 Q9 closed: assume all three obligations trigger.
