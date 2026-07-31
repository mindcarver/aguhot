import {
  FundSampleExclusionReason,
  FundType,
} from "./types.js";
import type {
  FundSample,
  FundSampleCandidate,
  FundSampleDecision,
} from "./types.js";

/** Version the policy, not just the input rows, so a replay can be explained. */
export const FUND_SAMPLE_POLICY_VERSION = "active-equity-partial-stock-v1";

export const INCLUDED_FUND_TYPES: readonly FundType[] = [
  FundType.ActiveEquity,
  FundType.PartialStockMixed,
];

function isIncludedType(type: FundType): boolean {
  return INCLUDED_FUND_TYPES.includes(type);
}

/** Evaluate one candidate without considering duplicate share classes. */
export function evaluateFundCandidate(
  candidate: FundSampleCandidate,
): FundSampleDecision {
  if (!candidate.fundKey.trim()) {
    return {
      candidate,
      included: false,
      reason: FundSampleExclusionReason.PendingReview,
    };
  }
  if (!isIncludedType(candidate.type)) {
    return {
      candidate,
      included: false,
      reason: FundSampleExclusionReason.UnsupportedFundType,
    };
  }
  if (candidate.closed) {
    return {
      candidate,
      included: false,
      reason: FundSampleExclusionReason.ClosedFund,
    };
  }
  if (!candidate.disclosureQualified) {
    return {
      candidate,
      included: false,
      reason: FundSampleExclusionReason.UnqualifiedDisclosure,
    };
  }
  return {
    candidate,
    included: true,
    reason: FundSampleExclusionReason.Included,
  };
}

function representativeSort(a: FundSampleCandidate, b: FundSampleCandidate): number {
  const shareClass = a.shareClass.localeCompare(b.shareClass);
  if (shareClass !== 0) return shareClass;
  return a.displayCode.localeCompare(b.displayCode);
}

/**
 * Apply the active-equity/partial-stock sample policy and deduplicate share
 * classes by the stable underlying fundKey. The result is sorted by fundKey
 * and does not depend on input order.
 */
export function buildFundSample(
  candidates: readonly FundSampleCandidate[],
  policyVersion = FUND_SAMPLE_POLICY_VERSION,
): FundSample {
  const decisions: FundSampleDecision[] = [];
  const eligibleByFund = new Map<string, FundSampleCandidate[]>();

  for (const candidate of candidates) {
    const decision = evaluateFundCandidate(candidate);
    if (!decision.included) {
      decisions.push(decision);
      continue;
    }
    const bucket = eligibleByFund.get(candidate.fundKey);
    if (bucket) bucket.push(candidate);
    else eligibleByFund.set(candidate.fundKey, [candidate]);
  }

  const included: FundSampleCandidate[] = [];
  for (const [fundKey, bucket] of [...eligibleByFund.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const ordered = [...bucket].sort(representativeSort);
    const representative = ordered[0]!;
    included.push(representative);
    decisions.push({
      candidate: representative,
      included: true,
      reason: FundSampleExclusionReason.Included,
    });
    for (const duplicate of ordered.slice(1)) {
      decisions.push({
        candidate: duplicate,
        included: false,
        reason: FundSampleExclusionReason.DuplicateFundShare,
      });
    }
    // Keep the loop's key explicit in the implementation: it is the identity
    // used for dedupe, while shareClass/displayCode are evidence only.
    if (representative.fundKey !== fundKey) {
      throw new Error("fund sample dedupe key changed during selection");
    }
  }

  decisions.sort((a, b) => {
    const fund = a.candidate.fundKey.localeCompare(b.candidate.fundKey);
    if (fund !== 0) return fund;
    const reason = a.reason.localeCompare(b.reason);
    if (reason !== 0) return reason;
    return representativeSort(a.candidate, b.candidate);
  });

  return {
    policyVersion,
    decisions,
    included,
  };
}
