/**
 * Self-check for the pure saliency/relevance logic (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:saliency-logic
 *           (tsx src/modules/event-assembly/saliency.selfcheck.ts)
 *
 * Covers the Epic 7 I/O & edge-case matrix:
 *   Relevance gate:
 *     1. clean finance text → pass + hitKeyword set.
 *     2. 美联储 headline → pass (regression guard).
 *     3. zero finance vocabulary → fail (the noise killer).
 *     4. finance + entertainment → suspicious (demoter, not killer).
 *     5. empty text → fail.
 *   Saliency (base, breadth+velocity span 0–100 after Story 7.4 renormalization):
 *     6. single source → breadth 22, velocity 0, total 22 (above LOW → held).
 *     7. two sources, tight window → breadth 39, velocity near-max.
 *     8. three sources → breadth saturated (65), velocity max (35).
 *     9. two sources, spread > 6h → velocity 0.
 *    10. weights sum to 100; thresholds LOW < HIGH; tiers partition.
 *   Publish-time bonuses (Story 7.4):
 *    11. marketReactionBonus: 0 with no data; scales with limit-up + price move.
 *    12. associationBonusPoints: scales with tag count, capped.
 *    13. combineSaliency: adds bonuses, caps at 100.
 *   Auto-publish decision (Story 7.3):
 *    14. fail → reject; pass+≥HIGH → approve; suspicious → hold; single-src → hold.
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
  marketReactionBonus,
  associationBonusPoints,
  combineSaliency,
  RelevanceLabel,
  SALIENCY_WEIGHTS,
  SALIENCY_BONUS_CAPS,
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

  // Regression guard: 美联储 was missing from the whitelist initially and
  // "新美联储主席…" headlines false-negatived as fail. Lock foreign-Fed coverage.
  const r1b = judgeRelevance("新美联储主席：哪怕总统批评我，也会按数据行动");
  assertions.push({
    name: "美联储 (US Fed) headline → pass (regression guard)",
    ok: r1b.label === RelevanceLabel.Pass && r1b.hitKeyword === "美联储",
    detail: JSON.stringify(r1b),
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

  // --- saliency base score ---------------------------------------------------

  const s1 = scoreSaliency({ evidenceCount: 1, distinctSourceCount: 1, spanMs: 0 });
  assertions.push({
    name: "single source → breadth 22, velocity 0, total 22 (held, not rejected)",
    ok:
      s1.breakdown.breadth === 22 &&
      s1.breakdown.velocity === 0 &&
      s1.score === 22 &&
      s1.score > SALIENCY_LOW_THRESHOLD,
    detail: JSON.stringify(s1),
  });

  // 2 sources 30 min apart → velocity ratio 1 - 0.5/6 = 0.9167 → ~32
  const s2 = scoreSaliency({ evidenceCount: 2, distinctSourceCount: 2, spanMs: 30 * 60 * 1000 });
  assertions.push({
    name: "two sources, 30min window → breadth 39, velocity near-max (>30)",
    ok: s2.breakdown.breadth === 39 && s2.breakdown.velocity > 30 && s2.score === Math.round(39 + s2.breakdown.velocity),
    detail: JSON.stringify(s2),
  });

  const s3 = scoreSaliency({ evidenceCount: 3, distinctSourceCount: 3, spanMs: 0 });
  assertions.push({
    name: "three sources → breadth saturated (65), velocity max (35)",
    ok: s3.breakdown.breadth === SALIENCY_WEIGHTS.breadth && s3.breakdown.velocity === SALIENCY_WEIGHTS.velocity && s3.score === 100,
    detail: JSON.stringify(s3),
  });

  const s4 = scoreSaliency({ evidenceCount: 2, distinctSourceCount: 2, spanMs: VELOCITY_WINDOW_MS + 1 });
  assertions.push({
    name: "two sources spread > 6h → velocity 0, total 39",
    ok: s4.breakdown.velocity === 0 && s4.score === 39,
    detail: JSON.stringify(s4),
  });

  // --- invariants / tier partition ------------------------------------------

  assertions.push({
    name: "base weights sum to 100; LOW < HIGH; saturation ≥ 2",
    ok:
      SALIENCY_WEIGHTS.breadth + SALIENCY_WEIGHTS.velocity === 100 &&
      SALIENCY_LOW_THRESHOLD < SALIENCY_HIGH_THRESHOLD &&
      BREADTH_SATURATION_SOURCES >= 2,
    detail: `base=${SALIENCY_WEIGHTS.breadth + SALIENCY_WEIGHTS.velocity} LOW=${SALIENCY_LOW_THRESHOLD} HIGH=${SALIENCY_HIGH_THRESHOLD}`,
  });

  assertions.push({
    name: "tiers partition: 10→reject, 30→hold, 70→publish",
    ok:
      saliencyTier(10) === "reject-tier" &&
      saliencyTier(30) === "hold-tier" &&
      saliencyTier(70) === "publish-tier",
  });

  // --- publish-time bonuses (Story 7.4) --------------------------------------

  assertions.push({
    name: "marketReactionBonus: 0 with no data; scales with limit-up + price move; caps at 20",
    ok:
      marketReactionBonus(0, false) === 0 &&
      marketReactionBonus(5, true) === 16 && // min(10,14)+6 = 16
      marketReactionBonus(7, true) === SALIENCY_BONUS_CAPS.marketReaction && // 14+6 = 20
      marketReactionBonus(100, true) === SALIENCY_BONUS_CAPS.marketReaction,
    detail: `none=${marketReactionBonus(0, false)} 5up=${marketReactionBonus(5, true)} 7up=${marketReactionBonus(7, true)}`,
  });

  assertions.push({
    name: "associationBonusPoints: scales with tag count, capped at 10",
    ok:
      associationBonusPoints(0) === 0 &&
      associationBonusPoints(2) === 6 &&
      associationBonusPoints(10) === SALIENCY_BONUS_CAPS.association,
    detail: `0=${associationBonusPoints(0)} 2=${associationBonusPoints(2)} 10=${associationBonusPoints(10)}`,
  });

  assertions.push({
    name: "combineSaliency: adds bonuses, caps at 100",
    ok: combineSaliency(50, 20, 10) === 80 && combineSaliency(95, 20, 10) === 100,
    detail: `mid=${combineSaliency(50, 20, 10)} capped=${combineSaliency(95, 20, 10)}`,
  });

  assertions.push({
    name: "marketReaction + association are 0 in the CLUSTER-TIME breakdown (7.4 adds at publish)",
    ok: s3.breakdown.marketReaction === 0 && s3.breakdown.association === 0,
    detail: JSON.stringify(s3.breakdown),
  });

  // --- auto-publish decision (Story 7.3) ------------------------------------

  assertions.push({
    name: "decideAutoPublishOutcome: fail → reject regardless of score",
    ok: decideAutoPublishOutcome(RelevanceLabel.Fail, 80) === "reject",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: pass + ≥HIGH (60) → approve",
    ok: decideAutoPublishOutcome(RelevanceLabel.Pass, 60) === "approve",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: suspicious → hold (never auto-publish)",
    ok: decideAutoPublishOutcome(RelevanceLabel.Suspicious, 80) === "hold",
  });
  assertions.push({
    name: "decideAutoPublishOutcome: pass + single-source score (22) → hold",
    ok: decideAutoPublishOutcome(RelevanceLabel.Pass, 22) === "hold",
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
