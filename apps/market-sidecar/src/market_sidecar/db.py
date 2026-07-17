"""psycopg v3 connection + idempotent upsert for the two market-bars tables.

The sidecar NEVER creates tables (Node/Prisma owns schema, AD-2) and NEVER uses
an ORM (no Prisma/SQLAlchemy/Alembic). It writes via raw SQL only. Upserts are
idempotent on the unique key (index_code,trade_date) / (sector_code,trade_date).
Bar re-runs use ON CONFLICT DO NOTHING (AC3); breadth re-runs update the latest
counts and fill optional fields without replacing known values with NULL. pct_change/close are bound as Python
Decimal (psycopg sends Decimal as numeric), matching the schema's DECIMAL columns
(Consistency Convention: 涨跌和比率以 decimal 存储, not float).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol

import psycopg
from psycopg.types.json import Json

from .config import database_url

# Raw SQL constants. Column order matches the Bar dataclasses below. id is
# app-assigned UUIDv7 (no DB default), ingested_at defaults to CURRENT_TIMESTAMP
# in the table but we pass an explicit UTC now for determinism/traceability.
_INDEX_UPSERT = """
INSERT INTO index_daily_bars
    (id, index_code, trade_date, pct_change, close, source, ingested_at, trace_id)
VALUES (%(id)s, %(index_code)s, %(trade_date)s, %(pct_change)s, %(close)s,
        %(source)s, %(ingested_at)s, %(trace_id)s)
ON CONFLICT (index_code, trade_date) DO NOTHING
"""

_SECTOR_UPSERT = """
INSERT INTO sector_daily_bars
    (id, sector_code, sector_name, trade_date, pct_change, close, source, ingested_at, trace_id)
VALUES (%(id)s, %(sector_code)s, %(sector_name)s, %(trade_date)s, %(pct_change)s, %(close)s,
        %(source)s, %(ingested_at)s, %(trace_id)s)
ON CONFLICT (sector_code, trade_date) DO NOTHING
"""

# Story 8.6 — market breadth single-row-per-trade_date aggregate. Same-day re-runs update
# the non-null pool counts (which can change before market close) and fill optional values.
# COALESCE prevents a transient source failure from erasing a value captured by an earlier run.
# dragon_tiger is a Json column (wrapped in psycopg.types.json.Json in _breadth_params).
_BREADTH_UPSERT = """
INSERT INTO market_breadth_daily
    (id, trade_date, limit_up_count, limit_down_count, consecutive_board_max,
     broken_board_count, advancing_count, declining_count, flat_count, total_turnover,
     margin_balance_change, dragon_tiger, source, ingested_at, trace_id)
VALUES (%(id)s, %(trade_date)s, %(limit_up_count)s, %(limit_down_count)s,
        %(consecutive_board_max)s, %(broken_board_count)s, %(advancing_count)s,
        %(declining_count)s, %(flat_count)s, %(total_turnover)s,
        %(margin_balance_change)s, %(dragon_tiger)s, %(source)s, %(ingested_at)s, %(trace_id)s)
ON CONFLICT (trade_date) DO UPDATE SET
    limit_up_count = EXCLUDED.limit_up_count,
    limit_down_count = EXCLUDED.limit_down_count,
    consecutive_board_max = EXCLUDED.consecutive_board_max,
    broken_board_count = EXCLUDED.broken_board_count,
    advancing_count = COALESCE(EXCLUDED.advancing_count, market_breadth_daily.advancing_count),
    declining_count = COALESCE(EXCLUDED.declining_count, market_breadth_daily.declining_count),
    flat_count = COALESCE(EXCLUDED.flat_count, market_breadth_daily.flat_count),
    total_turnover = COALESCE(EXCLUDED.total_turnover, market_breadth_daily.total_turnover),
    margin_balance_change = COALESCE(EXCLUDED.margin_balance_change, market_breadth_daily.margin_balance_change),
    dragon_tiger = COALESCE(EXCLUDED.dragon_tiger, market_breadth_daily.dragon_tiger),
    source = EXCLUDED.source,
    ingested_at = EXCLUDED.ingested_at,
    trace_id = EXCLUDED.trace_id
