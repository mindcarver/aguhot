"""CLI entry: `python -m market_sidecar ingest --backfill --scope index`.

Subcommands:
  ingest  The only command. Modes (mutually exclusive):
    --backfill      ~3 years of history (AC1/AC2)
    --incremental   last ~5 trading days (AC3 idempotency re-run)
    --smoke         live smoke: last 5 trading days, index only (NOT run by tests)

Scopes:
    --scope index   三大宽基
    --scope sector  申万一级
  (omitting --scope runs both; --smoke forces index only)

Exit code: 0 on success or below-threshold failures; 1 if the failure ratio
exceeded FAILURE_THRESHOLD (scheduler retry signal, AD-4).

This is a manually-runnable CLI only — scheduling wiring (BullMQ/cron) is out of
scope for story 8.1 (deferred to a later 8.x story).
"""

from __future__ import annotations

import argparse
import logging
import sys

from .ingest import ingest_indices, ingest_sectors


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
        choices=("index", "sector", "both"),
        default="both",
        help="index=三大宽基, sector=申万一级, both=both. --smoke forces index.",
    )
    ing.add_argument(
        "-v", "--verbose", action="count", default=0, help="-v info, -vv debug."
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _configure_logging(args.verbose)

    if args.command != "ingest":
        return 2

    # --smoke is index-only by definition.
    scope = "index" if args.smoke else args.scope
    mode = "smoke" if args.smoke else ("backfill" if args.backfill else "incremental")

    exit_code = 0
    if scope in ("index", "both"):
        rep = ingest_indices(mode=mode)
        exit_code |= rep.exit_code
        _log_report(rep)
    if scope in ("sector", "both") and not args.smoke:
        rep = ingest_sectors(mode=mode)
        exit_code |= rep.exit_code
        _log_report(rep)
    return exit_code


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
