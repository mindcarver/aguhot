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
    BREADTH_TRADE_DATE,
    EXPECTED_BREADTH,
    EXPECTED_INDEX_PCT,
    EXPECTED_SECTOR_PCT,
    dt_pool_20260714,
    empty_frame,
    index_daily_em_sh000001,
    index_daily_em_sz399107,
    index_daily_sh000001,
    index_hist_sw_801010,
    lhb_detail_20260714,
    margin_sse_20260714,
    margin_szse_20260714,
    sector_first_info,
    spot_em_20260714,
    zb_pool_20260714,
    zt_pool_20260714,
)


class FakeAk:
    """Fake akshare module returning canned frames. Implements AkModule protocol."""

    def __init__(
        self,
        index_frames: dict[str, object] | None = None,
        sector_frames: dict[str, object] | None = None,
        sector_list: object | None = None,
        *,
        breadth_frames: dict[str, object] | None = None,
    ) -> None:
        self._index = index_frames or {}
        self._sector = sector_frames or {}
        self._list = sector_list
        self._breadth = breadth_frames or {}

    def stock_zh_index_daily(self, symbol: str):  # noqa: ANN001
        return self._index.get(symbol, index_daily_sh000001())

    def stock_zh_index_daily_em(self, symbol: str, start_date: str, end_date: str):  # noqa: ANN001
        # breadth_frames keys: index_em_sh / index_em_sz (canned _em frames carry 成交额).
        if symbol == "sh000001":
            return self._breadth.get("index_em_sh", index_daily_em_sh000001())
        if symbol == "sz399107":
            return self._breadth.get("index_em_sz", index_daily_em_sz399107())
        return empty_frame()

    def sw_index_first_info(self):
        return self._list if self._list is not None else sector_first_info()

    def index_hist_sw(self, symbol: str, period: str):  # noqa: ANN001
        return self._sector.get(symbol, index_hist_sw_801010())

    # --- breadth (story 8.6) ---
    def stock_zt_pool_em(self, date: str):  # noqa: ANN001
        return self._breadth.get("zt", zt_pool_20260714())

    def stock_zt_pool_dtgc_em(self, date: str):  # noqa: ANN001
        return self._breadth.get("dt", dt_pool_20260714())

    def stock_zt_pool_zbgc_em(self, date: str):  # noqa: ANN001
        return self._breadth.get("zb", zb_pool_20260714())

    def stock_zh_a_spot_em(self):
        return self._breadth.get("spot", spot_em_20260714())

    def stock_lhb_detail_em(self, start_date: str, end_date: str):  # noqa: ANN001
        return self._breadth.get("lhb", lhb_detail_20260714())

    def stock_margin_szse(self, date: str):  # noqa: ANN001
        return self._breadth.get("margin_szse", margin_szse_20260714())

    def stock_margin_sse(self, start_date: str, end_date: str):  # noqa: ANN001
        return self._breadth.get("margin_sse", margin_sse_20260714())


import pytest  # noqa: E402 — needed for the autouse fixture below


@pytest.fixture(autouse=True)
def _no_request_throttle(monkeypatch):
    """Disable _call_ak's throttling + real sleeping by default (test speed + deterministic asserts).

    - MIN_REQUEST_INTERVAL=0 ⇒ _throttle is a no-op (no throttle sleeps; retry tests' `[2.0, 4.0]`
      backoff asserts stay unpolluted).
    - time.sleep ⇒ no-op so failure-isolation tests (which make a source raise) don't pay _call_ak's
      REAL retry backoff (was ~6s per failing source ⇒ 120s suite). The retry/throttle tests override
      this with their own sleep-capturing stub.
    """
    monkeypatch.setattr(akc, "MIN_REQUEST_INTERVAL", 0.0)
    monkeypatch.setattr(akc.time, "sleep", lambda *_a, **_k: None)


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


# ===========================================================================
# Breadth tests (story 8.6) — AC3/AC4/AC5. FakeAk, no network, no DB.
# ===========================================================================


