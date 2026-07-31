/**
 * US FRED capital provider adapter (Issue #52) — the first concrete
 * `CapitalProviderPort` implementation.
 *
 * Fetches five US macro/liquidity/risk series from the FRED REST API and
 * resolves each observation's `publishedAt` through the release calendar
 * (`series/releases → release/dates`). Per AD-CAP-2, `realtime_start` /
 * `realtime_end` are vintage boundaries and are NEVER used as `publishedAt`.
 *
 * Architecture authority: `.scd/designs/capital-provider-port.md` (AD-CAP-1/2/3).
 *
 * WHY THIS LIVES IN apps/worker, NOT core (mirrors headless-agent-targets-adapter):
 * the adapter performs external HTTP I/O. Core owns the `CapitalProviderPort`
 * interface and the append service; the worker owns this concrete adapter and
 * resolves it from env. Domain/publish modules never import this file.
 */

import type {
  CapitalProviderPort,
  CapitalProviderRequest,
  ProviderObservation,
  ProviderObservationBatch,
} from "@aguhot/core";
import {
  CapitalAvailability,
  CapitalDimension,
  CapitalMarket,
} from "@aguhot/core";

const PROVIDER_ID = "us-fred";
const FRED_API_BASE = "https://api.stlouisfed.org/fred";
const FRED_PROCESSING_VERSION = "fred-adapter-v1";
const REQUEST_TIMEOUT_MS = 30_000;

/** One FRED series mapped to its #43 catalog metricKey and unit. */
interface FredSeriesMapping {
  readonly seriesId: string;
  readonly metricKey: string;
  readonly dimension: CapitalDimension;
  /** Catalog unit the adapter normalizes the raw value into. */
  readonly unit: string;
  /**
   * Transform applied to the raw FRED value. GDPC1/CPIAUCSL are index/level
   * series; the dashboard wants year-over-year percent for growth/inflation.
   * `identity` leaves the value as-is (already in the target unit).
   */
  readonly valueTransform: "identity" | "year_over_year_percent";
}

/**
 * The five FRED series wired in #43's catalog (us-fred sourceId).
 * metricKey strings align exactly with `metric-catalog.ts`.
 */
const FRED_SERIES: readonly FredSeriesMapping[] = [
  {
    seriesId: "GDPC1",
    metricKey: "us-growth",
    dimension: CapitalDimension.Growth,
    unit: "percent",
    valueTransform: "year_over_year_percent",
  },
  {
    seriesId: "CPIAUCSL",
    metricKey: "us-inflation",
    dimension: CapitalDimension.Inflation,
    unit: "percent",
    valueTransform: "year_over_year_percent",
  },
  {
    seriesId: "WALCL",
    metricKey: "us-liquidity",
    dimension: CapitalDimension.Liquidity,
    unit: "millions USD",
    valueTransform: "identity",
  },
  {
    seriesId: "DFF",
    metricKey: "us-funding-price",
    dimension: CapitalDimension.FundingPrice,
    unit: "percent",
    valueTransform: "identity",
  },
  {
    seriesId: "BAMLH0A0HYM2",
    metricKey: "us-risk-credit",
    dimension: CapitalDimension.RiskCredit,
    unit: "percent",
    valueTransform: "identity",
  },
];

const FRED_SOURCE = {
  id: "us-fred",
  name: "Federal Reserve Economic Data",
  dataset: "FRED",
  documentationUrl: "https://fred.stlouisfed.org/",
} as const;

/** Injectable JSON transport so tests run offline against fixtures. */
export type FredTransport = (url: string) => Promise<unknown>;

export interface FredProviderAdapterOptions {
  readonly apiKey: string;
  /** Override the API base (testing). Defaults to the public FRED endpoint. */
  readonly apiBase?: string;
  /** Injectable transport (testing). Defaults to global fetch + timeout. */
  readonly transport?: FredTransport;
}

// ---- FRED wire types (the only place that knows the JSON shapes) ----

interface FredObservationWire {
  readonly realtime_start: string;
  readonly realtime_end: string;
  readonly date: string;
  readonly value: string;
}

interface FredObservationsResponse {
  readonly observations: readonly FredObservationWire[];
}

interface FredReleaseWire {
  readonly id: number;
  readonly name: string;
}

interface FredSeriesReleasesResponse {
  readonly releases: readonly FredReleaseWire[];
}

interface FredReleaseDateWire {
  readonly release_id: number;
  readonly date: string;
}

interface FredReleaseDatesResponse {
  readonly release_dates: readonly FredReleaseDateWire[];
}

