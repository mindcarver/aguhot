"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isOperatorAuthenticated } from "@/lib/operator-auth";

import { getPrisma, newTraceId, suppressAiContent } from "@aguhot/core";

/**
 * Server action: suppress one piece of AI content (one recommendation_reasons
 * or deep_reads row). Story 5.4.
 *
 * Parses the form (targetType + targetId + hotEventId + optional note), whitelists
 * targetType to {"reason","deepread"} (the TrendBriefing exclusion is enforced
 * HERE — a forged "trend_briefing" submit never reaches suppressAiContent), calls
 * suppressAiContent (the sibling single-transaction that suppresses the source
 * row + appends a ReviewDecision + conditionally refreshes the projection), then
 * revalidates + redirects back to the sampling console.
 *
 * Auth: defense-in-depth re-check of isOperatorAuthenticated (mirrors submitReview
 * in [eventId]/actions.ts — middleware is the primary gate, but a server-action
 * POST does not re-render the layout so we re-check here in case the matcher is
 * ever misconfigured).
 *
 * Error handling:
 *   - targetType outside {"reason","deepread"}: throw (a forged submit is a bug
 *     or tampering, not an expected operator path). The page form only emits
 *     "reason" / "deepread".
 *   - Prisma P2025 (target row missing): the source suppress fn's
 *     findUniqueOrThrow raised inside the transaction → it rolled back (nothing
 *     written). Redirect back to the console (the revalidated list reflects the
 *     true state).
 *   - Idempotent re-suppress: suppressAiContent returns {suppressed:false} and
 *     writes nothing; we treat it as success (the operator's intent — content is
 *     suppressed — is satisfied) and redirect back.
 *
 * V1 reviewer identity is the placeholder "operator" (same as submitReview; real
 * auth drops into the (operator) layout when user-profile lands).
 */
export async function submitSuppressAiContent(formData: FormData): Promise<void> {
  // Defense-in-depth: middleware is the primary auth gate (covers POST), but a
  // server action POST does not re-render the layout, so re-check auth here in
  // case the middleware matcher is ever misconfigured.
  if (!(await isOperatorAuthenticated())) redirect("/console/login");
  const targetType = formData.get("targetType");
  const targetId = formData.get("targetId");
  const hotEventId = formData.get("hotEventId");
  const note = formData.get("note");

  // Whitelist targetType to {"reason","deepread"}. TrendBriefing is excluded
  // (epic Gap 2) — a forged "trend_briefing" submit is rejected here before it
  // can reach suppressAiContent. Basic form validation: missing fields are a bug
  // or a tampered form, not an expected operator path.
  if (
    typeof targetType !== "string" ||
    (targetType !== "reason" && targetType !== "deepread")
  ) {
    throw new Error(
      "[submitSuppressAiContent] invalid targetType: must be 'reason' or 'deepread'",
    );
  }
  if (typeof targetId !== "string" || targetId.trim() === "") {
    redirect("/console/ai-content");
  }
  if (typeof hotEventId !== "string" || hotEventId.trim() === "") {
    redirect("/console/ai-content");
  }
  const noteStr = typeof note === "string" && note.trim() !== "" ? note.trim() : undefined;

  const prisma = getPrisma();

  try {
    await suppressAiContent({
      prisma,
      traceId: newTraceId(),
      targetType,
      targetId,
      hotEventId,
      reviewer: "operator",
      note: noteStr,
    });
  } catch (error) {
    // Prisma P2025 (record not found in findUniqueOrThrow) — the target row was
    // already gone (deleted event cascade, or a stale form). The transaction
    // rolled back (nothing written). Redirect back to the revalidated console.
    if (isPrismaNotFound(error)) {
      revalidatePath("/console/ai-content");
      redirect("/console/ai-content");
    }
    throw error;
  }

  // Success (including idempotent already-suppressed): revalidate the sampling
  // console (the list + SM-6 readout reflect the new state) + the public surfaces
  // that may have changed (timeline / detail). Redirect back to the console.
  revalidatePath("/console/ai-content");
  revalidatePath("/console");
  redirect("/console/ai-content");
}

function isPrismaNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  );
}
