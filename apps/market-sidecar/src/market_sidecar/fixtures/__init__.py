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


def index_daily_em_sh000001() -> pd.DataFrame:
    """Canned stock_zh_index_daily_em(symbol='sh000001') shape (eastmoney index kline).

    Unlike the sine-based stock_zh_index_daily, the _em variant carries 成交额. 上证综指
    covers all SH → 成交额 = 沪市成交额. 3 trading days; only 日期 + 成交额 are consumed
    by fetch_index_amounts (other columns are realistic filler).
    """
    return pd.DataFrame(
        {
            "日期": pd.to_datetime(["2026-07-10", "2026-07-13", "2026-07-14"]),
            "开盘": [3200.0, 3210.0, 3190.0],
            "收盘": [3198.0, 3205.0, 3180.0],
            "最高": [3210.0, 3215.0, 3200.0],
            "最低": [3190.0, 3198.0, 3175.0],
            "成交量": [3_000_000, 3_100_000, 3_500_000],
            "成交额": [450_000_000_000, 460_000_000_000, 480_000_000_000],
            "振幅": [0.6, 0.5, 0.8],
            "涨跌幅": [-0.1, 0.2, -0.8],
            "涨跌额": [-3.0, 6.0, -25.0],
            "换手率": [0.9, 0.9, 1.0],
        }
    )