def test_fetch_limit_pool_counts_rows_and_max_consecutive():
    """涨停池: row count + max 连板数 (AC4/AC5)."""
    stats = akc.fetch_limit_pool(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert stats.trade_date == BREADTH_TRADE_DATE
    assert stats.row_count == EXPECTED_BREADTH["limit_up_count"]
    assert stats.consecutive_max == EXPECTED_BREADTH["consecutive_board_max"]


def test_fetch_limit_down_pool_counts_rows():
    """跌停池: row count only (consecutive_max None, no 连板数 column)."""
    stats = akc.fetch_limit_down_pool(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert stats.row_count == EXPECTED_BREADTH["limit_down_count"]
    assert stats.consecutive_max is None


def test_fetch_broken_board_counts_rows():
    """炸板池: row count only."""
    stats = akc.fetch_broken_board(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert stats.row_count == EXPECTED_BREADTH["broken_board_count"]
    assert stats.consecutive_max is None


def test_fetch_spot_breadth_counts_advancing_declining_flat_and_turnover():
    """spot: advancing/declining/flat from 涨跌幅 sign + total 成交额 sum (AC5)."""
    b = akc.fetch_spot_breadth(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert b.advancing_count == EXPECTED_BREADTH["advancing_count"]
    assert b.declining_count == EXPECTED_BREADTH["declining_count"]
    assert b.flat_count == EXPECTED_BREADTH["flat_count"]
    assert isinstance(b.total_turnover, Decimal)
    assert str(b.total_turnover) == EXPECTED_BREADTH["total_turnover"]


def test_fetch_index_amounts_sums_both_indices_per_date():
    """AC1: 两市成交额 = sh000001 + sz399107 成交额 per date (HISTORICAL, all days)."""
    m = akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=FakeAk()
    )
    assert m[date(2026, 7, 14)] == Decimal(EXPECTED_BREADTH["market_turnover_20260714"])
    assert m[date(2026, 7, 13)] == Decimal(EXPECTED_BREADTH["market_turnover_20260713"])
    assert m[date(2026, 7, 10)] == Decimal("830000000000")  # 450e9 + 380e9
    # outside the frame range → not present (not fabricated)
    assert date(2026, 7, 7) not in m


def test_fetch_index_amounts_date_missing_in_one_index_is_omitted():
    """AC2: a date present in only ONE index is omitted — no half-sum (NFR-5)."""
    import pandas as pd  # noqa: PLC0415 — local to the test

    sz = index_daily_em_sz399107()
    sz_missing_0710 = sz[sz["日期"] != pd.to_datetime("2026-07-10")].reset_index(drop=True)
    ak = FakeAk(breadth_frames={"index_em_sz": sz_missing_0710})
    m = akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=ak
    )
    # sh has 07-10 but sz now doesn't → omitted (not the sh-only half-sum)
    assert date(2026, 7, 10) not in m
    # both still have 07-14 → present
    assert m[date(2026, 7, 14)] == Decimal(EXPECTED_BREADTH["market_turnover_20260714"])


def test_fetch_index_amounts_empty_or_missing_column_returns_empty():
    """AC2: empty frame / missing 成交额 or 日期 column → empty map (no raise, honest empty).

    The no-amount-column AND no-date-column cases must return {} (never raise a KeyError that
    would null every day's turnover via the outer try/except). Covers column-name drift on
    either column.
    """
    import pandas as pd  # noqa: PLC0415 — local to the test

    # empty frames
    ak_empty = FakeAk(breadth_frames={"index_em_sh": empty_frame(), "index_em_sz": empty_frame()})
    assert akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=ak_empty
    ) == {}

    # rows present but NO 成交额 column (amount col drift) → empty, no raise
    no_amt = pd.DataFrame({"日期": pd.to_datetime(["2026-07-14"]), "收盘": [3180.0]})
    ak_no_amt = FakeAk(breadth_frames={"index_em_sh": no_amt, "index_em_sz": no_amt})
    assert akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=ak_no_amt
    ) == {}

    # rows present but NO 日期 column (date col drift) → empty, no raise
    no_date = pd.DataFrame({"成交额": [4.8e11], "收盘": [3180.0]})
    ak_no_date = FakeAk(breadth_frames={"index_em_sh": no_date, "index_em_sz": no_date})
    assert akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=ak_no_date
    ) == {}


def test_fetch_index_amounts_retries_through_transient_failures(monkeypatch):
    """AC1: a transient ConnectionError on stock_zh_index_daily_em recovers via _with_retry.

    Per symbol, the first 2 calls raise and the 3rd succeeds. fetch_index_amounts must return the
    full summed dict (same as the no-failure path). We assert the recovered VALUES, the per-symbol
    CALL COUNT (proves retry actually happened — not a no-op pass-through), and the backoff DELAYS
    (pins the exponential formula). time.sleep is captured (not waited on).
    """
    delays: list[float] = []
    monkeypatch.setattr(akc.time, "sleep", lambda d, *_a, **_k: delays.append(d))

    calls: dict[str, int] = {}

    class _Flaky(FakeAk):
        def stock_zh_index_daily_em(self, symbol, start_date, end_date):  # noqa: ANN001
            n = calls.get(symbol, 0) + 1
            calls[symbol] = n
            # per symbol: raise on attempts 1 & 2, succeed on attempt 3
            if n < akc.FETCH_RETRY_ATTEMPTS:
                raise ConnectionError("RemoteDisconnected (transient)")
            return super().stock_zh_index_daily_em(symbol, start_date, end_date)

    m = akc.fetch_index_amounts(
        start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=_Flaky()
    )
    # recovered ⇒ full dict, same values as the clean path
    assert m[date(2026, 7, 14)] == Decimal(EXPECTED_BREADTH["market_turnover_20260714"])
    assert m[date(2026, 7, 13)] == Decimal(EXPECTED_BREADTH["market_turnover_20260713"])
    # each symbol retried exactly FETCH_RETRY_ATTEMPTS times (proves retry happened per symbol)
    assert calls == {sym: akc.FETCH_RETRY_ATTEMPTS for sym in akc.MARKET_TURNOVER_INDICES}
    # 2 backoff sleeps per symbol (between 3 attempts), series [2.0, 4.0] — pins exponential formula
    assert delays == [2.0, 4.0, 2.0, 4.0]