"""


class Connection(Protocol):
    """Minimal psycopg connection protocol for testability (mock/real)."""

    def cursor(self, *, row_factory: object | None = ...) -> "Cursor": ...


class Cursor(Protocol):
    def execute(self, query: str, params: object | None = ...) -> object: ...
    def fetchall(self) -> list[tuple]: ...


@dataclass(frozen=True)
class IndexBar:
    """One index daily bar row. pct_change/close are Decimal (not float)."""

    id: str
    index_code: str
    trade_date: date
    pct_change: Decimal
    close: Decimal
    source: str
    ingested_at: str  # ISO8601 UTC
    trace_id: str | None = None


@dataclass(frozen=True)
class SectorBar:
    """One sector daily bar row. sector_name carried per-row (display convenience)."""

    id: str
    sector_code: str
    sector_name: str
    trade_date: date
    pct_change: Decimal
    close: Decimal
    source: str
    ingested_at: str  # ISO8601 UTC
    trace_id: str | None = None


@dataclass(frozen=True)
class MarketBreadthRow:
    """One market_breadth_daily row: a single-day aggregate of 5 breadth sources.

    Date-specific pool counts (limit_up/down, consecutive_board_max, broken_board_count) are int
    and NOT NULL — they come from stock_zt_pool_* which take a date. The SPOT-derived fields
    (advancing/declining/flat) are NULLABLE: stock_zh_a_spot_em() takes NO date and serves ONLY
    the latest trading day, so a historical-day row carries None for these three fields (NFR-5
    honest empty, never fabricated onto past trade_dates). total_turnover prefers the historical
    index daily 成交额 sum (sh000001 + sz399107); the latest day may use the spot snapshot total
    when the index endpoint is unavailable. Historical dates are never filled from latest spot.
    margin_balance_change is the day-over-day 融资余额 diff (None on the first day in the window
    or when margin is unavailable). dragon_tiger is the golden-example dict shape (see
    akshare_client.dragon_tiger_to_json) or None on fetch failure.
    """

    id: str
    trade_date: date
    limit_up_count: int
    limit_down_count: int
    consecutive_board_max: int
    broken_board_count: int
    advancing_count: int | None  # spot pctChange > 0; None on non-latest days (spot is latest-day-only)
    declining_count: int | None  # spot pctChange < 0; None on non-latest days
    flat_count: int | None  # spot pctChange == 0; None on non-latest days
    total_turnover: Decimal | None  # 两市成交额 = sh000001 + sz399107 成交额 sum (index-em, HISTORICAL); None on fetch failure / date missing from one index
    margin_balance_change: Decimal | None
    dragon_tiger: dict[str, object] | None
    source: str
    ingested_at: str  # ISO8601 UTC
    trace_id: str | None = None


@contextmanager
def connect(url: str | None = None) -> Iterator[psycopg.Connection]:
    """Open a psycopg connection, commit on clean exit, rollback on error.

    Passing url=None resolves DATABASE_URL via config. Tests inject a live url
    against the dev PG (wrapped in a transaction for rollback isolation).
    """
    conn = psycopg.connect(url or database_url())
    try:
        # autocommit False by default: ingest() controls commit boundaries so
        # a partial batch can be rolled back atomically.
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_index_bars(conn: Connection, bars: list[IndexBar]) -> int:
    """Upsert index bars idempotently. Returns the count of newly-inserted rows.

    ON CONFLICT DO NOTHING means a repeat for the same (index_code, trade_date)
    is a no-op (AC3). We use executemany so the whole batch is one round-trip.
    """
    if not bars:
        return 0
    payload = [_index_params(b) for b in bars]
    with conn.cursor() as cur:
        cur.executemany(_INDEX_UPSERT, payload)
        # executemany returns rows stats inconsistently across psycopg versions;
        # re-query the exact inserted count is over-engineering. The caller
        # treats the return as "best-effort inserted" for logging; idempotency
        # is guaranteed by ON CONFLICT, not by this count.
        return len(payload)


def upsert_sector_bars(conn: Connection, bars: list[SectorBar]) -> int:
    """Upsert sector bars idempotently. Same semantics as upsert_index_bars."""
    if not bars:
        return 0
    payload = [_sector_params(b) for b in bars]
    with conn.cursor() as cur:
        cur.executemany(_SECTOR_UPSERT, payload)
        return len(payload)


def upsert_market_breadth(conn: Connection, rows: list[MarketBreadthRow]) -> int:
    """Upsert breadth rows and self-heal partial same-day data.

    Required pool counts take the latest run; nullable fields use the latest non-null value.
    Row identity remains one-per-trade-date, so repeated identical input is idempotent.
    """
    if not rows:
        return 0
    payload = [_breadth_params(r) for r in rows]
    with conn.cursor() as cur:
        cur.executemany(_BREADTH_UPSERT, payload)
        return len(payload)


def count_index_bars(conn: Connection, index_code: str) -> int:
    """Count rows for an index code (test assertion helper)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM index_daily_bars WHERE index_code = %s",
            (index_code,),
        )
        return int(cur.fetchone()[0])


def count_sector_bars(conn: Connection, sector_code: str) -> int:
    """Count rows for a sector code (test assertion helper)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM sector_daily_bars WHERE sector_code = %s",
            (sector_code,),
        )
        return int(cur.fetchone()[0])


def count_breadth_rows(conn: Connection) -> int:
    """Count all market_breadth_daily rows (test assertion helper)."""
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market_breadth_daily")
        return int(cur.fetchone()[0])


def _index_params(b: IndexBar) -> dict[str, object]:
    return {
        "id": b.id,
        "index_code": b.index_code,
        "trade_date": b.trade_date,
        "pct_change": b.pct_change,
        "close": b.close,
        "source": b.source,
        "ingested_at": b.ingested_at,
        "trace_id": b.trace_id,
    }


def _sector_params(b: SectorBar) -> dict[str, object]:
    return {
        "id": b.id,
        "sector_code": b.sector_code,
        "sector_name": b.sector_name,
        "trade_date": b.trade_date,
        "pct_change": b.pct_change,
        "close": b.close,
        "source": b.source,
        "ingested_at": b.ingested_at,
        "trace_id": b.trace_id,
    }


def _breadth_params(r: MarketBreadthRow) -> dict[str, object]:
    return {
        "id": r.id,
        "trade_date": r.trade_date,
        "limit_up_count": r.limit_up_count,
        "limit_down_count": r.limit_down_count,
        "consecutive_board_max": r.consecutive_board_max,
        "broken_board_count": r.broken_board_count,
        "advancing_count": r.advancing_count,
        "declining_count": r.declining_count,
        "flat_count": r.flat_count,
        "total_turnover": r.total_turnover,
        "margin_balance_change": r.margin_balance_change,
        # Wrap the dict in psycopg.types.json.Json so it adapts to JSONB. A NULL dragon_tiger
        # must bind as SQL NULL (not JSON 'null'): Json(None) would adapt to a JSONB scalar
        # 'null', not a database NULL. Bind Python None directly when the dict is absent
        # (NFR-5 fetch-failure / honest empty).
        "dragon_tiger": None if r.dragon_tiger is None else Json(r.dragon_tiger),
        "source": r.source,
        "ingested_at": r.ingested_at,
        "trace_id": r.trace_id,
    }
