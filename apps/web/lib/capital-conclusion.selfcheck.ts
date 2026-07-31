/**
 * Deterministic acceptance checks for Issue #58's FR-009 text conclusion.
 * Verifies the PRD constraint (no score/bull-bear/buy-sell) and the
 * fact-vs-unknown distinction (A4/A5).
 */

import {
  CapitalAvailability as Avail,
  CapitalDimension as Dim,
  CapitalMarket as Mkt,
} from "@aguhot/core";
import type { CapitalAvailability } from "@aguhot/core";
import type { CapitalReplayResult } from "@aguhot/core";
import {
  assertNoForbiddenTerms,
  buildCapitalConclusion,
} from "./capital-conclusion.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function replayFixture(
  dimensions: Partial<Record<string, { availability: Avail; value: number | null; unit: string | null; sourceId?: string; publishedAt?: string | null; statusReason?: string | null }>>,
): CapitalReplayResult {
  const allDims = [
    Dim.Growth,
    Dim.Inflation,
    Dim.Liquidity,
    Dim.FundingPrice,
    Dim.RiskCredit,
    Dim.MarketBreadth,
    Dim.InstitutionalPositioning,
  ];
  const DEGRADED: Set<CapitalAvailability> = new Set([Avail.Unknown, Avail.Failed, Avail.PendingReview, Avail.IncompleteReconstruction]);
  const rawMarkets = [Mkt.Global, Mkt.UnitedStates, Mkt.China, Mkt.Korea].map((market) => {
    const dims = allDims.map((dimension) => {
      const key = `${market}|${dimension}`;
      const fixture = dimensions[key];
      if (fixture === undefined) {
        return {
          market,
          dimension,
          records: [],
          availability: Avail.Unknown,
          statusReason: "no data",
        };
      }
      const hasValue = fixture.value !== null && fixture.availability === Avail.Available;
      return {
        market,
        dimension,
        records: hasValue
          ? [
              {
                id: `${key}-r1`,
                metricKey: `${market}-${dimension}`,
                market,
                dimension,
                value: fixture.value,
                unit: fixture.unit,
                observedAt: "2024-01-31T00:00:00.000Z",
                publishedAt: fixture.publishedAt ?? "2024-02-02T00:00:00.000Z",
                asOf: "2024-02-02T00:00:00.000Z",
                source: {
                  id: fixture.sourceId ?? "us-fred",
                  name: "FRED",
                  dataset: "DFF",
                  documentationUrl: null,
                },
                processingVersion: "v1",
                availability: fixture.availability,
                statusReason: fixture.statusReason ?? null,
                revision: 1,
              },
            ]
          : [],
        availability: fixture.availability,
        statusReason: fixture.statusReason ?? null,
      };
    });
    const degraded = dims.filter((d) => DEGRADED.has(d.availability));
    const marketAvail =
      degraded.length === 0 ? Avail.Available : degraded.length === dims.length ? Avail.Unknown : Avail.Partial;
    return { market, availability: marketAvail, dimensions: dims };
  });
  const overallDegraded = rawMarkets.filter((m) => DEGRADED.has(m.availability));
  const overall =
    overallDegraded.length === 0
      ? Avail.Available
      : overallDegraded.length === rawMarkets.length
        ? Avail.Unknown
        : Avail.Partial;
  return {
    asOf: "2024-02-15T00:00:00.000Z",
    availability: overall,
    fundConcentrationSnapshots: [],
    markets: rawMarkets,
  };
}

const assertions: Assertion[] = [];

