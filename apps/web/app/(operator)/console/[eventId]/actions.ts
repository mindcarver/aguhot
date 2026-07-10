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
  mergeHotEvents,
  splitHotEvent,
  listPublishedHotEvents,
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

/**
 * Server action: merge another published hot event into the current one. Story 1.10.
 *
 * Parses the form (target=current eventId, source=the published event to absorb),
 * validates source≠target and source is currently published (checked against
 * listPublishedHotEvents), then sequences:
 *   1. mergeHotEvents(source→target) — move source's evidence links to target
 *      (shared deduped), clear source's links, recompute target's signature.
 *   2. decideReview(target, republish) — refresh target's read model (shows union).
 *   3. decideReview(source, takedown, note="merged into {target}") — retire source
 *      (delete source's read model; audit chain keeps the reason).
 *
 * This is NOT a cross-module transaction (web layer calls them in sequence). If
 * step 1 succeeds and step 2 crashes, source's evidence has moved to target but
 * target's public read model still shows the old count — the operator re-submits
 * the republish. Append-only + idempotent link moves mean no corruption.
 *
 * Validation failures (source=target, source not published) redirect back with
 * no writes. IllegalTransitionError on the republish/takedown (status changed
 * between render and submit) also redirects back — the revalidated page shows
 * the true state.
 *
 * V1 reviewer identity is a placeholder ("operator"); real auth drops into the
 * (operator) layout when user-profile lands.
 */
export async function submitMerge(formData: FormData): Promise<void> {
  const targetId = formData.get("targetId");
  const sourceId = formData.get("sourceId");

  if (typeof targetId !== "string" || targetId.trim() === "") {
    redirect("/console");
  }
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    revalidatePath(`/console/${targetId}`);
    redirect(`/console/${targetId}`);
  }
  // source=target is rejected before any module call (mergeHotEvents also guards,
  // but we front-load it so no prisma round-trip is wasted).
  if (sourceId === targetId) {
    revalidatePath(`/console/${targetId}`);
    redirect(`/console/${targetId}`);
  }

  const prisma = getPrisma();
  const traceId = newTraceId();

  // Validate source is currently published (the merge form lists published events
  // only, but the status could have changed between render and submit). Reading
  // the published read model is the authoritative visibility check.
  const published = await listPublishedHotEvents({ prisma, traceId: newTraceId() });
  const sourceIsPublished = published.some((e) => e.hotEventId === sourceId);
  if (!sourceIsPublished) {
    revalidatePath(`/console/${targetId}`);
    redirect(`/console/${targetId}`);
  }

  try {
    // 1. Move source's evidence into target (event-assembly domain; only writes
    //    hot_event_evidence + target cluster_signature).
    await mergeHotEvents({ prisma, traceId, sourceId, targetId });

    // 2. Refresh target's read model to show the union evidence (publish gate).
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: targetId,
      outcome: "republish",
      reviewer: "operator",
      note: "merge: absorbed source evidence",
    });

    // 3. Retire the source (publish gate: takedown deletes its read model). The
    //    note records the merge intent for the audit chain.
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: sourceId,
      outcome: "takedown",
      reviewer: "operator",
      note: `merged into ${targetId}`,
    });
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      // The status changed between render and submit (e.g. source was taken down
      // by another operator). Nothing the operator can't retry — revalidate so
      // the page reflects the true state, then redirect back to the target.
      revalidatePath("/console");
      revalidatePath(`/console/${targetId}`);
      revalidatePath(`/console/${sourceId}`);
      redirect(`/console/${targetId}`);
    }
    if (error instanceof CandidateNotFoundError) {
      revalidatePath("/console");
      redirect("/console");
    }
    if (isPrismaNotFound(error)) {
      revalidatePath("/console");
      redirect("/console");
    }
    throw error;
  }

  // Success: revalidate everything that changed. Target now shows the union;
  // source is gone from public + console published list.
  revalidatePath("/console");
  revalidatePath(`/console/${targetId}`);
  revalidatePath(`/console/${sourceId}`);
  revalidatePath(`/events/${targetId}`);
  revalidatePath(`/events/${sourceId}`);
  redirect(`/console/${targetId}`);
}

/**
 * Server action: split a subset of the current event's evidence into a new
 * candidate. Story 1.10.
 *
 * Parses the form (source=current eventId, evidenceRecordIds[]=the checked
 * subset, title=the new candidate's title), validates the subset is non-empty
 * and not the full set, then sequences:
 *   1. splitHotEvent(source, subset, title) — create a new candidate HotEvent,
 *      move the selected links source→new, recompute both signatures.
 *   2. decideReview(source, republish, note="split") — refresh source's read
 *      model to show the remaining evidence.
 *
 * The new candidate lands as `candidate` (NOT auto-published — the publish gate
 * stays mandatory). The operator approves it via the existing 1.6 review queue.
 *
 * Validation failures (empty/full-set selection, empty title) redirect back with
 * no writes. This is NOT a cross-module transaction (same append-only + idempotent
 * link-move safety as submitMerge).
 */
export async function submitSplit(formData: FormData): Promise<void> {
  const sourceId = formData.get("sourceId");
  const title = formData.get("title");
  // formData.getAll returns all values for the repeated `evidenceRecordId` key
  // (one per checked checkbox). Filter to non-empty strings.
  const evidenceRecordIds = formData
    .getAll("evidenceRecordId")
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");

  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    redirect("/console");
  }
  if (typeof title !== "string" || title.trim() === "") {
    revalidatePath(`/console/${sourceId}`);
    redirect(`/console/${sourceId}`);
  }

  const prisma = getPrisma();
  const traceId = newTraceId();

  try {
    // 1. Create the new candidate + move the selected subset (event-assembly
    //    domain; only writes hot_event_evidence + hot_events). splitHotEvent
    //    guards empty/full-set selection internally; if it rejects, redirect back.
    const splitResult = await splitHotEvent({
      prisma,
      traceId,
      sourceId,
      evidenceRecordIds,
      title: title.trim(),
      reviewer: "operator",
    });
    if (!splitResult.split) {
      // emptySelection / fullSetSelected / invalidTitle — front-load validation
      // failed inside the service. Revalidate + redirect back (no public change).
      revalidatePath(`/console/${sourceId}`);
      redirect(`/console/${sourceId}`);
    }

    // 2. Refresh source's read model to show the remaining evidence (publish gate).
    await decideReview({
      prisma,
      traceId: newTraceId(),
      hotEventId: sourceId,
      outcome: "republish",
      reviewer: "operator",
      note: `split: moved ${splitResult.movedLinks ?? 0} to ${splitResult.newHotEventId ?? "new"}`,
    });
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      revalidatePath("/console");
      revalidatePath(`/console/${sourceId}`);
      redirect(`/console/${sourceId}`);
    }
    if (error instanceof CandidateNotFoundError) {
      revalidatePath("/console");
      redirect("/console");
    }
    if (isPrismaNotFound(error)) {
      revalidatePath("/console");
      redirect("/console");
    }
    throw error;
  }

  // Success: revalidate. Source shows remaining evidence; the new candidate
  // appears in the /console review queue (not yet public).
  revalidatePath("/console");
  revalidatePath(`/console/${sourceId}`);
  revalidatePath(`/events/${sourceId}`);
  redirect(`/console/${sourceId}`);
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
