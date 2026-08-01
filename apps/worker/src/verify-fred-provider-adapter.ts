/**
 * Deterministic acceptance checks for Issue #52's US FRED provider adapter.
 *
 * Runs entirely offline: an injectable FredTransport returns fixture JSON, so
 * no real FRED API call is made and CI is not gated on network or credentials.
 * A minimal inline fake Prisma exercises the end-to-end path through #51's
 * appendCapitalProviderObservations → #47's listCapitalDataRecordsAt.
 *
 * Fixture release IDs (RELEASE_ID_*) match the live FRED `/releases` table and
 * the adapter's pre-seeded `releaseId` values — this regression-guards the bug
 * where `/series/releases` returns HTTP 404 for these series (verified against
 * the live API), which had left every publishedAt null and the dashboard empty.
 */

import {
  CapitalAvailability,
  appendCapitalProviderObservations,
  getPrisma,
  listCapitalDataRecordsAt,
} from "@aguhot/core";
import { FredProviderAdapter, type FredTransport } from "./fred-provider-adapter.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

// ---- minimal fake Prisma (mirrors the #47/#51 selfcheck pattern) ----

type StoredRow = Record<string, unknown> & { recordKey: string; id: string };

function fakePrisma() {
  const rows = new Map<string, StoredRow>();
  const client = {
    capitalEnvironmentRecord: {
      async findUnique({ where }: { where: { recordKey: string } }) {
        return rows.get(where.recordKey) ?? null;
      },
      async create({ data }: { data: StoredRow }) {
        if (rows.has(data.recordKey)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        rows.set(data.recordKey, data);
        return data;
      },
      async findMany({
        where,
      }: {
        where?: {
          metricKey?: string;
          market?: string;
          OR?: readonly [
            { publishedAt: { lte: Date } },
            { publishedAt: null; asOf: { lte: Date } },
          ];
        };
      } = {}) {
        const cutoff = where?.OR?.[0]?.publishedAt.lte;
        const fallbackCutoff = where?.OR?.[1]?.asOf.lte;
        return [...rows.values()].filter((row) => {
          if (where?.metricKey !== undefined && row.metricKey !== where.metricKey) return false;
          if (where?.market !== undefined && row.market !== where.market) return false;
          if (cutoff !== undefined && fallbackCutoff !== undefined) {
            const publishedAt = row.publishedAt as Date | null;
            const asOf = row.asOf as Date;
            if (publishedAt !== null ? publishedAt > cutoff : asOf > fallbackCutoff) return false;
          }
          return true;
        });
      },
    },
  } as unknown as ReturnType<typeof getPrisma>;
  return { client, rows };
}

// ---- FRED wire fixtures (release IDs match the live FRED release table) ----

// Real FRED release IDs (verified via /releases + /release/dates on the live API).
// These mirror the pre-seeded releaseId values in FredSeriesMapping.
const RELEASE_ID_GDP = 53; // Gross Domestic Product (GDPC1)
const RELEASE_ID_CPI = 10; // Consumer Price Index (CPIAUCSL)
const RELEASE_ID_BOFA = 209; // ICE BofA Indices (BAMLH0A0HYM2)

/**
 * GDPC1 observations. realtime_start is the vintage boundary (when the value
 * first appeared in FRED), NOT the publication date. The 2024-01-01 obs's
 * earliest qualifying release date (>= its observation date) is 2024-01-25 →
 * that becomes publishedAt; the 2023-10-01 obs is the first period (no prior
 * for YoY → degraded).
 */
const gdpObservations = {
  observations: [
    { realtime_start: "2024-01-25", realtime_end: "2024-02-28", date: "2023-10-01", value: "22500" },
    { realtime_start: "2024-04-25", realtime_end: "2024-05-30", date: "2024-01-01", value: "22750" },
  ],
};
const gdpReleaseDates = {
  release_dates: [
    { release_id: RELEASE_ID_GDP, date: "2024-01-25" },
    { release_id: RELEASE_ID_GDP, date: "2024-04-25" },
  ],
};

/**
 * CPIAUCSL observations. Both have qualifying release dates → both produce
 * publishedAt (after YoY transform). 2024-02 is the first period (degraded).
 */
const cpiObservations = {
  observations: [
    { realtime_start: "2024-03-12", realtime_end: "2024-04-09", date: "2024-02-01", value: "310" },
    { realtime_start: "2024-04-10", realtime_end: "2024-05-13", date: "2024-03-01", value: "312" },
  ],
};
const cpiReleaseDates = {
  release_dates: [
    { release_id: RELEASE_ID_CPI, date: "2024-03-12" },
    { release_id: RELEASE_ID_CPI, date: "2024-04-10" },
  ],
};

/**
 * BAMLH0A0HYM2 observations. identity transform → no degradation. realtime_start
 * 2024-02-05 matches a release date; realtime_start 2024-03-15 has no later
 * release date → publishedAt=null → unknown.
 */
const bofaObservations = {
  observations: [
    { realtime_start: "2024-02-05", realtime_end: "2024-03-04", date: "2024-02-02", value: "5.8" },
    { realtime_start: "2024-03-15", realtime_end: "2024-04-12", date: "2024-03-01", value: "5.9" },
  ],
};
const bofaReleaseDates = {
  release_dates: [{ release_id: RELEASE_ID_BOFA, date: "2024-02-05" }],
};

/**
 * DFF observations — used to verify honest degradation. DFF has NO pre-seeded
 * releaseId (release 472 has zero release dates on the live API), so the
 * dynamic `/series/releases` fallback runs and returns empty → releaseId=null
 * → publishedAt=null → unknown for every observation.
 */
const dffObservations = {
  observations: [
    { realtime_start: "2024-02-04", realtime_end: "2024-02-10", date: "2024-01-31", value: "5.5" },
    { realtime_start: "2024-02-02", realtime_end: "2024-02-08", date: "2024-02-01", value: "5.49" },
  ],
};

/**
 * Per-series FRED responses. The transport routes by endpoint path AND
 * series_id/release_id, since a URL like `/release/dates?release_id=53` contains
 * both the path and the param.
 */
interface FredFixture {
  /** seriesId → observations response. */
  readonly observations?: Record<string, unknown>;
  /** seriesId → series/releases response (only hit for series without a pre-seeded releaseId). */
  readonly releases?: Record<string, unknown>;
  /** releaseId (as string) → release/dates response. */
  readonly releaseDates?: Record<string, unknown>;
}

function param(url: string, name: string): string | undefined {
  const query = url.split("?")[1];
  if (query === undefined) return undefined;
  return new URLSearchParams(query).get(name) ?? undefined;
}

function fixtureTransport(fixture: FredFixture): FredTransport {
  return async (url: string) => {
    if (url.includes("/series/observations")) {
      const id = param(url, "series_id");
      const payload = id !== undefined ? fixture.observations?.[id] : undefined;
      if (payload !== undefined) return payload;
      return { observations: [] };
    }
    if (url.includes("/series/releases")) {
      const id = param(url, "series_id");
      const payload = id !== undefined ? fixture.releases?.[id] : undefined;
      if (payload !== undefined) return payload;
      return { releases: [] };
    }
    if (url.includes("/release/dates")) {
      const id = param(url, "release_id");
      const payload = id !== undefined ? fixture.releaseDates?.[id] : undefined;
      if (payload !== undefined) return payload;
      return { release_dates: [] };
    }
    throw new Error(`fixture transport: no match for ${url}`);
  };
}

/**
 * Full fixture covering all 5 series for end-to-end / multi-series checks. Only
 * series with a pre-seeded releaseId (GDPC1/CPIAUCSL/BAMLH0A0HYM2) provide
 * release/dates; DFF/WALCL have no seed and the dynamic fallback returns empty
 * releases (mirroring the live 404), so they degrade to unknown.
 */
function fullFixture(overrides: Partial<FredFixture> = {}): FredFixture {
  return {
    observations: {
      GDPC1: gdpObservations,
      CPIAUCSL: cpiObservations,
      BAMLH0A0HYM2: bofaObservations,
      DFF: dffObservations,
      WALCL: { observations: [] },
    },
    releases: {
      // DFF/WALCL have no pre-seeded releaseId → the dynamic fallback calls
      // /series/releases, which returns empty (live API: 404). Both degrade.
      DFF: { releases: [] },
      WALCL: { releases: [] },
    },
    releaseDates: {
      [String(RELEASE_ID_GDP)]: gdpReleaseDates,
      [String(RELEASE_ID_CPI)]: cpiReleaseDates,
      [String(RELEASE_ID_BOFA)]: bofaReleaseDates,
    },
    ...overrides,
  };
}

/** Transport where series/releases returns MULTIPLE releases (ambiguous → null). */
function multiReleaseTransport(): FredTransport {
  return async (url: string) => {
    if (url.includes("/series/observations")) {
      if (url.includes("series_id=DFF")) return dffObservations;
      return { observations: [] };
    }
    if (url.includes("/series/releases")) {
      return { releases: [{ id: 1, name: "A" }, { id: 2, name: "B" }] };
    }
    if (url.includes("/release/dates")) return { release_dates: [] };
    throw new Error(`multi-release transport: no match for ${url}`);
  };
}

/** Transport where every FRED call throws (full failure). */
function failingTransport(): FredTransport {
  return async () => {
    throw new Error("FRED API rate limit exceeded");
  };
}

/** Count how many times the transport was called for a given path. */
function countingTransport(inner: FredTransport) {
  const counts = new Map<string, number>();
  const wrapped: FredTransport = async (url: string) => {
    let key = "other";
    if (url.includes("/series/releases")) key = "series/releases";
    else if (url.includes("/release/dates")) key = "release/dates";
    else if (url.includes("/series/observations")) key = "series/observations";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return inner(url);
  };
  return { transport: wrapped, counts };
}

const assertions: Assertion[] = [];
const request = {
  observedFrom: "2024-01-01",
  observedTo: "2024-12-31",
  traceId: "fred-selfcheck-trace",
};

// A1: adapter implements CapitalProviderPort with providerId="us-fred".
const adapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
assertions.push({
  name: "A1 adapter implements CapitalProviderPort with providerId us-fred",
  ok: adapter.providerId === "us-fred" && typeof adapter.fetchObservations === "function",
});

// A2: pre-seeded releaseId resolves publishedAt from release/dates (not realtime_start).
// GDPC1 2024-01-01 obs: releaseId=53 seeded, earliest release date >= 2024-01-01 is
// 2024-01-25 → publishedAt=2024-01-25.
const gdpAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
const gdpBatch = await gdpAdapter.fetchObservations(request);
const gdpObs = gdpBatch.observations.filter((o) => o.metricKey === "us-growth");
const gdpYoY = gdpObs.find((o) => o.observedAt === "2024-01-01T00:00:00.000Z");
const gdpFirst = gdpObs.find((o) => o.observedAt === "2023-10-01T00:00:00.000Z");
assertions.push({
  name: "A2 pre-seeded releaseId resolves publishedAt from release/dates (GDPC1)",
  ok:
    gdpYoY?.publishedAt === "2024-01-25T00:00:00.000Z" &&
    gdpYoY?.value !== null &&
    Math.abs((gdpYoY!.value as number) - 1.11111111) < 1e-6 &&
    gdpYoY?.unit === "percent" &&
    gdpYoY?.availability === CapitalAvailability.Available,
  detail: JSON.stringify(gdpYoY),
});
assertions.push({
  name: "A2 first GDPC1 period degrades (no prior for YoY)",
  ok:
    gdpFirst?.value === null &&
    gdpFirst?.availability === CapitalAvailability.Unknown &&
    gdpFirst?.statusReason?.includes("no prior value") === true,
  detail: JSON.stringify(gdpFirst),
});

// A2: CPIAUCSL + BAMLH0A0HYM2 also resolve publishedAt via their pre-seeded releaseIds.
const cpiBatch = await new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
}).fetchObservations(request);
const cpiObs = cpiBatch.observations.filter((o) => o.metricKey === "us-inflation");
const cpiPublished = cpiObs.find((o) => o.observedAt === "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A2 pre-seeded releaseId resolves publishedAt (CPIAUCSL)",
  ok:
    cpiPublished?.publishedAt === "2024-03-12T00:00:00.000Z" &&
    cpiPublished?.availability === CapitalAvailability.Available &&
    cpiPublished?.value !== null,
  detail: JSON.stringify(cpiPublished),
});

