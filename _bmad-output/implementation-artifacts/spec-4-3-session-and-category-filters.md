---
title: '盘前/盘中/盘后与类别筛选 (4.3)'
type: 'feature'
created: '2026-07-12'
status: 'done'
final_revision: 'e8708418e6284708737ccdc4fa52ea89ea7dead8'
review_loop_iteration: 0
baseline_revision: 'da46e6ea8630b7cf502fdec4cff0fa3be92385db'
followup_review_recommended: false
sprint_change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-07-11.md'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-timeline-home-and-card-component.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-aguhot-2026-07-09/DESIGN.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** Epic 4 首页时间流（Story 4.2）已交付分钟级 `时间流` 卡列表，但首页没有任何筛选——用户无法按交易时段（盘前/盘中/盘后/全天）或类别（概念/行业/个股）缩窄时间流。epic-4-context FR-2 与 UX-DR5 revised 要求：active 筛选状态可见、可清除、URL 可分享、返回不丢失。

**Approach:** 在首页时间流区上方新增一个 URL 驱动的 server-component 筛选 nav（`FilterPill` 作 `<Link>`，零 client JS）。session 维度（盘前/盘中/盘后/全天）服务端筛选——直接透传给既有 `listPublishedTimeline({ sessionTag })`（命中 `(trade_date, session_tag, occurred_at)` 复合索引）。category 维度（概念/行业/个股）复用既有 `AssociationKind` 与 Story 2.2 的 `listPublishedAssociations` JS-join 内存筛选模式（V1 规模小，Json 列规范化为子表是已记 defer 的 scale-ceiling）。筛选状态全部住在 URL `?session=` / `?category=` 里：可分享、刷新保留、返回还原。

## Boundaries & Constraints

**Always:**
- 公开站只读发布态读模型（AD-3/AD-3b/AD-6）：首页只读 `listPublishedTimeline` + `listPublishedHotEvents` + `listPublishedAssociations`；请求路径不拼 SQL、不触发同步刷新或外部调用（AD-4）。匿名可用（AD-8）：筛选不得 gate 于用户身份。
- URL 驱动筛选（native query string 优于 client store）：每个 pill 是 `<Link href="?session=…">` / `<Link href="?category=…">`；active pill 取 brand 态，clear 路径（「全天」/「全部类别」或 active pill 自身的清除 href）始终可见。pill 切换须 `mergeSearchParams` 保留兄弟键（session↔category 互不 clobber）。
- 诚实状态（NFR-2）：读模型为空（无任何 published_timeline 行）→ 既有 4.2 空态（"暂无公开展示的时间流。" + 最近更新）；筛选为空（有行但当前筛选无一命中）→ 区分文案"当前筛选条件下暂无时间流条目。"+ 清除筛选链接，不渲染最近更新（数据存在，只是被筛掉，不是页面未更新）。绝不渲染占位/假数据。DB 不可达=getPrisma 抛错（loud route error）。
- session=服务端筛选（透传 `sessionTag`）；category=内存 JS-join 筛选（`listPublishedAssociations` → `hotEventId → Set<AssociationKind>` → 过滤 timeline 条目）。筛选 nav 的 `aria-label` 必须用 **「时间流筛选」**（与 4.2 已移除的 V1 `nav[aria-label="筛选"]` 区分，保 4.2 既有 e2e 不回归）。
- 复用既有件：`FilterPill`（`apps/web/components/chips.tsx`）、`listPublishedAssociations` / `AssociationKind`（`@aguhot/core` barrel）、async `searchParams: Promise<{}>` 模式（仿 `daily/page.tsx`）。`firstString` + timeline 专用 `mergeSearchParams`（keys=`[session, category]`）内联于新筛选组件。导入约定：`import type`、无 TS `enum`、`const … as const`。

