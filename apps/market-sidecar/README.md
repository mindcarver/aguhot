# apps/market-sidecar

The AGUHOT market history daily-bars sidecar — a **Python 3.12 runtime** (the
monorepo's third runtime per AD-1) that translates external A-share market
sources into rows. It owns **no domain aggregate** and contains **no domain
rules**: its boundary is identical to the RSSHub self-host collector (it only
"translates an external source into rows"). It is the impl side of the
`MarketDataAdapter` port (AD-7) — Node domain modules read the two Postgres
tables it writes; they never call AkShare.

## What it writes

Three tables, **owned by Node/Prisma** (`packages/core/prisma/schema.prisma`).
This sidecar writes them via **psycopg v3 raw SQL only** — it never uses
Prisma, SQLAlchemy, or Alembic (single-schema ownership stays with Node/Prisma,
AD-2):

| Table | Scope | Unique key |
| --- | --- | --- |
| `index_daily_bars` | 三大宽基 (上证综指 `sh000001` / 深证成指 `sz399001` / 创业板指 `sz399006`) | `(index_code, trade_date)` |
| `sector_daily_bars` | 申万一级行业 (~31 industries) | `(sector_code, trade_date)` |
| `market_breadth_daily` | 市场广度 single-row-per-day aggregate (涨停/跌停/连板/炸板/涨跌家数/两市成交额/龙虎榜/融资融券, story 8.6) | `(trade_date)` |

Each row carries `pct_change` + `close` as **Decimal** (not float — Consistency
Convention: 涨跌和比率以 decimal 存储), `source="akshare"`, `ingested_at` (UTC),
and an app-assigned UUIDv7 `id`. Index/sector bars use `ON CONFLICT DO NOTHING`.
Breadth uses `DO UPDATE`: required counts take the latest run while nullable
fields keep the latest non-null value, allowing partial same-day rows to heal.

## AkShare functions (verified)

AkShare function names churn across versions. These were probed against the
pinned version and recorded at the top of `src/market_sidecar/akshare_client.py`:

| Probe | Function | Returns |
| --- | --- | --- |
| akshare version | — | **1.18.64** (pinned in `pyproject.toml`) |
| Index daily | `ak.stock_zh_index_daily(symbol="sh000001")` | `date, open, high, low, close, volume` (no pct_change → derived from consecutive closes) |
| Sector list | `ak.sw_index_first_info()` | `行业代码 (801010.SI), 行业名称, …` (31 rows) |
| Sector daily | `ak.index_hist_sw(symbol="801010", period="day")` | `代码, 日期, 收盘, …` (bare code, no `.SI`; returns all history → filtered client-side) |
| Breadth: 涨停池 | `ak.stock_zt_pool_em(date="20260714")` | `序号, 代码, 名称, …, 连板数` (row count = limit-up; 连板数 max = consecutive board max) |
| Breadth: 跌停池 | `ak.stock_zt_pool_dtgc_em(date="20260714")` | same column family (row count = limit-down) |
| Breadth: 炸板池 | `ak.stock_zt_pool_zbgc_em(date="20260714")` | same column family (row count = broken-board) |
| Breadth: 涨跌家数 | `ak.stock_zh_a_spot_em()` → fallback `ak.stock_zh_a_spot()` | `代码, 名称, 最新价, 涨跌幅, 成交额, …` (ALL A-share spots, latest day only; advancing/declining from 涨跌幅 sign, turnover = sum 成交额) |
| Breadth: 龙虎榜 | `ak.stock_lhb_detail_em(start_date="20260714", end_date="20260714")` | `序号, 代码, 名称, …, 龙虎榜净买额, 上榜原因` (takes a start/end RANGE; one day = same date for both; one row per listed stock; empty frame = no listings that day) |
| Breadth: 融资融券 (上交所) | `ak.stock_margin_sse(start_date="20260714", end_date="20260714")` | `信用交易日期, 融资余额, 融资买入额, …` (汇总; 融资余额 in **yuan**; takes a start/end RANGE) |
| Breadth: 融资融券 (深交所) | `ak.stock_margin_szse(date="20260714")` | `融资买入额, 融资余额, …` (汇总; 融资余额 in **亿元/100M yuan**; the sidecar normalizes ×1e8 to yuan before summing with SSE) |

> `ak.sw_index_daily` does **not** exist in 1.18.64 — use `index_hist_sw`.
> `stock_zt_pool_*` take `date="YYYYMMDD"` (string, no dashes); `stock_lhb_detail_em` +
> `stock_margin_sse` take `start_date=end_date="YYYYMMDD"` for one day; `stock_margin_szse`
> takes `date="YYYYMMDD"`; `stock_zh_a_spot_em` takes **no** date param (latest day only).
> **Unit mismatch:** SSE margin is in yuan, SZSE margin is in 亿元 — the sidecar normalizes
> SZSE ×1e8 before summing (T-1 data; exchange disclosure lag).

### 北向资金已砍（North-bound capital dropped）

`stock_hsgt_*` (north-bound capital) is **deliberately not collected**: the 沪深交易所
stopped real-time disclosure on 2024-08-19, so showing it would fabricate empty data
(NFR-5 violation). Do not re-add it without a restored live source.

## Run

```bash
cd apps/market-sidecar
uv sync                # install pinned deps into .venv

# Backfill ~3 years (AC1/AC2):
uv run python -m market_sidecar ingest --backfill --scope index
uv run python -m market_sidecar ingest --backfill --scope sector

# Incremental (last ~5 trading days, idempotent — AC3):
uv run python -m market_sidecar ingest --incremental

# Live smoke (NOT run by tests) — last 5 trading days, index only:
uv run python -m market_sidecar ingest --smoke

# Breadth (story 8.6) — market breadth aggregate, one row per trading day:
uv run python -m market_sidecar ingest --backfill --scope breadth
uv run python -m market_sidecar ingest --incremental --scope breadth   # idempotent (AC2)
uv run python -m market_sidecar ingest --smoke --scope breadth         # last 5 days T1 (NOT run by tests)
```

The CLI reads `DATABASE_URL` from the repo-root `.env` (same string Node uses).
Exit code is non-zero if the per-item failure ratio exceeds the threshold
(`ingest.FAILURE_THRESHOLD`, default 0.5) — a scheduler retry signal (AD-4).

`apps/worker` schedules incremental index and breadth collection every 30 minutes.
It publishes the base crash day after index detection, then re-projects
`published_crash_days.breadth` after breadth succeeds. The CLI commands above
remain available for backfills and operator-triggered recovery.

## Test

```bash
cd apps/market-sidecar
uv sync --extra dev      # install pytest
uv run pytest            # green, deterministic, no network
```

- `tests/test_parse.py` — fixture-based: parsing, pct_change derivation, date
  windowing, per-item isolation. **No network, no DB** (mirrors spec-1-4's "RSS
  adapter verified via fixture" precedent).
- `tests/test_upsert.py` — idempotent upsert (AC3) against the local dev PG,
  using a **throwaway test schema** (created + dropped per test; never touches
  `public.*`). Auto-skips if PG/`DATABASE_URL` is unavailable.

The live smoke (`--smoke`) is **not** part of the test suite — it hits
`push2.eastmoney.com` for manual/deployment verification only.

## Out of scope (deferred)

- `CrashDay` / `published_crash_days` read model — stories 8.2/8.3.
- `published_crash_days.breadth` projection + `run-market-breadth.ts` runner — story 8.7.
- `/crash-calendar/[date]` deep detail page — story 8.8.
- Individual stocks / minute bars / HS300 / CSI500 — YAGNI.
- 北向资金 `stock_hsgt_*` — dropped (exchanges stopped real-time disclosure 2024-08-19).
