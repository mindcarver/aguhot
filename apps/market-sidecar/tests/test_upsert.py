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
from market_sidecar.db import IndexBar, SectorBar, connect, upsert_index_bars, upsert_sector_bars

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