def index_daily_em_sz399107() -> pd.DataFrame:
    """Canned stock_zh_index_daily_em(symbol='sz399107') shape (深证综指, covers all SZ).

    成交额 = 深市成交额. Same 3 trading days as sh so per-date sum = 两市成交额.
    """
    return pd.DataFrame(
        {
            "日期": pd.to_datetime(["2026-07-10", "2026-07-13", "2026-07-14"]),
            "开盘": [1900.0, 1910.0, 1885.0],
            "收盘": [1895.0, 1905.0, 1870.0],
            "最高": [1910.0, 1915.0, 1895.0],
            "最低": [1888.0, 1898.0, 1865.0],
            "成交量": [2_000_000, 2_100_000, 2_400_000],
            "成交额": [380_000_000_000, 390_000_000_000, 410_000_000_000],
            "振幅": [1.1, 0.9, 1.6],
            "涨跌幅": [-0.3, 0.5, -1.8],
            "涨跌额": [-5.0, 10.0, -35.0],
            "换手率": [1.2, 1.2, 1.4],
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


# ---------------------------------------------------------------------------
# Breadth fixtures (story 8.6). trade_date = 2026-07-14 (a trading day).
# These mirror the verified akshare 1.18.64 frame shapes (see akshare_client.py probe).
# ---------------------------------------------------------------------------

BREADTH_TRADE_DATE = date(2026, 7, 14)


def zt_pool_20260714() -> pd.DataFrame:
    """Canned stock_zt_pool_em(date='20260714') shape: 涨停池.

    3 stocks limit-up; 连板数 max = 4 (the 2nd row). Columns mirror the verified frame.
    """
    return pd.DataFrame(
        {
            "序号": [1, 2, 3],
            "代码": ["000001", "000002", "600000"],
            "名称": ["平安银行", "万科A", "浦发银行"],
            "涨停价": [12.34, 10.50, 11.20],
            "最新价": [12.34, 10.50, 11.20],
            "成交额": [1.0e9, 2.0e9, 3.0e9],
            "流通市值": [2.0e11, 1.5e11, 3.0e11],
            "封板资金": [5.0e8, 3.0e8, 4.0e8],
            "首次封板时间": ["09:30:00", "10:15:00", "14:20:00"],
            "最后封板时间": ["09:30:00", "10:15:00", "14:20:00"],
            "炸板次数": [0, 1, 0],
            "涨停统计": ["3/3", "2/3", "1/1"],
            "连板数": [1, 4, 2],
        }
    )


def dt_pool_20260714() -> pd.DataFrame:
    """Canned stock_zt_pool_dtgc_em(date='20260714') shape: 跌停池. 2 stocks limit-down."""
    return pd.DataFrame(
        {
            "序号": [1, 2],
            "代码": ["300001", "600001"],
            "名称": ["特锐德", "浦发银行"],
            "跌停价": [8.50, 9.00],
            "最新价": [8.50, 9.00],
            "成交额": [5.0e8, 6.0e8],
        }
    )


def zb_pool_20260714() -> pd.DataFrame:
    """Canned stock_zt_pool_zbgc_em(date='20260714') shape: 炸板池. 1 broken-board stock."""
    return pd.DataFrame(
        {
            "序号": [1],
            "代码": ["000333"],
            "名称": ["美的集团"],
            "涨停价": [15.00],
            "最新价": [14.20],
            "成交额": [8.0e8],
        }
    )


def spot_em_20260714() -> pd.DataFrame:
    """Canned stock_zh_a_spot_em() shape: A-share spots for the latest trading day.

    6 stocks: 3 advancing (涨跌幅 > 0), 2 declining (涨跌幅 < 0), 1 flat (涨跌幅 == 0).
    total 成交额 = 1e9 + 2e9 + 3e9 + 4e9 + 5e9 + 6e9 = 21e9 (Decimal-exact via str).
    """
    return pd.DataFrame(
        {
            "代码": ["000001", "000002", "000003", "000004", "000005", "000006"],
            "名称": ["平安银行", "万科A", "上海钢联", "浦发银行", "招商银行", "中国银行"],
            "最新价": [12.34, 10.50, 20.00, 11.20, 35.00, 4.50],
            "涨跌幅": [5.0, 2.5, 0.0, -1.2, -3.0, 10.0],
            "涨跌额": [0.59, 0.26, 0.0, -0.14, -1.08, 0.41],
            "成交量": [1e6, 2e6, 3e6, 4e6, 5e6, 6e6],
            "成交额": [1e9, 2e9, 3e9, 4e9, 5e9, 6e9],
        }
    )


def lhb_detail_20260714() -> pd.DataFrame:
    """Canned stock_lhb_detail_em(date='20260714') shape: 龙虎榜. 2 stocks listed."""
    return pd.DataFrame(
        {
            "序号": [1, 2],
            "代码": ["000001", "600000"],
            "名称": ["平安银行", "浦发银行"],
            "收盘价": [12.34, 11.20],
            "涨跌幅": [5.0, 2.0],
            "龙虎榜净买额": [1.5e8, -3.0e7],
            "上榜原因": ["日涨幅偏离值达7%", "日振幅值达15%"],
        }
    )


def margin_sse_20260714() -> pd.DataFrame:
    """Canned stock_margin_sse(start_date='20260714', end_date='20260714') shape (上交所汇总).

    SSE 融资融券汇总; 融资余额 in YUAN. One aggregate row for the day. Cols mirror the
    verified akshare 1.18.64 frame.
    """
    return pd.DataFrame(
        {
            "信用交易日期": ["20260714"],
            "融资余额": [8.0e9],  # 8e9 yuan (SSE reports in yuan)
            "融资买入额": [3.0e8],
            "融券余量": [1.0e6],
            "融券余量金额": [5.0e6],
            "融券卖出量": [1000],
            "融资融券余额": [8.5e9],
        }
    )


def margin_szse_20260714() -> pd.DataFrame:
    """Canned stock_margin_szse(date='20260714') shape (深交所汇总).

    SZSE 融资融券汇总; 融资余额 in 亿元 (×1e8). The wrapper normalizes to yuan before summing
    so SSE (yuan) + SZSE (亿元→yuan) are comparable. Cols mirror the verified frame.
    """
    return pd.DataFrame(
        {
            "融资买入额": [30.0],  # 亿元
            "融资余额": [40.0],  # 40 亿元 → 4e9 yuan after normalization
            "融券卖出量": [5.0],
            "融券余量": [17.66],
            "融券余额": [1.12],
            "融资融券余额": [41.12],
        }
    )


def empty_frame() -> pd.DataFrame:
    """An empty frame (for non-trading-day / no-listing-day tests)."""
    return pd.DataFrame()


# Expected derived breadth counts for 2026-07-14 (assertion map). Decimal-str values
# match Decimal(str(numpy_float64)) representation (the parse layer goes via str to dodge
# float binary-repr drift; the DB DECIMAL(20,2) column normalizes on store).
EXPECTED_BREADTH = {
    "limit_up_count": 3,
    "limit_down_count": 2,
    "consecutive_board_max": 4,
    "broken_board_count": 1,
    "advancing_count": 3,
    "declining_count": 2,
    "flat_count": 1,
    "total_turnover": "21000000000.0",  # 21e9 yuan (sum of float64 成交额 via Decimal(str))
    # fetch_index_amounts (index-em derived, HISTORICAL): 两市成交额 = sh000001 + sz399107.
    # 07-14: 480e9 (sh) + 410e9 (sz) = 890e9 yuan; 07-13: 460e9 + 390e9 = 850e9.
    "market_turnover_20260714": "890000000000",
    "market_turnover_20260713": "850000000000",
    "lhb_stock_count": 2,
    "lhb_net_sum": "120000000.0",  # 1.5e8 + (-3e7) = 1.2e8 (float64 str -> Decimal)
    "margin_total": "12000000000",  # 8e9 yuan (SSE) + 40亿元→4e9 yuan (SZSE) = 12e9 yuan
}
