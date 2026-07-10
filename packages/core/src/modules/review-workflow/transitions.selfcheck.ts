/**
 * Self-check for the pure transition resolver (no infra, no DB).
 *
 * Run with: pnpm --filter core verify:review-logic
 *           (tsx src/modules/review-workflow/transitions.selfcheck.ts)
 *
 * Asserts the three legal transitions resolve to the correct target status +
 * read-model action, and that four illegal transitions (reject published /
 * approve taken_down / takedown candidate / approve rejected) throw
 * IllegalTransitionError. This is the safety-critical transition logic — the
 * kind that silently regresses without a check — and this self-check needs no
 * PG/Redis so it can run in any gate.
 */

import { PublicationStatus } from "../../shared/publication-status.js";
import { resolveTransition, LEGAL_TRANSITIONS } from "./transitions.js";
import { IllegalTransitionError, ReviewOutcome } from "./types.js";
import type { ReviewOutcome as ReviewOutcomeType } from "./types.js";

interface Assertion {
  name: string;
  ok: boolean;
  detail?: string;
}

function main(): void {
  const assertions: Assertion[] = [];

  // --- the legal transitions -------------------------------------------

  const legalCases: Array<{
    from: string;
    outcome: ReviewOutcomeType;
    expectTo: string;
    expectAction: string;
  }> = [
    { from: "candidate", outcome: "approve", expectTo: "published", expectAction: "publish" },
    { from: "candidate", outcome: "reject", expectTo: "rejected", expectAction: "none" },
    { from: "published", outcome: "takedown", expectTo: "taken_down", expectAction: "takedown" },
    // Story 1.9: republish is a published→published transition with a publish
    // action (re-project effective title/tags + latest explanation). It reuses
    // the publish gate (decideReview) — the same refresh runs.
    { from: "published", outcome: "republish", expectTo: "published", expectAction: "publish" },
  ];

  for (const c of legalCases) {
    const r = resolveTransition(c.from, c.outcome);
    assertions.push({
      name: `legal: ${c.from} + ${c.outcome} → ${c.expectTo} (${c.expectAction})`,
      ok: r.to === c.expectTo && r.action === c.expectAction,
      detail: `got to=${r.to}, action=${r.action}`,
    });
  }

  // LEGAL_TRANSITIONS table matches the cases exactly (guard against the table
  // drifting from resolveTransition).
  assertions.push({
    name: "LEGAL_TRANSITIONS table has exactly the 4 legal paths",
    ok: LEGAL_TRANSITIONS.length === 4 &&
      LEGAL_TRANSITIONS.every(
        (lt) => resolveTransition(lt.from, lt.outcome).to === lt.to &&
          resolveTransition(lt.from, lt.outcome).action === lt.action,
      ),
    detail: `${LEGAL_TRANSITIONS.length} entries`,
  });

  // --- illegal transitions (from the spec I/O matrix) -------------------

  const illegalCases: Array<{ from: string; outcome: ReviewOutcomeType; label: string }> = [
    { from: "published", outcome: "reject", label: "reject already-published" },
    { from: "taken_down", outcome: "approve", label: "approve taken-down" },
    { from: "candidate", outcome: "takedown", label: "takedown never-published candidate" },
    { from: "rejected", outcome: "approve", label: "approve already-rejected" },
    // Story 1.9: republish is ONLY legal on a published event. Re-publish of
    // taken_down / rejected is 1.10 (deferred); republish on a candidate makes
    // no sense (nothing has been published to refresh).
    { from: "candidate", outcome: "republish", label: "republish never-published candidate" },
    { from: "taken_down", outcome: "republish", label: "republish taken-down (1.10)" },
    { from: "rejected", outcome: "republish", label: "republish rejected (1.10)" },
  ];

  for (const c of illegalCases) {
    let threw = false;
    let threwRightType = false;
    try {
      resolveTransition(c.from, c.outcome);
    } catch (error) {
      threw = true;
      threwRightType = error instanceof IllegalTransitionError;
    }
    assertions.push({
      name: `illegal: ${c.label} throws IllegalTransitionError`,
      ok: threw && threwRightType,
      detail: threw ? (threwRightType ? "(correct error)" : "(wrong error type)") : "(did not throw)",
    });
  }

  // --- exhaustive illegal coverage: every (from, outcome) NOT in legal is illegal ---
  // This catches a future status that accidentally becomes legal without the
  // table being updated.
  const allStatuses = ["candidate", "published", "rejected", "taken_down"];
  const allOutcomes: ReviewOutcomeType[] = ["approve", "reject", "takedown", "republish"];
  for (const from of allStatuses) {
    for (const outcome of allOutcomes) {
      const isLegal = LEGAL_TRANSITIONS.some((lt) => lt.from === from && lt.outcome === outcome);
      let threw = false;
      try {
        resolveTransition(from, outcome);
      } catch {
        threw = true;
      }
      assertions.push({
        name: `exhaustive: ${from}+${outcome} ${isLegal ? "resolves" : "throws"}`,
        ok: isLegal ? !threw : threw,
        detail: isLegal ? "(legal, resolved)" : "(illegal, threw)",
      });
    }
  }

  // --- boundary: data drift (unknown status) is illegal, never silently passes ---
  let driftThrew = false;
  try {
    resolveTransition("garbage_status", ReviewOutcome.Approve);
  } catch (error) {
    driftThrew = error instanceof IllegalTransitionError;
  }
  assertions.push({
    name: "boundary: unknown status string throws (data drift is illegal)",
    ok: driftThrew,
  });

  // --- PublicationStatus const matches the strings used in cases -------------
  // Guard against someone renaming a const value and silently breaking the
  // transitions (the self-check hardcodes the literal strings on purpose).
  assertions.push({
    name: "PublicationStatus values match expected literals",
    ok: PublicationStatus.Candidate === "candidate" &&
      PublicationStatus.Published === "published" &&
      PublicationStatus.Rejected === "rejected" &&
      PublicationStatus.TakenDown === "taken_down",
  });

  report(assertions);
}

// --- reporting ---------------------------------------------------------------

function report(assertions: Assertion[]): void {
  console.log("");
  console.log("=== review-workflow transitions self-check ===");
  for (const a of assertions) {
    const mark = a.ok ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${a.name}${a.detail ? ` — ${a.detail}` : ""}`);
  }
  const failed = assertions.filter((a) => !a.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length}/${assertions.length} assertions ok`);
    process.exit(0);
  } else {
    console.error(`FAIL — ${failed.length}/${assertions.length} assertions failed`);
    process.exit(1);
  }
}

main();
