import {
  assertCapitalDataRecord,
  CapitalAvailability,
  CapitalCatalogStatus,
  CapitalDimension,
  CapitalFrequency,
  CapitalMarket,
  CapitalRevisionCapability,
  PublicationDateCapability,
} from "./types.js";
import type {
  CapitalDataRecord,
  CapitalMetricCatalogEntry,
  CapitalMetricHistoricalCoverage,
  CapitalMetricSourceFieldMapping,
  CapitalSourceReference,
} from "./types.js";

const UTC = "UTC";
const GLOBAL_CANDIDATE_URL = "https://fred.stlouisfed.org/";
const NBS_URL = "https://data.stats.gov.cn/";
const ECOS_URL = "https://ecos.bok.or.kr/";
const KRX_URL = "https://global.krx.co.kr/";
const AKSHARE_URL = "https://github.com/akfamily/akshare";

const coverage = (note: string): CapitalMetricHistoricalCoverage => ({
  start: null,
  end: null,
  note,
});

const candidateSource = (
  sourceId: string,
  provider: string,
  dataset: string,
  valueField: string | null,
  observedAtField: string | null,
  publishedAtField: string | null,
  unitField: string | null,
  evidenceUrl: string,
  notes: string,
  options: {
    valueFields?: readonly string[];
    valueTransform?: string;
    rawUnit?: string | null;
    publicationDateCapability?: PublicationDateCapability;
  } = {},
): CapitalMetricSourceFieldMapping => ({
  sourceId,
  provider,
  dataset,
  valueField,
  valueFields:
    options.valueFields ?? (valueField === null ? [] : [valueField]),
  valueTransform: options.valueTransform ?? "identity",
  rawUnit: options.rawUnit ?? null,
  observedAtField,
  publishedAtField,
  unitField,
  publicationDateCapability:
    options.publicationDateCapability ?? PublicationDateCapability.Unknown,
  evidenceUrl,
  notes,
});

const FRED = (
  dataset: string,
  series: string,
  rawUnit: string,
  valueTransform = "identity",
): CapitalMetricSourceFieldMapping =>
  candidateSource(
    "us-fred",
    "Federal Reserve Bank of St. Louis",
    dataset,
    series,
    "date",
    null,
    "units",
    "https://fred.stlouisfed.org/",
    "FRED realtime_start 是 vintage query boundary，不是 release timestamp；必须连接 release dates endpoint 后才能满足 published_at。",
    { rawUnit, valueTransform },
  );

const NBS = (
  dataset: string,
  field: string,
  rawUnit: string,
): CapitalMetricSourceFieldMapping =>
  candidateSource(
    "cn-nbs",
    "National Bureau of Statistics of China",
    dataset,
    field,
    "period",
    "release_date",
    "unit",
    NBS_URL,
    "候选国家统计局字段；发布日期、修订和历史快照能力尚未在 AGUHOT 内核验。",
    { rawUnit },
  );

const ECOS = (
  dataset: string,
  field: string,
  rawUnit: string,
): CapitalMetricSourceFieldMapping =>
  candidateSource(
    "kr-ecos",
    "Bank of Korea ECOS",
    dataset,
    field,
    "TIME",
    "release_date",
    "UNIT",
    ECOS_URL,
    "候选 BOK ECOS 字段；接口发布时间和 vintage 保留能力尚未在 AGUHOT 内核验。",
    { rawUnit },
  );

const KRX = (
  dataset: string,
  field: string | null,
  rawUnit: string,
  options: {
    valueFields?: readonly string[];
    valueTransform?: string;
  } = {},
): CapitalMetricSourceFieldMapping =>
  candidateSource(
    "kr-krx",
    "Korea Exchange",
    dataset,
    field,
    "trade_date",
    null,
    null,
    KRX_URL,
    "候选 KRX 字段；观察日期可得不等于已具备点时发布日期能力，保持 planned。",
    { rawUnit, ...options },
  );

const GLOBAL = (
  dataset: string,
): CapitalMetricSourceFieldMapping =>
  candidateSource(
    "global-public-candidate",
    "Public global macro candidates",
    dataset,
    null,
    null,
    null,
    null,
    GLOBAL_CANDIDATE_URL,
    "仅记录候选来源方向；未核验具体系列、发布日期或历史 vintage，不能升级为 available。",
  );

