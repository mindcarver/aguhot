"""test_parse.py — deterministic parse/pct_change tests on fixtures (no network, no DB).

Mirrors spec-1-4's "RSS adapter verified via fixture, not live network" precedent.
Exercises akshare_client parsing + windowing + pct_change derivation against the
canned fixtures in src/market_sidecar/fixtures/, via a fake ak module.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from market_sidecar import akshare_client as akc
from market_sidecar.fixtures import (
    EXPECTED_INDEX_PCT,
    EXPECTED_SECTOR_PCT,
    index_daily_sh000001,
    index_hist_sw_801010,
    sector_first_info,
)


class FakeAk:
    """Fake akshare module returning canned frames. Implements AkModule protocol."""

    def __init__(
        self,
        index_frames: dict[str, object] | None = None,
        sector_frames: dict[str, object] | None = None,
        sector_list: object | None = None,
    ) -> None:
        self._index = index_frames or {}
        self._sector = sector_frames or {}
        self._list = sector_list

    def stock_zh_index_daily(self, symbol: str):  # noqa: ANN001
        return self._index.get(symbol, index_daily_sh000001())

    def sw_index_first_info(self):
        return self._list if self._list is not None else sector_first_info()

    def index_hist_sw(self, symbol: str, period: str):  # noqa: ANN001
        return self._sector.get(symbol, index_hist_sw_801010())


# --- index parsing + pct_change ---


def test_fetch_index_daily_derives_pct_change_and_drops_first_row():
    """AC5: fixture parse -> IndexRow with Decimal pct_change; first row dropped."""
    rows = akc.fetch_index_daily("sh000001", ak_module=FakeAk())
    # 6 fixture rows -> first dropped -> 5 bars with pct_change
    assert len(rows) == 5
    by_date = {r.trade_date: r for r in rows}
    # the first trading day (2026-07-07) must be absent (no prior close)
    assert date(2026, 7, 7) not in by_date
    # every remaining bar has a non-None Decimal pct_change
    for r in rows:
        assert r.pct_change is not None
        assert isinstance(r.pct_change, Decimal)
        assert isinstance(r.close, Decimal)
    # exact derived pct_change values (rounded 4dp)
    for d, expected in EXPECTED_INDEX_PCT.items():
        assert str(by_date[d].pct_change) == expected, f"pct_change on {d}"


def test_fetch_index_daily_date_window():
    """Inclusive [start, end] windowing on trade_date."""
    rows = akc.fetch_index_daily(
        "sh000001",
        start_date=date(2026, 7, 9),
        end_date=date(2026, 7, 13),
        ak_module=FakeAk(),
    )
    # window 07-09..07-13 keeps closes [100,99,99,100] BUT pct_change derivation
    # needs the prior close: the first in-window row (07-09 close 99) has no
    # in-window prior -> dropped -> 3 bars (07-10,07-13,... up to 07-13)
    # in-window rows after first: 07-10(99),07-13(100) -> wait recompute:
    # window rows close seq: [99(09),99(10),100(13)] (07-14 excluded)
    # pct: drop 09 -> 10: (99-99)/99=0, 13: (100-99)/99=1.0101 -> 2 bars
    assert [r.trade_date for r in rows] == [date(2026, 7, 10), date(2026, 7, 13)]
    assert str(rows[0].pct_change) == "0.0000"
    assert str(rows[1].pct_change) == "1.0101"


def test_fetch_index_daily_single_row_window_yields_empty():
    """A one-row window has no prior close -> empty (do not fabricate, NFR-5)."""
    rows = akc.fetch_index_daily(
        "sh000001",
        start_date=date(2026, 7, 7),
        end_date=date(2026, 7, 7),
        ak_module=FakeAk(),
    )
    assert rows == []


def test_fetch_index_daily_skips_zero_prior_close():
    """If a prior close is 0, that bar is skipped (no division by zero, NFR-5)."""
    import pandas as pd

    from market_sidecar.fixtures import index_daily_sh000001

    base = index_daily_sh000001()
    # inject a 0 close on the 2nd row to force a zero-prior on the 3rd
    df = base.copy()
    df.loc[1, "close"] = 0.0  # 2026-07-08 close -> 0
    ak = FakeAk(index_frames={"sh000001": df})
    rows = akc.fetch_index_daily("sh000001", ak_module=ak)
    # 07-09 (close 99) had prev close 0 -> skipped; 07-08 itself had a normal
    # prev (100) so it is kept with a computed pct (but 0 close is fine).
    dates = [r.trade_date for r in rows]
    assert date(2026, 7, 9) not in dates  # the zero-prev bar dropped


# --- sector list + parsing ---


def test_list_sectors_strips_si_suffix_and_keeps_name():
    """sw_index_first_info -> SectorMeta with bare code + si_code + name."""
    metas = akc.list_sectors(ak_module=FakeAk())
    assert len(metas) == 3
    first = metas[0]
    assert first.code == "801010"
    assert first.si_code == "801010.SI"
    assert first.name == "农林牧渔"


def test_fetch_sector_daily_derives_pct_change():
    """index_hist_sw frame -> SectorRow with Decimal pct_change; first row dropped."""
    sector = akc.SectorMeta(code="801010", si_code="801010.SI", name="农林牧渔")
    rows = akc.fetch_sector_daily(sector, ak_module=FakeAk())
    # 5 fixture rows -> first dropped -> 4 bars
    assert len(rows) == 4
    by_date = {r.trade_date: r for r in rows}
    assert date(2026, 7, 8) not in by_date  # first row dropped
    for r in rows:
        assert r.sector_code == "801010"
        assert r.sector_name == "农林牧渔"
        assert r.pct_change is not None
        assert isinstance(r.close, Decimal)
    for d, expected in EXPECTED_SECTOR_PCT.items():
        assert str(by_date[d].pct_change) == expected, f"sector pct on {d}"


# --- ingest orchestration with fakes (no DB) ---


def test_ingest_indices_uses_fake_and_builds_bars(monkeypatch):
    """ingest_indices with a fake ak_module + a no-op DB produces a sane report.

    We stub connect/upsert so no DB is touched; this validates per-item isolation
    and report bookkeeping (the DB upsert path is tested in test_upsert.py).
    """
    from market_sidecar import ingest as ing_mod

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_index_bars", lambda conn, bars: captured.extend(bars) or len(bars)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_indices(
        mode="incremental", ak_module=FakeAk(), today=date(2026, 7, 14)
    )
    # BROAD_INDICES has 3 codes; the fake returns the same sh000001 frame for all.
    assert rep.total_items == 3
    assert rep.ok_items == 3
    assert rep.failed_items == 0
    assert rep.exit_code == 0
    assert len(captured) == 15  # 3 indices * 5 bars each
    # every captured bar is a db.IndexBar with source akshare + UUIDv7 id
    from market_sidecar.db import IndexBar

    for b in captured:
        assert isinstance(b, IndexBar)
        assert b.source == "akshare"
        assert len(b.id) >= 26  # uuid7 str


class _FakeConn:
    """No-op connection for ingest orchestration tests."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False
