"""test_upsert.py — idempotent upsert against the dev PG (AC3), with rollback isolation.

Per spec AC5: tests may use the local PG but must be deterministic and leave no
residue. We use a throwaway test schema (CREATE SCHEMA / SET search_path / DROP
SCHEMA on teardown) so the test NEVER touches the public.index_daily_bars /
sector_daily_bars tables that the real sidecar writes. This keeps the dev DB
clean and makes the test independent of any real ingested data.

Skipped automatically if DATABASE_URL is unset or PG is unreachable — the suite
must not hard-depend on the dev DB (the parse tests in test_parse.py carry the
core correctness assertions and run with zero infra).
"""

from __future__ import annotations

import os
from datetime import date
from decimal import Decimal

import psycopg
import pytest

from market_sidecar.config import load_env
from market_sidecar.db import (
    IndexBar,
    MarketBreadthRow,
    SectorBar,
    connect,
    count_breadth_rows,
    upsert_index_bars,
    upsert_market_breadth,
    upsert_sector_bars,
)

load_env()
# Strip Prisma's ?schema=public param — libpq rejects it. Tests use the bare URL
# and set search_path explicitly via the throwaway test schema.
_DB_URL_RAW = os.environ.get("DATABASE_URL", "").strip()
DB_URL = _DB_URL_RAW.split("?", 1)[0] if "?" in _DB_URL_RAW else _DB_URL_RAW
TEST_SCHEMA = "market_sidecar_test"


def _pg_available() -> bool:
    if not DB_URL:
        return False
    try:
        with psycopg.connect(DB_URL, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _pg_available(),
    reason="dev PG unavailable or DATABASE_URL unset; upsert isolation test needs local PG",
)


@pytest.fixture()
def isolated_schema():
    """Create a throwaway schema, create the two tables in it (mirroring the real
    DDL), run the test inside it, then DROP SCHEMA CASCADE.

    This proves the upsert SQL is correct against real Postgres WITHOUT touching
    public.* — full isolation, no residue.
    """
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")
            cur.execute(f"CREATE SCHEMA {TEST_SCHEMA}")
            # mirror the production DDL (idempotency unique keys are the point)
            cur.execute(
                f"""
                CREATE TABLE {TEST_SCHEMA}.index_daily_bars (
                    id TEXT NOT NULL,
                    index_code TEXT NOT NULL,
                    trade_date DATE NOT NULL,
                    pct_change DECIMAL(8,4) NOT NULL,
                    close DECIMAL(12,4) NOT NULL,
                    source TEXT NOT NULL,
                    ingested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    trace_id TEXT,
                    CONSTRAINT idx_pkey PRIMARY KEY (id)
                );
                CREATE UNIQUE INDEX idx_code_date_key
                    ON {TEST_SCHEMA}.index_daily_bars(index_code, trade_date);
                CREATE TABLE {TEST_SCHEMA}.sector_daily_bars (
                    id TEXT NOT NULL,
                    sector_code TEXT NOT NULL,
                    sector_name TEXT NOT NULL,
                    trade_date DATE NOT NULL,
                    pct_change DECIMAL(8,4) NOT NULL,
                    close DECIMAL(12,4) NOT NULL,
                    source TEXT NOT NULL,
                    ingested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    trace_id TEXT,
                    CONSTRAINT sec_pkey PRIMARY KEY (id)
                );
                CREATE UNIQUE INDEX sec_code_date_key
                    ON {TEST_SCHEMA}.sector_daily_bars(sector_code, trade_date);
                CREATE TABLE {TEST_SCHEMA}.market_breadth_daily (
                    id TEXT NOT NULL,
                    trade_date DATE NOT NULL,
                    limit_up_count INTEGER NOT NULL,
                    limit_down_count INTEGER NOT NULL,
                    consecutive_board_max INTEGER NOT NULL,
                    broken_board_count INTEGER NOT NULL,
                    advancing_count INTEGER,
                    declining_count INTEGER,
                    flat_count INTEGER,
                    total_turnover DECIMAL(20,2),
                    margin_balance_change DECIMAL(20,2),
                    dragon_tiger JSONB,
                    source TEXT NOT NULL,
                    ingested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    trace_id TEXT,
                    CONSTRAINT br_pkey PRIMARY KEY (id)
                );
                CREATE UNIQUE INDEX br_trade_date_key
                    ON {TEST_SCHEMA}.market_breadth_daily(trade_date);
                """
            )
    # Point subsequent connections at the test schema via search_path so the
    # db.py SQL (which uses unqualified table names) hits the throwaway tables.
    # psycopg connect options: prepend search_path via options.
    yield _schema_url()
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")