const bofaBatch = await new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
}).fetchObservations(request);
const bofaObs = bofaBatch.observations.filter((o) => o.metricKey === "us-risk-credit");
const bofaPublished = bofaObs.find((o) => o.observedAt === "2024-02-02T00:00:00.000Z");
assertions.push({
  name: "A2 pre-seeded releaseId resolves publishedAt (BAMLH0A0HYM2)",
  ok:
    bofaPublished?.publishedAt === "2024-02-05T00:00:00.000Z" &&
    bofaPublished?.value === 5.8 &&
    bofaPublished?.availability === CapitalAvailability.Available,
  detail: JSON.stringify(bofaPublished),
});

// A3: DFF (no pre-seeded releaseId + empty /series/releases) → publishedAt=null,
// unknown, no realtime_start fallback. This is the honest-degradation guarantee
// for series whose release has no publication calendar (live release 472 = 0 dates).
const dffAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
const dffBatch = await dffAdapter.fetchObservations(request);
const dffObs = dffBatch.observations.filter((o) => o.metricKey === "us-funding-price");
assertions.push({
  name: "A3 no releaseId + no qualifying release date → publishedAt=null, unknown (DFF)",
  ok:
    dffObs.length === 2 &&
    dffObs.every(
      (o) =>
        o.publishedAt === null &&
        o.availability === CapitalAvailability.Unknown &&
        o.value === null &&
        o.statusReason?.includes("not used as publishedAt") === true,
    ),
  detail: JSON.stringify(dffObs),
});

