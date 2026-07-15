/**
 * Self-check for the pure saliency/relevance logic (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:saliency-logic
 *           (tsx src/modules/event-assembly/saliency.selfcheck.ts)
 *
 * Covers the Epic 7 I/O & edge-case matrix:
 *   Relevance gate:
 *     1. clean finance text → pass + hitKeyword set.
 *     2. zero finance vocabulary → fail (the noise killer).
 *     3. finance + entertainment → suspicious (demoter, not killer).
 *     4. empty text → fail (no whitelist hit).
 *   Saliency:
 *     5. single source → breadth 12, velocity 0, total 12 (above LOW → held).
 *     6. two sources, tight window → velocity near-max.
 *     7. three sources → breadth saturated (40).
 *     8. two sources, spread > 6h → velocity 0.
 *     9. weights sum to 100; thresholds LOW < HIGH; tiers partition correctly.
 *
 * Prints PASS/FAIL and exits non-zero iff any assertion fails, so it is
 * CI-gateable (the "leave one runnable check behind for non-trivial logic"
 * pattern — the weighted score + stepwise breadth silently regresses without it).
 */

import {
  judgeRelevance,
  scoreSaliency,
  saliencyTier,
  decideAutoPublishOutcome,
  RelevanceLabel,
  SALIENCY_WEIGHTS,
  SALIENCY_LOW_THRESHOLD,
  SALIENCY_HIGH_THRESHOLD,
  BREADTH_SATURATION_SOURCES,
  VELOCITY_WINDOW_MS,
} from "./saliency.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- relevance gate --------------------------------------------------------

  const r1 = judgeRelevance("央行宣布降准0.5个百分点 释放长期资金");
  assertions.push({
    name: "clean finance text → pass + hitKeyword set",
    ok: r1.label === RelevanceLabel.Pass && r1.hitKeyword !== null && !r1.hitNoise,
    detail: JSON.stringify(r1),
  });

  const r2 = judgeRelevance("某明星综艺录制现场花絮 选秀选手路透");
  assertions.push({
    name: "zero finance vocabulary → fail (noise killer)",
    ok: r2.label === RelevanceLabel.Fail && r2.hitKeyword === null,
    detail: JSON.stringify(r2),
  });

  const r3 = judgeRelevance("某上市公司签约明星代言 订单预期增长");
  assertions.push({
    name: "finance + entertainment → suspicious (demoter)",
    ok: r3.label === RelevanceLabel.Suspicious && r3.hitKeyword !== null && r3.hitNoise,
    detail: JSON.stringify(r3),
  });

  const r4 = judgeRelevance("");
  assertions.push({
    name: "empty text → fail",
    ok: r4.label === RelevanceLabel.Fail,
    detail: JSON.stringify(r4),
  });

  // --- saliency score --------------------------------------------------------

  const s1 = scoreSaliency({ evidenceCount: 1, distinctSourceCount: 1, spanMs: 0 });
  assertions.push({
    name: "single source → breadth 12, velocity 0, total 12 (held, not rejected)",
    ok:
      s1.breakdown.breadth === 12 &&
      s1.breakdown.velocity === 0 &&
      s1.score === 12 &&
      s1.score > SALIENCY_LOW_THRESHOLD,
    detail: JSON.stringify(s1),
  });

  // 2 sources 30 min apart → velocity ratio 1 - 0.5/6 = 0.9167 → ~18.3
  const s2 = scoreSaliency({ evidenceCount: 2, distinctSourceCount: 2, spanMs: 30 * 60 * 1000 });
  assertions.push({
    name: "two sources, 30min window → breadth 24, velocity near-max (>15)",
    ok: s2.breakdown.breadth === 24 && s2.breakdown.velocity > 15 && s2.score === Math.round(24 + s2.breakdown.velocity),
    detail: JSON.stringify(s2),
  });

  const s3 = scoreSaliency({ evidenceCount: 3, distinctSourceCount: 3, spanMs: 0 });
  assertions.push({
    name: "three sources → breadth saturated (40)",
    ok: s3.breakdown.breadth === SALIENCY_WEIGHTS.breadth && s3.breakdown.velocity === SALIENCY_WEIGHTS.velocity,
    detail: JSON.stringify(s3),
  });

  const s4 = scoreSaliency({ evidenceCount: 2, distinctSourceCount: 2, spanMs: VELOCITY_WINDOW_MS + 1 });
  assertions.push({
    name: "two sources spread > 6h → velocity 0",
    ok: s4.breakdown.velocity === 0 && s4.score === 24,
    detail: JSON.stringify(s4),
  });

  // --- invariants / tier partition ------------------------------------------

  const weightSum =
    SALIENCY_WEIGHTS.breadth +
    SALIENCY_WEIGHTS.velocity +
    SALIENCY_WEIGHTS.marketReaction +
    SALIENCY_WEIGHTS.association;
  assertions.push({
    name: "weights sum to 100; LOW < HIGH; saturation ≥ 2",
    ok: weightSum === 100 && SALIENCY_LOW_THRESHOLD < SALIENCY_HIGH_THRESHOLD && BREADTH_SATURATION_SOURCES >= 2,
    detail: `weights=${weightSum} LOW=${SALIENCY_LOW_THRESHOLD} HIGH=${SALIENCY_HIGH_THRESHOLD}`,
  });

  assertions.push({
    name: "tiers partition: 5→reject, 20→hold, 50→publish",
    ok:
      saliencyTier(5) === "reject-tier" &&
      saliencyTier(20) === "hold-tier" &&
      saliencyTier(50) === "publish-tier",
  });

  assertions.push({
    name: "marketReaction + association are 0 at cluster time (7.4 folds in later)",
    ok: s3.breakdown.marketReaction === 0 && s3.breakdown.association === 0,
    detail: JSON.stringify(s3.breakdown),
  });

  // --- auto-publish decision (Story 7.3) ------------------------------------

  assertions.push({
    name: "decideAutoPublishOutcome: fail → reject regardless of score",
    ok: decideAutoPublishOutcome(RelevanceLabel.Fail, 80) === "reject",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: pass + high score → approve",
    ok: decideAutoPublishOutcome(RelevanceLabel.Pass, 50) === "approve",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: suspicious → hold (never auto-publish)",
    ok:
      decideAutoPublishOutcome(RelevanceLabel.Suspicious, 80) === "hold",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: pass + single-source score (12) → hold",
    ok: decideAutoPublishOutcome(RelevanceLabel.Pass, 12) === "hold",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: pass + degenerate score (<LOW) → reject",
    ok: decideAutoPublishOutcome(RelevanceLabel.Pass, 5) === "reject",
  });

  // --- report ----------------------------------------------------------------

  const failed = assertions.filter((a) => !a.ok);
  for (const a of assertions) {
    const tag = a.ok ? "PASS" : "FAIL";
    const tail = a.detail ? `  ${a.detail}` : "";
    console.log(`  ${tag}  ${a.name}${tail}`);
  }
  console.log("");
  if (failed.length > 0) {
    console.log(`FAIL — ${failed.length}/${assertions.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok.`);
}

main();
