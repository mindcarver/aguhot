"""AGUHOT market history daily-bars sidecar.

A Python 3.12 runtime (AD-1's third runtime) that translates external A-share
market sources into rows. It owns NO domain aggregate root and contains NO
domain rules (boundary == RSSHub self-host collector). It is the impl side of
the MarketDataAdapter port (AD-7): Node domain modules read the two Postgres
tables it writes; they never call AkShare.

Tables (Node/Prisma owns the schema; this sidecar writes via psycopg raw SQL):
  - index_daily_bars  (三大宽基 daily pct_change + close)
  - sector_daily_bars (申万一级行业 daily pct_change + close)
"""

__version__ = "0.0.0"