const AKSHARE_BREADTH = candidateSource(
  "cn-akshare-breadth",
  "AkShare",
  "A-share breadth and turnover summaries",
  null,
  "交易日期",
  null,
  null,
  AKSHARE_URL,
  "现有 sidecar 的 limit-pool/breadth endpoint 只覆盖近期日期且无 provider 发布日期。",
  {
    valueFields: ["上涨家数", "下跌家数"],
    valueTransform: "independent_scalar_fields",
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
  },
);

const AKSHARE_INDEX = candidateSource(
  "cn-akshare-index-sector",
  "AkShare",
  "A-share index and申万一级行业 daily bars",
  "收盘",
  "日期",
  null,
  null,
  AKSHARE_URL,
  "现有 sidecar 记录观察交易日但没有 provider 发布日期，因此只能作为 partial 辅助字段映射。",
  { publicationDateCapability: PublicationDateCapability.ObservationOnly },
);

const metric = (
  metricKey: string,
  market: CapitalMarket,
  dimension: CapitalDimension,
  label: string,
  status: CapitalCatalogStatus,
  sourceFieldMapping: CapitalMetricSourceFieldMapping | null,
  unit: string | null,
  frequency: CapitalFrequency,
  observedAtRule: string,
  publishedAtRule: string,
  historicalCoverage: CapitalMetricHistoricalCoverage,
  revisionCapability: CapitalRevisionCapability,
  snapshotCapability: boolean,
  degradationReason: string | null,
  relatedSourceFieldMappings: readonly CapitalMetricSourceFieldMapping[] = [],
): CapitalMetricCatalogEntry => ({
  metricKey,
  market,
  dimension,
  label,
  status,
  sourceFieldMapping,
  relatedSourceFieldMappings,
  unit,
  frequency,
  timezone: UTC,
  observedAtRule,
  publishedAtRule,
  historicalCoverage,
  revisionCapability,
  snapshotCapability,
  evidenceUrl: sourceFieldMapping?.evidenceUrl ?? null,
  degradationReason,
});

const plannedReason =
  "候选来源和字段已登记，但采集适配器、发布日期和历史版本能力尚未核验。";
const unavailableReason =
  "当前 approved V1 source baseline 没有可验证、可保存快照且具备该维度口径的来源；保持不可用，不用零值补齐。";

/**
 * Stable source-field catalog for global, US, China and Korea. There is one
 * primary metric entry for each market/dimension pair (4 × 7 = 28). Planned
 * entries intentionally describe candidates only; they do not claim that a
 * provider adapter or point-in-time history already exists.
 */
