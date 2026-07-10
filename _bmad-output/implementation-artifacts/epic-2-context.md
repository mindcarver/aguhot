# Epic 2 Context: 主线联动与日度复盘

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the single-event view established in Epic 1 into a connected mainline experience. Beyond reading one hot event, the user can see which concepts, industries, and representative stocks it touches, whether the market has already reacted, whether it is one-off noise or part of a sustained theme, and how the whole trading day compresses into a structured daily review. The epic wires the bidirectional navigation closed loop 首页 ↔ 详情 ↔ 主题页 ↔ 日报 so discovery, explanation, and review form one continuous reading path.

## Stories

- Story 2.1: 市场反应信号生成与展示
- Story 2.2: 概念、行业与个股关联视图
- Story 2.3: 主题页连续追踪
- Story 2.4: 结构化日报生成与阅读
- Story 2.5: 跨首页、主题页、日报与详情页的主线浏览闭环

## Requirements & Constraints

- A market-reaction record must include at least one price/volume-dimension signal AND at least one sector/limit-up-dimension signal; every signal carries a trading-session time context so it cannot be confused with another session.
- Market-reaction signals are explanatory, never advisory: no buy/sell/target-price/position wording anywhere in the detail reaction block, theme page, or daily review. Differentiation is "explain the news, not recommend stocks."
- Concept/industry/stock associations shown on detail must rest on an explicit mapping basis — arbitrary hand-filled associations are not allowed — and every associated item must have a clear click-through destination (filtered view, detail, or secondary page); dead links are defects.
- Theme continuity must be honest: when evidence is insufficient to relate an event to a theme or to historical events, the system shows nothing rather than fabricating "similar history."
- The daily review must contain the day's key hot-event list plus a brief conclusion per event, label its coverage date and generation time, and let users jump from each entry to the corresponding event detail.
- A theme page aggregates multiple events across time and presents them chronologically so continuity reads as a sequence; users can navigate from the theme page back to any member event.
- Navigation must be a true closed loop: detail → theme (FR9), daily → detail (FR10), theme → detail (FR11), detail → filtered/secondary views (FR7). Any dead-end is an Epic 2 defect.
- Return paths must preserve reading context: returning from detail to a list (homepage with filters, theme sequence, or daily list) restores filter state and scroll position rather than always falling back to the homepage top.
- Graceful degradation is load-bearing: when market data, theme evidence, or partial external data is unavailable, the hot event and its evidence timeline still render with an explicit missing-status notice; absence is shown as absence, never silent omission or fabricated completeness.
- All AI-generated daily-review (and any AI-derived association/theme) content carries the uniform AI label, identical to other AI surfaces; the label signals "AI-processed layer with sources," not a premium or profit opportunity.
- Public content surfaced via daily/theme paths must retain evidence source, source name, time, and original link; traceability propagates into every Epic 2 surface.
- V1 is Web-only; daily review and theme pages must work on desktop and mobile.
- Success signals: detail-page average dwell ≥ 2 min (market-reaction is a key dwell driver), logged-in 7-day retention ≥ 20% (daily + theme drive return visits), daily-review open rate ≥ 25%.

## Technical Decisions

- **Single write-owner per aggregate (same rule as Epic 1):** `market-reaction` solely owns the `ReactionSnapshot` aggregate (price/volume + sector/limit-up signals attached to a hot event); `theme-linking` solely owns `Theme` associations and theme/historical-event continuity judgments. Epic 2 never writes the `HotEvent` cluster owned by `event-assembly`.
- **Concept/industry vs representative stock:** no dedicated module is named. By the ownership rule, concept/industry/theme associations fall under `theme-linking`; representative-stock and price/volume reaction data fall under `market-reaction` (the `ReactionSnapshot` owner). The internal sub-aggregate split is left to module design.
- **`MarketDataAdapter` port:** all market-data (行情) sources enter exclusively through this port in `packages/core/contracts`. Domain and publish modules must not import third-party SDKs directly; provider swaps happen only in the adapter/worker-assembly layer. The concrete financial-data vendor list is deferred.
- **Daily digest is an async, versioned job:** daily-review generation lives in `apps/worker/src/jobs/` (the `digest` job) and runs as a BullMQ job — the web request path never blocks on it. The digest is a versioned, traceable artifact (append-only), not an in-place overwrite.
- **Three Epic-2-relevant BullMQ job categories** (Redis 8 / BullMQ, kebab-case names), each carrying a `trace_id`: market signal aggregation (writes `ReactionSnapshot`), daily digest generation, and theme backfill (retroactively associates historical events to themes, powering FR9 continuity and FR11 evolution). Web may enqueue jobs but must not await their result.
- **Public reads only published read models:** theme page, daily page, and the detail page's reaction/association sections read only `published_*` (or equivalent) read models generated/refreshed by `publish-orchestrator` — never raw ingest, intermediates, or operator working tables. This is what guarantees consistent ordering, visibility, and performance across the closed loop. Visibility stays gated by `publication_status = published`.
- **Data model seed (cardinalities):** `HOT_EVENT ||--o{ REACTION_SNAPSHOT` (one event, many snapshots); `HOT_EVENT }o--o{ THEME` (many-to-many theme membership — the continuity substrate); `DAILY_DIGEST ||--o{ HOT_EVENT` (a digest aggregates many events).
- **Cross-page navigation is not a module:** the closed loop is achieved through shared published read models plus foreign-key-style links between them (`DAILY_DIGEST → HOT_EVENT`, `HOT_EVENT ↔ THEME`, `HOT_EVENT → REACTION_SNAPSHOT`).
- **Conventions (Epic-2-relevant):** UUIDv7 primary keys; UTC storage with ISO 8601 on the public API (critical for daily-review trading-day scoping); `data / meta / error` envelope; decimals stored raw and formatted only at the display layer (directly governs market-reaction rendering); domain events past-tense PascalCase; writes only through application command entry points.
- **Deferred (affects Epic 2):** WebSocket/SSE real-time push is deferred — V1 relies on read-model refresh plus active polling for market-reaction and theme-evolution updates; financial-data provider selection is deferred (only the adapter port is fixed); whether market-reaction/theme updates can bypass the review gate for speed, and whether theme pages are fully auto-generated or need operator participation, are undecided.