// A3: BAMLH0A0HYM2 observation whose realtime_start (2024-03-15) is after the
// last release date (2024-02-05) → no qualifying release date → publishedAt=null.
const bofaUnpublished = bofaObs.find((o) => o.observedAt === "2024-03-01T00:00:00.000Z");
assertions.push({
  name: "A3 seeded releaseId but no qualifying release date → publishedAt=null, unknown",
  ok:
    bofaUnpublished?.publishedAt === null &&
    bofaUnpublished?.availability === CapitalAvailability.Unknown &&
    bofaUnpublished?.value === null,
  detail: JSON.stringify(bofaUnpublished),
});

// A3: multiple releases → releaseId=null → publishedAt=null (no guess).
const multiAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: multiReleaseTransport(),
});
const multiBatch = await multiAdapter.fetchObservations(request);
const multiDff = multiBatch.observations.filter((o) => o.metricKey === "us-funding-price");
assertions.push({
  name: "A3 ambiguous (multiple) releases → publishedAt=null, not guessed",
  ok:
    multiDff.length === 2 &&
    multiDff.every((o) => o.publishedAt === null && o.availability === CapitalAvailability.Unknown),
  detail: JSON.stringify(multiDff),
});

// A4: full failure → batch availability=failed, does not throw, degrades each series.
const failAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: failingTransport(),
});
let failThrew = false;
let failBatch;
try {
  failBatch = await failAdapter.fetchObservations(request);
} catch {
  failThrew = true;
}
assertions.push({
  name: "A4 full API failure returns failed batch without throwing",
  ok:
    !failThrew &&
    failBatch !== undefined &&
    failBatch.availability === CapitalAvailability.Failed &&
    failBatch.observations.length === 5 &&
    failBatch.observations.every((o) => o.availability === CapitalAvailability.Unknown),
  detail: JSON.stringify({ availability: failBatch?.availability, count: failBatch?.observations.length }),
});

