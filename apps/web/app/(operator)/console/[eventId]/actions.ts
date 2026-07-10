"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  decideReview,
  getPrisma,
  IllegalTransitionError,
  CandidateNotFoundError,
  newTraceId,
  reviseHotEvent,
  saveExplanation,
  ExplanationSource,
} from "@aguhot/core";

/**
 * Server action: submit one operator review decision. Story 1.6 + Story 1.9
 * (republish outcome).
 *
 * Parses the form (outcome + optional note), calls decideReview (the single
 * transaction that validates the transition, writes the two append-only
 * decision rows, updates publication_status, and refreshes the read model),
 * then revalidates the console paths and redirects back to the detail page so
 * the operator sees the updated status + audit chain entry.
 *
 * Story 1.9: the outcome whitelist now includes "republish" (published→published
 * re-projection of effective title/tags + latest explanation). The "republish"
 * button on the published branch of /console/[eventId] posts to this same action.
 *
 * Error handling:
 *   - IllegalTransitionError: the transition is not legal for the event's
 *     current status (e.g. the status changed between page render and submit,
 *     or a stale form was double-submitted). Nothing was written (the
 *     transaction rolled back); redirect back — the revalidated detail page
 *     shows the true current state (the form buttons are conditional on
 *     status, so an illegal outcome's button is no longer rendered).
 *   - CandidateNotFoundError / Prisma P2025: the event was deleted. Redirect
 *     to the queue (the candidate is gone).
 *   - Any other error: rethrow (surfaces as a 500; a genuine bug, not an
 *     expected operator path).
 *
 * V1 reviewer identity is a placeholder ("operator"); real auth drops into the
 * (operator) layout and flows a verified identity here when user-profile lands.
 */
export async function submitReview(formData: FormData): Promise<void> {
  const eventId = formData.get("eventId");
  const outcome = formData.get("outcome");
  const note = formData.get("note");

  // Basic form validation. A malformed post (missing fields) is a bug or a
  // tampered form, not an expected operator path — redirect to the queue.
  if (typeof eventId !== "string" || eventId.trim() === "") {
    redirect("/console");
  }
  if (
    typeof outcome !== "string" ||
    !["approve", "reject", "takedown", "republish"].includes(outcome)
  ) {
    redirect(`/console/${eventId}`);
  }
  const noteStr = typeof note === "string" && note.trim() !== "" ? note.trim() : undefined;

  const prisma = getPrisma();

  try {
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: eventId,
      outcome: outcome as "approve" | "reject" | "takedown" | "republish",
      reviewer: "operator",
      note: noteStr,
    });
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      // Nothing was written; revalidate so the page reflects the true state,
      // then redirect back to the detail page.
      revalidatePath("/console");
      revalidatePath(`/console/${eventId}`);
      redirect(`/console/${eventId}`);
    }
    if (error instanceof CandidateNotFoundError) {
      revalidatePath("/console");
      redirect("/console");
    }
    // Prisma P2025 (record not found in findUniqueOrThrow) — same user-facing
    // outcome as CandidateNotFoundError.
    if (isPrismaNotFound(error)) {
      revalidatePath("/console");
      redirect("/console");
    }
    throw error;
  }

  // Success: revalidate the queue + detail (and the public detail page so a
  // republish is reflected next visit) so the next render shows the new
  // status + audit chain entry, then redirect back to the detail page.
  revalidatePath("/console");
  revalidatePath(`/console/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  redirect(`/console/${eventId}`);
}

/**
 * Server action: submit an operator title/tags/explanation revision. Story 1.9.
 *
 * Parses the form (title + tags + three explanation partitions), calls
 * reviseHotEvent (append a HotEventRevision only if title/tags changed) +
 * saveExplanation (append an ExplanationVersion source="human" only if the
 * partitions changed), then revalidates + redirects back to the detail page.
 *
 * Each module append is its own atomic write (event-assembly writes
 * hot_event_revisions; explanation writes explanation_versions). The two are
 * NOT a cross-module transaction (web layer calls them in sequence). If one
 * succeeds and the other's process crashes, a partial revision remains — but
 * append-only means no corruption (the operator re-submits). Cross-module
 * atomicity is deferred (would require a core orchestrator accepting a tx).
 *
 * The revision does NOT refresh the public read model — that only happens on
 * republish (submitReview outcome="republish"). So after submitRevision the
 * public page still shows the old version; the operator console shows the
 * pending diff. This is the AC2 "pending" semantics.
 */
export async function submitRevision(formData: FormData): Promise<void> {
  const eventId = formData.get("eventId");
  const title = formData.get("title");
  const tags = formData.get("tags");
  const summary = formData.get("summary");
  const whyItMatters = formData.get("whyItMatters");
  const uncertainties = formData.get("uncertainties");

  if (typeof eventId !== "string" || eventId.trim() === "") {
    redirect("/console");
  }
  if (typeof title !== "string" || title.trim() === "") {
    // An event must keep a non-empty title. Re-show the page (no write).
    revalidatePath(`/console/${eventId}`);
    redirect(`/console/${eventId}`);
  }
  const tagsValue = typeof tags === "string" ? tags : "";
  const summaryValue = typeof summary === "string" ? summary : "";
  const whyValue = typeof whyItMatters === "string" ? whyItMatters : "";
  const uncValue = typeof uncertainties === "string" ? uncertainties : "";

  const prisma = getPrisma();
  const traceId = newTraceId();

  // reviseHotEvent: append a HotEventRevision only if title or normalized tags
  // changed vs effective. saveExplanation: append a human version only if any
  // partition changed vs the latest version. Both are no-ops on no-change.
  await reviseHotEvent({
    prisma,
    traceId,
    hotEventId: eventId,
    title: title.trim(),
    tags: tagsValue,
    reviewer: "operator",
  });
  await saveExplanation({
    prisma,
    traceId,
    hotEventId: eventId,
    summary: summaryValue,
    whyItMatters: whyValue,
    uncertainties: uncValue,
    source: ExplanationSource.Human,
  });

  // Revalidate the console detail (pending diff updates) + the public detail
  // (no change yet — public only moves on republish — but revalidate keeps the
  // cache honest if a republish follows). Redirect back to the detail page.
  revalidatePath("/console");
  revalidatePath(`/console/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  redirect(`/console/${eventId}`);
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
