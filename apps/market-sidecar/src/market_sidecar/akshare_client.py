"""AkShare client — the MarketDataAdapter impl side (AD-7).

Translates external AkShare frames into normalized Bar payloads. This module is
the ONLY place that imports akshare; swapping providers changes only this file
(AD-7). Column-name normalization + pct_change derivation live here so the
ingest layer sees one stable shape.

----
AKSHARE PROBE RECORD (verify before trusting — AkShare function names churn):
  akshare version : 1.18.64  (probed 2026-07-15, installed via uv)
  index daily     : ak.stock_zh_index_daily(symbol="sh000001"|"sz399001"|"sz399006")
                    -> columns: date, open, high, low, close, volume  (NO pct_change;
                       we derive pct_change from consecutive closes)
                    date col is a python `date` object in returned frame (parsed).
  sector list     : ak.sw_index_first_info()
                    -> columns: 行业代码 (e.g. "801010.SI"), 行业名称, ...
                    31 申万一级行业. We strip the ".SI" suffix for index_hist_sw.
  sector daily    : ak.index_hist_sw(symbol="801010", period="day")  # BARE code, no .SI
                    -> columns: 代码, 日期, 收盘, 开盘, 最高, 最低, 成交量, 成交额
                    returns ALL history (1999-12-30 -> present); we filter by date
                    client-side. NO pct_change column; derive from consecutive closes.
  NOTE            : ak.sw_index_daily does NOT exist in 1.18.64 (use index_hist_sw).

  -- Breadth sources (story 8.6, probed 2026-07-16 against akshare 1.18.64). Each is a
     per-trading-day snapshot; we call it once per date and aggregate into one row.
     North-bound capital (stock_hsgt_*) is DELIBERATELY NOT collected: exchanges stopped
     real-time disclosure on 2024-08-19, so it would fabricate empty data.
  zt pool (涨停)   : ak.stock_zt_pool_em(date="20260714")
                    -> columns include 序号, 代码, 名称, 涨停价, 最新价, 成交额, 流通市值,
                       封板资金, 首次封板时间, 最后封板时间, 炸板次数, 涨停统计, 连板数, ...
                    row count = limit-up count; 连板数 max = consecutive board max.
  dtgc pool (跌停) : ak.stock_zt_pool_dtgc_em(date="20260714")
                    -> same column family as zt pool; row count = limit-down count.
  zbgc pool (炸板) : ak.stock_zt_pool_zbgc_em(date="20260714")
                    -> same column family; row count = broken-board count.
  spot (涨跌家数)  : ak.stock_zh_a_spot_em(), fallback ak.stock_zh_a_spot()
                    -> columns include 代码, 名称, 最新价, 涨跌幅, 涨跌额, 成交量, 成交额, ...
                    ALL A-share spots for the latest trading day (no date param). We derive
                    advancing/declining/flat from 涨跌幅 sign and total_turnover = sum(成交额).
  dragon tiger    : ak.stock_lhb_detail_em(start_date="20260714", end_date="20260714")
                    -> columns include 序号, 代码, 名称, 收盘价, 涨跌幅, 龙虎榜净买额, ...
                    NOTE: takes a start_date/end_date RANGE (not a single date). For one day
                    we pass the same date as both bounds. One row per stock that appeared on
                    the dragon-tiger list that day. Empty frame ⇒ no stock listed that day
                    (honest zero object, not NULL).
  margin (融资融券): ak.stock_margin_sse(start_date="20260714", end_date="20260714")   (上交所汇总)
                  & ak.stock_margin_szse(date="20260714")                             (深交所汇总)
                    -> SSE cols: 信用交易日期, 融资余额, 融资买入额, 融券余量, 融券余量金额,
                       融券卖出量, 融资融券余额  (values in YUAN, e.g. 759423798637)
                    -> SZSE cols: 融资买入额, 融资余额, 融券卖出量, 融券余量, 融券余额,
                       融资融券余额  (values in 亿元/100M yuan, e.g. 6770.18)
                    UNIT MISMATCH: SSE is in yuan, SZSE is in 亿元 (×1e8). We normalize SZSE
                    → yuan (×1e8) before summing. Both are 融资融券汇总 (market-wide aggregate),
                    T-1 data (exchange disclosure lag). We sum 融资余额 across both exchanges
                    for one date; the wrapper returns MarginBalance(total=...). The day-over-day
                    diff (margin_balance_change) is computed by the ingest loop across consecutive
                    days (total[D] - total[D-1]); else margin_balance_change is NULL (NFR-5).
  NOTE            : stock_zt_pool_* take date="YYYYMMDD" (string, no dashes).
                    stock_lhb_detail_em takes start_date=end_date="YYYYMMDD" for one day.
                    stock_margin_sse takes start_date/end_date="YYYYMMDD"; stock_margin_szse
                    takes date="YYYYMMDD". stock_zh_a_spot_em takes NO date (latest day only).
  index daily em  : ak.stock_zh_index_daily_em(symbol="sh000001"|"sz399107",
                    start_date="20260707", end_date="20260714")
                    -> columns: 日期, 开盘, 收盘, 最高, 最低, 成交量, 成交额, 振幅, 涨跌幅, 涨跌额, 换手率
                    Unlike stock_zh_index_daily (sine; only volume, NO 成交额), the _em variant
                    carries 成交额 — used to derive 两市成交额 = sh000001 + sz399107 amount sum
                    (HISTORICAL; spot's total_turnover is latest-day only). sz399107 = 深证综指
                    (all SZ), sh000001 = 上证综指 (all SH) → 两市全市场.
  exchange turnover: ak.stock_sse_deal_daily(date="20260716") +
                    ak.stock_szse_summary(date="20260716") provide dated stock-market
                    transaction amounts from the Shanghai and Shenzhen exchanges. They are a
                    fallback only when the Eastmoney index history is unavailable.
----

Fixture injection: the fetch functions accept an optional `ak_module` param so
tests pass a fake module exposing canned DataFrames (deterministic, no network,
mirroring spec-1-4's "RSS adapter verified via fixture" precedent).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Callable, Protocol, TypeVar

log = logging.getLogger(__name__)

# 三大宽基 (AkShare symbol form, with exchange prefix).
BROAD_INDICES: tuple[str, ...] = ("sh000001", "sz399001", "sz399006")

# 两市成交额派生用 (沪市综指覆盖全 SH + 深证综指覆盖全 SZ = 两市全市场)。仅 breadth ingest 取成交额
# 时用；刻意 NOT 进 BROAD_INDICES —— 它不参与 8.1/8.2 的 crash 判定（避免改变大跌日检测结果）。
MARKET_TURNOVER_INDICES: tuple[str, ...] = ("sh000001", "sz399107")

# Cap on the per-stock list serialized into the dragon_tiger JSONB column. A heavy listing
# day can name hundreds of stocks; we keep the top N by net buy to bound the JSONB payload.
# The aggregates (stockCount, institutionalNetBuy, hotMoneyNetBuy) stay UNCAPPED — only the
# per-stock `topStocks` list is trimmed.
DRAGON_TIGER_TOP_N = 20

# Network retry for flaky external (akshare/eastmoney) GETs. Exponential backoff: base × 2**attempt,
# slept ONLY between attempts (N attempts ⇒ N-1 sleeps). Default 3 attempts ⇒ 2 sleeps of 2s, 4s
# (≈6s worst-case per call). Bounded ⇒ the runner always terminates. Absorbs transient ProxyError /
# RemoteDisconnected (the dominant observed failure mode); a sustained eastmoney outage/IP-block is
# NOT breakable in-code — retries just maximize recovery odds, and the projected data upserts
# persistently so the next successful run fills it.
FETCH_RETRY_ATTEMPTS = 3
FETCH_RETRY_BACKOFF_BASE = 2.0  # seconds

# Global request rate-limit (prevents eastmoney IP ban). The breadth ingest fires many akshare
# calls back-to-back (5 sources × N days + spot + index) — eastmoney's anti-scraping IP-bans after
# such bursts (observed: push2his/push2 hosts go RemoteDisconnected for an extended period after a
# run). akshare's OWN pagination already sleeps 0.5–1.5s/page (≈1–2 req/s, tolerated); our CALL
# boundary had no pacing. MIN_REQUEST_INTERVAL enforces a floor between any two akshare calls so the
# aggregate rate stays ≤ 1/interval req/s (default 0.5s ⇒ ≤2 req/s, matching akshare's tolerated
# pagination rate). 0 ⇒ throttling disabled (tests / opt-out).
MIN_REQUEST_INTERVAL = 0.5  # seconds
_last_call_at: float = 0.0  # time.monotonic() of the last akshare call (module-global rate-limit state)


class AkModule(Protocol):
    """Structural type for the akshare module + fakes."""

    def stock_zh_index_daily(self, symbol: str) -> Any: ...
    def stock_zh_index_daily_em(self, symbol: str, start_date: str, end_date: str) -> Any: ...
    def sw_index_first_info(self) -> Any: ...
    def index_hist_sw(self, symbol: str, period: str) -> Any: ...
    # Breadth (story 8.6):
    def stock_zt_pool_em(self, date: str) -> Any: ...
    def stock_zt_pool_dtgc_em(self, date: str) -> Any: ...
    def stock_zt_pool_zbgc_em(self, date: str) -> Any: ...
    def stock_zh_a_spot_em(self) -> Any: ...
    def stock_zh_a_spot(self) -> Any: ...
    def stock_lhb_detail_em(self, start_date: str, end_date: str) -> Any: ...
    def stock_margin_szse(self, date: str) -> Any: ...
    def stock_margin_sse(self, start_date: str, end_date: str) -> Any: ...
    def stock_sse_deal_daily(self, date: str) -> Any: ...
    def stock_szse_summary(self, date: str) -> Any: ...


@dataclass(frozen=True)
class IndexRow:
    """Normalized index daily row from AkShare (pre-DB). Decimal, not float."""

    index_code: str
    trade_date: date
    close: Decimal
    pct_change: Decimal | None  # None for the first bar (no prior close)


@dataclass(frozen=True)
class SectorMeta:
    """A 申万一级 sector code + name (from sw_index_first_info)."""

    code: str  # bare, no .SI (index_hist_sw wants bare)
    si_code: str  # with .SI (sw_index_first_info returns this)
    name: str


@dataclass(frozen=True)
class SectorRow:
    """Normalized sector daily row from AkShare (pre-DB). Decimal, not float."""

    sector_code: str  # bare (e.g. "801010")
    sector_name: str
    trade_date: date
    close: Decimal
    pct_change: Decimal | None  # None for the first bar


def list_sectors(ak_module: AkModule | None = None) -> list[SectorMeta]:
    """List the 申万一级 sectors. Returns bare code + si_code + name.

    ak_module=None uses the real akshare (network). Tests inject a fake.
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = ak.sw_index_first_info()
    metas: list[SectorMeta] = []
    for _, row in df.iterrows():
        si_code = str(row["行业代码"]).strip()
        name = str(row["行业名称"]).strip()
        bare = si_code.removesuffix(".SI")
        metas.append(SectorMeta(code=bare, si_code=si_code, name=name))
    return metas