def test_fetch_index_amounts_persistent_failure_raises_after_retries(monkeypatch):
    """AC2: persistent failure (eastmoney sustained outage) ⇒ _with_retry exhausts ⇒ raises.

    The raise propagates out of fetch_index_amounts; ingest's per-source try/except turns it into
    total_turnover=None (NFR-5). Retries are bounded — we assert the per-symbol call count equals
    FETCH_RETRY_ATTEMPTS (pins the load-bearing termination bound; a `while True` regression fails here).
    """
    delays: list[float] = []
    monkeypatch.setattr(akc.time, "sleep", lambda d, *_a, **_k: delays.append(d))

    calls: dict[str, int] = {}

    class _Dead(FakeAk):
        def stock_zh_index_daily_em(self, symbol, start_date, end_date):  # noqa: ANN001
            calls[symbol] = calls.get(symbol, 0) + 1
            raise ConnectionError("push2his down (sustained)")

    with pytest.raises(ConnectionError):
        akc.fetch_index_amounts(
            start=date(2026, 7, 10), end=date(2026, 7, 14), ak_module=_Dead()
        )
    # first symbol exhausted all FETCH_RETRY_ATTEMPTS before raising (bounded — no while-True regression)
    assert calls[akc.MARKET_TURNOVER_INDICES[0]] == akc.FETCH_RETRY_ATTEMPTS
    # backoff series [2.0, 4.0] before the final (un-slept) attempt
    assert delays == [2.0, 4.0]


def test_throttle_paces_consecutive_calls(monkeypatch):
    """AC1: _throttle enforces MIN_REQUEST_INTERVAL between calls (caps aggregate request rate).

    The whole point of the rate-limit: prevent the back-to-back burst that triggers eastmoney's IP
    ban. With interval>0, a second call immediately after the first MUST sleep ~interval. We override
    the autouse-disabled interval with a tiny value for speed.
    """
    monkeypatch.setattr(akc, "MIN_REQUEST_INTERVAL", 0.05)
    sleeps: list[float] = []
    monkeypatch.setattr(akc.time, "sleep", lambda d, *_a, **_k: sleeps.append(d))
    monkeypatch.setattr(akc, "_last_call_at", 0.0)  # first call: elapsed huge ⇒ no sleep

    akc._throttle()
    assert sleeps == []  # first call after a long gap ⇒ no wait
    akc._throttle()
    # second call immediately after ⇒ waited ≈ interval (0 < wait ≤ interval)
    assert sleeps and 0 < sleeps[0] <= 0.05


def test_throttle_noop_when_interval_zero(monkeypatch):
    """AC2: MIN_REQUEST_INTERVAL=0 ⇒ _throttle never sleeps (opt-out / test default)."""
    monkeypatch.setattr(akc, "MIN_REQUEST_INTERVAL", 0.0)
    sleeps: list[float] = []
    monkeypatch.setattr(akc.time, "sleep", lambda *_a, **_k: sleeps.append(0))
    monkeypatch.setattr(akc, "_last_call_at", 0.0)

    akc._throttle()
    akc._throttle()
    assert sleeps == []


def test_call_ak_throttles_before_each_retry_attempt(monkeypatch):
    """Composition: _call_ak engages _throttle() before EACH attempt (the central claim of the change).

    Without this, a refactor that drops `_throttle()` from the retry loop ships green (the direct
    _throttle tests still pass; the retry tests run with throttle disabled). Here we drive _call_ak
    through a fail-then-succeed fn with throttle ON and assert a throttle sleep fires before EACH
    attempt (distinguished from the 2.0s backoff sleep by magnitude).
    """
    monkeypatch.setattr(akc, "MIN_REQUEST_INTERVAL", 0.05)  # re-enable throttle (autouse disables)
    sleeps: list[float] = []
    monkeypatch.setattr(akc.time, "sleep", lambda d, *_a, **_k: sleeps.append(d))
    # seed _last_call_at to "just now" so the FIRST attempt's throttle engages (the 0.0 module
    # sentinel means cold-start first-call never waits — correct, but here we want to observe both
    # attempts pacing).
    monkeypatch.setattr(akc, "_last_call_at", akc.time.monotonic())

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("transient")
        return "ok"

    result = akc._call_ak("flaky_source", flaky)
    assert result == "ok"
    assert calls["n"] == 2  # failed once, succeeded on retry
    # throttle sleeps (≤ interval 0.05) fire before EACH of the 2 attempts; one 2.0s backoff between.
    throttle_sleeps = [s for s in sleeps if s <= 0.05]
    backoff_sleeps = [s for s in sleeps if s > 0.05]
    assert len(throttle_sleeps) == 2  # one per attempt — pins the composition
    assert backoff_sleeps == [2.0]


