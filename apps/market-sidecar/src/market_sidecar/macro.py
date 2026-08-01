"""Macro indicator fetch: China GDP YoY + CPI YoY via akshare (Issue #69).

NBS's `easyquery.htm` API is blocked by WAF (403 UrlACL) from the deployment
environment. akshare's `macro_china_gdp` / `macro_china_cpi_yearly` reach the
same NBS-sourced data via Eastmoney's API (`datacenter-web.eastmoney.com`),
bypassing the WAF. This module fetches the latest values and emits JSON to
stdout for the Node worker's snapshot poll job to capture.

Output schema (one JSON object per line, JSON-lines for streaming):
  {"metric_key": "cn-growth", "market": "cn", "dimension": "growth",
   "observed_at": "2026-01-01T00:00:00.000Z", "value": 5.0, "indicator": "gdp_yoy"}
  {"metric_key": "cn-inflation", ...}

No DB writes here — the Node worker owns snapshot persistence (AD-SNAP-1).
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

log = logging.getLogger("market_sidecar.macro")


def _to_iso_period(period_str: str) -> str:
    """Normalize akshare's Chinese period label to an ISO-ish observed_at.

    akshare GDP '季度' column looks like '2026年第1季度' or '2026年第1-2季度'.
    We extract the year + quarter start month and emit a UTC midnight timestamp
    at the quarter start (Q1=01-01, Q2=04-01, Q3=07-01, Q4=10-01). For cumulative
    periods like '1-2季度', the start is Q1.
    """
    s = period_str.strip()
    try:
        year = int(s[:4])
    except ValueError:
        raise ValueError(f"unparseable period: {period_str!r}")
    # Cumulative (e.g. '第1-3季度') starts at Q1; single quarter (e.g. '第2季度').
    if "1-" in s or s.endswith("第1季度"):
        month = 1
    elif "第2季度" in s:
        month = 4
    elif "第3季度" in s:
        month = 7
    elif "第4季度" in s or "1-4季度" in s:
        month = 10
    else:
        month = 1
    return f"{year:04d}-{month:02d}-01T00:00:00.000Z"


def fetch_macro(ak_module: Any = None) -> list[dict[str, Any]]:
    """Fetch latest GDP YoY + CPI YoY. Returns a list of observation dicts.

    `ak_module` is injectable for testing (mirrors akshare_client's pattern).
    """
    if ak_module is None:
        import akshare as ak_module  # type: ignore[assignment]

    results: list[dict[str, Any]] = []

    # GDP YoY — quarterly, latest row is the most recent quarter.
    try:
        gdp = ak_module.macro_china_gdp()
        if gdp is not None and len(gdp) > 0:
            latest = gdp.iloc[0]  # head = latest
            period = str(latest["季度"])
            yoy = latest["国内生产总值-同比增长"]
            results.append(
                {
                    "metric_key": "cn-growth",
                    "market": "cn",
                    "dimension": "growth",
                    "observed_at": _to_iso_period(period),
                    "value": float(yoy) if yoy is not None else None,
                    "unit": "percent",
                    "indicator": "gdp_yoy",
                    "source_period": period,
                }
            )
    except Exception as e:  # noqa: BLE001 — per-source isolation
        log.error("macro_china_gdp failed: %s", e)

    # CPI YoY — monthly, ascending; latest rows may be NaN (not yet published).
    # Walk backwards from the tail to find the most recent published value.
    try:
        cpi = ak_module.macro_china_cpi_yearly()
        if cpi is not None and len(cpi) > 0:
            import math
            latest = None
            for idx in range(len(cpi) - 1, -1, -1):
                row = cpi.iloc[idx]
                val = row["今值"]
                if val is not None and not (isinstance(val, float) and math.isnan(val)):
                    latest = row
                    break
            if latest is not None:
                date_raw = str(latest["日期"])
                val = latest["今值"]
                # akshare CPI '日期' is like '2025-08-09 00:00:00'; take the month.
                observed = f"{date_raw[:7]}-01T00:00:00.000Z"
                results.append(
                    {
                        "metric_key": "cn-inflation",
                        "market": "cn",
                        "dimension": "inflation",
                        "observed_at": observed,
                        "value": float(val),
                        "unit": "percent",
                        "indicator": "cpi_yoy",
                        "source_period": date_raw,
                    }
                )
    except Exception as e:  # noqa: BLE001
        log.error("macro_china_cpi_yearly failed: %s", e)

    return results


def run_macro() -> int:
    """CLI entry: fetch macro indicators and emit JSON-lines to stdout."""
    observations = fetch_macro()
    for obs in observations:
        sys.stdout.write(json.dumps(obs, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0 if observations else 1