function defaultTransport(): FredTransport {
  return async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(
          `[fred-adapter] ${url} failed: HTTP ${response.status} ${response.statusText}`,
        );
      }
      return response.json() as Promise<unknown>;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function buildUrl(
  apiBase: string,
  apiKey: string,
  path: string,
  params: Record<string, string>,
): string {
  const search = new URLSearchParams({
    ...params,
    api_key: apiKey,
    file_type: "json",
  });
  return `${apiBase}${path}?${search.toString()}`;
}

function parseIsoTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
}

/**
 * Apply the series value transform. `year_over_year_percent` needs the prior
 * period's value; when no prior is available the observation degrades to
 * unknown (the first data point of a series has no YoY).
 */
function applyTransform(
  current: number,
  prior: number | null,
  transform: FredSeriesMapping["valueTransform"],
): { value: number | null; degraded: boolean } {
  if (transform === "identity") return { value: current, degraded: false };
  if (prior === null || prior === 0) return { value: null, degraded: true };
  const yoy = ((current - prior) / prior) * 100;
  return { value: Math.round(yoy * 1e8) / 1e8, degraded: false };
}

export class FredProviderAdapter implements CapitalProviderPort {
  readonly providerId = PROVIDER_ID;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly transport: FredTransport;
  /** seriesId → release_id cache (AD-CAP-2: avoid re-fetching the mapping). */
  private readonly releaseIdCache = new Map<string, number | null>();
  /** release_id → sorted release date strings cache. */
  private readonly releaseDatesCache = new Map<number, readonly string[]>();

  constructor(options: FredProviderAdapterOptions) {
    this.apiKey = options.apiKey;
    this.apiBase = options.apiBase ?? FRED_API_BASE;
    this.transport = options.transport ?? defaultTransport();
  }

  async fetchObservations(
    request: CapitalProviderRequest,
  ): Promise<ProviderObservationBatch> {
    const observations: ProviderObservation[] = [];
    const failures: string[] = [];

    for (const series of FRED_SERIES) {
      try {
        const seriesObs = await this.fetchSeries(series, request);
        observations.push(...seriesObs);
      } catch (error) {
        const reason = (error as Error).message;
        failures.push(`${series.seriesId}: ${reason}`);
        observations.push(this.degradedSeries(series, request, reason));
      }
    }

    const availability =
      failures.length === 0
        ? CapitalAvailability.Available
        : failures.length === FRED_SERIES.length
          ? CapitalAvailability.Failed
          : CapitalAvailability.Partial;

    return {
      providerId: PROVIDER_ID,
      observations,
      availability,
      statusReason:
        failures.length > 0 ? `${failures.length}/${FRED_SERIES.length} series failed` : null,
    };
  }