def test_fetch_dragon_tiger_aggregates_listings():
    """龙虎榜: stock count + net buy sum + topStocks (AC5)."""
    dt = akc.fetch_dragon_tiger(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert dt.stock_count == EXPECTED_BREADTH["lhb_stock_count"]
    assert str(dt.institutional_net_buy) == EXPECTED_BREADTH["lhb_net_sum"]
    assert dt.hot_money_net_buy == Decimal("0")
    assert len(dt.top_stocks) == 2
    # the golden-example Json shape
    j = akc.dragon_tiger_to_json(dt)
    assert j["stockCount"] == 2
    assert isinstance(j["topStocks"], list)
    assert j["topStocks"][0]["code"] == "000001"


def test_fetch_dragon_tiger_empty_frame_is_honest_zero_not_null():
    """AC3: a day with no 龙虎榜 listings -> honest zero object ({stockCount:0,...}), not NULL."""
    ak = FakeAk(breadth_frames={"lhb": empty_frame()})
    dt = akc.fetch_dragon_tiger(BREADTH_TRADE_DATE, ak_module=ak)
    assert dt.stock_count == 0
    assert dt.institutional_net_buy == Decimal("0")
    assert dt.top_stocks == []
    j = akc.dragon_tiger_to_json(dt)
    assert j["stockCount"] == 0


def test_dragon_tiger_to_json_caps_top_stocks_but_keeps_full_count():
    """P4: topStocks list capped to DRAGON_TIGER_TOP_N; stockCount/aggregate nets UNCAPPED.

    A heavy listing day (25 stocks) must produce topStocks of length 20 (capped), but
    stockCount stays 25 (the full listing count) and institutionalNetBuy reflects the full
    net-buy sum (not the sum of the capped list).
    """
    import pandas as pd

    n = akc.DRAGON_TIGER_TOP_N + 5  # 25 stocks > cap(20)
    codes = [f"{i:06d}" for i in range(n)]
    # net buy descends so row 0 has the largest net; the cap must keep rows 0..19 after sort
    nets = [Decimal(10000000) - i * 1000 for i in range(n)]
    df = pd.DataFrame(
        {
            "序号": list(range(1, n + 1)),
            "代码": codes,
            "名称": [f"s{i}" for i in range(n)],
            "收盘价": [10.0] * n,
            "涨跌幅": [5.0] * n,
            "龙虎榜净买额": [float(x) for x in nets],
            "上榜原因": ["x"] * n,
        }
    )
    ak = FakeAk(breadth_frames={"lhb": df})
    dt = akc.fetch_dragon_tiger(BREADTH_TRADE_DATE, ak_module=ak)
    j = akc.dragon_tiger_to_json(dt)
    # cap applies only to the per-stock list
    assert len(j["topStocks"]) == akc.DRAGON_TIGER_TOP_N
    # aggregates UNCAPPED: full listing count + full net-buy sum
    assert j["stockCount"] == n
    assert Decimal(j["institutionalNetBuy"]) == sum(nets)
    # the cap kept the TOP 20 by net buy (desc): the largest net (10000000) must be present,
    # the smallest net (10000000 - 24*1000 = 9976000, the 25th) must be absent.
    kept_codes = {s["code"] for s in j["topStocks"]}
    assert codes[0] in kept_codes  # largest net kept
    assert codes[-1] not in kept_codes  # smallest net (25th) dropped by the cap


def test_fetch_margin_sums_balance_across_exchanges():
    """融资融券: sums 融资余额 across SSE+SZSE into one yuan total (P2: returns total, not change)."""
    m = akc.fetch_margin(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert m.trade_date == BREADTH_TRADE_DATE
    # the wrapper now returns the balance TOTAL (date-specific), not a discarded change.
    assert m.total is not None
    assert m.total == Decimal(EXPECTED_BREADTH["margin_total"])  # 8e9 (SSE) + 4e9 (SZSE) = 12e9 yuan


def test_fetch_margin_both_exchanges_missing_returns_none_total():
    """AC3: margin source unavailable -> total None (does not fabricate)."""
    ak = FakeAk(breadth_frames={"margin_sse": empty_frame(), "margin_szse": empty_frame()})
    m = akc.fetch_margin(BREADTH_TRADE_DATE, ak_module=ak)
    assert m.total is None


def test_fetch_margin_normalizes_szse_yi_yuan_to_yuan():
    """SSE 融资余额 (yuan) + SZSE 融资余额 (亿元) are normalized to a common yuan sum.

    SSE fixture = 8e9 yuan; SZSE fixture = 40 亿元 = 4e9 yuan → total 12e9 yuan. This locks
    down the unit-mismatch handling (SSE reports yuan, SZSE reports 亿元 ×1e8). Now exercised
    via the public fetch_margin (P2 made the helper's output actually used, not discarded).
    """
    m = akc.fetch_margin(BREADTH_TRADE_DATE, ak_module=FakeAk())
    assert m.total == Decimal(EXPECTED_BREADTH["margin_total"])


def test_ingest_breadth_aggregates_sources_into_single_row(monkeypatch):
    """AC1/AC4: ingest_breadth aggregates the 5 sources into ONE row per trading day.

    We stub connect/upsert so no DB is touched; the window is narrowed via today= so only
    2026-07-14 is in range. The captured MarketBreadthRow must carry the summed counts.
    """
    from market_sidecar import ingest as ing_mod

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=FakeAk(), today=BREADTH_TRADE_DATE
    )
    assert rep.failed_items == 0
    assert rep.exit_code == 0
    # smoke window = SMOKE_DAYS calendar days; only 07-14 has market data (the other
    # calendar days in the window are non-trading days → skipped). At least the 07-14 row.
    assert len(captured) >= 1
    row = next(r for r in captured if r.trade_date == BREADTH_TRADE_DATE)
    assert row.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
    assert row.limit_down_count == EXPECTED_BREADTH["limit_down_count"]
    assert row.consecutive_board_max == EXPECTED_BREADTH["consecutive_board_max"]
    assert row.broken_board_count == EXPECTED_BREADTH["broken_board_count"]
    assert row.advancing_count == EXPECTED_BREADTH["advancing_count"]
    assert row.declining_count == EXPECTED_BREADTH["declining_count"]
    assert row.flat_count == EXPECTED_BREADTH["flat_count"]
    # total_turnover is now index-em derived (两市成交额 = sh000001 + sz399107), NOT spot.
    assert str(row.total_turnover) == EXPECTED_BREADTH["market_turnover_20260714"]
    assert row.source == "akshare"
    assert row.dragon_tiger is not None
    assert row.dragon_tiger["stockCount"] == EXPECTED_BREADTH["lhb_stock_count"]


def test_ingest_breadth_per_source_isolation_optional_source_failure_keeps_row(monkeypatch):
    """AC4: an OPTIONAL source (dragon_tiger) failing → row still written, field NULL.

    The per-source try/except isolates the failure; the other 4 sources still aggregate
    into the day's row. dragon_tiger becomes None (honest empty, NFR-5), NOT a dropped row.
    """
    from market_sidecar import ingest as ing_mod

    class _BoomLhb(FakeAk):
        # Match the real protocol: stock_lhb_detail_em(self, start_date, end_date).
        def stock_lhb_detail_em(self, start_date: str, end_date: str):  # noqa: ANN001
            raise RuntimeError("lhb backend down")

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=_BoomLhb(), today=BREADTH_TRADE_DATE
    )
    row = next(r for r in captured if r.trade_date == BREADTH_TRADE_DATE)
    # row still written (lhb is optional); dragon_tiger is NULL on fetch failure
    assert row is not None
    assert row.dragon_tiger is None
    # core counts still present
    assert row.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
    # the failed source is recorded, but exit code is 0 (failure ratio under threshold)
    assert any("dragon_tiger" in f for f in rep.failures)
    assert rep.exit_code == 0