// A5: caching — observations per series; series/releases + release/dates cached.
// GDPC1/CPIAUCSL/BAMLH0A0HYM2 use pre-seeded releaseId (no /series/releases call);
// only DFF/WALCL fall back to /series/releases (2 calls). The 3 seeded releases
// each fetch /release/dates once, cached across both fetchObservations calls.
const counter = countingTransport(fixtureTransport(fullFixture()));
const cacheAdapter = new FredProviderAdapter({ apiKey: "test-key", transport: counter.transport });
await cacheAdapter.fetchObservations(request);
await cacheAdapter.fetchObservations(request);
const srCount = counter.counts.get("series/releases") ?? 0;
const rdCount = counter.counts.get("release/dates") ?? 0;
assertions.push({
  name: "A5 seeded releaseId skips /series/releases; both endpoints cached across fetches",
  ok: srCount === 2 && rdCount === 3,
  detail: JSON.stringify({ seriesReleasesCalls: srCount, releaseDatesCalls: rdCount }),
});

// A6: end-to-end — adapter output → #51 appendCapitalProviderObservations → #47 read-back.
const store = fakePrisma();
const e2eAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
const e2eBatch = await e2eAdapter.fetchObservations(request);
const e2eResult = await appendCapitalProviderObservations(store.client, e2eBatch, {
  asOf: "2024-12-31T00:00:00.000Z",
  traceId: request.traceId,
});
// GDPC1 publishedAt 2024-01-25 is visible at a 2024-05 cutoff.
const visible = await listCapitalDataRecordsAt(store.client, "2024-05-15T00:00:00.000Z");
const visibleGdp = visible.filter((r) => r.metricKey === "us-growth");
assertions.push({
  name: "A6 end-to-end: adapter → append → listCapitalDataRecordsAt point-in-time read-back",
  ok:
    e2eResult.inserted > 0 &&
    visibleGdp.some(
      (r) =>
        r.publishedAt === "2024-01-25T00:00:00.000Z" &&
        r.availability === CapitalAvailability.Available &&
        r.value !== null,
    ),
  detail: JSON.stringify({ inserted: e2eResult.inserted, visibleGdpCount: visibleGdp.length }),
});