export const CAPITAL_METRIC_CATALOG: readonly CapitalMetricCatalogEntry[] = [
  // Global common environment.
  metric(
    "global-growth",
    CapitalMarket.Global,
    CapitalDimension.Growth,
    "全球增长",
    CapitalCatalogStatus.Planned,
    GLOBAL("Global growth reference series"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "来源观测期或参考期",
    "以来源明确的公开发布日期为准；未提供时不可用于点时回放",
    coverage("全球参考系列待选定并核验历史覆盖。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "global-inflation",
    CapitalMarket.Global,
    CapitalDimension.Inflation,
    "全球通胀",
    CapitalCatalogStatus.Planned,
    GLOBAL("Global inflation reference series"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "来源观测期",
    "来源公开发布日期",
    coverage("全球参考系列待选定并核验历史覆盖。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "global-liquidity",
    CapitalMarket.Global,
    CapitalDimension.Liquidity,
    "全球流动性",
    CapitalCatalogStatus.Planned,
    GLOBAL("Global liquidity reference series"),
    "index",
    CapitalFrequency.ReleaseDefined,
    "来源观测期",
    "来源公开发布日期",
    coverage("全球参考系列待选定并核验历史覆盖。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "global-funding-price",
    CapitalMarket.Global,
    CapitalDimension.FundingPrice,
    "全球资金价格",
    CapitalCatalogStatus.Planned,
    GLOBAL("Global funding-price reference series"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "来源观测期",
    "来源公开发布日期",
    coverage("全球参考系列待选定并核验历史覆盖。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "global-risk-credit",
    CapitalMarket.Global,
    CapitalDimension.RiskCredit,
    "全球风险偏好与信用",
    CapitalCatalogStatus.Planned,
    GLOBAL("Global credit and risk reference series"),
    "spread",
    CapitalFrequency.ReleaseDefined,
    "来源观测期",
    "来源公开发布日期",
    coverage("全球参考系列待选定并核验历史覆盖。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "global-market-breadth",
    CapitalMarket.Global,
    CapitalDimension.MarketBreadth,
    "全球市场宽度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Unknown,
    "无可验证来源",
    "无可验证来源",
    coverage("当前没有纳入首版的可审计全球宽度来源。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),
  metric(
    "global-institutional-positioning",
    CapitalMarket.Global,
    CapitalDimension.InstitutionalPositioning,
    "全球机构持仓与拥挤度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Unknown,
    "无可验证来源",
    "无可验证来源",
    coverage("首版没有全球机构持仓统一披露口径。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),

  // United States.
  metric(
    "us-growth",
    CapitalMarket.UnitedStates,
    CapitalDimension.Growth,
    "美国增长",
    CapitalCatalogStatus.Planned,
    FRED(
      "Real GDP",
      "GDPC1",
      "billions of chained 2017 dollars",
      "year_over_year_percent",
    ),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "FRED observation date",
    "FRED release dates endpoint must be joined; realtime_start is not published_at",
    coverage("FRED series-specific; exact vintage retention must be verified."),
    CapitalRevisionCapability.ProviderVintage,
    false,
    plannedReason,
  ),
  metric(
    "us-inflation",
    CapitalMarket.UnitedStates,
    CapitalDimension.Inflation,
    "美国通胀",
    CapitalCatalogStatus.Planned,
    FRED(
      "Consumer Price Index for All Urban Consumers",
      "CPIAUCSL",
      "index 1982-1984=100",
    ),
    "index",
    CapitalFrequency.ReleaseDefined,
    "FRED observation date",
    "FRED release dates endpoint must be joined; realtime_start is not published_at",
    coverage("FRED series-specific; exact vintage retention must be verified."),
    CapitalRevisionCapability.ProviderVintage,
    false,
    plannedReason,
  ),
  metric(
    "us-liquidity",
    CapitalMarket.UnitedStates,
    CapitalDimension.Liquidity,
    "美国流动性",
    CapitalCatalogStatus.Planned,
    FRED("Federal Reserve total assets", "WALCL", "millions of USD"),
    "millions USD",
    CapitalFrequency.ReleaseDefined,
    "FRED observation date",
    "FRED release dates endpoint must be joined; realtime_start is not published_at",
    coverage("FRED series-specific; exact vintage retention must be verified."),
    CapitalRevisionCapability.ProviderVintage,
    false,
    plannedReason,
  ),
  metric(
    "us-funding-price",
    CapitalMarket.UnitedStates,
    CapitalDimension.FundingPrice,
    "美国资金价格",
    CapitalCatalogStatus.Planned,
    FRED("Effective Federal Funds Rate", "DFF", "percent"),
    "percent",
    CapitalFrequency.Daily,
    "FRED observation date",
    "FRED release dates endpoint must be joined; realtime_start is not published_at",
    coverage("FRED series-specific; exact vintage retention must be verified."),
    CapitalRevisionCapability.ProviderVintage,
    false,
    plannedReason,
  ),
  metric(
    "us-risk-credit",
    CapitalMarket.UnitedStates,
    CapitalDimension.RiskCredit,
    "美国风险偏好与信用",
    CapitalCatalogStatus.Planned,
    FRED(
      "ICE BofA US High Yield Option-Adjusted Spread",
      "BAMLH0A0HYM2",
      "percent",
    ),
    "percent",
    CapitalFrequency.Daily,
    "FRED observation date",
    "FRED release dates endpoint must be joined; realtime_start is not published_at",
    coverage("FRED series-specific; exact vintage retention must be verified."),
    CapitalRevisionCapability.ProviderVintage,
    false,
    plannedReason,
  ),
  metric(
    "us-market-breadth",
    CapitalMarket.UnitedStates,
    CapitalDimension.MarketBreadth,
    "美国市场宽度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Unknown,
    "无已核验来源",
    "无已核验来源",
    coverage("首版未接入可保存快照的美国全市场宽度来源。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),
  metric(
    "us-institutional-positioning",
    CapitalMarket.UnitedStates,
    CapitalDimension.InstitutionalPositioning,
    "美国机构持仓与拥挤度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Unknown,
    "无已核验来源",
    "无已核验来源",
    coverage("首版未固定可审计的美国机构持仓样本和披露口径。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),

  // China.
  metric(
    "cn-growth",
    CapitalMarket.China,
    CapitalDimension.Growth,
    "中国增长",
    CapitalCatalogStatus.Planned,
    NBS("National accounts release", "gdp_yoy", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "NBS period",
    "NBS release_date",
    coverage("国家统计局系列和修订规则需逐字段核验。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "cn-inflation",
    CapitalMarket.China,
    CapitalDimension.Inflation,
    "中国通胀",
    CapitalCatalogStatus.Planned,
    NBS("Consumer price index release", "cpi_yoy", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "NBS period",
    "NBS release_date",
    coverage("国家统计局系列和修订规则需逐字段核验。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "cn-liquidity",
    CapitalMarket.China,
    CapitalDimension.Liquidity,
    "中国流动性",
    CapitalCatalogStatus.Planned,
    NBS("Money supply release", "m2_yoy", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "NBS period",
    "NBS release_date",
    coverage("国家统计局系列和修订规则需逐字段核验。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "cn-funding-price",
    CapitalMarket.China,
    CapitalDimension.FundingPrice,
    "中国资金价格",
    CapitalCatalogStatus.Planned,
    NBS("Funding price reference release", "funding_rate", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "NBS period or source trading date",
    "source release_date",
    coverage("首版来源基线未核验中国资金价格字段和发布规则。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "cn-risk-credit",
    CapitalMarket.China,
    CapitalDimension.RiskCredit,
    "中国风险偏好与信用",
    CapitalCatalogStatus.Planned,
    NBS("Credit impulse reference release", "credit_growth_yoy", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "NBS period",
    "NBS release_date",
    coverage("首版来源基线未核验中国信用字段和修订规则。"),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "cn-market-breadth",
    CapitalMarket.China,
    CapitalDimension.MarketBreadth,
    "A 股市场宽度",
    CapitalCatalogStatus.Partial,
    AKSHARE_BREADTH,
    "count",
    CapitalFrequency.Daily,
    "AkShare 交易日期",
    "无 provider published_at；只能以采集观察时间记录并保持 partial",
    coverage("Limit-pool/breadth endpoint 仅经验性覆盖近期交易日。"),
    CapitalRevisionCapability.ObservationOnly,
    true,
    "现有 AkShare sidecar 无 provider 发布日期，无法满足完整点时回放；空响应和失败必须保留为 unknown/failed。",
    [AKSHARE_INDEX],
  ),
  metric(
    "cn-institutional-positioning",
    CapitalMarket.China,
    CapitalDimension.InstitutionalPositioning,
    "中国机构持仓与拥挤度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Quarterly,
    "无已核验基金披露来源（由 Issue #44 负责）",
    "无已核验基金披露来源",
    coverage("公募基金样本和披露字段属于独立 Issue #44，当前不提前声明覆盖。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),

  // Korea.
  metric(
    "kr-growth",
    CapitalMarket.Korea,
    CapitalDimension.Growth,
    "韩国增长",
    CapitalCatalogStatus.Planned,
    ECOS("National accounts", "GDP_REAL_YOY", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "ECOS TIME",
    "ECOS release_date",
    coverage("ECOS series-specific; release timestamp and vintage behavior require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-inflation",
    CapitalMarket.Korea,
    CapitalDimension.Inflation,
    "韩国通胀",
    CapitalCatalogStatus.Planned,
    ECOS("Consumer price index", "CPI_YOY", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "ECOS TIME",
    "ECOS release_date",
    coverage("ECOS series-specific; release timestamp and vintage behavior require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-liquidity",
    CapitalMarket.Korea,
    CapitalDimension.Liquidity,
    "韩国流动性",
    CapitalCatalogStatus.Planned,
    ECOS("Broad money", "M2", "local currency"),
    "local currency",
    CapitalFrequency.ReleaseDefined,
    "ECOS TIME",
    "ECOS release_date",
    coverage("ECOS series-specific; release timestamp and vintage behavior require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-funding-price",
    CapitalMarket.Korea,
    CapitalDimension.FundingPrice,
    "韩国资金价格",
    CapitalCatalogStatus.Planned,
    ECOS("Base rate", "BASE_RATE", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "ECOS TIME",
    "ECOS release_date",
    coverage("ECOS series-specific; release timestamp and vintage behavior require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-risk-credit",
    CapitalMarket.Korea,
    CapitalDimension.RiskCredit,
    "韩国风险偏好与信用",
    CapitalCatalogStatus.Planned,
    ECOS("Credit spread reference", "CREDIT_SPREAD", "percent"),
    "percent",
    CapitalFrequency.ReleaseDefined,
    "ECOS TIME",
    "ECOS release_date",
    coverage("ECOS series-specific; release timestamp and vintage behavior require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-market-breadth",
    CapitalMarket.Korea,
    CapitalDimension.MarketBreadth,
    "韩国市场宽度",
    CapitalCatalogStatus.Planned,
    KRX(
      "Equity market breadth",
      null,
      "count",
      {
        valueFields: ["advancing_issues", "declining_issues"],
        valueTransform: "independent_scalar_fields",
      },
    ),
    "count",
    CapitalFrequency.Daily,
    "KRX trade_date",
    "KRX endpoint publication timestamp (must be verified)",
    coverage("KRX downloadable history and publication timestamp require verification."),
    CapitalRevisionCapability.Unknown,
    false,
    plannedReason,
  ),
  metric(
    "kr-institutional-positioning",
    CapitalMarket.Korea,
    CapitalDimension.InstitutionalPositioning,
    "韩国机构持仓与拥挤度",
    CapitalCatalogStatus.Unavailable,
    null,
    null,
    CapitalFrequency.Quarterly,
    "无已核验来源",
    "无已核验来源",
    coverage("首版没有固定韩国机构持仓样本和披露口径。"),
    CapitalRevisionCapability.None,
    false,
    unavailableReason,
  ),
] as const;

const STATUS_TO_AVAILABILITY: Record<
  CapitalCatalogStatus,
  CapitalAvailability
> = {
  [CapitalCatalogStatus.Confirmed]: CapitalAvailability.Available,
  [CapitalCatalogStatus.Partial]: CapitalAvailability.Partial,
  [CapitalCatalogStatus.Planned]: CapitalAvailability.Unknown,
  [CapitalCatalogStatus.Unavailable]: CapitalAvailability.Unknown,
};

export interface CapitalMetricMappingObservation {
  sourceId: string;
  dataset: string;
  valueField: string | null;
  valueFields: readonly string[];
  valueTransform: string;
  rawUnit: string | null;
  observedAtField: string | null;
  publishedAtField: string | null;
  unitField: string | null;
  publicationDateCapability: PublicationDateCapability;
}

export type CapitalMetricRecordMetadata = Pick<
  CapitalDataRecord,
  "metricKey" | "market" | "dimension" | "unit" | "source"
>;

export interface CapitalMetricObservationInput {
  id: string;
  value: number | null;
  observedAt: string;
  publishedAt: string | null;
  asOf: string;
  processingVersion: string;
  revision: number;
  statusReason?: string | null;
}

/**
 * Project catalog identity/provenance into the corresponding
 * `CapitalDataRecord` fields. Entries without a verified source deliberately
 * refuse this projection; they must be represented as unknown/unavailable
 * outside the numeric record path rather than receiving a fabricated source.
 */
export function capitalMetricRecordMetadata(
  entry: CapitalMetricCatalogEntry,
): CapitalMetricRecordMetadata {
  const mapping = entry.sourceFieldMapping;
  if (
    mapping === null ||
    entry.status === CapitalCatalogStatus.Planned ||
    entry.status === CapitalCatalogStatus.Unavailable
  ) {
    throw new Error(
      `Metric ${entry.metricKey} has no verified source mapping for a ${entry.status} catalog entry; use degradation instead of a CapitalDataRecord`,
    );
  }
  const source: CapitalSourceReference = {
    id: mapping.sourceId,
    name: mapping.provider,
    dataset: mapping.dataset,
    documentationUrl: mapping.evidenceUrl,
  };
  return {
    metricKey: entry.metricKey,
    market: entry.market,
    dimension: entry.dimension,
    unit: entry.unit,
    source,
  };
}

/**
 * Convert one raw metric observation into the shared point-in-time record.
 * A partial source without a provider publication field is intentionally
 * withheld as `unknown` with a null value; it must not be forced through the
 * `Partial` numeric branch, because the #41 contract requires publishedAt for
 * every numeric available/partial record. Composite fields (for example
 * advancing and declining counts) are also withheld until a separate scalar
 * metric is defined.
 */
export function mapCapitalMetricObservationToRecord(
  entry: CapitalMetricCatalogEntry,
  input: CapitalMetricObservationInput,
): CapitalDataRecord {
  const mapping = entry.sourceFieldMapping;
  if (mapping === null) {
    throw new Error(
      `Metric ${entry.metricKey} has no source mapping; cannot create a provenance record`,
    );
  }

  const scalarValue = mapping.valueFields.length === 1 &&
    mapping.valueTransform !== "independent_scalar_fields";
  const pointInTimeComplete =
    mapping.publishedAtField !== null && input.publishedAt !== null;
  const canCarryNumericValue =
    (entry.status === CapitalCatalogStatus.Confirmed ||
      entry.status === CapitalCatalogStatus.Partial) &&
    scalarValue &&
    pointInTimeComplete &&
    input.value !== null;
  const availability = canCarryNumericValue
    ? entry.status === CapitalCatalogStatus.Confirmed
      ? CapitalAvailability.Available
      : CapitalAvailability.Partial
    : CapitalAvailability.Unknown;
  const reason = canCarryNumericValue
    ? input.statusReason ?? null
    : input.statusReason ??
      (mapping.publishedAtField === null
        ? "来源没有 provider published_at 字段，无法满足完整点时记录；保留为 unknown。"
        : !scalarValue
          ? "来源包含多个独立数值字段，尚未定义单值聚合；保留为 unknown。"
          : entry.status === CapitalCatalogStatus.Planned
            ? "来源能力尚未核验；planned 指标不得生成数值记录。"
            : "观测值或发布日期缺失，保留为 unknown。");
  const record: CapitalDataRecord = {
    id: input.id,
    metricKey: entry.metricKey,
    market: entry.market,
    dimension: entry.dimension,
    value: canCarryNumericValue ? input.value : null,
    unit: canCarryNumericValue ? entry.unit : null,
    observedAt: input.observedAt,
    publishedAt: input.publishedAt,
    asOf: input.asOf,
    source: {
      id: mapping.sourceId,
      name: mapping.provider,
      dataset: mapping.dataset,
      documentationUrl: mapping.evidenceUrl,
    },
    processingVersion: input.processingVersion,
    availability,
    statusReason: reason,
    revision: input.revision,
  };
  assertCapitalDataRecord(record);
  return record;
}

/**
 * Convert catalog readiness into the record-level availability vocabulary.
 * Planned and unavailable catalog entries intentionally become `unknown`,
 * never a zero-valued available record.
 */
export function catalogStatusToAvailability(
  status: CapitalCatalogStatus,
): CapitalAvailability {
  return STATUS_TO_AVAILABILITY[status];
}

/**
 * Compare an observed source schema against the approved mapping. Any source,
 * dataset, field or unit drift is an explicit pending-review state; adapters
 * must not silently promote a changed provider payload.
 */
export function evaluateCapitalMetricMapping(
  entry: CapitalMetricCatalogEntry,
  observed: CapitalMetricMappingObservation,
): CapitalAvailability {
  const expected = entry.sourceFieldMapping;
  if (
    expected === null ||
    expected.sourceId !== observed.sourceId ||
    expected.dataset !== observed.dataset ||
    expected.valueField !== observed.valueField ||
    JSON.stringify(expected.valueFields) !== JSON.stringify(observed.valueFields) ||
    expected.valueTransform !== observed.valueTransform ||
    expected.rawUnit !== observed.rawUnit ||
    expected.observedAtField !== observed.observedAtField ||
    expected.publishedAtField !== observed.publishedAtField ||
    expected.unitField !== observed.unitField ||
    expected.publicationDateCapability !== observed.publicationDateCapability
  ) {
    return CapitalAvailability.PendingReview;
  }
  return catalogStatusToAvailability(entry.status);
}

function cloneEntry(entry: CapitalMetricCatalogEntry): CapitalMetricCatalogEntry {
  return {
    ...entry,
    historicalCoverage: { ...entry.historicalCoverage },
    sourceFieldMapping:
      entry.sourceFieldMapping === null
        ? null
        : { ...entry.sourceFieldMapping },
    relatedSourceFieldMappings: entry.relatedSourceFieldMappings.map((mapping) => ({
      ...mapping,
    })),
  };
}

export function listCapitalMetricCatalog(
  market?: CapitalMarket,
): CapitalMetricCatalogEntry[] {
  return CAPITAL_METRIC_CATALOG.filter(
    (entry) => market === undefined || entry.market === market,
  ).map(cloneEntry);
}

export function getCapitalMetricCatalogEntry(
  metricKey: string,
): CapitalMetricCatalogEntry | undefined {
  const entry = CAPITAL_METRIC_CATALOG.find(
    (candidate) => candidate.metricKey === metricKey,
  );
  return entry === undefined ? undefined : cloneEntry(entry);
}

export function validateCapitalMetricCatalogEntry(
  entry: CapitalMetricCatalogEntry,
): string[] {
  const errors: string[] = [];
  if (!entry.metricKey.trim()) errors.push("metricKey is required");
  if (!entry.label.trim()) errors.push("label is required");
  if (!entry.timezone.trim()) errors.push("timezone is required");
  if (!entry.observedAtRule.trim()) errors.push("observedAtRule is required");
  if (!entry.publishedAtRule.trim()) errors.push("publishedAtRule is required");
  if (!entry.historicalCoverage.note.trim()) {
    errors.push("historicalCoverage.note is required");
  }
  if (entry.status === CapitalCatalogStatus.Confirmed) {
    if (entry.sourceFieldMapping === null) {
      errors.push("confirmed entries require sourceFieldMapping");
    }
    if (!entry.unit?.trim()) errors.push("confirmed entries require unit");
    if (!entry.evidenceUrl?.trim()) errors.push("confirmed entries require evidenceUrl");
    if (entry.degradationReason !== null) {
      errors.push("confirmed entries cannot carry degradationReason");
    }
  } else if (!entry.degradationReason?.trim()) {
    errors.push("degraded entries require degradationReason");
  }
  if (entry.sourceFieldMapping !== null) {
    const mapping = entry.sourceFieldMapping;
    if (!mapping.sourceId.trim()) errors.push("sourceFieldMapping.sourceId is required");
    if (!mapping.provider.trim()) errors.push("sourceFieldMapping.provider is required");
    if (!mapping.dataset.trim()) errors.push("sourceFieldMapping.dataset is required");
    if (!mapping.notes.trim()) errors.push("sourceFieldMapping.notes is required");
    if (!mapping.valueTransform.trim()) {
      errors.push("sourceFieldMapping.valueTransform is required");
    }
    if (
      mapping.valueFields.length === 1 &&
      mapping.valueField !== mapping.valueFields[0]
    ) {
      errors.push("sourceFieldMapping.valueField must match its single valueFields entry");
    }
    if (mapping.valueFields.length > 1 && mapping.valueField !== null) {
      errors.push("composite valueFields must not claim one scalar valueField");
    }
  }
  entry.relatedSourceFieldMappings.forEach((mapping, index) => {
    if (!mapping.sourceId.trim()) {
      errors.push(`relatedSourceFieldMappings[${index}].sourceId is required`);
    }
    if (!mapping.provider.trim()) {
      errors.push(`relatedSourceFieldMappings[${index}].provider is required`);
    }
    if (!mapping.dataset.trim()) {
      errors.push(`relatedSourceFieldMappings[${index}].dataset is required`);
    }
    if (!mapping.notes.trim()) {
      errors.push(`relatedSourceFieldMappings[${index}].notes is required`);
    }
    if (!mapping.valueTransform.trim()) {
      errors.push(`relatedSourceFieldMappings[${index}].valueTransform is required`);
    }
    if (
      mapping.valueFields.length === 1 &&
      mapping.valueField !== mapping.valueFields[0]
    ) {
      errors.push(
        `relatedSourceFieldMappings[${index}].valueField must match its single valueFields entry`,
      );
    }
    if (mapping.valueFields.length > 1 && mapping.valueField !== null) {
      errors.push(
        `relatedSourceFieldMappings[${index}] composite valueFields must not claim one scalar valueField`,
      );
    }
  });
  return errors;
}

export function assertCapitalMetricCatalogEntry(
  entry: CapitalMetricCatalogEntry,
): void {
  const errors = validateCapitalMetricCatalogEntry(entry);
  if (errors.length > 0) {
    throw new Error(`Invalid capital metric catalog entry ${entry.metricKey}: ${errors.join("; ")}`);
  }
}
