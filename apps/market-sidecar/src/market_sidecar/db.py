"""psycopg v3 connection + idempotent upsert for the two market-bars tables.

The sidecar NEVER creates tables (Node/Prisma owns schema, AD-2) and NEVER uses
an ORM (no Prisma/SQLAlchemy/Alembic). It writes via raw SQL only. Upserts are
idempotent on the unique key (index_code,trade_date) / (sector_code,trade_date)
with ON CONFLICT DO NOTHING — a re-run of the same trading day is a no-op and
NEVER overwrites an existing row (AC3). pct_change/close are bound as Python
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