def test_ingest_breadth_index_amounts_failure_nulls_turnover_keeps_row(monkeypatch):
    """AC2: index_amounts (total_turnover source) failing → total_turnover NULL, row still written.

    The fetch_index_amounts try/except in ingest_breadth isolates the failure: every day's
    total_turnover=None (NFR-5, never fabricated), but the breadth row is still written with
    its other fields intact (core counts, advancing/declining/flat from spot, dragon_tiger, margin).
    """
    from market_sidecar import ingest as ing_mod

    class _BoomIndexEm(FakeAk):
        def stock_zh_index_daily_em(self, symbol: str, start_date: str, end_date: str):  # noqa: ANN001
            raise RuntimeError("index em backend down")

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=_BoomIndexEm(), today=BREADTH_TRADE_DATE
    )
    row = next(r for r in captured if r.trade_date == BREADTH_TRADE_DATE)
    # row still written; total_turnover is NULL on index-amount fetch failure
    assert row is not None
    assert row.total_turnover is None
    # other fields intact
    assert row.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
    assert row.advancing_count == EXPECTED_BREADTH["advancing_count"]
    assert row.dragon_tiger is not None
    assert any("index_amounts" in f for f in rep.failures)
    assert rep.exit_code == 0


def test_ingest_breadth_core_source_failure_drops_day(monkeypatch):
    """AC4/NFR-5: a CORE source (涨停池) failing → NO row for that day (never fabricate).

    The date-specific pool counts (limit_up/down, etc.) are NOT NULL in the schema; if a pool
    source fails we cannot write the row honestly, so the day is absent from the table rather
    than carrying a fake zero. (Spot is no longer core — it's NULL on historical days by design.)
    """
    from market_sidecar import ingest as ing_mod

    class _BoomZt(FakeAk):
        def stock_zt_pool_em(self, date: str):  # noqa: ANN001
            raise RuntimeError("zt backend down")

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=_BoomZt(), today=BREADTH_TRADE_DATE
    )
    # 07-14 must NOT be in the captured rows (core source failed)
    assert all(r.trade_date != BREADTH_TRADE_DATE for r in captured)
    assert any("limit_up" in f for f in rep.failures)


