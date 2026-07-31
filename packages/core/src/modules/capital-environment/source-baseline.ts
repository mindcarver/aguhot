import {
  CapitalFrequency,
  CapitalMarket,
  PublicationDateCapability,
  SourceReadiness,
} from "./types.js";
import type { CapitalSourceBaseline } from "./types.js";

/**
 * Source baseline for the first delivery. "Planned" means the public source
 * is identified but no adapter is wired. AkShare is deliberately "partial":
 * the existing sidecar provides A-share observations, but its current rows do
 * not carry a provider publication timestamp, so they cannot yet satisfy a
 * complete point-in-time replay contract.
 */
export const CAPITAL_SOURCE_BASELINE: readonly CapitalSourceBaseline[] = [
  {
    id: "cn-akshare-index-sector",
    market: CapitalMarket.China,
    provider: "AkShare",
    dataset: "A-share index and申万一级行业 daily bars",
    frequency: CapitalFrequency.Daily,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Existing sidecar backfill is configured for approximately three years; exact provider history is not guaranteed.",
    },
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
    snapshotCapability: true,
    readiness: SourceReadiness.Partial,
    documentationUrl: "https://github.com/akfamily/akshare",
    notes:
      "Current source stores observed trade dates and ingestion time, but no provider publication timestamp; retain as partial until a publication/vintage field is captured.",
  },
  {
    id: "cn-akshare-breadth",
    market: CapitalMarket.China,
    provider: "AkShare",
    dataset: "A-share limit pools, breadth, turnover and margin summaries",
    frequency: CapitalFrequency.Daily,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Limit-pool endpoints are empirically limited to recent trading days; do not claim a full historical series.",
    },
    publicationDateCapability: PublicationDateCapability.ObservationOnly,
    snapshotCapability: true,
    readiness: SourceReadiness.Partial,
    documentationUrl: "https://github.com/akfamily/akshare",
    notes:
      "A missing pool or failed source remains missing; the sidecar must not synthesize zero counts.",
  },
  {
    id: "us-fred",
    market: CapitalMarket.UnitedStates,
    provider: "Federal Reserve Bank of St. Louis",
    dataset: "FRED macro, rates and credit observations",
    frequency: CapitalFrequency.ReleaseDefined,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Dataset-specific; verify series coverage and vintage retention before adapter approval.",
    },
    publicationDateCapability: PublicationDateCapability.Unknown,
    snapshotCapability: false,
    readiness: SourceReadiness.Planned,
    documentationUrl: "https://fred.stlouisfed.org/",
    notes:
      "Candidate public source. No AGUHOT adapter is wired in this delivery.",
  },
  {
    id: "cn-nbs",
    market: CapitalMarket.China,
    provider: "National Bureau of Statistics of China",
    dataset: "China macroeconomic releases",
    frequency: CapitalFrequency.ReleaseDefined,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Series-specific; publication calendar and revision policy must be captured per indicator.",
    },
    publicationDateCapability: PublicationDateCapability.Unknown,
    snapshotCapability: false,
    readiness: SourceReadiness.Planned,
    documentationUrl: "https://data.stats.gov.cn/",
    notes:
      "Candidate public source. Field and revision mapping remains unimplemented.",
  },
  {
    id: "kr-ecos",
    market: CapitalMarket.Korea,
    provider: "Bank of Korea ECOS",
    dataset: "Korean macro, rates and liquidity observations",
    frequency: CapitalFrequency.ReleaseDefined,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Series-specific; verify release timestamps and vintage behavior before adapter approval.",
    },
    publicationDateCapability: PublicationDateCapability.Unknown,
    snapshotCapability: false,
    readiness: SourceReadiness.Planned,
    documentationUrl: "https://ecos.bok.or.kr/",
    notes:
      "Candidate public source. No AGUHOT adapter is wired in this delivery.",
  },
  {
    id: "kr-krx",
    market: CapitalMarket.Korea,
    provider: "Korea Exchange",
    dataset: "Korean equity index and market breadth observations",
    frequency: CapitalFrequency.Daily,
    historicalCoverage: {
      start: null,
      end: null,
      note: "Dataset-specific; verify downloadable history and publication timestamps per endpoint.",
    },
    publicationDateCapability: PublicationDateCapability.Unknown,
    snapshotCapability: false,
    readiness: SourceReadiness.Planned,
    documentationUrl: "https://global.krx.co.kr/",
    notes:
      "Candidate public source. Observation dates alone are insufficient for complete point-in-time replay.",
  },
];

export function listCapitalSourceBaseline(
  market?: CapitalMarket,
): CapitalSourceBaseline[] {
  return CAPITAL_SOURCE_BASELINE.filter(
    (source) => market === undefined || source.market === market,
  ).map((source) => ({
    ...source,
    historicalCoverage: { ...source.historicalCoverage },
  }));
}