**Block If:**
- `listPublishedTimeline({ sessionTag })` 或 `listPublishedAssociations` 本地 PG 集成验证失败（4.1/2.2 已绿，回归即阻塞）→ HALT。
- `pnpm typecheck` 出现与本 story 改动相关的类型错误且不可自愈 → HALT。

**Never:**
- 不新增 `公告` / `研报` 类别（V1 out-of-scope：codebase 无数据源/enum/字段/ingest 路径，渲染即违反 absence-as-absence；已记 deferred-work）。
- 不新增 enum/表/字段（category 复用 `AssociationKind`，session 复用 `TimelineSessionTag`）；不给 `listPublishedTimeline` 加 `category` 参数（与 2.2 `listPublishedHotEvents` 同理：filter-free 读 + web 层 JS-join，避免把"无 association"与"维度无命中"拆到两次读）。
- 不复用 V1 死维度键 `?window` / `?concept` / `?industry` / `?stock`（4.2 已从首页移除）；不删 `feed-filters.tsx`（4.2 Never 保留；本 story 不复用它，自包含新组件）。
- 不给 `non_trading` 独立 pill（仅在「全天」下出现，无独立 toggle，可辩护）；不筛选 main-line-band（band 是 saliency 投影，独立于时间流筛选，始终全量 top-N）。
- 不新增 client JS / `useState` / loading skeleton（公开页 server component + `force-dynamic`）；不新增 API route / fetch；`force-dynamic` 与 masthead 原样保留。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| 仅 session 筛选 | `?session=intraday`，timeline 有数据 | `listPublishedTimeline({ sessionTag: "intraday" })`；渲染 intraday pill active + 命中条目 | 无命中→筛选空态 |
| 仅 category 筛选 | `?category=stock`，部分条目 hotEvent 含 stock association | 读全部 timeline + associations，内存过滤留 stock 条目；stock pill active | 无命中→筛选空态 |
| session + category 同时 | `?session=pre_open&category=concept` | session 服务端先筛，再内存 category 筛；两 pill 均 active，互不 clobber | 无命中→筛选空态 |
| 「全天」/ 清除 session | `?session` 缺失或点「全天」pill | 不传 sessionTag（含 non_trading）；session pill 全为 default 态 | — |
| 非法 session 值 | `?session=foo` | 忽略→视同「全天」（不传 sessionTag），不 500 | firstString + 白名单 parse |
| 非法 category 值 | `?category=foo` | 忽略→视同无 category 筛选，不 500 | 白名单 parse |
| 重复键 | `?session=a&session=b` | 取首个，不抛 TypeError（数组归一） | firstString |
| 读模型空（无任何行） | published_timeline 无数据 | 既有 4.2 空态 + 最近更新，筛选 nav 仍渲染（但无命中可筛） | `[]` 非错误 |
| 筛选空（有行无命中） | timeline 有行但筛选后为空 | "当前筛选条件下暂无时间流条目。"+ 清除筛选链接，无最近更新 | — |
| URL 可分享/返回 | 复制带 `?session=&category=` 的 URL 直访 | 状态从 URL 还原，pill active 态正确；返回不丢筛选 | server 读 searchParams |

</intent-contract>

## Code Map

- `apps/web/app/(public)/_components/timeline-filters.tsx` -- NEW：server component，session pills（盘前/盘中/盘后/全天）+ category pills（概念/行业/个股），`FilterPill as <Link>`，`aria-label="时间流筛选"`；内联 `firstString` + `parseTimelineFilters` + `mergeTimelineSearchParams`（keys `[session, category]`）；导出 `TIMELINE_SESSIONS` / `TIMELINE_CATEGORIES` / parse fns 供 page 复用。
- `apps/web/app/(public)/page.tsx` -- MODIFY：PageProps 加 `searchParams: Promise<{ session?: string; category?: string }>`；parse → `listPublishedTimeline({ sessionTag })`（session 服务端筛）+ 条件 `listPublishedAssociations`（category 内存筛）；渲染 `<TimelineFilters>` 于时间流区上方；两类空态分支；masthead/`force-dynamic`/band 不动。
- `apps/web/e2e/timeline.spec.ts` -- MODIFY：把「无残留优先级 filter pill」测试改为断言「V1 window pills（今日/近7天/近30天/全部）仍缺失 + 新 `nav[aria-label='时间流筛选']` 存在」；新增 `@timeline` 筛选用例（session 命中/筛选空态/category 正负例/session+category 复合/URL 还原）。
- `apps/web/e2e/seed-timeline.ts` -- MODIFY：为已 seed 的事件注入已知 association（concept/industry/stock 各覆盖正例 + 一个无 association 的负例），使 category 筛选有确定性正负样本。