  private async fetchSeries(
    series: FredSeriesMapping,
    request: CapitalProviderRequest,
  ): Promise<ProviderObservation[]> {
    const url = buildUrl(this.apiBase, this.apiKey, "/series/observations", {
      series_id: series.seriesId,
      observation_start: request.observedFrom,
      observation_end: request.observedTo,
      order_by: "observation_date",
      sort_order: "asc",
    });
    const wire = (await this.transport(url)) as FredObservationsResponse;
    const rows = Array.isArray(wire.observations) ? wire.observations : [];

    const releaseId = await this.resolveReleaseId(series.seriesId, request.traceId);
    const releaseDates =
      releaseId === null ? null : await this.resolveReleaseDates(releaseId, request.traceId);

    const result: ProviderObservation[] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const raw = Number(row.value);
      const priorRaw = index > 0 ? Number(rows[index - 1]!.value) : null;
      const observedAt = `${row.date}T00:00:00.000Z`;

      if (!Number.isFinite(raw)) {
        result.push(this.unknownObservation(series, observedAt, "FRED returned a non-numeric value"));
        continue;
      }

      const transformed = applyTransform(raw, priorRaw, series.valueTransform);
      const publishedAt =
        releaseDates === null ? null : this.matchReleaseDate(releaseDates, row.realtime_start);

      if (transformed.degraded) {
        result.push(
          this.unknownObservation(series, observedAt, "first period: no prior value for YoY transform"),
        );
        continue;
      }

      // When no verifiable publication date could be resolved, the observation
      // degrades to an honest non-value: publishedAt=null AND value/unit cleared,
      // so it never appears as a confirmed value without a publication date.
      const hasPublicationDate = publishedAt !== null;
      result.push({
        metricKey: series.metricKey,
        market: CapitalMarket.UnitedStates,
        dimension: series.dimension,
        value: hasPublicationDate ? transformed.value : null,
        unit: hasPublicationDate ? series.unit : null,
        observedAt,
        publishedAt,
        source: FRED_SOURCE,
        processingVersion: FRED_PROCESSING_VERSION,
        availability: hasPublicationDate
          ? CapitalAvailability.Available
          : CapitalAvailability.Unknown,
        statusReason: hasPublicationDate
          ? null
          : `release/dates has no publication date for ${row.date}; realtime_start ${row.realtime_start} not used as publishedAt`,
        revision: 1,
      });
    }
    return result;
  }

  /**
   * AD-CAP-2 step 1: resolve a series to its release_id via series/releases.
   * Cached per seriesId. Returns null when the mapping is ambiguous (multiple
   * releases) or absent — the caller degrades rather than guessing.
   */
  private async resolveReleaseId(seriesId: string, traceId: string): Promise<number | null> {
    if (this.releaseIdCache.has(seriesId)) {
      return this.releaseIdCache.get(seriesId) ?? null;
    }
    const url = buildUrl(this.apiBase, this.apiKey, "/series/releases", {
      series_id: seriesId,
    });
    const wire = (await this.transport(url)) as FredSeriesReleasesResponse;
    const releases = Array.isArray(wire.releases) ? wire.releases : [];
    const releaseId = releases.length === 1 ? releases[0]!.id : null;
    this.releaseIdCache.set(seriesId, releaseId);
    if (releaseId === null && traceId !== "") {
      console.warn(
        `[fred-adapter] ${seriesId} has ${releases.length} releases; publishedAt degraded to null`,
      );
    }
    return releaseId;
  }

  /**
   * AD-CAP-2 step 2: fetch the release's publication dates. Cached per
   * release_id. Returns the sorted list of date strings.
   */
  private async resolveReleaseDates(
    releaseId: number,
    traceId: string,
  ): Promise<readonly string[]> {
    const cached = this.releaseDatesCache.get(releaseId);
    if (cached !== undefined) return cached;
    const url = buildUrl(this.apiBase, this.apiKey, "/release/dates", {
      release_id: String(releaseId),
      order_by: "release_date",
      sort_order: "asc",
    });
    const wire = (await this.transport(url)) as FredReleaseDatesResponse;
    const dates = (Array.isArray(wire.release_dates) ? wire.release_dates : [])
      .map((entry) => entry.date)
      .sort((a, b) => parseIsoTimestamp(`${a}T00:00:00.000Z`) - parseIsoTimestamp(`${b}T00:00:00.000Z`));
    this.releaseDatesCache.set(releaseId, dates);
    if (dates.length === 0 && traceId !== "") {
      console.warn(`[fred-adapter] release ${releaseId} has no release dates`);
    }
    return dates;
  }

  /**
   * Find the publication date for an observation. A release date qualifies when
   * it is on or after the observation's `realtime_start` — the vintage boundary
   * marking when this observation first became available in FRED. The earliest
   * qualifying release date is the publication date.
   *
   * AD-CAP-2: `realtime_start` is used only as a matching boundary to locate the
   * correct release entry; it is never returned as `publishedAt`. The value of
   * `publishedAt` always comes from the `release/dates` endpoint.
   */
  private matchReleaseDate(
    releaseDates: readonly string[],
    realtimeStart: string,
  ): string | null {
    const vintageTs = parseIsoTimestamp(`${realtimeStart}T00:00:00.000Z`);
    for (const date of releaseDates) {
      if (parseIsoTimestamp(`${date}T00:00:00.000Z`) >= vintageTs) {
        return `${date}T00:00:00.000Z`;
      }
    }
    return null;
  }

  private unknownObservation(
    series: FredSeriesMapping,
    observedAt: string,
    reason: string,
  ): ProviderObservation {
    return {
      metricKey: series.metricKey,
      market: CapitalMarket.UnitedStates,
      dimension: series.dimension,
      value: null,
      unit: null,
      observedAt,
      publishedAt: null,
      source: FRED_SOURCE,
      processingVersion: FRED_PROCESSING_VERSION,
      availability: CapitalAvailability.Unknown,
      statusReason: reason,
      revision: 1,
    };
  }

  /** A series that failed entirely degrades to a single unknown observation. */
  private degradedSeries(
    series: FredSeriesMapping,
    request: CapitalProviderRequest,
    reason: string,
  ): ProviderObservation {
    return this.unknownObservation(
      series,
      request.observedTo,
      `series ${series.seriesId} fetch failed: ${reason}`,
    );
  }
}