def _schema_url() -> str:
    """DATABASE_URL with options=-c search_path=test_schema so unqualified tables
    in db.py resolve into the throwaway schema."""
    sep = "&" if "?" in DB_URL else "?"
    return f"{DB_URL}{sep}options=-c%20search_path%3D{TEST_SCHEMA}"


def _bar(id_: str, code: str, d: date, pct: str, close: str) -> IndexBar:
    return IndexBar(
        id=id_,
        index_code=code,
        trade_date=d,
        pct_change=Decimal(pct),
        close=Decimal(close),
        source="akshare",
        ingested_at="2026-07-15T00:00:00+00:00",
        trace_id=None,
    )


def test_index_upsert_is_idempotent(isolated_schema):
    """AC3: re-running the same (index_code, trade_date) is a no-op — no duplicate,
    no overwrite of the existing row."""
    bars1 = [
        _bar("01947cdc-1000-7000-8000-000000000001", "sh000001", date(2026, 7, 14), "1.2300", "3967.1260"),
        _bar("01947cdc-1000-7000-8000-000000000002", "sz399001", date(2026, 7, 14), "-0.5600", "12345.6700"),
    ]
    with connect(isolated_schema) as conn:
        n1 = upsert_index_bars(conn, bars1)
        # second run: SAME unique keys, different id + different pct_change to
        # prove the existing rows are NOT overwritten (ON CONFLICT DO NOTHING).
        bars2 = [
            _bar("01947cdc-1000-7000-8000-0000000000aa", "sh000001", date(2026, 7, 14), "9.9999", "9999.9999"),
            _bar("01947cdc-1000-7000-8000-0000000000bb", "sz399001", date(2026, 7, 14), "9.9999", "9999.9999"),
        ]
        n2 = upsert_index_bars(conn, bars2)

    assert n1 == 2  # first run inserts both
    assert n2 == 2  # executemany processed 2 (count is batch size; idempotency is row-level)
    # the real idempotency proof: re-open and count + read values
    with connect(isolated_schema) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM index_daily_bars")
            assert cur.fetchone()[0] == 2  # still exactly 2 (no duplicates)
            cur.execute(
                "SELECT pct_change FROM index_daily_bars WHERE index_code='sh000001'"
            )
            row = cur.fetchone()
            assert row is not None
            # original value preserved — NOT overwritten by the 9.9999 rerun
            assert str(row[0]) == "1.2300"


def test_sector_upsert_is_idempotent_and_keeps_name(isolated_schema):
    """AC3 for sector_daily_bars; also sector_name carried per-row."""
    b1 = SectorBar(
        id="01947cdc-1000-7000-8000-000000000010",
        sector_code="801010",
        sector_name="农林牧渔",
        trade_date=date(2026, 7, 14),
        pct_change=Decimal("0.5215"),
        close=Decimal("210.0900"),
        source="akshare",
        ingested_at="2026-07-15T00:00:00+00:00",
        trace_id=None,
    )
    with connect(isolated_schema) as conn:
        upsert_sector_bars(conn, [b1])
        # rerun with same unique key -> no duplicate, no overwrite
        b1_dup = SectorBar(
            id="01947cdc-1000-7000-8000-0000000000ff",
            sector_code="801010",
            sector_name="CHANGED",
            trade_date=date(2026, 7, 14),
            pct_change=Decimal("9.9999"),
            close=Decimal("9999.9999"),
            source="akshare",
            ingested_at="2026-07-15T00:00:00+00:00",
            trace_id=None,
        )
        upsert_sector_bars(conn, [b1_dup])
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM sector_daily_bars")
            cnt = cur.fetchone()[0]
            # idempotency guarantees exactly 1 row; read its preserved fields
            cur.execute(
                "SELECT sector_name, pct_change FROM sector_daily_bars WHERE sector_code='801010'"
            )
            name, pct = cur.fetchone()
    assert cnt == 1
    assert name == "农林牧渔"  # original preserved, not "CHANGED"
    assert str(pct) == "0.5215"


def test_decimal_not_float_round_trip(isolated_schema):
    """Consistency Convention: pct_change/close stored as DECIMAL, not float.

    Bind Decimal -> numeric; read back and assert exact decimal equality (a float
    column would introduce binary-repr drift like 1.2300000000001).
    """
    bar = _bar(
        "01947cdc-1000-7000-8000-000000000020",
        "sz399006",
        date(2026, 7, 14),
        "-2.3456",
        "3500.1234",
    )
    with connect(isolated_schema) as conn:
        upsert_index_bars(conn, [bar])
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pct_change, close, pg_typeof(pct_change)::text FROM index_daily_bars WHERE index_code='sz399006'"
            )
            pct, close, typ = cur.fetchone()
    assert typ == "numeric"
    assert str(pct) == "-2.3456"
    assert str(close) == "3500.1234"


