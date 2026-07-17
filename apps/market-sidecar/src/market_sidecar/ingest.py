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
from .db import (
    IndexBar,
    MarketBreadthRow,
    SectorBar,
    connect,
    upsert_index_bars,
    upsert_market_breadth,
    upsert_sector_bars,
)

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


def ingest_breadth(
    *,
    mode: str,
    db_url: str | None = None,
    ak_module: akc.AkModule | None = None,
    today: date | None = None,
) -> IngestReport:
    """Ingest market breadth (story 8.6) — one aggregate row per trading day.

    Breadth is per-trade_date (not per-code like the bar tables): for each day in the
    window we aggregate AkShare sources into a SINGLE market_breadth_daily row. The
    date-specific sources are fetched per-day: 涨停池 / 跌停池 / 炸板池 (stock_zt_pool_*),
    龙虎榜 (stock_lhb_detail_em), 融资融券 (stock_margin_*). The SPOT source
    (stock_zh_a_spot_em) takes NO date and returns ONLY the latest trading day's snapshot,
    so it is fetched ONCE per ingest run and its THREE derived fields (advancing/declining/
    flat) are populated ONLY on the row whose trade_date equals the window end (the latest
    day); every other day carries NULL for those three fields (NFR-5 honest empty — never
    fabricate the latest-day snapshot onto historical trade_dates). total_turnover is
    NOT from spot — it is derived from index daily 成交额 (sh000001 + sz399107, fetched
    ONCE per run) so it is available on EVERY trading day, including historical ones.

    Per-source error isolation (AC4, mirrors 8.1's per-item isolation): each source is
    fetched in its own try/except. A failed source is skipped + logged; the other sources
    still contribute to that day's row. The CORE counts (limit-up/down pools) are required —
    if either pool source fails, that day produces NO row (NFR-5: never fabricate the
    missing count). The OPTIONAL sources (margin, dragon-tiger, spot) failing yields a row
    with that field NULL/None (honest empty). A day with ALL core sources failing counts as
    1 failed item; the failure-ratio threshold gates the exit code (FAILURE_THRESHOLD).

    margin_balance_change (P2): the margin endpoints are date-specific, so a day-over-day
    change is computable as total[D] - total[D-1]. The previous day's total is tracked across
    the loop; on the first day in the window, or when either day's margin total is unavailable,
    the change is None. A margin fetch failure resets the prev total to None so the next day's
    diff is NOT computed against stale state.
    """
    start, end = _window(mode, today)
    report = IngestReport(scope="breadth", mode=mode)
    rows: list[MarketBreadthRow] = []

    # P1: fetch spot ONCE — stock_zh_a_spot_em() returns the LATEST trading day only (no date
    # param). We stamp its four derived fields onto ONLY the latest-day row (trade_date == end);
    # every other day gets NULL for these fields (honest empty, never fabricated). A spot fetch
    # failure leaves latest_spot = None → the latest-day row also gets NULL spot fields (NFR-5).
    latest_spot: akc.SpotBreadth | None = None
    try:
        latest_spot = akc.fetch_spot_breadth(end, ak_module=ak_module)
    except Exception as exc:  # spot is optional now: NULL fields on failure, does not drop the day
        report.failures.append(f"spot {end}: {type(exc).__name__}: {exc}")
        log.exception("failed spot (latest-day) %s", end)

    # 两市成交额 per date from index daily 成交额 (sh000001 上证综指 + sz399107 深证综指 = 两市
    # 全市场). Fetched ONCE over the window — HISTORICAL (unlike spot's latest-day-only turnover).
    # Failure → empty dict → every day's total_turnover=None (NFR-5), never blocks the breadth row
    # (per-source isolation, mirrors spot). advancing/declining/flat still come from spot (latest day).
    turnover_by_day: dict[date, Decimal] = {}
    try:
        turnover_by_day = akc.fetch_index_amounts(start=start, end=end, ak_module=ak_module)
    except Exception as exc:
        report.failures.append(f"index_amounts {start}..{end}: {type(exc).__name__}: {exc}")
        log.exception("failed index_amounts %s..%s", start, end)

    # P2: track the previous trading day's margin total to compute the day-over-day diff.
    prev_margin_total: Decimal | None = None

    # Enumerate trading days in the window. We don't have an A-share calendar here, so we
    # walk calendar days and let the pool fetches naturally return empty frames on non-
    # trading days (weekends/holidays) — an empty 涨停池 on a non-trading day is the
    # signal that day has no market. To avoid writing spurious all-zero rows for non-
    # trading days, we require the 涨停池 OR 跌停池 to return a non-empty frame (P9: with
    # spot now NULL on historical days, the guard keys off the date-specific pools only).
    for day in _iter_dates(start, end):
        report.total_items += 1
        is_latest = day == end
        day_spot = latest_spot if is_latest else None
        breadth, day_margin_total = _aggregate_breadth_day(
            day, day_spot, turnover_by_day, prev_margin_total, ak_module, report
        )
        if breadth is None:
            # Core pool sources failed → no row for this day (NFR-5). Already counted as failed.
            # Reset prev margin so the next day's diff isn't computed against stale state.
            prev_margin_total = None
            continue
        rows.append(breadth)
        report.ok_items += 1
        log.info("ok breadth %s: lu=%d ld=%d adv=%s dec=%s turnover=%s",
                 day, breadth.limit_up_count, breadth.limit_down_count,
                 breadth.advancing_count, breadth.declining_count, breadth.total_turnover)
        prev_margin_total = day_margin_total

    if rows:
        with connect(db_url) as conn:
            report.bars_written = upsert_market_breadth(conn, rows)
    return report


