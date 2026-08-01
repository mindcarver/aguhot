"""CLI entry: `python -m market_sidecar ingest --backfill --scope index`.

Subcommands:
  ingest  The only command. Modes (mutually exclusive):
    --backfill      ~3 years of history (AC1/AC2)
    --incremental   last ~5 trading days (AC3 idempotency re-run)
    --smoke         live smoke: last 5 trading days, index only (NOT run by tests)

Scopes:
    --scope index    三大宽基
    --scope sector   申万一级
    --scope breadth  市场广度 (涨跌停/连板/炸板/涨跌家数/成交额/龙虎榜/融资融券, story 8.6)
  (ommitting --scope runs index+sector; --smoke with breadth runs breadth only, else index)

Exit code: 0 on success or below-threshold failures; 1 if the failure ratio
exceeded FAILURE_THRESHOLD (scheduler retry signal, AD-4).

The CLI remains manually runnable. The Node worker invokes the incremental index,
sector, and breadth scopes every 30 minutes to refresh the public crash calendar.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date

from .ingest import ingest_breadth, ingest_indices, ingest_sectors
from .macro import run_macro


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="market_sidecar",
        description="AGUHOT market history daily-bars sidecar (AkShare -> Postgres).",
    )
    sub = p.add_subparsers(dest="command", required=True)

    ing = sub.add_parser("ingest", help="Fetch + upsert market daily bars.")
    mode = ing.add_mutually_exclusive_group(required=True)
    mode.add_argument("--backfill", action="store_true", help="~3 years of history.")
    mode.add_argument(
        "--incremental", action="store_true", help="Last ~5 trading days (idempotent re-run)."
    )
    mode.add_argument(
        "--smoke",
        action="store_true",
        help="Live smoke: last 5 trading days, index only. NOT run by tests.",
    )
    ing.add_argument(
        "--scope",
        choices=("index", "sector", "both", "breadth"),
        default="both",
        help="index=三大宽基, sector=申万一级, both=index+sector, breadth=市场广度(8.6). "
        "--smoke with breadth runs breadth; otherwise --smoke forces index.",
    )
    ing.add_argument(
        "-v", "--verbose", action="count", default=0, help="-v info, -vv debug."
    )
    ing.add_argument(
        "--from",
        dest="from_day",
        metavar="YYYY-MM-DD",
        default=None,
        help="Breadth --backfill only: inclusive start date. Requires --to. "
        "Narrows the run from the default 3-year window to [from, to].",
    )
    ing.add_argument(
        "--to",
        dest="to_day",
        metavar="YYYY-MM-DD",
        default=None,
        help="Breadth --backfill only: inclusive end date. Requires --from.",
    )

    sub.add_parser(
        "macro",
        help="Fetch China GDP/CPI YoY via akshare (Eastmoney), emit JSON-lines. Issue #69.",
    )

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _configure_logging(getattr(args, "verbose", 0))

    if args.command == "macro":
        return run_macro()

    if args.command != "ingest":
        return 2

    # --smoke is index-only by definition, UNLESS the caller explicitly asked for the
    # breadth scope (story 8.6: breadth has its own smoke channel, SMOKE_DAYS window).
    if args.smoke and args.scope == "breadth":
        scope = "breadth"
    else:
        scope = "index" if args.smoke else args.scope
    mode = "smoke" if args.smoke else ("backfill" if args.backfill else "incremental")

    exit_code = 0
    if scope == "breadth":
        override_start, override_end = _resolve_range(args)
        # --from/--to narrow a --backfill run; incremental/smoke windows are fixed and short.
        if (override_start is not None) and mode != "backfill":
            raise SystemExit("--from/--to are only valid with --backfill")
        rep = ingest_breadth(
            mode=mode, override_start=override_start, override_end=override_end
        )
        exit_code |= rep.exit_code
        _log_report(rep)
        return exit_code
    if scope in ("index", "both"):
        rep = ingest_indices(mode=mode)
        exit_code |= rep.exit_code
        _log_report(rep)
    if scope in ("sector", "both") and not args.smoke:
        rep = ingest_sectors(mode=mode)
        exit_code |= rep.exit_code
        _log_report(rep)
    return exit_code


def _parse_day(value: str | None, flag: str) -> date | None:
    """Parse a YYYY-MM-DD CLI arg; reject malformed values loudly."""
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"{flag} must be YYYY-MM-DD, got {value!r}")


def _resolve_range(args: argparse.Namespace) -> tuple[date | None, date | None]:
    """Validate --from/--to: both-or-neither.

    Returns (start, end) for ingest_breadth, both None when no override was requested.
    The backfill-only guard lives in main(), where the resolved mode is in scope.
    """
    start = _parse_day(args.from_day, "--from")
    end = _parse_day(args.to_day, "--to")
    if (start is None) != (end is None):
        raise SystemExit("--from and --to must be given together")
    return start, end


def _configure_logging(verbose: int) -> None:
    level = logging.DEBUG if verbose >= 2 else (logging.INFO if verbose == 1 else logging.WARNING)
    logging.basicConfig(
        level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )


def _log_report(rep: object) -> None:
    log = logging.getLogger("market_sidecar")
    log.info(
        "report scope=%s mode=%s items=%d ok=%d skipped=%d failed=%d bars=%d ratio=%.2f",
        rep.scope, rep.mode, rep.total_items, rep.ok_items, rep.skipped_items,
        rep.failed_items, rep.bars_written, rep.failure_ratio,
    )
    for s in rep.skips:
        log.warning("skip: %s", s)
    for f in rep.failures:
        log.error("fail: %s", f)


if __name__ == "__main__":
    sys.exit(main())