def test_ingest_breadth_non_trading_day_skipped_not_written(monkeypatch):
    """A non-trading day (all pools empty, no spots) is skipped, not written as all-zero."""
    from market_sidecar import ingest as ing_mod

    ak = FakeAk(
        breadth_frames={
            "zt": empty_frame(),
            "dt": empty_frame(),
            "zb": empty_frame(),
            "spot": empty_frame(),
        }
    )
    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(mode="smoke", ak_module=ak, today=BREADTH_TRADE_DATE)
    # no rows written (every day in the window is a non-trading day under these empties)
    assert captured == []
    assert rep.bars_written == 0
    assert rep.exit_code == 0


def test_ingest_breadth_no_fabrication_on_historical_day_spot_only_on_latest(monkeypatch):
    """P1 (HIGH): the latest-day spot snapshot is NEVER fabricated onto historical trade_dates.

    stock_zh_a_spot_em() takes NO date and returns ONLY the latest trading day's snapshot. The
    ingest loop must fetch spot ONCE and populate the three spot-derived fields
    (advancing/declining/flat) ONLY on the row whose trade_date == window end (today);
    every historical day carries None for those three fields (honest empty, NFR-5).
    total_turnover is NOT a spot field — it is index-em derived (sh000001 + sz399107) and is
    available on any trading day whose index bars exist, historical or latest.

    Under FakeAk every calendar day in the window returns NON-empty date-specific pools, so each
    day produces a row. We then assert: the latest-day row has populated spot fields; EVERY other
    row has None for all four spot fields — i.e. the latest-day counts are NOT stamped onto past
    trade_dates. The date-specific pools ARE fetched per-day and remain populated on every row.
    """
    from market_sidecar import ingest as ing_mod

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=FakeAk(), today=BREADTH_TRADE_DATE
    )
    assert rep.failed_items == 0
    # the window spans multiple calendar days, all with non-empty pools → multiple rows
    assert len(captured) >= 2
    latest = next(r for r in captured if r.trade_date == BREADTH_TRADE_DATE)
    historical = [r for r in captured if r.trade_date != BREADTH_TRADE_DATE]
    assert len(historical) >= 1

    # LATEST day: spot fields populated from the single latest-day fetch
    assert latest.advancing_count == EXPECTED_BREADTH["advancing_count"]
    assert latest.declining_count == EXPECTED_BREADTH["declining_count"]
    assert latest.flat_count == EXPECTED_BREADTH["flat_count"]
    # total_turnover is index-em derived (NOT spot): 两市成交额 for the latest day too.
    assert str(latest.total_turnover) == EXPECTED_BREADTH["market_turnover_20260714"]

    # HISTORICAL days: the three SPOT-derived fields (advancing/declining/flat) MUST be None
    # (never fabricated onto past trade_dates). total_turnover is NOT a spot field anymore — it
    # is index-em derived and may be present on a historical day whose index bars exist (e.g.
    # 07-10/07-13) — so it is NOT part of this "no fabrication" assertion.
    for r in historical:
        assert r.advancing_count is None, f"fabricated advancing on historical {r.trade_date}"
        assert r.declining_count is None, f"fabricated declining on historical {r.trade_date}"
        assert r.flat_count is None, f"fabricated flat on historical {r.trade_date}"

    # The date-specific pools ARE per-day and remain populated on historical rows (not nulled).
    for r in historical:
        assert r.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
        assert r.limit_down_count == EXPECTED_BREADTH["limit_down_count"]

    # total_turnover is index-em derived (NOT spot) — a historical day WITH index bars gets the
    # REAL summed value (the headline outcome of this change), while a historical day outside the
    # index frame stays None (NFR-5 honest empty, never fabricated). This positively verifies the
    # contract the "no fabrication" assertion above no longer covers for turnover.
    by_date = {r.trade_date: r for r in historical}
    assert str(by_date[date(2026, 7, 13)].total_turnover) == EXPECTED_BREADTH["market_turnover_20260713"]
    assert str(by_date[date(2026, 7, 10)].total_turnover) == "830000000000"  # 450e9 + 380e9
    # 07-09 is in the window but not in the index-em frame → None (not fabricated)
    assert by_date[date(2026, 7, 9)].total_turnover is None