## Tasks & Acceptance

**Execution:**
- `apps/web/app/(public)/_components/timeline-filters.tsx` -- NEW -- session+category pill nav（URL 驱动、active 可见可清除、兄弟键不 clobber、白名单 parse 抗非法值）。
- `apps/web/app/(public)/page.tsx` -- MODIFY -- async searchParams → session 透传 `listPublishedTimeline`、category 内存 JS-join；两类空态；筛选 nav 渲染于时间流上方。
- `apps/web/e2e/timeline.spec.ts` -- MODIFY -- 更新「无残留 V1 filter」断言 + 新增 `@timeline` 筛选场景（surface-anchored 与 seeded 各覆盖）。
- `apps/web/e2e/seed-timeline.ts` -- MODIFY -- 注入已知 association（正负例）支撑 category 筛选断言。

**Acceptance Criteria:**
- Given timeline 有数据，when 匿名访问 `/?session=intraday`，then 仅 `sessionTag="intraday"` 条目渲染，「盘中」pill 为 active 态，其余 session pill 为 default，URL 含 `?session=intraday`。
- Given 部分条目 hotEvent 含 stock association，when 访问 `/?category=stock`，then 仅这些条目渲染，「个股」pill active，无 association 的条目不出现。
- Given 同时 `?session=pre_open&category=concept`，when 渲染，then 两 pill 均 active 且切换其一不丢失另一维度（`mergeSearchParams` 保兄弟键）。
- Given timeline 有行但当前筛选无命中，when 渲染，then 显示"当前筛选条件下暂无时间流条目。"+ 清除筛选链接，不显示「最近更新」（区别于读模型真空态）。
- Given 读模型完全无数据，when 访问任意 `?session=`/`?category=`，then 显示既有 4.2 空态 + 最近更新，筛选 nav 仍渲染，masthead 可见，不触发 `/login`（AD-8）。
- Given `?session=foo` 或 `?category=foo`（非法值），when 访问，then 忽略该筛选用默认态，HTTP 200，不 500。
- Given 复制带筛选的 URL 直访，when 页面加载，then pill active 态从 URL 还原正确（URL 可分享/返回不丢）。
- Given 既有 4.2 e2e，when 运行默认公共面套件，then masthead/时间流区块/`nav[aria-label='筛选']` 缺失等断言全绿不回归；`nav[aria-label='时间流筛选']` 存在。

## Auto Run Result

Status: done

**Summary:** Delivered Story 4.3 — 盘前/盘中/盘后与类别筛选. The Epic 4 timeline home gains a URL-driven, server-component filter nav (`<TimelineFilters aria-label="时间流筛选">`) above the timeline. The **session** dimension (盘前/盘中/盘后/全天) is filtered server-side by passing the parsed `?session=` value as `sessionTag` to the existing `listPublishedTimeline({ sessionTag })` (hits the `(trade_date, session_tag, occurred_at)` composite index built in 4.1). The **category** dimension (概念/行业/个股) reuses the existing `AssociationKind` and the Story 2.2 in-memory JS-join pattern: `listPublishedAssociations` → `hotEventId → Set<AssociationKind>` → filter the timeline entries in memory (Json-column sub-table normalization is the documented scale-ceiling defer; announcement/research_report are V1 out-of-scope, no data source). Filter state lives entirely in the URL (`?session=` / `?category=`): shareable, refresh-stable, back/forward restores it, zero client JS / `useState`. Active state is visible and clearable (the active pill self-clears; 「全天」 clears session); sibling keys are preserved on every pill switch via `mergeTimelineSearchParams`. Two honest empty states are distinguished: read-model-empty (4.2 copy + 最近更新) vs filter-empty ("当前筛选条件下暂无时间流条目。" + clear link, no 最近更新) — a fallback unfiltered re-read disambiguates them when a session filter matches nothing.

