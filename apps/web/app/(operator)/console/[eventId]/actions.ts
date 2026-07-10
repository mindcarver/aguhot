"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  decideReview,
  getPrisma,
  IllegalTransitionError,
  CandidateNotFoundError,
  newTraceId,
} from "@aguhot/core";

/**
 * Server action: submit one operator review decision. Story 1.6.
 *
 * Parses the form (outcome + optional note), calls decideReview (the single
 * transaction that validates the transition, writes the two append-only
 * decision rows, updates publication_status, and refreshes the read model),
 * then revalidates the console paths and redirects back to the detail page so
 * the operator sees the updated status + audit chain entry.
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
 *
 * Note: a server action invoked via `<form action>` must return void (Next.js
 * constraint). The operator feedback loop is the redirect + revalidated page,
 * not a return value.
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
  if (typeof outcome !== "string" || !["approve", "reject", "takedown"].includes(outcome)) {
    redirect(`/console/${eventId}`);
  }
  const noteStr = typeof note === "string" && note.trim() !== "" ? note.trim() : undefined;

  const prisma = getPrisma();

  try {
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: eventId,
      outcome: outcome as "approve" | "reject" | "takedown",
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

  // Success: revalidate the queue + detail so the next render shows the new
  // status + audit chain entry, then redirect back to the detail page.
  revalidatePath("/console");
  revalidatePath(`/console/${eventId}`);
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