def test_ingest_breadth_spot_fetch_failure_nulls_latest_day_spot_not_dropped(monkeypatch):
    """P1/NFR-5: a latest-day spot fetch failure → NULL spot fields on the latest row (not dropped).

    Spot is no longer a core source. If stock_zh_a_spot_em raises, the latest-day row is still
    written (the date-specific pools succeeded) but its three spot fields (advancing/declining/
    flat) are None — honest empty. total_turnover is NOT a spot field (index-em derived), so a
    spot failure does NOT null it — it stays populated from the index amounts.
    """
    from market_sidecar import ingest as ing_mod

    class _BoomSpot(FakeAk):
        def stock_zh_a_spot_em(self):
            raise RuntimeError("spot backend down")

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    rep = ing_mod.ingest_breadth(
        mode="smoke", ak_module=_BoomSpot(), today=BREADTH_TRADE_DATE
    )
    latest = next(r for r in captured if r.trade_date == BREADTH_TRADE_DATE)
    # row still written (spot is optional now); spot fields NULL on fetch failure
    assert latest is not None
    assert latest.advancing_count is None
    assert latest.declining_count is None
    assert latest.flat_count is None
    # total_turnover survives (index-em derived, spot-independent) for the latest day
    assert str(latest.total_turnover) == EXPECTED_BREADTH["market_turnover_20260714"]
    # date-specific pools still present
    assert latest.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
    # the failure is recorded
    assert any("spot" in f for f in rep.failures)


def test_ingest_breadth_margin_balance_change_diffed_day_over_day(monkeypatch):
    """P2: margin_balance_change = total[D] - total[D-1]; None on the first day, populated after.

    The margin endpoints are date-specific, so a day-over-day change is computable. Under FakeAk
    every day returns the SAME margin fixture (total = 12e9 yuan), so for consecutive trading days
    the diff is 0 (non-null). The FIRST trading day in the window has no prior → None. We assert:
    the first written row has margin_balance_change is None; at least one later row has a non-null
    (zero) diff. This proves the diff is computed and the prev-total is threaded across days.
    """
    from market_sidecar import ingest as ing_mod

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    ing_mod.ingest_breadth(mode="smoke", ak_module=FakeAk(), today=BREADTH_TRADE_DATE)
    # multiple rows (every calendar day has non-empty pools under FakeAk)
    assert len(captured) >= 2
    by_date = {r.trade_date: r for r in captured}
    ordered = sorted(by_date.values(), key=lambda r: r.trade_date)
    # FIRST written row: no prior day in the window → margin_balance_change is None
    assert ordered[0].margin_balance_change is None
    # at least one later row has a NON-None diff (0.00 because the fixture total is identical
    # across days — the point is the diff is COMPUTED, not discarded as the old code did)
    later_diffs = [r.margin_balance_change for r in ordered[1:]]
    assert any(d is not None for d in later_diffs), "no day-over-day margin diff was computed"
    assert all(d == Decimal("0") for d in later_diffs if d is not None)


def test_ingest_breadth_margin_fetch_failure_resets_prev_total(monkeypatch):
    """P2/NFR-5: a margin fetch failure on day D resets prev total so day D+1's diff is None.

    Without the reset, day D+1 would diff its total against the STALE day D-1 total — silently
    wrong. We force a failure on the MIDDLE day and assert the day after it has a None diff
    (not a diff against stale state).
    """
    from market_sidecar import ingest as ing_mod

    # window = 07-07..07-14. Fail margin on 07-10 (middle). The fake returns the same fixture
    # for every date, so without the reset, 07-11 would diff against 07-09's total (stale).
    boom_day = "20260710"

    class _BoomMarginMid(FakeAk):
        def stock_margin_sse(self, start_date: str, end_date: str):  # noqa: ANN001
            if start_date == boom_day:
                raise RuntimeError("sse margin down on 07-10")
            return super().stock_margin_sse(start_date, end_date)

        def stock_margin_szse(self, date: str):  # noqa: ANN001
            if date == boom_day:
                raise RuntimeError("szse margin down on 07-10")
            return super().stock_margin_szse(date)

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    ing_mod.ingest_breadth(mode="smoke", ak_module=_BoomMarginMid(), today=BREADTH_TRADE_DATE)
    by_date = {r.trade_date: r for r in captured}
    # 07-10 itself: margin fetch failed → day_margin_total None → diff None (no prior usable)
    assert by_date[date(2026, 7, 10)].margin_balance_change is None
    # 07-11 (the day AFTER the failure): prev total was reset to None → diff must be None,
    # NOT a stale diff against 07-09's total. This is the reset guard.
    assert by_date[date(2026, 7, 11)].margin_balance_change is None
    # 07-12 recovers: both today's and 07-11's totals are present → diff computed (0.00)
    assert by_date[date(2026, 7, 12)].margin_balance_change == Decimal("0")