def _aggregate_breadth_day(
    day: date,
    spot: akc.SpotBreadth | None,
    turnover_by_day: dict[date, Decimal],
    prev_margin_total: Decimal | None,
    ak_module: akc.AkModule | None,
    report: IngestReport,
) -> tuple[MarketBreadthRow | None, Decimal | None]:
    """Aggregate the breadth sources for one day into a single row (per-source isolation).

    `spot` is the pre-fetched latest-day SpotBreadth, or None for non-latest days (spot fields
    stay NULL on the row). `prev_margin_total` is the prior day's 融资余额 total for the P2 diff.

    Returns (row_or_None, margin_total_for_this_day). row is None if a CORE pool source failed
    (NFR-5). margin_total is this day's balance total (passed back so the caller can thread it
    into the next day's diff); None on a margin fetch failure so the next diff resets.

    Core sources (failure => no row): the three date-specific pools (涨停/跌停/炸板). Spot is no
    longer core — it is NULL on historical days and optional on the latest day. Optional sources
    (margin, dragon-tiger) failing leaves that field None on the returned row.
    """
    # --- core sources (failure => no row for the day) ---
    limit_up: akc.LimitPoolStats | None = None
    limit_down: akc.LimitPoolStats | None = None
    broken_board: akc.LimitPoolStats | None = None

    core_failed = False
    try:
        limit_up = akc.fetch_limit_pool(day, ak_module=ak_module)
    except Exception as exc:  # per-source isolation (AC4)
        report.failures.append(f"limit_up {day}: {type(exc).__name__}: {exc}")
        log.exception("failed limit_up %s", day)
        core_failed = True
    try:
        limit_down = akc.fetch_limit_down_pool(day, ak_module=ak_module)
    except Exception as exc:  # per-source isolation (AC4)
        report.failures.append(f"limit_down {day}: {type(exc).__name__}: {exc}")
        log.exception("failed limit_down %s", day)
        core_failed = True
    try:
        broken_board = akc.fetch_broken_board(day, ak_module=ak_module)
    except Exception as exc:  # per-source isolation (AC4)
        report.failures.append(f"broken_board {day}: {type(exc).__name__}: {exc}")
        log.exception("failed broken_board %s", day)
        core_failed = True

    if core_failed:
        report.failed_items += 1
        return None, None

    # Non-trading day guard (P9): the three date-specific pools are all empty → no market that
    # day → skip (do not write an all-NULL-spot / all-zero-pool row, NFR-5). With spot now NULL
    # on historical days, the guard keys off the date-specific pools only (spot may legitimately
    # be None on a historical trading day that HAS pool data).
    assert limit_up is not None and limit_down is not None and broken_board is not None
    if (
        limit_up.row_count == 0
        and limit_down.row_count == 0
        and broken_board.row_count == 0
    ):
        report.skipped_items += 1
        report.skips.append(f"{day}: non-trading day (all pools empty)")
        log.info("skip %s: non-trading day", day)
        # A non-trading day contributes no margin total to the next day's diff.
        return None, None

    # --- optional sources (failure => None field on the row, honest empty NFR-5) ---
    # P2: margin_balance_change = total[D] - total[D-1]. None when this is the first day in the
    # window (prev_margin_total is None), or when today's total is unavailable.
    margin_change: Decimal | None = None
    day_margin_total: Decimal | None = None
    try:
        margin = akc.fetch_margin(day, ak_module=ak_module)
        day_margin_total = margin.total
        if day_margin_total is not None and prev_margin_total is not None:
            margin_change = day_margin_total - prev_margin_total
    except Exception as exc:  # per-source isolation (AC4)
        report.failures.append(f"margin {day}: {type(exc).__name__}: {exc}")
        log.exception("failed margin %s", day)
        day_margin_total = None  # reset: next day's diff won't use stale state

    dragon_tiger_json: dict[str, object] | None = None
    try:
        dt = akc.fetch_dragon_tiger(day, ak_module=ak_module)
        dragon_tiger_json = akc.dragon_tiger_to_json(dt)
    except Exception as exc:  # per-source isolation (AC4): NULL on failure, honest empty
        report.failures.append(f"dragon_tiger {day}: {type(exc).__name__}: {exc}")
        log.exception("failed dragon_tiger %s", day)
        dragon_tiger_json = None

    return (
        MarketBreadthRow(
            id=_new_id(),
            trade_date=day,
            limit_up_count=limit_up.row_count,
            limit_down_count=limit_down.row_count,
            consecutive_board_max=limit_up.consecutive_max or 0,
            broken_board_count=broken_board.row_count,
            advancing_count=spot.advancing_count if spot is not None else None,
            declining_count=spot.declining_count if spot is not None else None,
            flat_count=spot.flat_count if spot is not None else None,
            total_turnover=turnover_by_day.get(day),
            margin_balance_change=margin_change,
            dragon_tiger=dragon_tiger_json,
            source=SOURCE,
            ingested_at=_utc_now_iso(),
            trace_id=None,
        ),
        day_margin_total,
    )


def _iter_dates(start: date, end: date):
    """Yield each calendar day in [start, end] inclusive (breadth walks days, not codes)."""
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


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
    "ingest_breadth",
    "database_url",
    "Decimal",
]