## UX & Interaction Patterns

- **Market-reaction chip (UX-DR7):** reaction info enters the visual system ONLY as a chip, never as a full red/green card or block — prevents "trading software" visual noise. A chip expresses exactly ONE signal dimension (price/volume, or sector, or limit-up); it never bundles multiple signals or carries long copy. Color is market-semantics only and is NEVER the sole encoding — every chip pairs color with a text/symbol label (arrow or word). Three sanctioned variants: `reaction-chip-up` / `reaction-chip-down` / `reaction-chip-flat`.
- **Association block:** concept/industry/stock associations live on detail as a distinct reading layer, separate from both the explanation text and the market-reaction block; items read like editorial annotations, not floating marketing cards. Each associated item is a click-through target.
- **Theme page:** reached from main nav and from detail (theme-continuity jump). Layout is a chronological series of related events read by scrolling; reuses `filter-pill` and `reaction-chip` with the same single-dimension rule; offers a one-click follow action that triggers lazy login rather than blocking browsing.
- **Daily review page:** reached from main nav; shows coverage date and generation time (or, if not yet generated, the generation time and current coverage scope rather than a blank page). Display title uses the editorial serif reserved for section/theme/daily titles. Each key event is a jump target into event detail. Reading order (Flow 3): scan daily summary → open 2–3 critical events → jump to theme page for fermenting threads → add theme to follow-list.
- **Return-path stability (UX-DR12):** entering detail from daily, theme, or search must return to the original consumption context with filter state and scroll position preserved, not to the homepage top. Navigation depth is capped at one level.
- **Degraded/empty states (UX-DR10):** missing market signals show an explicit missing-data block; an ungenerated daily review shows generation time + coverage scope; insufficient evidence keeps the summary but marks it "来源不足 / 仍待确认." Never silently hide risk or fake completeness.
- **AI label (UX-DR8):** the single unified `ai-label` (accent-warm pill) marks AI-generated daily-review content. Voice stays low-key — "AI 生成摘要，已提供来源," never a marketing highlight or profit framing.
- **Accessibility (UX-DR13):** reaction chips carry text/symbol in addition to color; association links, theme-page jumps, and daily→detail jumps are keyboard-reachable; theme and daily pages keep structured heading hierarchy; reduced-motion switches all transitions to instant cut; mobile tap targets on chips/rows meet touch-size minimums.
- **Banned patterns (UX-DR15):** no auto-play or attention-grabbing animation on theme/daily loading; no ticker-style price flicker on chips; no stacked multi-layer modals for theme/daily/event jumps (they are page navigations); no color-only differentiation of critical states; no horizontal carousel for the theme sequence or daily event list — vertical scroll only.
- **Responsive behavior:** `≥1200px` left nav fixed, detail uses `detail-max` (860px); `768–1199px` nav narrows, single main column, filters float to top; `<768px` drawer nav and on detail the market-reaction block and association block stack vertically ("依次下沉") rather than competing for space. Mobile is not a compressed screenshot — hotspot scan, evidence timeline readability, and a clear return path are guaranteed.

## Cross-Story Dependencies

- Stories 2.1 (market-reaction generation) and 2.2 (concept/industry/stock association) both feed the detail page established by Epic 1's Story 1.8; they enrich an existing published `HotEvent`, they do not rebuild the detail surface. They can proceed in parallel once Epic 1's published detail read model is stable.
- Story 2.3 (theme page tracking) depends on the `theme-linking` module's theme associations and the theme-backfill job producing `HOT_EVENT }o--o{ THEME` membership; it also depends on Story 2.5's return-path contract so a detail → theme jump round-trips without context loss.
- Story 2.4 (daily review) depends on the daily-digest BullMQ job and on the `DAILY_DIGEST ||--o{ HOT_EVENT` read model; its detail jump and return depend on Story 2.5.
- Story 2.5 (cross-page closed loop) is the integration capstone: it depends on 2.1–2.4 surfaces existing and on Epic 1's homepage stream and detail page. It wires the bidirectional navigation and reading-context preservation across 首页 ↔ 详情 ↔ 主题页 ↔ 日报 and should land after the other Epic 2 stories are usable.
- Upstream integration point: all Epic 2 public pages consume the `published_*` read models produced by Epic 1's `publish-orchestrator`; changes to that read-model contract ripple across Epic 2. Epic 2 jobs (market aggregation, digest, theme backfill) operate on published or pre-published `HotEvent` state gated by Epic 1's `publication_status`.
