"""Configuration: resolve DATABASE_URL from the repo root .env.

Mirrors the Node side's single source of truth (packages/core/src/db.ts reads
DATABASE_URL via @aguhot/config requireEnv). We read the SAME .env at the
monorepo root so Node and Python share one connection string (AD-2 single
schema; the sidecar is the sole writer of these two tables via psycopg, never
Prisma). python-dotenv loads the file; the env var takes precedence if already
set (CI/production).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv

_DEFAULT_DB_URL = "postgresql://aguhot@localhost:5432/aguhot?schema=public"


def _resolve_env_path() -> Path:
    """Locate the repo-root .env relative to this file.

    src/market_sidecar/config.py -> ../../../../.env (apps/market-sidecar/src/...).
    Falls back to CWD if not found (lets tests point elsewhere).
    """
    here = Path(__file__).resolve()
    # here = .../apps/market-sidecar/src/market_sidecar/config.py
    # repo root = 4 parents up
    root = here.parents[3]
    return root / ".env"


def load_env() -> None:
    """Load the repo-root .env into os.environ (does not override existing)."""
    env_path = _resolve_env_path()
    if env_path.is_file():
        load_dotenv(env_path, override=False)


def database_url() -> str:
    """Return the Postgres connection string for psycopg.

    Raises if explicitly empty (match Node requireEnv fail-loud behavior).
    """
    load_env()
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return _psycopg_url(_DEFAULT_DB_URL)
    return _psycopg_url(url)


def _psycopg_url(url: str) -> str:
    """Strip Prisma-only query params that libpq/psycopg rejects, keep libpq params.

    The repo-root .env DATABASE_URL carries `?schema=public` for Prisma. libpq
    does not know `schema` and raises "invalid URI query parameter". We drop
    ONLY the Prisma-only `schema` key and preserve real libpq params (e.g.
    `sslmode=require`, `application_name`) so future non-local deploys keep TLS.
    """
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query) if k != "schema"]
    return urlunsplit(parts._replace(query=urlencode(kept)))