_BREADTH_DEFAULT_DRAGON = {
    "stockCount": 2,
    "institutionalNetBuy": "120000000",
    "hotMoneyNetBuy": "0",
    "topStocks": [],
}
_UNSET = object()  # sentinel: distinguish "not provided" from "explicitly None"


def _breadth_row(
    id_: str,
    d: date,
    *,
    limit_up: int = 3,
    turnover: str = "21000000000.00",
    margin: str | None = "-500000000.00",
    dragon: object = _UNSET,
) -> MarketBreadthRow:
    # dragon=_UNSET → use the populated default; dragon=None → explicit NULL (NFR-5 path).
    dragon_val = _BREADTH_DEFAULT_DRAGON if dragon is _UNSET else dragon
    return MarketBreadthRow(
        id=id_,
        trade_date=d,
        limit_up_count=limit_up,
        limit_down_count=2,
        consecutive_board_max=4,
        broken_board_count=1,
        advancing_count=3,
        declining_count=2,
        flat_count=1,
        total_turnover=Decimal(turnover),
        margin_balance_change=Decimal(margin) if margin is not None else None,
        dragon_tiger=dragon_val,
        source="akshare",
        ingested_at="2026-07-16T00:00:00+00:00",
        trace_id=None,
    )


def test_breadth_upsert_is_idempotent(isolated_schema):
    """AC2: re-running the same trade_date is a no-op — no duplicate, no overwrite."""
    row1 = _breadth_row(
        "01947cdc-1000-7000-8000-0000000000b1",
        date(2026, 7, 14),
        limit_up=3,
        turnover="21000000000.00",
        margin="-500000000.00",
    )
    with connect(isolated_schema) as conn:
        n1 = upsert_market_breadth(conn, [row1])
        # second run: SAME trade_date, different id + different counts to prove NO overwrite
        row2 = _breadth_row(
            "01947cdc-1000-7000-8000-0000000000b2",
            date(2026, 7, 14),
            limit_up=999,
            turnover="99999999.99",
            margin=None,
            dragon=None,
        )
        n2 = upsert_market_breadth(conn, [row2])

    assert n1 == 1
    assert n2 == 1  # batch size; idempotency is row-level
    # the real idempotency proof: re-open, count, and read preserved values
    with connect(isolated_schema) as conn:
        assert count_breadth_rows(conn) == 1  # still exactly 1 (no duplicate)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT limit_up_count, total_turnover, margin_balance_change, dragon_tiger "
                "FROM market_breadth_daily WHERE trade_date='2026-07-14'"
            )
            lu, to, margin, dragon = cur.fetchone()
    assert lu == 3  # original preserved, NOT overwritten by the 999 rerun
    assert str(to) == "21000000000.00"
    assert str(margin) == "-500000000.00"  # original margin preserved (not NULLed)
    assert dragon is not None
    assert dragon["stockCount"] == 2  # original dragon_tiger preserved (not NULLed)


def test_breadth_upsert_nullable_fields_accept_null(isolated_schema):
    """NFR-5: margin_balance_change + dragon_tiger NULLable (fetch failure → honest NULL).

    A null dragon_tiger must be stored as SQL NULL (read back as Python None), NOT as a
    JSONB scalar 'null' (which Json(None) would have produced before the params-builder fix).
    The discriminator is the SQL predicate `dragon_tiger IS NULL`: it is True for a real
    database NULL and False for a JSONB 'null' scalar. psycopg returns Python None for a
    SQL NULL too, so both the Python readback AND the IS NULL predicate must hold.
    """
    row = _breadth_row(
        "01947cdc-1000-7000-8000-0000000000b3",
        date(2026, 7, 15),
        margin=None,
        dragon=None,
    )
    with connect(isolated_schema) as conn:
        upsert_market_breadth(conn, [row])
        with conn.cursor() as cur:
            cur.execute(
                "SELECT margin_balance_change, dragon_tiger, dragon_tiger IS NULL "
                "FROM market_breadth_daily WHERE trade_date='2026-07-15'"
            )
            margin, dragon, is_null = cur.fetchone()
    assert margin is None
    # dragon_tiger is a real database NULL (not a JSONB 'null' scalar): psycopg returns
    # Python None for SQL NULL, and the SQL predicate `IS NULL` is True (it would be False
    # for a JSONB scalar 'null').
    assert dragon is None
    assert is_null is True
