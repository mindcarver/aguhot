-- Repair the 2026-07-16 crash-day breadth gap without overwriting any later capture.
--
-- Values are sourced and cross-checked as follows:
--   - 涨/跌/平 2495/2860/169: Wind's end-of-day count reported by Sina Finance,
--     https://finance.sina.com.cn/jjxw/2026-07-16/doc-inihyuqe1263055.shtml
--     (the report's universe is 沪深两市及北交所, matching stock_zh_a_spot*).
--   - 两市成交额 2,407,628,000,000 yuan: the completed-day totals from
--     stock_sse_deal_daily (11,250.74 亿元) and stock_szse_summary
--     (1,282,554,000,000 yuan). The sidecar now uses these exchange summaries as
--     its dated fallback when the index-history provider fails.
--
-- `COALESCE` makes this safe on databases that were already repaired by a later
-- successful capture. The published projection is updated in the same migration so
-- the public detail page does not wait for the next scheduled refresh.
UPDATE market_breadth_daily
SET
  advancing_count = COALESCE(advancing_count, 2495),
  declining_count = COALESCE(declining_count, 2860),
  flat_count = COALESCE(flat_count, 169),
  total_turnover = COALESCE(total_turnover, 2407628000000)
WHERE trade_date = DATE '2026-07-16';

UPDATE published_crash_days
SET breadth = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        breadth,
        '{advancingCount}',
        COALESCE(NULLIF(breadth -> 'advancingCount', 'null'::jsonb), '2495'::jsonb)
      ),
      '{decliningCount}',
      COALESCE(NULLIF(breadth -> 'decliningCount', 'null'::jsonb), '2860'::jsonb)
    ),
    '{flatCount}',
    COALESCE(NULLIF(breadth -> 'flatCount', 'null'::jsonb), '169'::jsonb)
  ),
  '{totalTurnover}',
  COALESCE(NULLIF(breadth -> 'totalTurnover', 'null'::jsonb), '2407628000000'::jsonb)
)
WHERE trade_date = DATE '2026-07-16' AND breadth IS NOT NULL;