def fetch_index_daily(
    symbol: str,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    ak_module: AkModule | None = None,
) -> list[IndexRow]:
    """Fetch one index's daily bars, deriving pct_change from consecutive closes.

    symbol: AkShare form ("sh000001" etc). start/end_date are inclusive and
    applied client-side (stock_zh_index_daily returns full history). Returns
    rows in ascending trade_date order. The first row has pct_change=None (no
    prior close); the caller decides whether to skip or store null — we DROP it
    (the caller wants pct_change NOT NULL per schema).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = ak.stock_zh_index_daily(symbol=symbol)
    # Normalize: akshare returns 'date' as object (str or date). Coerce.
    rows = _parse_index_frame(df, symbol)
    rows = _apply_date_window(rows, start_date, end_date)
    # Attach pct_change derived from the prior close. The very first row has no
    # prior → pct_change stays None → dropped (schema requires NOT NULL).
    return _with_pct_change(rows)


def fetch_sector_daily(
    sector: SectorMeta,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    ak_module: AkModule | None = None,
) -> list[SectorRow]:
    """Fetch one 申万 sector's daily bars via index_hist_sw(bare_code, 'day').

    index_hist_sw returns ALL history (no server-side date filter); we apply
    the inclusive window client-side. pct_change derived from consecutive
    closes; the first row (pct_change=None) is dropped.
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = ak.index_hist_sw(symbol=sector.code, period="day")
    rows = _parse_sector_frame(df, sector)
    rows = _apply_date_window(rows, start_date, end_date)
    return _with_pct_change(rows)


