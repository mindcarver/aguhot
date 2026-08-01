/**
 * Deterministic acceptance checks for Issue #69's Eastmoney capital adapter.
 *
 * Runs offline with an injectable MacroTransport mock (no sidecar spawn), so
 * CI is not gated on akshare or network. Validates: target resolution,
 * fetchLatest metric filtering, extractor value/source mapping, and the
 * null-value degradation path.
 */

import {
  snapshotsToProviderBatch,
  type CapitalProviderSnapshotRow,
} from "@aguhot/core";
import {
  resolveEastmoneyTargets,
  eastmoneyExtractor,
  type MacroTransport,
  type MacroObservation,
} from "./eastmoney-capital-adapter.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];

const gdpObs: MacroObservation = {
  metric_key: "cn-growth",
  market: "cn",
  dimension: "growth",
  observed_at: "2026-01-01T00:00:00.000Z",
  value: 4.7,
  unit: "percent",
  indicator: "gdp_yoy",
  source_period: "2026年第1季度",
};
const cpiObs: MacroObservation = {
  metric_key: "cn-inflation",
  market: "cn",
  dimension: "inflation",
  observed_at: "2025-08-01T00:00:00.000Z",
  value: 0.0,
  unit: "percent",
  indicator: "cpi_yoy",
  source_period: "2025-08-09",
};

const mockTransport: MacroTransport = async () => [gdpObs, cpiObs];

// A2/A3: resolveEastmoneyTargets returns 2 targets (GDP + CPI).
const targets = resolveEastmoneyTargets(mockTransport);
assertions.push({
  name: "A2 resolveEastmoneyTargets returns GDP + CPI targets",
  ok: targets.length === 2,
  detail: `count=${targets.length}`,
});

// A2: GDP fetchLatest returns the GDP observation, filtered from the batch.
const gdpTarget = targets.find((t) => t.providerId === "cn-eastmoney" && true)!;
const gdpFetch = await gdpTarget.fetchLatest();
assertions.push({
  name: "A2 GDP fetchLatest returns cn-growth observation",
  ok:
    gdpFetch !== null &&
    gdpFetch!.metricKey === "cn-growth" &&
    gdpFetch!.market === "cn" &&
    gdpFetch!.observedAt === "2026-01-01T00:00:00.000Z",
  detail: JSON.stringify(gdpFetch).slice(0, 120),
});

// A2: the rawPayload is the full MacroObservation (audit trail).
assertions.push({
  name: "A2 rawPayload carries the full observation (audit trail)",
  ok:
    (gdpFetch!.rawPayload as unknown as MacroObservation).indicator === "gdp_yoy" &&
    (gdpFetch!.rawPayload as unknown as MacroObservation).source_period === "2026年第1季度",
  detail: JSON.stringify(gdpFetch!.rawPayload).slice(0, 120),
});

// A3: extractor pulls value + unit + source from the snapshot row.
const snapshotRow: CapitalProviderSnapshotRow = {
  id: "snap-test",
  snapshotKey: "cn-eastmoney|cn-growth|cn|growth|2026-01-01T00:00:00.000Z|eastmoney-akshare-v1",
  providerId: "cn-eastmoney",
  metricKey: "cn-growth",
  market: "cn",
  dimension: "growth",
  observedAt: "2026-01-01T00:00:00.000Z",
  firstCapturedAt: "2026-07-20T10:00:00.000Z",
  rawPayload: gdpObs as unknown as CapitalProviderSnapshotRow["rawPayload"],
  processingVersion: "eastmoney-akshare-v1",
  traceId: null,
};
const extracted = eastmoneyExtractor(snapshotRow);
assertions.push({
  name: "A3 extractor maps value/unit/source from rawPayload",
  ok:
    extracted.value === 4.7 &&
    extracted.unit === "percent" &&
    extracted.source.id === "cn-eastmoney",
  detail: JSON.stringify(extracted),
});

// A3: snapshotsToProviderBatch produces publishedAt = firstCapturedAt (AD-SNAP-1).
const batch = snapshotsToProviderBatch([snapshotRow], {
  providerId: "cn-eastmoney",
  extractor: eastmoneyExtractor,
  processingVersion: "eastmoney-akshare-v1",
});
assertions.push({
  name: "A3 batch publishedAt = firstCapturedAt, value present, source cn-eastmoney",
  ok:
    batch.observations.length === 1 &&
    batch.observations[0]!.publishedAt === "2026-07-20T10:00:00.000Z" &&
    batch.observations[0]!.value === 4.7 &&
    batch.observations[0]!.source.id === "cn-eastmoney",
  detail: JSON.stringify(batch.observations[0]).slice(0, 150),
});

// A5: null-value observation (unparseable/missing) → unknown, no zero-fill.
const nullSnapshot: CapitalProviderSnapshotRow = {
  ...snapshotRow,
  rawPayload: { ...gdpObs, value: null } as unknown as CapitalProviderSnapshotRow["rawPayload"],
};
const nullExtracted = eastmoneyExtractor(nullSnapshot);
assertions.push({
  name: "A5 null value in payload → extractor returns null (no zero-fill)",
  ok: nullExtracted.value === null,
  detail: JSON.stringify(nullExtracted),
});

// A2: metric filtering — CPI target gets only the CPI observation.
const cpiTarget = targets[1]!;
const cpiFetch = await cpiTarget.fetchLatest();
assertions.push({
  name: "A2 CPI fetchLatest returns cn-inflation (not cn-growth)",
  ok:
    cpiFetch !== null &&
    cpiFetch!.metricKey === "cn-inflation" &&
    cpiFetch!.observedAt === "2025-08-01T00:00:00.000Z",
  detail: cpiFetch!.metricKey,
});

// A2: empty transport (no data published) → fetchLatest returns null.
const emptyTransport: MacroTransport = async () => [];
const emptyTargets = resolveEastmoneyTargets(emptyTransport);
const emptyFetch = await emptyTargets[0]!.fetchLatest();
assertions.push({
  name: "A2 empty sidecar output → fetchLatest returns null (not yet published)",
  ok: emptyFetch === null,
  detail: String(emptyFetch),
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