def test_ingest_breadth_historical_non_trading_day_still_skipped_with_null_spot(monkeypatch):
    """P9: after P1, a historical NON-trading day (empty date-specific pools + null spot) is still
    skipped — not written as a row with NULL spot + zero pools. And a historical TRADING day
    (non-empty pools) is still written. The guard now keys off pools only (spot is null on history).
    """
    from market_sidecar import ingest as ing_mod
    import pandas as pd

    # A fake where pools are NON-empty ONLY for 07-13 and 07-14 (trading days); empty on all
    # other calendar days (non-trading days). Spot is fetched once (latest day only).
    trade_dates = {"20260713", "20260714"}
    zt = zt_pool_20260714()
    dt = dt_pool_20260714()
    zb = zb_pool_20260714()
    empty = empty_frame()

    class _CalendarFake(FakeAk):
        def stock_zt_pool_em(self, date: str):  # noqa: ANN001
            return zt if date in trade_dates else empty

        def stock_zt_pool_dtgc_em(self, date: str):  # noqa: ANN001
            return dt if date in trade_dates else empty

        def stock_zt_pool_zbgc_em(self, date: str):  # noqa: ANN001
            return zb if date in trade_dates else empty

    captured: list = []
    monkeypatch.setattr(
        ing_mod, "upsert_market_breadth", lambda conn, rows: captured.extend(rows) or len(rows)
    )
    monkeypatch.setattr(ing_mod, "connect", lambda *_a, **_k: _FakeConn())

    ing_mod.ingest_breadth(mode="smoke", ak_module=_CalendarFake(), today=BREADTH_TRADE_DATE)
    written_dates = {r.trade_date for r in captured}
    # ONLY the two trading days are written; the non-trading days in the window are skipped
    assert written_dates == {date(2026, 7, 13), date(2026, 7, 14)}
    # 07-13 is a historical trading day (non-latest): pools populated, spot fields NULL
    r13 = next(r for r in captured if r.trade_date == date(2026, 7, 13))
    assert r13.limit_up_count == EXPECTED_BREADTH["limit_up_count"]
    assert r13.advancing_count is None  # spot is latest-day-only → historical day NULL
    # 07-14 is the latest day: spot fields populated
    r14 = next(r for r in captured if r.trade_date == date(2026, 7, 14))
    assert r14.advancing_count == EXPECTED_BREADTH["advancing_count"]


# ===========================================================================
# P8 — breadth SQL contract test. ALWAYS RUNS (no PG, no network). Guards the
# idempotency clause + the null/JSON adaptation even when test_upsert.py auto-skips
# because DATABASE_URL is missing from the subprocess env.
# ===========================================================================


def test_breadth_upsert_sql_contract_idempotency_and_null_adaptation():
    """P8: pin the breadth upsert SQL contract + the dragon_tiger null/JSON adaptation.

    These assertions run with ZERO infra (no PG, no network) so the contract is guarded even
    when the PG-backed test_upsert.py module auto-skips due to a missing DATABASE_URL in the
    subprocess env. Two invariants:
      1. Idempotency: _BREADTH_UPSERT contains ON CONFLICT ("trade_date") DO NOTHING.
      2. NULL vs JSON: the params builder binds a NULL dragon_tiger as Python None (→ SQL NULL),
         NOT as Json(None) (which would adapt to a JSONB scalar 'null'). A dict binds as Json(...).
    """
    from psycopg.types.json import Json

    from market_sidecar import db as db_mod
    from market_sidecar.db import MarketBreadthRow

    # 1. idempotency clause present: ON CONFLICT on the trade_date unique key, DO NOTHING.
    # Quoting in the actual SQL is unquoted (trade_date is a lowercase, non-reserved name so
    # Postgres needs no quotes); we assert the clause exists with the right column + action,
    # tolerating quote style so the test isn't brittle to a cosmetic re-quote.
    import re

    assert re.search(
        r'ON CONFLICT\s+\(?["]?trade_date["]?\)?\s+DO NOTHING',
        db_mod._BREADTH_UPSERT,
    ), "breadth upsert must be idempotent on trade_date (ON CONFLICT ... DO NOTHING)"

    # 2a. a null dragon_tiger binds as Python None (→ SQL NULL), NOT Json(None)
    null_row = MarketBreadthRow(
        id="x", trade_date=date(2026, 7, 14),
        limit_up_count=1, limit_down_count=0, consecutive_board_max=0, broken_board_count=0,
        advancing_count=None, declining_count=None, flat_count=None, total_turnover=None,
        margin_balance_change=None, dragon_tiger=None,
        source="akshare", ingested_at="2026-07-16T00:00:00+00:00", trace_id=None,
    )
    params_null = db_mod._breadth_params(null_row)
    assert params_null["dragon_tiger"] is None
    assert not isinstance(params_null["dragon_tiger"], Json)

    # 2b. a dict dragon_tiger binds as Json(...) (→ JSONB), with the dict preserved inside
    dict_row = MarketBreadthRow(
        id="y", trade_date=date(2026, 7, 15),
        limit_up_count=2, limit_down_count=1, consecutive_board_max=1, broken_board_count=1,
        advancing_count=3, declining_count=2, flat_count=1, total_turnover=Decimal("1.0"),
        margin_balance_change=None, dragon_tiger={"stockCount": 2, "topStocks": []},
        source="akshare", ingested_at="2026-07-16T00:00:00+00:00", trace_id=None,
    )
    params_dict = db_mod._breadth_params(dict_row)
    assert isinstance(params_dict["dragon_tiger"], Json)
    assert params_dict["dragon_tiger"].obj == {"stockCount": 2, "topStocks": []}
