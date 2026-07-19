-- Preserve the full-precision exchange total returned by the sidecar parser.
-- The preceding incident migration used the exchange tables' display-rounded values.
-- This correction applies only to that exact value; a subsequent successful capture wins.
UPDATE market_breadth_daily
SET total_turnover = 2407627704765.26
WHERE trade_date = DATE '2026-07-16' AND total_turnover = 2407628000000;

UPDATE published_crash_days
SET breadth = jsonb_set(breadth, '{totalTurnover}', '2407627704765.26'::jsonb)
WHERE trade_date = DATE '2026-07-16'
  AND breadth IS NOT NULL
  AND breadth ->> 'totalTurnover' = '2407628000000';
