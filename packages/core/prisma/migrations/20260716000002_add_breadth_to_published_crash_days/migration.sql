-- Story 8.7: add the market-breadth projection column to published_crash_days.
--
-- `breadth` is the CrashDayBreadth projection materialized from market_breadth_daily (8.6) by
-- refreshPublishedCrashDays (publish-orchestrator, AD-3 single write-owner). It is the SOLE
-- breadth surface the /crash-calendar/[date] deep-detail page (8.8) consumes; the page never
-- reads market_breadth_daily directly.
--
-- NULLABLE (NFR-5 honest empty, never fabricated): a crash day whose market_breadth_daily row is
-- absent (sidecar has not run that day / predates breadth collection) OR whose breadth read
-- failed projects `breadth = NULL`. The breadth read is wrapped in an inner try/catch inside the
-- per-date projection loop — a breadth failure NEVER blocks the published crash-day row from
-- being upserted (row existence = published). Existing rows get `breadth = NULL` automatically
-- (ADD COLUMN ... JSONB defaults to NULL); they are backfilled on the next refresh run.
--
-- Forward-only ALTER (Epic-7 dev-DB drift blocks `migrate dev`, so this is applied via
-- `prisma migrate deploy`). Mirrors the 8.6 breadth-table migration: JSONB (not JSON) so the
-- projection's nested object (counts + turnover + margin + dragonTiger) indexes/queries as a
-- structured value if a later story needs it.

ALTER TABLE "published_crash_days" ADD COLUMN "breadth" JSONB;