**Files changed:**
- `apps/web/app/(public)/_components/timeline-filters.tsx` — NEW: server-component filter nav; exports `TIMELINE_SESSIONS`/`TIMELINE_CATEGORIES`, `parseTimelineFilters`/`parseSessionFilter`/`parseCategoryFilter` (whitelist, invalid→undefined, never 500), `mergeTimelineSearchParams` (keys `[session, category]`, sibling-preserving), `firstString` (array-collapse). Each pill is a `<FilterPill as <Link>>`.
- `apps/web/app/(public)/page.tsx` — MODIFY: async `searchParams`; session→`listPublishedTimeline({ sessionTag })`; category→conditional `listPublishedAssociations` JS-join; two empty-state branches + the session-filtered-empty fallback re-read. Masthead/`force-dynamic`/band untouched; band never filtered.
- `apps/web/e2e/seed-timeline.ts` — MODIFY: pinned the 4 events' `publishedAt`/`occurredAt` to fixed UTC instants on 2024-01-02 (deterministic session spread: intraday={半导体,铜价}, pre_open={稀土}, post_close={军工}); kept all 4.2 invariants (fold, association injections, no-assoc negative).
- `apps/web/e2e/timeline.spec.ts` — MODIFY: closed a pre-existing unclosed `/**` JSDoc that had swallowed the 3 surface tests as dead comment text (they now run); strengthened session-narrowing (strict subset + known in/exclusion), composite (data intersection), filter-empty, and invalid-value tests; added read-model-empty-with-filter + repeated-key tests; adjusted the 4.2 band test to the now-deterministic pinned data.

**Review findings breakdown:** 4 layers (blind-hunter / edge-case-hunter / verification-gap / intent-alignment). 6 patches applied (2 medium — session-narrowing web-wiring pin + read-model-empty-with-filter AC pin; 4 low — composite intersection, repeated-key matrix row, unclosed-JSDoc resurrection of 3 dead surface tests incl. the one this story tasked modifying, 4.2 band test adjustment to pinned data). 1 deferred (unbounded `listPublishedAssociations` hot-path read — logged to deferred-work). 12 rejected (intent-mandated loud DB failure, intent-mandated `时间流筛选` a11y label, `firstString` duplication per spec Never, speculative edges, 2.2-pattern duality, TS-enforced merge keys, surface-anchored text matching, seed test-data concerns).