# --- breadth fetch wrappers (story 8.6) ---


@dataclass(frozen=True)
class LimitPoolStats:
    """Counts derived from a 涨停/跌停/炸板 pool frame for one trade date.

    row_count = number of stocks in the pool; consecutive_max is only meaningful for the
    涨停 pool (连板数 column); for the 跌停/炸板 pools consecutive_max stays None.
    """

    trade_date: date
    row_count: int
    consecutive_max: int | None  # max 连板数 from the 涨停 pool; None for dt/zb pools


@dataclass(frozen=True)
class SpotBreadth:
    """Advancing/declining/flat counts + total turnover from an A-share spot snapshot."""

    trade_date: date
    advancing_count: int  # 涨跌幅 > 0
    declining_count: int  # 涨跌幅 < 0
    flat_count: int  # 涨跌幅 == 0 (or NaN/None treated as flat)
    total_turnover: Decimal  # sum(成交额) across all spots, in yuan


@dataclass(frozen=True)
class DragonTiger:
    """Aggregated dragon-tiger (龙虎榜) stats for one trade date.

    The golden-example shape stored in market_breadth_daily.dragon_tiger Json:
      {stockCount, institutionalNetBuy, hotMoneyNetBuy,
       topStocks:[{code,name,netBuy,reason}]}
    institutional/hotMoney net buy are best-effort from the 龙虎榜净买额 column family
    (akshare flattens the buy/sell sides; we take the row-level net where available and
    0 where the column is absent — honest zero, never fabricated, NFR-5).
    """

    stock_count: int
    institutional_net_buy: Decimal
    hot_money_net_buy: Decimal
    top_stocks: list[dict[str, object]]  # [{code,name,netBuy,reason}]


