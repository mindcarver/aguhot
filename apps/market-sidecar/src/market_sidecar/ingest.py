"""Ingest orchestration: backfill / incremental / smoke.

Backfill: ~3 years of history per item (index or sector). Incremental: last N
trading days (default 5). Smoke: last 5 trading days, index only, live (not run
by the test suite).

Per-item error isolation (AC4): a single index/sector failure is caught and
logged as a skip; it does NOT abort the batch. If the failure ratio exceeds the
threshold (default 0.5), the run exits non-zero so a scheduler can retry the
whole batch (AD-4 retry discipline). Missing data is never fabricated (NFR-5):
a date with no AkShare row simply produces no bar.

This module is fixture-testable: every fetch goes through akshare_client, which
accepts an injected fake ak_module. The DB path is tested separately in
test_upsert (transaction-rollback isolation against the dev PG).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from . import akshare_client as akc
from .config import database_url
from .db import IndexBar, SectorBar, connect, upsert_index_bars, upsert_sector_bars

log = logging.getLogger("market_sidecar.ingest")

SOURCE = "akshare"
# Backfill window: ~3 years (per spec AC1/AC2). We over-fetch slightly; the
# date window in akshare_client trims to exactly this range.
BACKFILL_DAYS = 365 * 3 + 5
# Incremental: last 5 trading days (covers weekends/holidays with margin).
INCREMENTAL_DAYS = 7
# Smoke: 5 trading days -> 7 calendar days window (per spec Dev Notes).
SMOKE_DAYS = 7
# Fail-ratio threshold: if more than this fraction of items fail, exit non-zero.
FAILURE_THRESHOLD = 0.5


@dataclass
class IngestReport:
    """Per-run summary for logging + scheduler exit-code decisions."""

    scope: str
    mode: str
    total_items: int = 0
    ok_items: int = 0
    skipped_items: int = 0
    failed_items: int = 0
    bars_written: int = 0
    skips: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    @property
    def failure_ratio(self) -> float:
        return self.failed_items / self.total_items if self.total_items else 0.0

    @property
    def exit_code(self) -> int:
        """Non-zero if the failure ratio exceeded threshold (scheduler retry signal)."""
        return 1 if self.total_items and self.failure_ratio > FAILURE_THRESHOLD else 0


def ingest_indices(
    *,
    mode: str,
    db_url: str | None = None,
    ak_module: akc.AkModule | None = None,
    today: date | None = None,
) -> IngestReport:
    """Ingest 三大宽基 daily bars. mode in {backfill, incremental, smoke}.

    db_url/ak_module/today are injection seams (tests). Production resolves the
    real DATABASE_URL, the real akshare, and date.today().
    """
    start, end = _window(mode, today)
    report = IngestReport(scope="index", mode=mode)
    bars: list[IndexBar] = []
    for symbol in akc.BROAD_INDICES:
        report.total_items += 1
        try:
            rows = akc.fetch_index_daily(
                symbol, start_date=start, end_date=end, ak_module=ak_module
            )
            if not rows:
                report.skipped_items += 1
                report.skips.append(f"{symbol}: no rows in window")
                log.warning("skip %s: no rows in window %s..%s", symbol, start, end)
                continue
            for r in rows:
                bars.append(_to_index_bar(r))
            report.ok_items += 1
            log.info("ok %s: %d bars", symbol, len(rows))
        except Exception as exc:  # per-item isolation (AC4)
            report.failed_items += 1
            report.failures.append(f"{symbol}: {type(exc).__name__}: {exc}")
            log.exception("failed %s", symbol)

    if bars:
        with connect(db_url) as conn:
            report.bars_written = upsert_index_bars(conn, bars)
    return report


def ingest_sectors(
    *,
    mode: str,
    db_url: str | None = None,
    ak_module: akc.AkModule | None = None,
    today: date | None = None,
) -> IngestReport:
    """Ingest 申万一级 sector daily bars. mode in {backfill, incremental}."""
    start, end = _window(mode, today)
    report = IngestReport(scope="sector", mode=mode)
    bars: list[SectorBar] = []
    try:
        sectors = akc.list_sectors(ak_module=ak_module)
    except Exception as exc:  # sector-list failure is fatal for this scope
        report.failures.append(f"sw_index_first_info: {type(exc).__name__}: {exc}")
        log.exception("failed to list sectors")
        return report

    for sector in sectors:
        report.total_items += 1
        try:
            rows = akc.fetch_sector_daily(
                sector, start_date=start, end_date=end, ak_module=ak_module
            )
            if not rows:
                report.skipped_items += 1
                report.skips.append(f"{sector.code}: no rows in window")
                log.warning("skip %s: no rows in window %s..%s", sector.code, start, end)
                continue
            for r in rows:
                bars.append(_to_sector_bar(r))
            report.ok_items += 1
            log.info("ok %s %s: %d bars", sector.code, sector.name, len(rows))
        except Exception as exc:  # per-item isolation (AC4)
            report.failed_items += 1
            report.failures.append(f"{sector.code}: {type(exc).__name__}: {exc}")
            log.exception("failed %s", sector.code)

    if bars:
        with connect(db_url) as conn:
            report.bars_written = upsert_sector_bars(conn, bars)
    return report


def _window(mode: str, today: date | None) -> tuple[date, date]:
    """Resolve the inclusive [start, end] date window for a mode."""
    end = today or date.today()
    if mode == "backfill":
        return end - timedelta(days=BACKFILL_DAYS), end
    if mode in ("incremental", "smoke"):
        return end - timedelta(days=INCREMENTAL_DAYS if mode == "incremental" else SMOKE_DAYS), end
    raise ValueError(f"unknown mode: {mode!r}")


def _to_index_bar(r: akc.IndexRow) -> IndexBar:
    """Map an akshare_client IndexRow to a db IndexBar (assign UUIDv7 + UTC ts)."""
    # pct_change is guaranteed non-None here: _with_pct_change drops the first row.
    # Explicit guard (not assert) so the invariant holds under `python -O`.
    if r.pct_change is None:
        raise RuntimeError(f"index {r.index_code} @ {r.trade_date} has no pct_change")
    return IndexBar(
        id=_new_id(),
        index_code=r.index_code,
        trade_date=r.trade_date,
        pct_change=r.pct_change,
        close=r.close,
        source=SOURCE,
        ingested_at=_utc_now_iso(),
        trace_id=None,
    )


def _to_sector_bar(r: akc.SectorRow) -> SectorBar:
    if r.pct_change is None:
        raise RuntimeError(f"sector {r.sector_code} @ {r.trade_date} has no pct_change")
    return SectorBar(
        id=_new_id(),
        sector_code=r.sector_code,
        sector_name=r.sector_name,
        trade_date=r.trade_date,
        pct_change=r.pct_change,
        close=r.close,
        source=SOURCE,
        ingested_at=_utc_now_iso(),
        trace_id=None,
    )


def _utc_now_iso() -> str:
    """UTC now as ISO8601 (no microseconds drift; matches Node DateTime UTC)."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id() -> str:
    """App-assigned UUIDv7 (system-wide convention: no DB-side default).

    The uuid7 PyPI package installs as the `uuid_extensions` module.
    """
    from uuid_extensions import uuid7  # noqa: PLC0415 — lazy to keep parse tests import-light

    return str(uuid7())


# Re-export for the CLI / tests
__all__ = [
    "IngestReport",
    "ingest_indices",
    "ingest_sectors",
    "database_url",
    "Decimal",
]
