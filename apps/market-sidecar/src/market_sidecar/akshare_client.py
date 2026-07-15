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
----

Fixture injection: the fetch functions accept an optional `ak_module` param so
tests pass a fake module exposing canned DataFrames (deterministic, no network,
mirroring spec-1-4's "RSS adapter verified via fixture" precedent).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Protocol

# 三大宽基 (AkShare symbol form, with exchange prefix).
BROAD_INDICES: tuple[str, ...] = ("sh000001", "sz399001", "sz399006")


class AkModule(Protocol):
    """Structural type for the akshare module + fakes."""

    def stock_zh_index_daily(self, symbol: str) -> Any: ...
    def sw_index_first_info(self) -> Any: ...
    def index_hist_sw(self, symbol: str, period: str) -> Any: ...


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