@dataclass(frozen=True)
class MarginBalance:
    """融资融券余额合计 (T-1) for one trade date, in yuan (SSE+SZSE normalized).

    total is the sum of 融资余额 across both exchanges (SSE in yuan, SZSE in 亿元 normalized ×1e8).
    The DAY-OVER-DAY change is NOT derivable from a single call — it requires a prior day's
    total, which the ingest loop tracks across the date window and diffs. total is None when
    BOTH exchange fetches failed or returned no 融资余额 column (NFR-5 honest empty, not fabricated).
    """

    trade_date: date
    total: Decimal | None  # SSE+SZSE 融资余额 sum in yuan; None if both exchanges unavailable


def fetch_limit_pool(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> LimitPoolStats:
    """涨停池 (stock_zt_pool_em): row count + max 连板数 for one trade date.

    date is formatted as "YYYYMMDD" (akshare convention, no dashes). An empty frame is a
    valid honest zero (no limit-up stocks that day) — returned as row_count=0,
    consecutive_max=0 (NOT None: the 涨停 pool always has the 连板数 column).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = _call_ak("zt_pool", lambda: ak.stock_zt_pool_em(date=_yyyymmdd(trade_date)))
    row_count, consecutive_max = _pool_counts(df, with_consecutive=True)
    return LimitPoolStats(
        trade_date=trade_date,
        row_count=row_count,
        consecutive_max=consecutive_max,
    )


def fetch_limit_down_pool(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> LimitPoolStats:
    """跌停池 (stock_zt_pool_dtgc_em): row count for one trade date.

    consecutive_max is None (the 跌停 pool has no 连板数 column).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = _call_ak("dt_pool", lambda: ak.stock_zt_pool_dtgc_em(date=_yyyymmdd(trade_date)))
    row_count, _ = _pool_counts(df, with_consecutive=False)
    return LimitPoolStats(trade_date=trade_date, row_count=row_count, consecutive_max=None)


def fetch_broken_board(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> LimitPoolStats:
    """炸板池 (stock_zt_pool_zbgc_em): row count for one trade date.

    consecutive_max is None (the 炸板 pool has no 连板数 column).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    df = _call_ak("zb_pool", lambda: ak.stock_zt_pool_zbgc_em(date=_yyyymmdd(trade_date)))
    row_count, _ = _pool_counts(df, with_consecutive=False)
    return LimitPoolStats(trade_date=trade_date, row_count=row_count, consecutive_max=None)


def fetch_spot_breadth(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> SpotBreadth:
    """A-share spot snapshot: advancing/declining/flat + total turnover.

    Eastmoney is primary. If its paginated endpoint fails after bounded retries, fall back to
    AkShare's Sina snapshot, which exposes the same normalized 涨跌幅/成交额 columns. Both return
    only the latest trading day, so the caller must attach this result only to the latest
    trading day confirmed by date-specific market sources.
    """
    ak = ak_module if ak_module is not None else _real_ak()
    try:
        df = _call_ak("spot_em", lambda: ak.stock_zh_a_spot_em())
    except Exception as em_exc:
        log.warning("spot_em failed; falling back to Sina spot: %s", em_exc)
        try:
            df = _call_ak("spot_sina", lambda: ak.stock_zh_a_spot())
        except Exception as sina_exc:
            raise RuntimeError(
                f"both spot sources failed (eastmoney={em_exc}; sina={sina_exc})"
            ) from sina_exc
    advancing = declining = flat = 0
    turnover = Decimal("0")
    for _, row in df.iterrows():
        pct = _to_decimal_or_none(row.get("涨跌幅"))
        if pct is None or pct == 0:
            flat += 1
        elif pct > 0:
            advancing += 1
        else:
            declining += 1
        amt = _to_decimal_or_none(row.get("成交额"))
        if amt is not None:
            turnover += amt
    return SpotBreadth(
        trade_date=trade_date,
        advancing_count=advancing,
        declining_count=declining,
        flat_count=flat,
        total_turnover=turnover,
    )


def fetch_index_amounts(
    *,
    start: date,
    end: date,
    ak_module: AkModule | None = None,
) -> dict[date, Decimal]:
    """两市成交额 (沪+深) per trade date, derived from index daily 成交额 (yuan).

    Uses stock_zh_index_daily_em (eastmoney), which returns 成交额 — UNLIKE the
    sine-based stock_zh_index_daily used by 8.1 (which has only volume, no 成交额).
    We sum sh000001 (上证综指, all SH) + sz399107 (深证综指, all SZ) 成交额 per date =
    沪深两市全市场成交额, available HISTORICALLY (unlike spot which is latest-day only).

    Fetched ONCE per ingest run over the [start,end] window (caller passes the ingest
    window); returns a date→yuan map. A date present in only ONE index is OMITTED (两市
    口径下缺一不可 — never half-sum, NFR-5). An empty frame / missing 成交额 column for
    an index ⇒ that index contributes nothing (no exception). A network EXCEPTION from
    either ak call propagates — the caller (ingest_breadth) wraps this in try/except so
    a failure ⇒ empty dict ⇒ every day's total_turnover=None (NFR-5, never fabricated).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    s, e = _yyyymmdd(start), _yyyymmdd(end)
    # Fetch each market-turnover index ONCE over the window, then sum 成交额 per date where
    # EVERY turnover index has data (两市口径下缺一不可 — no half-sum, NFR-5). A network EXCEPTION
    # propagates; the caller (ingest_breadth) wraps this in try/except ⇒ empty dict ⇒ all None.
    # Each ak call is wrapped in _with_retry — transient ProxyError/RemoteDisconnected (the dominant
    # observed failure mode) recovers with exponential backoff; a sustained outage still raises.
    per_index: dict[str, dict[date, Decimal]] = {}
    for symbol in MARKET_TURNOVER_INDICES:
        df = _call_ak(
            f"index_em {symbol}",
            lambda sym=symbol, sd=s, ed=e: ak.stock_zh_index_daily_em(
                symbol=sym, start_date=sd, end_date=ed
            ),
        )
        per_index[symbol] = _index_amount_map(df)
    common: set[date] = set(per_index[MARKET_TURNOVER_INDICES[0]])
    for symbol in MARKET_TURNOVER_INDICES[1:]:
        common &= set(per_index[symbol])
    return {d: sum(idx[d] for idx in per_index.values()) for d in common}


def fetch_exchange_amount(trade_date: date, *, ak_module: AkModule | None = None) -> Decimal:
    """两市成交额 fallback from dated Shanghai + Shenzhen exchange summaries.

    The primary source remains the two Eastmoney index histories in
    :func:`fetch_index_amounts`, because they retrieve a whole date window in two calls. When
    that endpoint is unavailable, the exchange endpoints provide an independently dated and
    auditable replacement for one completed trading day:

    - ``stock_sse_deal_daily`` reports the ``股票`` ``成交金额`` in 亿元;
    - ``stock_szse_summary`` reports the ``股票`` ``成交金额`` in yuan.

    Both exchange amounts are required. A missing row or column raises so the caller can retain
    an honest null rather than publish a one-sided "两市" total.
    """
    ak = ak_module if ak_module is not None else _real_ak()
    day = _yyyymmdd(trade_date)
    sse = _call_ak("sse_deal_daily", lambda: ak.stock_sse_deal_daily(date=day))
    szse = _call_ak("szse_summary", lambda: ak.stock_szse_summary(date=day))

    sse_amount_yi = _summary_amount(
        sse,
        label_column="单日情况",
        label="成交金额",
        value_column="股票",
    )
    szse_amount_yuan = _summary_amount(
        szse,
        label_column="证券类别",
        label="股票",
        value_column="成交金额",
    )
    return sse_amount_yi * Decimal("100000000") + szse_amount_yuan


def _summary_amount(
    df: Any,
    *,
    label_column: str,
    label: str,
    value_column: str,
) -> Decimal:
    """Extract one numeric total from an exchange summary frame or raise clearly."""
    if df.empty or label_column not in df.columns or value_column not in df.columns:
        raise ValueError(
            f"exchange summary missing {label_column!r} or {value_column!r} column"
        )
    matches = df[df[label_column].astype(str).str.strip() == label]
    if matches.empty:
        raise ValueError(f"exchange summary missing {label_column}={label}")
    amount = _to_decimal_or_none(matches.iloc[0][value_column])
    if amount is None:
        raise ValueError(f"exchange summary has non-numeric {value_column} for {label}")
    return amount


_T = TypeVar("_T")


def _throttle() -> None:
    """Block until at least MIN_REQUEST_INTERVAL has elapsed since the last akshare call.

    Module-global rate-limit (single-threaded sidecar ingest). Prevents the back-to-back request
    burst that triggers eastmoney's anti-scraping IP ban. No-op when MIN_REQUEST_INTERVAL <= 0
    (opt-out / tests). Uses time.monotonic() so wall-clock adjustments don't affect pacing.
    """
    global _last_call_at
    if MIN_REQUEST_INTERVAL <= 0:
        _last_call_at = time.monotonic()
        return
    wait = MIN_REQUEST_INTERVAL - (time.monotonic() - _last_call_at)
    if wait > 0:
        time.sleep(wait)
    _last_call_at = time.monotonic()


def _call_ak(label: str, fn: Callable[[], _T]) -> _T:
    """Call an akshare function with global rate-limiting + bounded exponential-backoff retry.

    Two concerns folded into one helper, applied at every breadth akshare call site:
      1. `_throttle()` before EACH attempt — caps the aggregate request rate so eastmoney's
         anti-scraping does NOT IP-ban this host in the first place (prevention). Retried attempts
         are also network calls, so they pace too.
      2. retry on failure — absorbs transient ProxyError/RemoteDisconnected (akshare's internal
         request_with_retry gives up too fast); exponential backoff, slept only between attempts
         (N attempts ⇒ N-1 sleeps). Safe because the wrapped calls are idempotent GETs.

    All-retries-failed ⇒ the last exception propagates (the caller's per-source try/except turns it
    into an honest-empty field — never fabricated, NFR-5). Bounded ⇒ the runner always terminates.
    """
    last_exc: Exception | None = None
    for attempt in range(FETCH_RETRY_ATTEMPTS):
        _throttle()
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 — network calls raise a wide variety; retry is safe for idempotent GETs
            last_exc = exc
            if attempt < FETCH_RETRY_ATTEMPTS - 1:
                delay = FETCH_RETRY_BACKOFF_BASE * (2**attempt)
                log.warning(
                    "retry %s: attempt %d/%d failed (%s: %s); backoff %.1fs",
                    label, attempt + 1, FETCH_RETRY_ATTEMPTS, type(exc).__name__, str(exc)[:120], delay,
                )
                time.sleep(delay)
    if last_exc is None:  # FETCH_RETRY_ATTEMPTS < 1 (misconfig) → fail loudly, don't silently no-op
        raise RuntimeError(f"_call_ak({label}): FETCH_RETRY_ATTEMPTS={FETCH_RETRY_ATTEMPTS} < 1")
    raise last_exc


def fetch_dragon_tiger(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> DragonTiger:
    """龙虎榜 (stock_lhb_detail_em): aggregate stats for one trade date.

    An empty frame ⇒ an honest zero object (no stock listed that day): stockCount=0,
    nets=0, topStocks=[]. This is NOT NULL — NULL is reserved for a fetch failure (the
    per-source try/except in ingest_breadth converts a raised exception to None). We do
    not attempt to split institutional vs hot-money net buy from the flattened detail
    frame (that needs the buying/selling seat breakdown); we report the row-level 龙虎榜
    净买额 sum as institutional_net_buy and leave hot_money_net_buy at 0 — honest given
    the available columns, and the 8.8 page can refine in a later story.
    """
    ak = ak_module if ak_module is not None else _real_ak()
    # stock_lhb_detail_em takes a start_date/end_date RANGE; for one day pass both as the
    # same date (probed akshare 1.18.64 signature).
    d = _yyyymmdd(trade_date)
    df = _call_ak("lhb", lambda: ak.stock_lhb_detail_em(start_date=d, end_date=d))
    if df is None or len(df) == 0:
        return DragonTiger(
            stock_count=0,
            institutional_net_buy=Decimal("0"),
            hot_money_net_buy=Decimal("0"),
            top_stocks=[],
        )
    net_sum = Decimal("0")
    top: list[dict[str, object]] = []
    for _, row in df.iterrows():
        net = _to_decimal_or_none(row.get("龙虎榜净买额")) or Decimal("0")
        net_sum += net
        top.append(
            {
                "code": str(row.get("代码", "")).strip(),
                "name": str(row.get("名称", "")).strip(),
                "netBuy": _decimal_to_jsonable(net),
                "reason": str(row.get("上榜原因", "")).strip(),
            }
        )
    return DragonTiger(
        stock_count=len(df),
        institutional_net_buy=net_sum,
        hot_money_net_buy=Decimal("0"),
        top_stocks=top,
    )


def fetch_margin(
    trade_date: date,
    *,
    ak_module: AkModule | None = None,
) -> MarginBalance:
    """融资融券余额合计 (T-1): sum 融资余额 across SSE+SZSE for the given date, in yuan.

    stock_margin_sse / stock_margin_szse are DATE-SPECIFIC (SSE takes a start/end range, SZSE
    takes a single date), so each call returns exactly one day's aggregate. We sum 融资余额
    across both exchanges (SZSE in 亿元 normalized ×1e8 to yuan, matching SSE). The DAY-OVER-DAY
    change is computed by the ingest loop across consecutive days; this wrapper returns only the
    balance TOTAL for the date (None when both exchanges are unavailable — honest empty, NFR-5).
    This keeps the wrapper a faithful "one source, one date" translation (AD-7).
    """
    ak = ak_module if ak_module is not None else _real_ak()
    total = _sum_margin_balance(ak, trade_date)
    return MarginBalance(trade_date=trade_date, total=total)


def dragon_tiger_to_json(dt: DragonTiger) -> dict[str, object]:
    """Serialize a DragonTiger to the golden-example Json shape for the DB column.

    The per-stock `topStocks` list is capped to DRAGON_TIGER_TOP_N (20) by net buy (desc)
    so a heavy listing day cannot produce an unbounded JSONB payload. The aggregate fields
    (stockCount, institutionalNetBuy, hotMoneyNetBuy) are UNCAPPED — stockCount reflects
    the full listing count, only the detail list is trimmed.
    """
    top = sorted(
        dt.top_stocks,
        key=lambda s: _to_decimal_or_none(s.get("netBuy")) or Decimal("0"),
        reverse=True,
    )[:DRAGON_TIGER_TOP_N]
    return {
        "stockCount": dt.stock_count,
        "institutionalNetBuy": _decimal_to_jsonable(dt.institutional_net_buy),
        "hotMoneyNetBuy": _decimal_to_jsonable(dt.hot_money_net_buy),
        "topStocks": top,
    }


# --- breadth frame parsing helpers ---


def _pool_counts(df: Any, *, with_consecutive: bool) -> tuple[int, int | None]:
    """Row count + optional max 连板数 from a zt/dt/zb pool frame.

    Returns (row_count, consecutive_max_or_None). An empty/None frame is (0, 0) when
    with_consecutive else (0, None) — honest zero counts, never fabricated (NFR-5).
    """
    if df is None or len(df) == 0:
        return 0, (0 if with_consecutive else None)
    row_count = len(df)
    consecutive_max: int | None = None
    if with_consecutive:
        consecutive_max = 0
        col = _first_present_column(df, ("连板数", "连板"))
        if col is not None:
            for v in df[col]:
                iv = _to_int_or_none(v)
                if iv is not None and iv > (consecutive_max or 0):
                    consecutive_max = iv
    return row_count, consecutive_max


def _sum_margin_balance(ak: AkModule, trade_date: date) -> Decimal | None:
    """Sum 融资余额 across SSE + SZSE for one date (both normalized to yuan). None if both fail.

    SSE (stock_margin_sse) returns 融资余额 in YUAN. SZSE (stock_margin_szse) returns 融资余额
    in 亿元 (×1e8) — we normalize to yuan before summing so the two exchanges are comparable.
    stock_margin_sse takes a start_date/end_date range; for one day we pass both as the same
    date. stock_margin_szse takes a single date.
    """
    total = Decimal("0")
    got_any = False
    d = _yyyymmdd(trade_date)

    # SSE (yuan): stock_margin_sse(start_date, end_date)
    fn_sse = getattr(ak, "stock_margin_sse", None)
    if fn_sse is not None:
        try:
            df = _call_ak("margin_sse", lambda: fn_sse(start_date=d, end_date=d))
        except Exception:  # noqa: BLE001 — one exchange missing is not fatal
            df = None
        if df is not None and len(df) > 0:
            col = _first_present_column(df, ("融资余额",))
            if col is not None:
                got_any = True
                for v in df[col]:
                    val = _to_decimal_or_none(v)
                    if val is not None:
                        total += val  # SSE already yuan

    # SZSE (亿元 → yuan): stock_margin_szse(date)
    fn_szse = getattr(ak, "stock_margin_szse", None)
    if fn_szse is not None:
        try:
            df = _call_ak("margin_szse", lambda: fn_szse(date=d))
        except Exception:  # noqa: BLE001 — one exchange missing is not fatal
            df = None
        if df is not None and len(df) > 0:
            col = _first_present_column(df, ("融资余额",))
            if col is not None:
                got_any = True
                for v in df[col]:
                    val = _to_decimal_or_none(v)
                    if val is not None:
                        total += val * Decimal("100000000")  # 亿元 → yuan (×1e8)

    return total if got_any else None


def _first_present_column(df: Any, candidates: tuple[str, ...]) -> str | None:
    """Return the first candidate column name present in the frame (column-name drift guard)."""
    cols = set(str(c) for c in df.columns)
    for c in candidates:
        if c in cols:
            return c
    return None


def _index_amount_map(df: Any) -> dict[date, Decimal]:
    """date → 成交额 (yuan) from a stock_zh_index_daily_em frame.

    Empty on a None/empty frame or a missing 成交额 column (column-name drift → honest
    empty, never raises). Dates come from the 日期 (or 'date') column. NaN 成交额 cells
    are skipped (NFR-5).
    """
    if df is None or len(df) == 0:
        return {}
    amt_col = _first_present_column(df, ("成交额",))
    date_col = _first_present_column(df, ("日期", "date"))
    if amt_col is None or date_col is None:
        return {}  # column-name drift on either column → honest empty (never raises), NFR-5
    out: dict[date, Decimal] = {}
    for _, row in df.iterrows():
        d = _coerce_date(row[date_col])
        amt = _to_decimal_or_none(row[amt_col])
        if amt is not None:
            out[d] = amt
    return out


def _yyyymmdd(d: date) -> str:
    """Format a date as akshare's 'YYYYMMDD' (no dashes)."""
    return d.strftime("%Y%m%d")


def _to_int_or_none(v: Any) -> int | None:
    """Coerce numpy int / float / str to int; None on failure."""
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None


def _to_decimal_or_none(v: Any) -> Decimal | None:
    """Coerce a numeric cell to Decimal, tolerating NaN/None. None on failure/NaN."""
    if v is None:
        return None
    try:
        # Detect NaN (numpy/pandas) without importing numpy: NaN != NaN.
        if v != v:  # noqa: PLR0124 — intentional NaN check
            return None
    except Exception:  # noqa: BLE001 — non-numeric types fall through
        pass
    try:
        return Decimal(str(v))
    except Exception:  # noqa: BLE001 — invalid value -> None (honest empty)
        return None


def _decimal_to_jsonable(d: Decimal) -> str:
    """Render a Decimal as a JSON-safe string (Json columns cannot hold Decimal)."""
    return str(d)


# --- frame parsing (column-name normalization) ---


def _parse_index_frame(df: Any, symbol: str) -> list[IndexRow]:
    """Parse stock_zh_index_daily frame -> IndexRow (close only; pct filled later)."""
    out: list[IndexRow] = []
    for _, row in df.iterrows():
        d = _coerce_date(row["date"])
        close = _to_decimal(row["close"])
        out.append(IndexRow(index_code=symbol, trade_date=d, close=close, pct_change=None))
    return out


def _parse_sector_frame(df: Any, sector: SectorMeta) -> list[SectorRow]:
    """Parse index_hist_sw frame -> SectorRow. Columns are Chinese (代码/日期/收盘)."""
    out: list[SectorRow] = []
    for _, row in df.iterrows():
        d = _coerce_date(row["日期"])
        close = _to_decimal(row["收盘"])
        out.append(
            SectorRow(
                sector_code=sector.code,
                sector_name=sector.name,
                trade_date=d,
                close=close,
                pct_change=None,
            )
        )
    return out


# --- pct_change derivation + date windowing (generic over IndexRow/SectorRow) ---


def _with_pct_change(rows: list[Any]) -> list[Any]:
    """Derive pct_change = (close - prev_close) / prev_close * 100.

    Mutates copies in place (dataclasses are frozen, so we rebuild). The first
    row (no prior close) is DROPPED because the schema's pct_change is NOT NULL.
    This also means a single-row window yields an empty list — caller should
    fetch at least 2 days to get one bar with pct_change.
    """
    if len(rows) < 2:
        return []
    out: list[Any] = []
    prev_close = rows[0].close
    for r in rows[1:]:
        pct = _safe_pct_change(prev_close, r.close)
        if pct is None:
            # prev close was 0 / None — skip this bar (don't fabricate, NFR-5)
            prev_close = r.close
            continue
        out.append(_replace(r, pct_change=pct))
        prev_close = r.close
    return out


def _safe_pct_change(prev: Decimal, curr: Decimal) -> Decimal | None:
    """((curr - prev) / prev) * 100, rounded to 4dp. None if prev is 0/None."""
    if prev is None or prev == 0:
        return None
    return ((curr - prev) / prev * 100).quantize(Decimal("0.0001"))


def _apply_date_window(
    rows: list[Any], start: date | None, end: date | None
) -> list[Any]:
    """Inclusive client-side date filter on trade_date."""
    out = []
    for r in rows:
        if start is not None and r.trade_date < start:
            continue
        if end is not None and r.trade_date > end:
            continue
        out.append(r)
    return out


def _replace(row: Any, **kwargs: Any) -> Any:
    """dataclasses.replace shim (avoids importing replace at module top for clarity)."""
    from dataclasses import replace

    return replace(row, **kwargs)


def _coerce_date(v: Any) -> date:
    """Coerce a pandas Timestamp / str / date into a python date."""
    if isinstance(v, date) and not isinstance(v, type):  # already date
        if hasattr(v, "date"):  # pandas Timestamp
            return v.date()
        return v
    if hasattr(v, "date"):  # pandas Timestamp duck-typing
        return v.date()
    # str fallback: first 10 chars "YYYY-MM-DD"
    return date.fromisoformat(str(v)[:10])


def _to_decimal(v: Any) -> Decimal:
    """Coerce a numpy float / str / int into Decimal (avoid float repr noise).

    Go via str to dodge numpy.float64 binary-repr drift into Decimal.
    """
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _real_ak() -> AkModule:
    """Import the real akshare lazily (keeps test imports network-free)."""
    import akshare  # noqa: PLC0415 — lazy on purpose

    return akshare  # type: ignore[return-value]
