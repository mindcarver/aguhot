/**
 * Deterministic acceptance checks for Issue #52's US FRED provider adapter.
 *
 * Runs entirely offline: an injectable FredTransport returns fixture JSON, so
 * no real FRED API call is made and CI is not gated on network or credentials.
 * A minimal inline fake Prisma exercises the end-to-end path through #51's
 * appendCapitalProviderObservations → #47's listCapitalDataRecordsAt.
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

// ---- FRED wire fixtures ----

const RELEASE_ID_DFF = 123;
const RELEASE_ID_GDP = 53;

/**
 * DFF observations. realtime_start is the vintage boundary (when the value first
 * appeared in FRED), NOT the publication date. The 2024-02-01 observation's
 * realtime_start (2024-02-02) matches release date 2024-02-02. The 2024-01-31
 * observation's realtime_start (2024-02-04) is after the last release date →
 * no match → publishedAt=null → unknown.
 */
const dffObservations = {
  observations: [
    {
      realtime_start: "2024-02-04",
      realtime_end: "2024-02-10",
      date: "2024-01-31",
      value: "5.5",
    },
    {
      realtime_start: "2024-02-02",
      realtime_end: "2024-02-08",
      date: "2024-02-01",
      value: "5.49",
    },
  ],
};

const dffReleases = { releases: [{ id: RELEASE_ID_DFF, name: "Selected Interest Rates" }] };
const dffReleaseDates = {
  release_dates: [
    { release_id: RELEASE_ID_DFF, date: "2024-02-02" },
    { release_id: RELEASE_ID_DFF, date: "2024-02-03" },
  ],
};

const gdpObservations = {
  observations: [
    { realtime_start: "2024-01-25", realtime_end: "2024-02-28", date: "2023-10-01", value: "22500" },
    { realtime_start: "2024-04-25", realtime_end: "2024-05-30", date: "2024-01-01", value: "22750" },
  ],
};
const gdpReleases = { releases: [{ id: RELEASE_ID_GDP, name: "Gross Domestic Product" }] };
const gdpReleaseDates = {
  release_dates: [
    { release_id: RELEASE_ID_GDP, date: "2024-01-25" },
    { release_id: RELEASE_ID_GDP, date: "2024-04-25" },
  ],
};

/**
 * Per-series FRED responses for one or more series. The transport routes by
 * endpoint path AND series_id/release_id, since a URL like
 * `/series/releases?series_id=DFF` contains both the path and the param.
 */
interface FredFixture {
  /** seriesId → observations response. */
  readonly observations?: Record<string, unknown>;
  /** seriesId → series/releases response. */
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

/** Full fixture covering all 5 series for end-to-end / multi-series checks. */
function fullFixture(overrides: Partial<FredFixture> = {}): FredFixture {
  return {
    observations: {
      DFF: dffObservations,
      GDPC1: gdpObservations,
      CPIAUCSL: { observations: [] },
      WALCL: { observations: [] },
      BAMLH0A0HYM2: { observations: [] },
    },
    releases: {
      DFF: dffReleases,
      GDPC1: gdpReleases,
      CPIAUCSL: { releases: [] },
      WALCL: { releases: [] },
      BAMLH0A0HYM2: { releases: [] },
    },
    releaseDates: {
      [String(RELEASE_ID_DFF)]: dffReleaseDates,
      [String(RELEASE_ID_GDP)]: gdpReleaseDates,
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

// A2/A3: DFF observations — publishedAt comes from release/dates, NOT realtime_start.
// The 2024-02-01 obs has a qualifying release date (2024-02-02); the 2024-01-31 obs
// has no qualifying release date → publishedAt=null → unknown.
const dffAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
const dffBatch = await dffAdapter.fetchObservations(request);
const dffObs = dffBatch.observations.filter((o) => o.metricKey === "us-funding-price");
const dffPublished = dffObs.find((o) => o.observedAt === "2024-02-01T00:00:00.000Z");
const dffUnpublished = dffObs.find((o) => o.observedAt === "2024-01-31T00:00:00.000Z");
assertions.push({
  name: "A2 publishedAt resolved from release/dates (not realtime_start)",
  ok:
    dffPublished?.publishedAt === "2024-02-02T00:00:00.000Z" &&
    dffPublished?.value === 5.49 &&
    dffPublished?.availability === CapitalAvailability.Available,
  detail: JSON.stringify(dffPublished),
});
assertions.push({
  name: "A3 no qualifying release date → publishedAt=null, unknown, no realtime_start fallback",
  ok:
    dffUnpublished?.publishedAt === null &&
    dffUnpublished?.availability === CapitalAvailability.Unknown &&
    dffUnpublished?.value === null &&
    dffUnpublished?.statusReason?.includes("not used as publishedAt") === true,
  detail: JSON.stringify(dffUnpublished),
});

// A2: GDPC1 YoY transform — (22750-22500)/22500*100 ≈ 1.1111%.
const gdpAdapter = new FredProviderAdapter({
  apiKey: "test-key",
  transport: fixtureTransport(fullFixture()),
});
const gdpBatch = await gdpAdapter.fetchObservations(request);
const gdpObs = gdpBatch.observations.filter((o) => o.metricKey === "us-growth");
const gdpYoY = gdpObs.find((o) => o.observedAt === "2024-01-01T00:00:00.000Z");
const gdpFirst = gdpObs.find((o) => o.observedAt === "2023-10-01T00:00:00.000Z");
assertions.push({
  name: "A2 GDPC1 year_over_year_percent transform applied with prior value",
  ok:
    gdpYoY?.value !== null &&
    Math.abs((gdpYoY!.value as number) - 1.11111111) < 1e-6 &&
    gdpYoY?.unit === "percent" &&
    gdpYoY?.publishedAt === "2024-04-25T00:00:00.000Z",
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

// A5: caching — series/releases and release/dates are fetched once per series/release,
// not once per observation.
const counter = countingTransport(fixtureTransport(fullFixture()));
const cacheAdapter = new FredProviderAdapter({ apiKey: "test-key", transport: counter.transport });
await cacheAdapter.fetchObservations(request);
await cacheAdapter.fetchObservations(request);
const srCount = counter.counts.get("series/releases") ?? 0;
const rdCount = counter.counts.get("release/dates") ?? 0;
// 5 series → 5 series/releases calls (cached on 2nd fetch). Only DFF and GDPC1
// have a release_id (others have empty releases → null → no release/dates call),
// and those release/dates calls are cached across both fetches.
assertions.push({
  name: "A5 series/releases + release/dates cached across observations and fetches",
  ok: srCount === 5 && rdCount === 2,
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
// visible at a cutoff after the 2024-02-02 release but the 2024-01-31 unknown
// record is also visible (non-value, asOf fallback). The available DFF record
// must be readable by publishedAt <= asOf.
const visible = await listCapitalDataRecordsAt(store.client, "2024-02-15T00:00:00.000Z");
const visibleDff = visible.filter((r) => r.metricKey === "us-funding-price");
assertions.push({
  name: "A6 end-to-end: adapter → append → listCapitalDataRecordsAt point-in-time read-back",
  ok:
    e2eResult.inserted > 0 &&
    visibleDff.some(
      (r) =>
        r.value === 5.49 &&
        r.publishedAt === "2024-02-02T00:00:00.000Z" &&
        r.availability === CapitalAvailability.Available,
    ),
  detail: JSON.stringify({ inserted: e2eResult.inserted, visibleDffCount: visibleDff.length }),
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