// A7: ISO timestamps in observedFrom/observedTo are truncated to YYYY-MM-DD.
// FRED's observation_start/observation_end reject ISO 8601 timestamps (HTTP
// 400); regression-guards the bug where a full-timestamp window left every
// series fetch failing with 400 and degrading to unknown.
let observedUrl: string | undefined;
const capturingTransport: FredTransport = async (url) => {
  if (url.includes("/series/observations")) observedUrl = url;
  return fixtureTransport(fullFixture())(url);
};
const tsAdapter = new FredProviderAdapter({ apiKey: "test-key", transport: capturingTransport });
const tsBatch = await tsAdapter.fetchObservations({
  observedFrom: "2024-01-01T12:34:56.789Z",
  observedTo: "2024-12-31T23:59:59.999Z",
  traceId: "fred-timestamp-trace",
});
const tsGdp = tsBatch.observations.find((o) => o.metricKey === "us-growth" && o.value !== null);
assertions.push({
  name: "A7 ISO timestamp window truncated to YYYY-MM-DD (no HTTP 400, observations fetched)",
  ok:
    observedUrl !== undefined &&
    !observedUrl!.includes("T") &&
    !observedUrl!.includes("%3A") &&
    tsGdp?.availability === CapitalAvailability.Available &&
    tsGdp?.publishedAt === "2024-01-25T00:00:00.000Z",
  detail: JSON.stringify({ observedUrl, tsGdpAvailable: tsGdp?.availability }),
});

const failed = assertions.filter((a) => !a.ok);
for (const a of assertions) {
  console.log(`${a.ok ? "PASS" : "FAIL"} ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
}
if (failed.length > 0) {
  console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed.`);
  process.exit(1);
}
console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
