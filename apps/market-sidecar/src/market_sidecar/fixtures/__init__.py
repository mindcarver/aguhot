"""Canned AkShare-shaped fixtures for deterministic tests (no network).

These mirror the EXACT frame shapes returned by the verified akshare 1.18.64
functions (see akshare_client.py probe record). The fake ak module in
tests/test_parse.py returns these so the parsing + pct_change logic is exercised
against real column names without touching eastmoney.

Fixture scope is deliberately tiny (a handful of trading days) — enough to
validate windowing, pct_change derivation, and the "first row dropped" rule.
"""

from __future__ import annotations

import pandas as pd
from datetime import date


def index_daily_sh000001() -> pd.DataFrame:
    """Canned stock_zh_index_daily(symbol='sh000001') shape: date/open/high/low/close/volume.

    6 trading days; close sequence chosen so pct_change values are exact:
      100 -> 110 (+10%) -> 99 (-10%) -> 99 (0%) -> 100 (+1.0101%) -> 105 (+5%)
    """
    return pd.DataFrame(
        {
            "date": pd.to_datetime(
                [
                    "2026-07-07",
                    "2026-07-08",
                    "2026-07-09",
                    "2026-07-10",
                    "2026-07-13",
                    "2026-07-14",
                ]
            ),
            "open": [99.0, 109.0, 100.0, 99.0, 99.5, 100.5],
            "high": [101.0, 111.0, 101.0, 100.0, 101.0, 106.0],
            "low": [99.0, 109.0, 99.0, 98.0, 99.0, 100.0],
            "close": [100.0, 110.0, 99.0, 99.0, 100.0, 105.0],
            "volume": [1000, 1100, 1200, 1300, 1400, 1500],
        }
    )


def sector_first_info() -> pd.DataFrame:
    """Canned sw_index_first_info() shape: 行业代码/行业名称/... (31 real; we use 3)."""
    return pd.DataFrame(
        {
            "行业代码": ["801010.SI", "801030.SI", "801050.SI"],
            "行业名称": ["农林牧渔", "基础化工", "有色金属"],
            "成份个数": [104, 410, 142],
            "静态市盈率": [21.56, 26.18, 24.04],
            "TTM(滚动)市盈率": [27.21, 25.35, 20.00],
            "市净率": [2.01, 2.32, 3.31],
            "静态股息率": [2.41, 1.56, 1.40],
        }
    )


def index_hist_sw_801010() -> pd.DataFrame:
    """Canned index_hist_sw(symbol='801010', period='day') shape.

    Columns: 代码/日期/收盘/开盘/最高/最低/成交量/成交额.
    close: 200 -> 220 (+10%) -> 209 (-5%) -> 209 (0%) -> 210.09 (+0.5238%)
    """
    return pd.DataFrame(
        {
            "代码": ["801010"] * 5,
            "日期": pd.to_datetime(
                ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13", "2026-07-14"]
            ),
            "收盘": [200.0, 220.0, 209.0, 209.0, 210.09],
            "开盘": [199.0, 219.0, 210.0, 208.0, 209.0],
            "最高": [201.0, 221.0, 211.0, 210.0, 211.0],
            "最低": [199.0, 219.0, 208.0, 208.0, 209.0],
            "成交量": [10.0, 11.0, 12.0, 13.0, 14.0],
            "成交额": [100.0, 110.0, 120.0, 130.0, 140.0],
        }
    )


# Expected derived pct_change (rounded to 4dp) for assertions.
EXPECTED_INDEX_PCT = {
    date(2026, 7, 8): "10.0000",   # (110-100)/100*100
    date(2026, 7, 9): "-10.0000",  # (99-110)/110*100
    date(2026, 7, 10): "0.0000",   # (99-99)/99*100
    date(2026, 7, 13): "1.0101",   # (100-99)/99*100
    date(2026, 7, 14): "5.0000",   # (105-100)/100*100
    # 2026-07-07 is DROPPED (first row, no prior close)
}

EXPECTED_SECTOR_PCT = {
    date(2026, 7, 9): "10.0000",   # (220-200)/200
    date(2026, 7, 10): "-5.0000",  # (209-220)/220
    date(2026, 7, 13): "0.0000",   # (209-209)/209
    date(2026, 7, 14): "0.5215",   # (210.09-209)/209
    # 2026-07-08 DROPPED (first row)
}
