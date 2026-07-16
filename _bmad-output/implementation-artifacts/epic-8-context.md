# Epic 8 Context: 大跌日历与历史回顾 (Crash Calendar & Historical Retrospective)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Upgrade the product's "market reaction" surface from a per-HotEvent single-point snapshot to a historical-sequence retrospective: let users open a dedicated crash-calendar page to see historical A-share big-down days, the sectors that led the decline those days, and the actual T+N return performance after each crash. Scheduled for v1.1 — explicitly kept out of V1 GA because market-quote data is an entirely new data category and the financial-information-service compliance gate is not yet cleared.

## Stories

- Story 8.1: Market history daily-bar ingest sidecar (Python + AkShare)
- Story 8.2: Crash-day detection + forward T+1/T+5/T+20 return calculation
- Story 8.3: `/crash-calendar` public page (calendar view + leading-sector board + forward-return table)
- Story 8.4: Side-nav entry + route wiring (desktop/mobile parity)
- Story 8.5: Crash-day ↔ same-day published HotEvent linkage (deferred v1.2)
- Story 8.6: Market-breadth data ingest (sidecar `--scope breadth`): limit-up/down counts, advancing/declining, turnover, dragon-tiger (龙虎榜), margin
- Story 8.7: Breadth projection into `published_crash_days.breadth` + dedicated runner
- Story 8.8: `/crash-calendar/[date]` deep detail page (five breadth sections + inherited crash-day views)

## Requirements & Constraints

Scope is a historical statistical retrospective, never prediction or investment advice. "Post-crash performance" is historical actual T+N return, explicitly labeled "non-predictive, non-advice", and is bound by the advisory wording blacklist.

Crash definition: any of the three broad indices (上证综指 / 深证成指 / 创业板指) closing with a daily decline at or below `CRASH_THRESHOLD` (default -2%, operator-adjustable config constant — do not hardcode; mirror the `TIMELINE_FOLD_THRESHOLD` pattern). For each crash day, record Top-N leading-decline 申万一级 sectors and T+1/T+5/T+20 actual returns for the three broad indices; T+N returns are backfilled as trading days advance, not forecast.

Honest-empty / no-fabrication is a hard rule (NFR-5): when breadth, quote, or T+N fields are unavailable, render an explicit missing/empty state — never synthesize placeholder values. Every public record must be traceable to a source (NFR-2). All pages must work on desktop and mobile (NFR-4).

Compliance gate (§10 / §12 Q9 / Q10 financial-information-service boundary): market-quote, breadth, limit-up/down, and dragon-tiger data belong to the financial-information-service category. Until external legal sign-off is obtained: `/crash-calendar` and `/crash-calendar/[date]` stay `robots noindex`, and `published_crash_days` is not projected in prod (dev-internal form only, same gate as the rest of V1). The legal-review action item scope must cover indices, sectors, breadth, dragon-tiger, and margin data.

Display hedging (SM-C4): the calendar must not be framed as "maximize post-crash gains" — do not sort by rebound magnitude, to avoid implying a rebound-pattern trading rule.

## Technical Decisions

**AD-1 third runtime boundary.** A new Python 3.12 + AkShare sidecar at `apps/market-sidecar` is introduced as the third runtime (alongside Node web + worker). It is a runtime, not a microservice: it owns no domain aggregate roots and contains only "translate-to-row" ingest logic. This mirrors the existing self-hosted RSSHub collector precedent — no new architectural pattern is invented. Domain modules (`market-reaction`, `crash-review`) read these tables; the sidecar never calls into domain rules.

**AD-2 single-schema ownership.** Node/Prisma owns all tables. Python writes via raw SQL only. Sidecar-owned tables: `index_daily_bars`, `sector_daily_bars`, `market_breadth_daily`. Domain-owned: `CrashDay` (written by `crash-review`).

**AD-3 published_* single-writer.** Only `publish-orchestrator` projects published read models. `published_crash_days` (including its `breadth Json?` column added in 8.7) is projected solely by `refreshPublishedCrashDays`; row existence = published. Breadth projection is per-date try/catch — a missing breadth row yields `breadth: null` without blocking the published crash-day row.

**AD-7 external sources enter via ports.** All AkShare access is isolated in the sidecar; domain code never depends on the AkShare SDK directly.

**Sidecar pattern (8.1 / 8.6).** `uv run market_sidecar ingest --scope {quotes|breadth}`, with `--backfill` (near-N-day bulk) and `--incremental` (idempotent upsert). Runners in `apps/worker/src/`: `run-crash-review.ts` (detection/projection) and `run-market-breadth.ts` (8.7, spawn sidecar → refresh projection).

**Data sources.** Selected: AkShare (free, token-free). Indices/sectors via index/sector daily endpoints. Breadth (8.6 T1 set): `stock_zt_pool_em` / `stock_zt_pool_dtgc_em` / `stock_zt_pool_zbgc_em` (limit-up / limit-down / broken-board pools), `stock_zh_a_spot_em` (advancing/declining/turnover), `stock_lhb_*` (dragon-tiger), `stock_margin_*` (margin balance change, T-1, nullable). North-bound capital (`stock_hsgt_*`) is explicitly dropped — exchanges stopped real-time disclosure on 2024-08-19, so showing it would fabricate empty data. Paid fallback (Tushare Pro) is only a rate-limit backstop, not used now.

**`market_breadth_daily` table (8.6).** `trade_date` unique single-row aggregate + `dragon_tiger Json` column. Columns include `limit_up_count`, `limit_down_count`, `consecutive_board_max`, `broken_board_count`, `advancing_count`, `declining_count`, `flat_count`, `total_turnover`, `margin_balance_change` (nullable), `source`, `ingested_at`, `trace_id`.

**Version + test discipline.** Pin the AkShare version (column-name drift has happened historically on `stock_zt_pool_em`). All breadth/ingest tests are fixture-verified and must not touch the network.

## UX & Interaction Patterns

`/crash-calendar` and `/crash-calendar/[date]` are public pages: server components, `force-dynamic`, `robots noindex`. The calendar index shows highlighted crash days with trigger index / decline; the deep page renders five breadth sections plus inherited views (broad indices, leading sectors, forward returns, same-day hot events).

Visual contracts to honor, without adding new tokens: red-up / green-down market semantics via `text-market-up` / `text-market-down` tokens; `ReactionChip` for leading-decline sectors and breadth counts; `font-mono` for all numeric/return figures; the advisory note uses the `EditorialReasonBlock` visual contract (hairline divider + label, neutral `bg-surface-muted`, body-sm). Side-nav adds the crash-calendar entry; the existing 220px left-rail layout is unchanged, and mobile drawer gets the same entry.

Empty / missing data renders as `—` or an explicit empty state (never blank, never placeholder).

## Cross-Story Dependencies

8.1 (quote data) → 8.2 (crash detection + forward returns) → 8.3 (projection + index page) → 8.4 (nav). 8.5 (hot-event linkage) depends on Epic 7 saliency and is deferred to v1.2 to avoid coupling with the saliency tuning period.

8.6 (breadth data, new `market_breadth_daily` table) → 8.7 (`published_crash_days.breadth` projection + `run-market-breadth.ts` runner) → 8.8 (`/crash-calendar/[date]` deep page; the index page in 8.3 is refactored to link calendar cells to `/crash-calendar/[date]` instead of inline detail).

Cross-cutting: pin AkShare version; fixture-verified tests with no network access; every story must pass local PG migration + `tsc --noEmit` clean. The 8.1–8.5 and 8.6–8.8 chains can be reasoned about as the same data → detection → projection → page shape applied twice (first to broad-index/sector quotes, then to breadth).
