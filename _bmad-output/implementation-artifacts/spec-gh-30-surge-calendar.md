---
title: 'GitHub #30: 新增 A 股大涨日历'
type: 'feature'
created: '2026-07-21'
status: 'done'
baseline_revision: '844c66d59ebdd72b4eaf407118269f065e0de947'
final_revision: '26b560b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/apps/web/AGENTS.md'
  - '{project-root}/apps/web/CLAUDE.md'
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** 系统只有大跌日历，用户无法以相同的可追溯、非建议方式回顾 A 股显著上涨日；把上涨日塞进现有大跌领域会混淆方向、阈值、审计数据与公开读模型。

**Approach:** 新建与大跌日历并行的上涨日检测、独立发布读模型、受控刷新链路与 `/surge-calendar` 页面族。它复用已入库的指数、行业和市场广度事实，但不读取原始表来渲染公开页面。

## Boundaries & Constraints

**Always:** 三大宽基任一日涨幅 `>= +2.0%` 即为大涨日；阈值以 `SURGE_THRESHOLD` 常量集中定义，所有判定结果记录实际阈值。检测/发布模型独立为 `surge_days` 与 `published_surge_days`，不得写入或改写 crash 表。公开页面只读 `published_*`，缺指数、行业、广度或未来 T+N 数据时分区显示诚实空状态，绝不补 0、借用别日数据或暗示买卖。两条页面路由均动态渲染、`noindex,nofollow`，含“历史统计回顾，非预测、非投资建议”；桌面和移动导航同时可达。

**Block If:** 现有 Prisma 迁移历史无法安全追加前向迁移，或生产刷新路径没有可在不改动大跌日逻辑的前提下接入独立上涨阶段的扩展点。

**Never:** 不更改大跌日的阈值、数据、排序和页面行为；不改 Python sidecar 或新增行情源；不把 `CrashDay`/`PublishedCrashDay` 参数化为双向模型；不在页面直读 `index_daily_bars`、`sector_daily_bars` 或 `market_breadth_daily`；不新增依赖、投资建议、推荐或按后续收益排序。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 判定与投影 | 某交易日任一宽基 `pctChange >= 2.0`，指数/行业/广度均存在 | 独立的 surge 与 published 行；月历高亮，详情展示触发指数、领涨板块、广度与 T+1/T+5/T+20 实际收益 | 幂等重跑不重复行 |
| 未达阈值或修订后不再达标 | 扫描范围内无指数达到阈值 | 不创建，或在来源检测集合中删除旧 surge/public 行；日历不高亮 | 仅清理本次扫描范围内的过期上涨日 |
| 局部行情缺失 | 缺某宽基、行业、广度或未来 bars | 仅缺失区块显示空态；缺宽基不伪造；未来收益为 `—` | 其他区块继续渲染 |
| 详情 URL 无效 | 非 `YYYY-MM-DD` 或无 published 行 | 返回 404 | 不回退到其他日期 |
| 合规开关关闭 | 未显式启用 `SURGE_CALENDAR_PUBLICATION_ENABLED` | 可检测/维护原始 `surge_days`，但 worker 不写 `published_surge_days` | 页面保持诚实空态；显式启用后才投影 |

</intent-contract>

## Code Map

- `packages/core/prisma/schema.prisma` / `packages/core/prisma/migrations/` -- 独立上涨源/公开模型与前向迁移。
- `packages/core/src/modules/surge-review/` -- 上涨日纯判定、服务、类型和确定性自检；镜像 crash-review，不共享写模型。
- `packages/core/src/modules/publish-orchestrator/{publish-service.ts,types.ts,index.ts}` -- 上涨日投影、领涨行业/广度映射、查询和导出。
- `packages/core/src/index.ts` / `packages/core/package.json` -- 对 worker 暴露上涨 API 与自检入口。
- `apps/worker/src/{market-data-refresh.ts,verify-market-data-refresh.ts,run-surge-review.ts,run-market-breadth.ts}` -- 并行检测/受开关控制的投影、可重跑入口及编排验证。
- `apps/web/app/(public)/surge-calendar/` -- 大涨日历索引和严格的日期详情页；选择性复用中性展示 helper。
- `apps/web/app/(public)/_components/{side-nav.tsx,public-nav.tsx}` -- 桌面及移动端入口。
- `apps/web/e2e/{seed-detail.ts,detail.spec.ts,navigation.spec.ts}` -- 可复现的页面和导航验证基准。

## Tasks & Acceptance

**Execution:**
- `packages/core/prisma/schema.prisma` and a new timestamped migration -- add `SurgeDay` and `PublishedSurgeDay`, trade-date keys, audited threshold/count/indices/source metadata, leading positive sectors and nullable breadth; preserve all existing models.
- `packages/core/src/modules/surge-review/*` -- implement `>= SURGE_THRESHOLD` union detection, actual forward-return calculation, per-item upsert and scan-scope reconciliation; add self-checks for boundary equality, missing indices, null horizons, ordering and rerun safety.
- `packages/core/src/modules/publish-orchestrator/{types.ts,publish-service.ts,index.ts}` and `packages/core/src/index.ts` -- add independent `refreshPublishedSurgeDays`/`listPublishedSurgeDays`; project sectors where `pctChange > 0` descending and same-date breadth without blocking or fabricating; export only typed public contracts.
- `apps/worker/src/{market-data-refresh.ts,verify-market-data-refresh.ts,run-surge-review.ts,run-market-breadth.ts}` -- detect surge after index ingest; run surge publication only when `SURGE_CALENDAR_PUBLICATION_ENABLED=true`; retain crash ordering/semantics and verify isolated failure, disabled gate and rerun behavior.
- `apps/web/app/(public)/surge-calendar/{page.tsx,[date]/page.tsx}` plus local display components -- render a 12-month UTC, Monday-first calendar with accessible highlighted day links; detail is force-dynamic/noindex/404-strict and shows neutral sections titled 大涨日、领涨板块、上涨后历史实际收益, available breadth, and same-day published events. Parameterize only presentation helpers that are genuinely direction-neutral.
- `apps/web/app/(public)/_components/{side-nav.tsx,public-nav.tsx}` and focused web e2e fixtures/specs -- add both navigation entries and deterministic seeded coverage for index/detail data, empty sections, 404, metadata and narrow-screen navigation.

