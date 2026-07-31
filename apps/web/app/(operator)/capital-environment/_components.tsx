/**
 * Capital environment dashboard components (Issue #58).
 *
 * Renders a #55 replay result as a market × dimension grid with per-cell
 * evidence drill-down, plus the FR-009 interpretable conclusion. Server
 * components (no "use client") — data is passed in, no direct I/O here.
 */

import type {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "@aguhot/core";
import type {
  CapitalReplayDimension,
  CapitalReplayMarket,
  CapitalReplayResult,
} from "@aguhot/core";
import type { CapitalConclusion } from "@/lib/capital-conclusion";
import { cn } from "@/lib/utils";

const MARKET_LABELS: Record<CapitalMarket, string> = {
  global: "全球",
  us: "美国",
  cn: "中国",
  kr: "韩国",
};

const DIMENSION_LABELS: Record<CapitalDimension, string> = {
  growth: "增长",
  inflation: "通胀",
  liquidity: "流动性",
  funding_price: "资金价格",
  risk_credit: "风险偏好与信用",
  market_breadth: "市场宽度",
  institutional_positioning: "机构持仓与拥挤度",
};

function availabilityBadgeClass(availability: CapitalAvailability): string {
  switch (availability) {
    case "available":
      return "bg-market-up-soft text-market-up";
    case "partial":
      return "bg-surface-muted text-ink-secondary";
    case "unknown":
    case "failed":
    case "incomplete_reconstruction":
      return "bg-market-down-soft text-market-down";
    case "pending_review":
      return "bg-surface-muted text-ink-tertiary";
    default:
      return "bg-surface-muted text-ink-tertiary";
  }
}

function availabilityLabel(availability: CapitalAvailability): string {
  const labels: Record<CapitalAvailability, string> = {
    available: "可得",
    partial: "部分",
    unknown: "未知",
    failed: "失败",
    pending_review: "待复核",
    incomplete_reconstruction: "无法还原",
  };
  return labels[availability] ?? "未知";
}

function DimensionCell({ dimension }: { readonly dimension: CapitalReplayDimension }) {
  const valueRecord = dimension.records.find((r) => r.value !== null);
  const hasValue = valueRecord !== undefined && dimension.availability === "available";

  return (
    <details className="group rounded-lg border border-border-hairline bg-surface-raised px-4 py-3 open:bg-surface-base">
      <summary className="flex cursor-pointer items-center justify-between gap-2 list-none">
        <span className="text-sm font-medium text-ink-primary">
          {DIMENSION_LABELS[dimension.dimension]}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-xs",
            availabilityBadgeClass(dimension.availability),
          )}
        >
          {availabilityLabel(dimension.availability)}
        </span>
      </summary>

      <div className="mt-3 space-y-2 font-mono text-xs text-ink-secondary">
        {hasValue && valueRecord ? (
          <>
            <p className="text-ink-primary">
              观测值：<span className="font-semibold">{valueRecord.value} {valueRecord.unit}</span>
            </p>
            <p>来源：{valueRecord.source.id}（{valueRecord.source.name}）</p>
            <p>观测日期：{valueRecord.observedAt.slice(0, 10)}</p>
            <p>发布日期：{valueRecord.publishedAt?.slice(0, 10) ?? "未知"}</p>
            <p>处理版本：{valueRecord.processingVersion}</p>
            <p>覆盖状态：{availabilityLabel(valueRecord.availability)}</p>
          </>
        ) : (
          <>
            <p className="text-ink-tertiary">无可得数值（非零值）</p>
            {dimension.statusReason ? <p>原因：{dimension.statusReason}</p> : null}
          </>
        )}
      </div>
    </details>
  );
}

function MarketSection({ market }: { readonly market: CapitalReplayMarket }) {
  return (
    <section aria-label={`${MARKET_LABELS[market.market]}资本环境`} className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-primary">
          {MARKET_LABELS[market.market]}
        </h2>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-mono text-xs",
            availabilityBadgeClass(market.availability),
          )}
        >
          {availabilityLabel(market.availability)}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {market.dimensions.map((dim) => (
          <DimensionCell key={`${dim.market}|${dim.dimension}`} dimension={dim} />
        ))}
      </div>
    </section>
  );
}

/**
 * The full dashboard body. Receives the replay result + conclusion (both built
 * server-side) and renders them. Honest empty states: a fully-unknown replay
 * shows an explicit unavailable message, never fabricated values.
 */
export function CapitalEnvironmentDashboard({
  replay,
  conclusion,
}: {
  readonly replay: CapitalReplayResult;
  readonly conclusion: CapitalConclusion;
}) {
  const allUnknown = replay.availability === "unknown";

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border-hairline bg-surface-muted px-5 py-4">
        <p className="text-sm text-ink-secondary">{conclusion.overview}</p>
        <p className="mt-2 text-xs text-ink-tertiary">{conclusion.disclaimer}</p>
      </div>

      {allUnknown ? (
        <p className="rounded-lg border border-border-hairline bg-surface-raised px-5 py-8 text-center text-ink-tertiary">
          该日期无可得的资本环境数据。请选择一个有可靠数据的日期。
        </p>
      ) : (
        replay.markets.map((market) => (
          <MarketSection key={market.market} market={market} />
        ))
      )}
    </div>
  );
}
