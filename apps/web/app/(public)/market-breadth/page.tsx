import type { Metadata } from "next";

import {
  getPrisma,
  listPublishedMarketBreadthHistory,
  MARKET_BREADTH_HISTORY_DEFAULT_LIMIT,
  newTraceId,
} from "@aguhot/core";

export const metadata: Metadata = {
  title: "涨跌停历史",
  // §12 Q10: historical market statistics remain noindex until financial-information review clears.
  robots: { index: false, follow: false },
};

/**
 * Daily limit-pool history — Issue #33.
 *
 * This page reads ONLY the narrow published_market_breadth_daily projection. It never reaches the
 * Python-owned raw ingest table or calls AkShare at request time. The bounded query keeps the
 * public read predictable; an absent collection date remains absent instead of becoming a false 0.
 */
export const dynamic = "force-dynamic";

export default async function MarketBreadthPage() {
  const history = await listPublishedMarketBreadthHistory({
    prisma: getPrisma(),
    traceId: newTraceId(),
    limit: MARKET_BREADTH_HISTORY_DEFAULT_LIMIT,
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="space-y-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink-primary">
          涨跌停历史
        </h1>
        <p className="text-lg text-ink-secondary">A 股每日涨停、跌停家数</p>
        <div className="mt-3 flex items-start gap-2 border-t border-border-hairline pt-3">
          <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-secondary">
            说明
          </span>
          <p className="text-sm leading-relaxed text-ink-secondary">
            历史统计回顾，非预测、非投资建议。仅展示已成功采集的交易日；未采集或不可用日期不会以 0
            补齐。数据来源：AkShare 公开行情。
          </p>
        </div>
      </header>

      {history.length === 0 ? (
        <section className="mt-12 space-y-2" aria-label="涨跌停历史为空">
          <p className="text-base text-ink-tertiary">暂无已确认的涨跌停历史数据。</p>
          <p className="font-mono text-xs text-ink-tertiary">数据采集完成后将在此展示。</p>
        </section>
      ) : (
        <section className="mt-12" aria-labelledby="market-breadth-history-title">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="market-breadth-history-title"
              className="text-xl font-semibold text-ink-primary"
            >
              最近 {history.length} 个已采集交易日
            </h2>
            <p className="font-mono text-xs text-ink-tertiary">按交易日升序</p>
          </div>
          <div className="overflow-x-auto rounded border border-border-hairline">
            <table className="min-w-full text-sm" aria-label="历史每日涨跌停家数">
              <thead className="bg-surface-muted text-left text-xs text-ink-secondary">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    交易日
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-market-up">
                    涨停家数
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-market-down">
                    跌停家数
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((day) => {
                  const tradeDate = formatTradeDate(day.tradeDate);
                  return (
                    <tr
                      key={tradeDate}
                      data-testid={`market-breadth-row-${tradeDate}`}
                      className="border-t border-border-hairline"
                    >
                      <th
                        scope="row"
                        className="px-4 py-3 text-left font-mono font-normal text-ink-secondary"
                      >
                        {tradeDate}
                      </th>
                      <td className="px-4 py-3 text-right font-mono text-market-up">
                        {day.limitUpCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-market-down">
                        {day.limitDownCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function formatTradeDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