**Acceptance Criteria:**
- Given verified daily bars, when the surge detector and enabled projection rerun, then exactly one independent published row per qualifying date is rendered and no crash read-model field changes.
- Given a qualifying date, when a user uses either navigation surface and opens its calendar link, then `/surge-calendar` and `/surge-calendar/{date}` render the expected factual sections without advisory wording.
- Given a no-longer-qualifying date inside the rescanned period, when recalculation completes, then it is absent from both surge source/public models and the calendar.
- Given missing optional facts, when the detail page renders, then only the affected section is unavailable and all present factual sections remain visible.
- Given disabled publication, when the scheduled refresh runs, then no `published_surge_days` write occurs; enabling the gate permits an idempotent projection.
- Existing crash-calendar automated checks and its visible routes retain their behavior.

## Spec Change Log

## Review Triage Log

### 2026-07-21 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 2, medium 5, low 0)
- defer: 0
- reject: 0
- addressed_findings:
  - `[high]` `[patch]` Closed the runtime publication gate in both public routes so previously projected rows are hidden when the gate is off.
  - `[high]` `[patch]` Isolated surge detection/projection failures so the existing breadth ingest and final crash projection still run.
  - `[medium]` `[patch]` Restored the default DB-free public e2e suite by excluding the tagged surge fixture suite.
  - `[medium]` `[patch]` Materialized missing tracked-index facts as explicit unavailable entries rather than silently omitting them.
  - `[medium]` `[patch]` Rejected impossible calendar-day arguments in both bounded runners.
  - `[medium]` `[patch]` Added deterministic checks for breadth-read fallback and bounded projection scope preservation.

## Auto Run Result

**Summary:** Added the independent, gate-controlled A-share surge calendar end to end: source and public read models, `>= +2.0%` detection, public projection, worker integration, dynamic public routes, and both navigation surfaces.

**Files changed:**
- Core schema/migration and `surge-review` module — independent audited source rows, detection, reconciliation and deterministic checks.
- Publish orchestrator — independent public projection, positive sector ordering, nullable breadth, and published-only query contract.
- Worker refresh/runners — gated projection, failure isolation, bounded repair validation and manual surge runner.
- Web calendar routes/components/navigation — dynamic noindex pages, Monday-first calendar, factual detail sections and honest missing-state rendering.
- Web test fixtures/specs — isolated database fixture, gate check, calendar/detail/404/navigation coverage; default public e2e remains database-free.

**Review findings:** 7 patch findings applied; 0 deferred; 0 rejected. Follow-up review recommendation: true, because the final fixes affect release gating and refresh-failure isolation.

**Verification:** Core and worker typechecks plus their surge/refresh selfchecks passed; web typecheck and gate selfcheck passed; production monorepo build passed; targeted surge browser suite passed (5/5); navigation browser suite passed (7/7); gate-off runtime check returned calendar 200 with the honest empty state and a known detail URL 404.

**Residual risks:** Local validation ran on Node 26.3.0 while the workspace declares Node 24.18.0. Next.js also emits its pre-existing middleware-to-proxy deprecation warning. No production deployment was performed.

## Design Notes

- `surge_days` remains a separate source-of-truth even though it reads the same daily bars: the trigger relation is opposite, its reconciliation is directional, and source rows must be auditable without a nullable “direction” discriminator.
- The public model materializes only same-date facts. `leadingSectors` is the positive counterpart of the crash projection, while breadth uses the same factual input but stays nullable to preserve its independent availability.
- The publication gate defaults closed; it is the release control requested by #30, not a substitute for the permanent `noindex` metadata or compliance review.

## Verification

**Commands:**
- `pnpm --filter @aguhot/core typecheck && pnpm --filter @aguhot/core verify:surge-logic` -- expected: Prisma client generation, types and deterministic detection checks pass.
- `pnpm --filter @aguhot/worker typecheck && pnpm --filter @aguhot/worker verify:market-data-refresh` -- expected: worker types and refreshed ordering/gate checks pass.
- `pnpm --filter @aguhot/web typecheck` -- expected: surge routes, shared UI and navigation type-check cleanly.
- targeted `pnpm --filter @aguhot/web exec playwright test ...` with deterministic seed -- expected: calendar, detail, 404, noindex, empty-state and nav contracts pass.
- `NODE_ENV=production pnpm build` -- expected: monorepo production build completes with the new dynamic routes.

**Manual checks:**
- With a locally seeded or verified qualifying date and publication gate enabled, load both surge routes at desktop and mobile widths; verify the date link, `noindex,nofollow`, factual sections and honest missing values.
