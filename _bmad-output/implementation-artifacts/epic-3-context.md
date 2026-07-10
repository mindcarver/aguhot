# Epic 3 Context: 搜索回访与轻留存

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 3 gives users a lightweight way to return to the content they care about: a cross-event search over published hot events and theme pages, and a personal follow/watchlist for hot events and themes. It deliberately keeps public consumption anonymous-first — search and browsing must never depend on a logged-in identity — and introduces sign-in only as a deferred step when the user chooses to save something. Success here is measured by return visits and light retention (e.g. logged-in 7-day retention), not by pushing every visitor into an account.

## Stories

- Story 3.1: 热点与主题搜索
- Story 3.2: 延迟登录的收藏动作
- Story 3.3: 关注列表与回访管理
- Story 3.4: 搜索结果到详情页的回访闭环
- Story 3.5: 公开页面语义与键盘可达基线
- Story 3.6: 公开页面触控热区与减少动态效果支持

## Requirements & Constraints

- Search must cover hot event titles, explanation summaries, and theme names; results rank by a blend of relevance and recency. (FR12)
- Empty search results must show explicit no-match feedback plus a path back to home or alternate keywords. (FR12, UX state patterns)
- Users can follow/unfollow hot events and themes from cards, detail pages, and theme pages; the watchlist is reachable as its own surface and follow state stays consistent within the signed-in session. (FR13)
- Following is allowed from detail pages and list pages; collection state must stay consistent across pages within the same account session. (FR13)
- The watchlist must clearly mark any followed item that has been taken offline or hidden, never disguising unavailable items as live content. (FR13, NFR2)
- Anonymous browsing is the default for all public content, search, and detail reading; sign-in is only required for the watchlist and follow actions. (privacy guardrail, NFR implied)
- Public pages and APIs may only read published read models — search and the watchlist must never read raw ingest or operator working tables. (traceability/visibility)
- Return-path stability: navigating from search results into a detail page and back must restore the original query, ranking, and scroll context rather than dumping the user on the home page. (UX interaction primitive; see Story 3.4)
- Accessibility: keyboard reachability, visible focus, semantic heading hierarchy, non-color-only market semantics, adequate mobile touch targets, and reduced-motion support are required across home, detail, theme, daily digest, search, and watchlist surfaces. (UX-DR13; Stories 3.5, 3.6)
- Search engine choice is intentionally deferred: V1 may use PostgreSQL full-text capabilities and only adopt a dedicated search stack once real query load appears.

## Technical Decisions

- **Where the code lives.** Search and watchlist belong to two separate domain modules under `packages/core`: `search-read` for the public search read path, and `user-profile` for the follow/watchlist and personal preferences. Public routes live in `apps/web/(public)` (search results page, watchlist page). (Capability → Architecture Map: 搜索与关注列表 → `search-read` + `user-profile` + `apps/web/(public)`.)
- **Governed by invariants AD-3 and AD-8.** AD-3 (public site reads only published read models) means search and watchlist must query `published_*` materialized read models, never raw tables. AD-8 (user identity must not become a public-content dependency) means the `user-profile` module owns follow state and personal preferences but must not make hot-event/theme modules require a user id to return base content.
- **Single ownership boundary.** `user-profile` owns `FollowTarget` / follow state; it does not write `HotEvent` or `Theme` records. `theme-linking` owns `Theme`; `event-assembly` owns `HotEvent`. Follow records reference these aggregates by id only.
- **Async-heavy architecture.** All heavy computation and external calls run as BullMQ jobs on the worker runtime; the web request path must stay light. Search and follow actions are lightweight reads/commands and may run inline, but no LLM or external fetch on the request path.
- **Deferred login pattern.** Follow actions triggered while anonymous should defer to a lightweight login prompt rather than blocking the browse path; if the user abandons login, they continue browsing without the page breaking.
- **Data model.** `USER_ACCOUNT ||--o{ FOLLOW_TARGET` and both `THEME` and `HOT_EVENT` can be a `FOLLOW_TARGET`. Search is read-side only over published event/theme read models.
- **Stack & conventions.** Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui 4 on the front; PostgreSQL 18 + Prisma 7 for read models; UUIDv7 primary keys; UTC-stored times; public API responses use the `data / meta / error` envelope; every request and job carries a `trace_id`. Error classification is `domain / adapter / transient`.
- **Search engine.** No dedicated search engine committed for V1; start with PostgreSQL capabilities and revisit once real query load is observed.

## UX & Interaction Patterns

- **Two Epic-3 surfaces.** Search results page (reached from global search) and the watchlist page (reached from primary nav or the follow action). Both are first-class top-level surfaces.
- **Follow action component.** One click completes the action from hot cards, detail pages, and theme pages. When sign-in is required, trigger login lazily instead of gating the browse path. (UX-DR9)
- **Return-path contract.** Returning from a detail page reached via search must restore the original search context (keyword, ranking, result list, scroll position). If the browser back state can't be restored, surface an explicit "back to search results" entry that carries the original query, not a blank search page. (UX-DR12, Story 3.4)
- **State patterns to implement.** Empty watchlist → explain the page's purpose and offer entries back to home or to explore themes. Search no-results → prompt no match and suggest returning home or changing keywords. Offline/unavailable followed item → mark status change explicitly, never disguise as live. (UX state patterns; Story 3.3)
- **Accessibility floor (cross-cutting, Stories 3.5/3.6).** All core interactions — nav, cards, search, filters, follow action, source links — must be keyboard reachable with visible focus and clean heading hierarchy. Market semantics cannot rely on red/green alone; add text or symbol labels. Mobile touch targets meet minimum tap sizes; reduced-motion preference flips state changes to instant transitions.
- **Voice and tone.** Restrained, explanatory, verifiable copy. Avoid hype, stock-picking language, or excitement wording ("即将爆发", "重磅利好" forbidden); prefer "为什么重要", "当前仍不确定".
- **Responsive behavior.** Left rail nav on desktop (`≥1200px`), narrowed/collapsing nav at `768–1199px`, top nav + drawer below `768px`. Card stacks collapse to a single column on mobile. Mobile must preserve: current hot-event scan, readable evidence timeline, and a clear return path.

## Cross-Story Dependencies

- **Depends on Epic 1 and Epic 2 outputs.** Search indexes published hot events and theme pages; the watchlist references them. Epic 3 can only ship after Epic 1 (publish pipeline + published read models) and Epic 2 (theme pages) exist. Per the readiness report, no forward dependencies on later epics exist.
- **Published read models are a hard prerequisite.** Both search and watchlist resolve against `published_*` read models maintained by `publish-orchestrator`; if an item's `publication_status != published`, it must be invisible on the public side and surface as unavailable in the watchlist.
- **Theme pages (Epic 2) are a follow target.** Following themes requires the theme-linking module's published themes to be available.
- **Navigation and return-path are shared infra.** Story 3.4 (search → detail → search) and the deferred-login follow flow assume the cross-surface context-return loop built in Epic 2 / Story 2.5 is in place; Epic 3 extends it to the search entry point.
- **Accessibility baseline (Stories 3.5, 3.6) is cross-epic.** The semantic/keyboard/touch/reduced-motion floor spans all public surfaces (home, detail, theme, daily digest, search, watchlist), so work here both consumes and extends the component-level a11y foundation laid in earlier epics.