// A4: conclusion must not contain forbidden advisory terms.
const mixedReplay = replayFixture({
  "us|funding_price": { availability: Avail.Available, value: 5.5, unit: "percent", publishedAt: "2024-02-02T00:00:00.000Z" },
  "us|growth": { availability: Avail.Available, value: 2.1, unit: "percent", publishedAt: "2024-02-02T00:00:00.000Z" },
  "cn|market_breadth": { availability: Avail.Unknown, value: null, unit: null, statusReason: "未采集" },
  "us|risk_credit": { availability: Avail.IncompleteReconstruction, value: null, unit: null, statusReason: "revision gap" },
});
const conclusion = buildCapitalConclusion(mixedReplay);
let forbiddenHit: string | null = null;
const fullText = [conclusion.overview, conclusion.disclaimer, ...conclusion.dimensions.map((d) => d.text)].join(" ");
for (const term of ["买入", "卖出", "建议买", "建议卖", "目标价", "目标仓位", "牛熊分数", "总分", "确定牛", "确定熊", "必然涨", "必然跌"]) {
  if (fullText.includes(term)) forbiddenHit = term;
}
assertions.push({
  name: "A4 conclusion contains no forbidden advisory term",
  ok: forbiddenHit === null,
  detail: forbiddenHit !== null ? `HIT: ${forbiddenHit}` : "clean",
});

// A4: assertNoForbiddenTerms throws on a forbidden term.
let threw = false;
try {
  assertNoForbiddenTerms("这是一个买入建议");
} catch {
  threw = true;
}
assertions.push({
  name: "A4 assertNoForbiddenTerms throws on forbidden input",
  ok: threw,
});

// A5: observed facts vs unknown states are distinguishable.
const usFundingLine = conclusion.dimensions.find((d) => d.market === Mkt.UnitedStates && d.dimension === Dim.FundingPrice);
const cnBreadthLine = conclusion.dimensions.find((d) => d.market === Mkt.China && d.dimension === Dim.MarketBreadth);
const usRiskLine = conclusion.dimensions.find((d) => d.market === Mkt.UnitedStates && d.dimension === Dim.RiskCredit);
assertions.push({
  name: "A5 observed dimension is labeled 'observed' with value + source",
  ok:
    usFundingLine?.kind === "observed" &&
    usFundingLine.text.includes("5.5") &&
    usFundingLine.text.includes("us-fred") &&
    usFundingLine.text.includes("2024-02-02"),
  detail: usFundingLine?.text,
});
assertions.push({
  name: "A5 unknown dimension is labeled 'unknown' with honest status",
  ok:
    cnBreadthLine?.kind === "unknown" &&
    cnBreadthLine.text.includes("未知") &&
    cnBreadthLine.text.includes("未采集"),
  detail: cnBreadthLine?.text,
});
assertions.push({
  name: "A5 incomplete_reconstruction dimension is surfaced honestly, not zero-filled",
  ok:
    usRiskLine?.kind === "unknown" &&
    usRiskLine.text.includes("无法完整还原") &&
    !usRiskLine.text.includes("0 "),
  detail: usRiskLine?.text,
});

// A4: overview + disclaimer present and non-advisory.
assertions.push({
  name: "A4 overview + disclaimer present, disclaimer is non-advisory",
  ok:
    conclusion.overview.includes("资本环境") &&
    conclusion.disclaimer.includes("不代表未来收益") &&
    conclusion.disclaimer.includes("不代表") === true &&
    conclusion.disclaimer.includes("买入") === false &&
    conclusion.disclaimer.includes("卖出") === false,
  detail: conclusion.disclaimer,
});

// A4: no-data replay → overview says "无可得数据", no fabricated values.
const emptyReplay = replayFixture({});
const emptyConclusion = buildCapitalConclusion(emptyReplay);
assertions.push({
  name: "A4 no-data replay → '无可得数据', no fabricated values",
  ok:
    emptyConclusion.overview.includes("无可得数据") &&
    emptyConclusion.dimensions.every((d) => d.kind === "unknown"),
  detail: emptyConclusion.overview,
});

// Determinism: same input → same output.
const run1 = buildCapitalConclusion(mixedReplay);
const run2 = buildCapitalConclusion(mixedReplay);
assertions.push({
  name: "deterministic — same replay → identical conclusion",
  ok: JSON.stringify(run1) === JSON.stringify(run2),
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