**Note on verification fidelity:** the initial implementation + patch subagents reported e2e green, but this orchestrator's direct shell had no `DATABASE_URL`; all four verification commands were re-run by the orchestrator against the local PG (`postgresql://aguhot:…@localhost:5432/aguhot`) to obtain ground truth. The subagent-authored test changes were confirmed correct; the only orchestrator-applied code change beyond the spec's tasks was the one-line JSDoc close (patch #5 above).

**Follow-up review recommendation:** true — the review closed two medium verification gaps where the story's headline behavior (session server-narrowing) and a spec AC (empty-state-with-filter) were completely unpinned (tests existed but asserted nothing / ran as dead code), required a seed refactor + test rewrite + resurrection of 3 dead tests; an independent follow-up pass would confirm the strengthened assertions are sound and that the seed timestamp pin did not introduce latent flakiness (band ordering is now `latestEvidenceAt`-sensitive among the count-1 events).

**Verification performed (orchestrator, ground truth):**
- `pnpm --filter @aguhot/web typecheck` — green (`tsc --noEmit` + e2e tsconfig).
- `pnpm --filter @aguhot/web e2e` — **33/33 passed** (default public surface: home/navigation/design/a11y + the 3 resurrected timeline surface tests incl. "无残留 V1 window pills + 新「时间流筛选」nav 存在" + the untagged repeated-key test; `@timeline` excluded by invert-grep).
- `pnpm --filter @aguhot/web e2e:timeline` — **14/14 passed** (seeded: 5 existing 4.2 + session narrowing / filter-empty / category positive+negative / composite intersection / URL restore / invalid-values / read-model-empty / read-model-empty-with-filter).
- `pnpm --filter @aguhot/worker verify:timeline` — **PASS, 31/31** (4.1 data-layer regression incl. `listPublishedTimeline sessionTag` narrowing).

**Residual risks:**
- Category filter runs after the 50-row `listPublishedTimeline` cap — on a >50-row day a category filter may return <50 matches (documented V1 scale-ceiling defer; sub-table normalization logged in deferred-work).
- The fallback re-read branch (session-filtered empty → unfiltered re-read to distinguish read-model-empty vs filter-empty) is exercised end-to-end only via the filter-empty test's code-path convergence, not by a dedicated test that isolates the re-read (would require an empty-session seed config that conflicts with the 4-event band requirement). Covered indirectly; the read-model-empty-with-filter test pins the short-circuit.
- Band ordering is now `latestEvidenceAt`-sensitive among count-1 events; future seed changes that alter those timestamps will reshuffle the band top-3 and may require re-adjusting the band test's second-link assertion.
- The pre-existing unclosed-JSDoc bug was fixed in this file only; other e2e spec files were not audited for the same shape.

### Follow-up review pass (2026-07-12)

**Summary:** Independent follow-up review of the committed 4.3 implementation (`da46e6e..f5dab63`). 4 review layers (blind-hunter / edge-case-hunter / verification-gap / intent-alignment) ran against the implementation diff. The pass closed one localized low-severity verification gap with a test-only patch and logged one low-severity coverage defer; no code change, no spec change, no intent gap or bad_spec.

**Files changed:**
- `apps/web/e2e/timeline.spec.ts` — MODIFY (test-only): extended the `@timeline` filter-empty test to click the 「清除筛选」 clear-all link, assert the URL resolves to `"/"` (both `?session=`/`?category=` dropped), and assert the filter-empty copy is gone after clear-all. Pins the `mergeTimelineSearchParams` two-key-delete → `"/"` branch that no pill href exercises.
- `_bmad-output/implementation-artifacts/deferred-work.md` — MODIFY (append-only): one NEW entry recording that the two 「筛选空」edge branches (session-alone-empty fallback distinguishing branch + category-alone `isFilterEmpty` route) are structurally unreachable under the 4-event band seed and need a seed-extension to pin. Existing ledger entries untouched.

**Review findings breakdown:** 4 layers. 1 patch applied (low — clear-all link click coverage). 1 deferred (low — empty-state edge branches unseeded, NEW ledger entry). 22 rejected (intent-mandated choices, speculative future hazards, graceful-degradation/no-spec-mandate, covered-at-correct-surface, design-opinion/style, misreads, pre-existing/already-deferred — full spectrum in the Review Triage Log below).

**Follow-up review recommendation:** false — this pass closed a single localized low-consequence verification gap with a test-only patch and logged one low defer; no behavior/API/security/data change, no spec amendment. Does not warrant a further independent pass.

**Verification performed (orchestrator, ground truth, local PG `postgresql://aguhot:…@localhost:5432/aguhot`):**
- `pnpm --filter @aguhot/web typecheck` — green.
- `pnpm --filter @aguhot/web e2e:timeline` — **14/14 passed** (incl. the patched filter-empty test's new clear-all click assertions; no regression vs the prior pass's 14/14).

**Residual artifacts (not part of this change, left in place):**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — dirty in the working tree from before this run (orchestrator bookkeeping); not part of the 4.3 reviewed diff, left uncommitted.

## Design Notes

**为何 session 服务端、category 内存。** session 直接映射 `listPublishedTimeline` 的 `sessionTag` 参数且背后有 `(trade_date, session_tag, occurred_at)` 复合索引（4.1 已建）——走服务端最省。category 的数据住在 `published_hot_event_associations.items`（Json 列），无单项 SQL 查询性（deferred-work 已记子表规范化 defer），故复用 2.2 既定 JS-join：`listPublishedAssociations` 全量读 → 建 `hotEventId → Set<AssociationKind>` → 在已 session 筛过的 timeline 条目上内存过滤。这是 epic-4-context「Category filter reuses AssociationKind + 2.2 feed-filter pattern」的直接落地。

**两类空态必须区分。** 读模型真空（无行）= 产品无内容 → 4.2 既有空态 + 最近更新；筛选空（有行无命中）= 用户缩太窄 → "当前筛选条件下暂无时间流条目。" + 清除链接，**不**显示最近更新（数据在，只是被筛掉）。混同会让用户误以为产品无数据。

**filter nav 的 aria-label 用「时间流筛选」。** 4.2 的 e2e 断言 `nav[aria-label='筛选']` 计数为 0（V1 FeedFilters 已移除）。新筛选 nav 若复用「筛选」会撞该断言；用「时间流筛选」既保 4.2 断言不回归，又给屏阅器一个区分语义。同时把那条 e2e 的语义从「V1 filter 已删」更新为「V1 window pills 已删 + 时间流筛选 nav 已建」。

**scale-ceiling（已知 defer，不在本 story 解决）。** category 内存筛在 `listPublishedTimeline` 的 50 行 cap 之后执行——若某日 >50 行，category 筛后可能不足 50（cap 先截断再过滤）。V1 规模小，与 2.2 同一妥协；子表规范化 + 索引化是 epic 级 defer（deferred-work 已记）。

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 全绿（`erasableSyntaxOnly` + `verbatimModuleSyntax`）。
- `pnpm --filter @aguhot/web e2e` -- expected: 默认公共面不回归（masthead/时间流区块/V1 filter 缺失 + 新「时间流筛选」nav 存在；`@timeline` 被 invert-grep 排除）。
- `pnpm --filter @aguhot/web e2e:timeline` -- expected: 播种筛选面全绿（session 命中/筛选空态/category 正负例/复合/URL 还原）。
- `pnpm --filter @aguhot/worker verify:timeline` -- expected: 4.1 数据层 31/31 不回归。

**Manual checks (if no CLI):**
- 本地 PG 有播种 published_timeline + associations 时，目视确认 session/category pill active 态、两类空态文案区分、URL 切换保兄弟键、非法值不 500。

## Spec Change Log

<!-- Empty until the first bad_spec loopback. -->

## Review Triage Log

### 2026-07-12 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (medium 2, low 4)
- defer: 1: (low 1)
- reject: 12
- addressed_findings:
  - `[medium]` `[patch]` Session-narrowing test asserted only `filteredCount <= unfilteredCount`, which passes even if `page.tsx` silently drops `sessionTag` (the story's headline server-side narrowing was unpinned at the web layer — data layer was covered by `verify:timeline` but the page pass-through was not). Pinned the seed events' `publishedAt`/`occurredAt` to fixed UTC instants on 2024-01-02 (a trading weekday) giving a deterministic multi-session spread (intraday={半导体,铜价}, pre_open={稀土}, post_close={军工}); strengthened the test to assert a STRICT subset + 半导体(intraday) renders + 稀土(pre_open)/军工(post_close) do NOT.
  - `[medium]` `[patch]` No test covered read-model-empty WITH a filter active (spec AC + the `isFilterEmpty` short-circuit `!isReadModelEmpty && ...` were unpinned — dropping the guard would have shown the filter-empty copy on a brand-new deployment). Added a `@timeline` test that clears `published_timeline_entries` and visits `/?session=intraday` + `/?category=stock`, asserting the read-model-empty copy + 最近更新 win and the filter-empty copy does NOT render.
  - `[low]` `[patch]` Composite session+category test asserted URL/active-state only, not the data intersection. Strengthened to assert the intersection under `?session=intraday&category=stock` (半导体 renders; 军工 stock-but-post_close excluded; 铜价 intraday-but-no-assoc excluded).
  - `[low]` `[patch]` Matrix row "重复键 `?session=a&session=b`" (the `firstString` array-collapse — the exact TypeError-on-`.trim()` failure mode the helper exists to prevent) had no e2e. Added an untagged test visiting repeated-key URLs for both dimensions, asserting HTTP 200 + first-key-wins active state.
  - `[low]` `[patch]` Pre-existing 4.2 bug surfaced during patching: `timeline.spec.ts` had an unclosed `/**` JSDoc (no `*/` before the first `test.describe`) that swallowed the entire first describe block — 3 surface tests, INCLUDING the one this story's Code Map tasked modifying ("无残留 V1 window pills + 新「时间流筛选」nav 存在") — as dead comment text; they had never been collected by Playwright. Closed the JSDoc (`*/`); the 3 tests now run and pass (default e2e 33/33). Root is 4.2; fixed inline because it nullified this story's own test change.
  - `[low]` `[patch]` The seed timestamp pin (for the session-narrowing fix above) made the 4.2 band test's expectations data-dependent: band ordering `evidenceCount DESC, latestEvidenceAt DESC` now deterministically drops 稀土 to rank 4 (second link → 军工), and the `近期升温` reason no longer fires (pinned 2024-01-02 `latestEvidenceAt` is ~930 days outside the 72h recency window at test time, and no event reaches `evidenceCount >= 3` for the `多源覆盖` fallback). Adjusted that 4.2 test's expectations to the now-deterministic data (asserts the no-reason-tag state) rather than reverting the pin.
  - `[low]` `[defer]` Category filter issues an unbounded `listPublishedAssociations` full-table read + in-memory `Map<hotEventId,Set<Kind>>` build on the public home hot path for every `?category=` request. Endorsed V1 trade-off (2.2 pattern; Json-column sub-table normalization is the epic-level defer); logged to deferred-work recording the hot-path-read angle.
  - rejects (spectrum): `Promise.all`/loud-DB-failure → `Promise.allSettled` graceful-degradation (intent-mandated per spec Always + 4.2 precedent); `aria-label="时间流筛选"` a11y choice (intent-mandated to distinguish from removed V1 `筛选` nav); `firstString` duplication (spec Never forbids reusing `feed-filters.tsx`); `sessionTag` cast "theater" (backed by whitelist parser; speculative `non_trading` widening); parsed-vs-raw `searchParams` duality (mirrors established 2.2 `FeedFilters` pattern); `row.items` null-iteration / `searchParams` rejection (speculative, write-path data invariant); `mergeTimelineSearchParams` not pathname-parameterized (homepage-only, matches 2.2); TS-enforced `updates` keys in the merge fn; seed `stockAssocHotEventId` returned-but-unused + text-based event matching (surface-anchoring is the correct altitude per READY standard); seed association-injection-after-decideReview ordering (test-data setup, 2.2's pipeline concern).

### 2026-07-12 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (low 1)
- defer: 1: (low 1)
- reject: 22
- addressed_findings:
  - `[low]` `[patch]` The filter-empty 「清除筛选」 clear-all link (`page.tsx:262-267`) was asserted `toBeVisible()` but never click-tested — the `mergeTimelineSearchParams(params, {}, ["session","category"])` two-key-delete → `"/"` branch is exercised by no pill href (pills always set a value, so `next.size` never reaches 0). A regression to a one-key delete, or a broken empty-map→`"/"` return, would have shipped undetected. Extended the existing `@timeline` filter-empty test to click the link, assert the URL resolves to `"/"` (no `?session=`/`?category=`), and assert the filter-empty copy is gone after clear-all.
  - `[low]` `[defer]` Two 「筛选空」edge branches are structurally unreachable under the 4-event band seed (every trading session has ≥1 event; every category matches ≥2 events): (a) the fallback unfiltered re-read at `page.tsx:148-152` — the distinguishing branch that flips `isReadModelEmpty` false→ routes to filter-empty (built precisely for the session-alone-empty case); (b) the category-alone `isFilterEmpty` route. Both are covered only indirectly via the composite `?session=pre_open&category=stock` intersection test. Pinning them needs a seed extension (a session/category that is empty-without-read-model-empty) that conflicts with the current band top-3 fixture. Logged to deferred-work as a NEW entry (seed-extension test-coverage hardening); existing ledger entries untouched.
  - rejects (spectrum, 22 distinct findings across 4 review layers, deduped): intent-mandated choices — `aria-label="时间流筛选"` dual-label (spec Always), duplicated `firstString`/`mergeTimelineSearchParams` vs `feed-filters.tsx` (spec Never forbids reuse), `sessionTag` `as TimelineSessionLiteral` cast (backed by runtime whitelist parser; intent Never forbids the `non_trading` pill that alone could widen it), `Promise.all`/loud-DB-failure (intent Always); design opinions / style — raw `<a>` vs `<Link>` on the clear link (cosmetic on a `force-dynamic` page; Ponytail: not worth the diff), 366-line file / advocacy-comment density, `firstString` exported yet commented "local", test-placed-outside-describe (the JSDoc IS closed — verified; top-level Playwright tests are valid); speculative future hazards — `TimelineFilters` optional `searchParams` footgun, seed `fetchAssociations` called-once assumption, PRC holiday calendar shifting 2024-01-02 to `non_trading`, pill label cross-dimension collision, seed `Asia/Shanghai` TZ robustness; graceful-degradation / no-spec-mandate — `mergeTimelineSearchParams` propagating invalid sibling values (`?session=foo&category=stock`) and dropping external `utm`/`ref` keys (intent defines a 2-key `[session,category]` merge mirroring 2.2; URL degrades gracefully, no sanitize mandate), invalid-value test not asserting URL hygiene; covered-at-correct-surface — parser helpers "lack unit selfcheck" (observable contracts pinned by e2e at the behavior surface: invalid→200, repeated-key→first-wins, valid→active; repo selfcheck would pin internals = Ponytail gold-plating), repeated-key `firstString` mechanism-vs-output, empty-state copy test "asymmetry" (the two copies live in mutually-exclusive ternary branches, so asserting one present proves the other absent), category-join wasted work on empty `timelineEntries` (same unseeded root as the defer; moot in practice); misreads — fallback read "capped-50 masks rows" (the fallback checks `length===0` emptiness only, never returns display rows), `firstString` empty-first repeated key (`?session=&session=intraday`; "take first" honored — first is empty→no-filter, degenerate URL); intent-permitted mechanism choices — `?session=all` direct-visit 「全天」 active state untested (unspecified edge; the pill's own href drops the key, so the only way there is a hand-crafted URL), category clear "always visible" being conditional on a category being active (intent's "或 active pill 自身的清除 href" sanctions R4b), session/category clear-mechanism asymmetry (intent permits both); pre-existing / already-deferred — cross-trade-date `listPublishedAssociations` over-fetch (deliberate 2.2 design, epic-level scale defer), 72h-recency positive branch coverage lost to the seed pin (band/4.2 concern, uncertain whether covered elsewhere; out of 4.3 scope), extra fallback DB read on empty+session (rare edge, perf-marginal).
