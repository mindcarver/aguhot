# apps/market-sidecar

The AGUHOT market history daily-bars sidecar — a **Python 3.12 runtime** (the
monorepo's third runtime per AD-1) that translates external A-share market
sources into rows. It owns **no domain aggregate** and contains **no domain
rules**: its boundary is identical to the RSSHub self-host collector (it only
"translates an external source into rows"). It is the impl side of the
`MarketDataAdapter` port (AD-7) — Node domain modules read the two Postgres
tables it writes; they never call AkShare.

## What it writes

Two tables, **owned by Node/Prisma** (`packages/core/prisma/schema.prisma`).
This sidecar writes them via **psycopg v3 raw SQL only** — it never uses
Prisma, SQLAlchemy, or Alembic (single-schema ownership stays with Node/Prisma,
AD-2):

| Table | Scope | Unique key |
| --- | --- | --- |
| `index_daily_bars` | 三大宽基 (上证综指 `sh000001` / 深证成指 `sz399001` / 创业板指 `sz399006`) | `(index_code, trade_date)` |
| `sector_daily_bars` | 申万一级行业 (~31 industries) | `(sector_code, trade_date)` |

Each row carries `pct_change` + `close` as **Decimal** (not float — Consistency
Convention: 涨跌和比率以 decimal 存储), `source="akshare"`, `ingested_at` (UTC),
and an app-assigned UUIDv7 `id`. Upserts are idempotent (`ON CONFLICT DO
NOTHING`): re-running a trading day is a no-op and never overwrites an existing
row (AC3).

## AkShare functions (verified)

AkShare function names churn across versions. These were probed against the
pinned version and recorded at the top of `src/market_sidecar/akshare_client.py`:

| Probe | Function | Returns |
| --- | --- | --- |
| akshare version | — | **1.18.64** (pinned in `pyproject.toml`) |
| Index daily | `ak.stock_zh_index_daily(symbol="sh000001")` | `date, open, high, low, close, volume` (no pct_change → derived from consecutive closes) |
| Sector list | `ak.sw_index_first_info()` | `行业代码 (801010.SI), 行业名称, …` (31 rows) |
| Sector daily | `ak.index_hist_sw(symbol="801010", period="day")` | `代码, 日期, 收盘, …` (bare code, no `.SI`; returns all history → filtered client-side) |

> `ak.sw_index_daily` does **not** exist in 1.18.64 — use `index_hist_sw`.

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
```

The CLI reads `DATABASE_URL` from the repo-root `.env` (same string Node uses).
Exit code is non-zero if the per-item failure ratio exceeds the threshold
(`ingest.FAILURE_THRESHOLD`, default 0.5) — a scheduler retry signal (AD-4).

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

- Scheduling wiring (BullMQ/cron/systemd timer) — later 8.x story.
- `CrashDay` / `published_crash_days` read model — story 8.2.
- Individual stocks / minute bars / HS300 / CSI500 — YAGNI.
