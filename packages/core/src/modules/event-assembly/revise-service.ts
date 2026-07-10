/**
 * revise-service — operator-authored title/tags revision (Story 1.9).
 *
 * This module is the write-point for hot_event_revisions (AD-5 append-only) and
 * lives inside event-assembly (AD-2: event-assembly owns HotEvent clustering and
 * this is the revision write-point). It ONLY writes hot_event_revisions — it
 * never writes hot_events.title (the baseline title stays cluster-derived; a
 * revision is an overlay, effective = latest revision ?? baseline).
 *
 *   - reviseHotEvent: read the current effective (title, tags), normalize the
 *     incoming tags, and APPEND one HotEventRevision row ONLY when the title or
 *     the normalized tags differ from effective. No change → no-op (prevents a
 *     dirty version + a spurious pending diff). Returns { appended, revisionId? }.
 *
 * Append-only (AD-5): prior revision rows are never updated or deleted. effective
 * = the latest row (createdAt desc, id desc tiebreaker) ?? the baseline (HotEvent.
 * title + []). publish-orchestrator reads the effective at projection time;
 * review-workflow reads it for the operator pending-vs-published diff.
 *
 * Tags (V1 minimal defensible): free-text operator tags, String[] (PostgreSQL
 * text[]). NO taxonomy, NO tag-level metadata, NO feed filtering by tag (those
 * belong to Epic 2.2). Normalization = trim, split on separators (ASCII comma,
 * fullwidth comma, newline), drop empties, dedupe preserve-order (case-sensitive).
 *
 * NFR: never fabricates tags. An empty normalized array is a legitimate value
 * (operator cleared all tags) and is appended if it differs from effective.
 */

import { newTraceId } from "../../shared/ids.js";
import type { ReviseHotEventOptions, ReviseHotEventResult } from "./types.js";

/**
 * Tag-input separators. ASCII comma (","), fullwidth comma ("，"), and any
 * newline (\n, \r). An operator pastes a single string like
 * "A股,a股，政策\n新闻" and normalizeTags splits it into ["A股","a股","政策","新闻"].
 * Semicolons / pipes are NOT separators in V1 (keep the rule minimal; the spec
 * I/O matrix pins the comma/comma/newline set).
 */
const TAG_SEPARATOR_RE = /[,，\r\n]+/;

/**
 * Normalize a raw operator tag input string into a clean String[]:
 *   1. Split on ASCII comma / fullwidth comma / newline.
 *   2. Trim each piece.
 *   3. Drop empty pieces.
 *   4. Dedupe preserve-order, case-SENSITIVE (["A股","a股"] both survive — they
 *      are distinct strings; case-insensitive dedupe would silently drop one and
 *      surprise the operator).
 *
 * This is the single normalization entry point. reviseHotEvent + the web form
 * both call it, so a tag set is normalized identically whether it arrives as a
 * raw paste (web form) or a pre-split array.
 */
export function normalizeTags(input: string | string[]): string[] {
  // If the caller already split into an array (e.g. a test), join then re-split
  // so the same separator rule applies. An array element containing a comma
  // ("a,b") is treated as two tags — consistent with the single-string paste path.
  const joined = Array.isArray(input) ? input.join(",") : input;
  const parts = joined.split(TAG_SEPARATOR_RE);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Revise a HotEvent's title and/or tags. Appends one HotEventRevision row ONLY
 * when the normalized title+tags differ from the current effective values; a
 * no-change submit is a no-op (no dirty version, no pending diff, no spurious
 * source flip on explanation). Returns { appended: true, revisionId } on append
 * or { appended: false } on no-op.
 *
 * effective title = latest revision.title ?? HotEvent.title (cluster baseline).
 * effective tags  = latest revision.tags ?? [] (clustering does not derive tags,
 *   so the baseline tag set is empty — there is no pre-1.9 tag column on
 *   hot_events or published_hot_events that the revision would overlay).
 *
 * This module ONLY writes hot_event_revisions. It never writes hot_events (the
 * baseline title stays cluster-derived; a revision is an append-only overlay).
 * publish-orchestrator projects the effective title/tags into published_hot_events
 * on republish; review-workflow computes the pending diff.
 */
export async function reviseHotEvent(
  options: ReviseHotEventOptions,
): Promise<ReviseHotEventResult> {
  const { prisma, traceId, hotEventId, title, tags, reviewer, note } = options;

  // Read the event (baseline title) + the latest revision (effective overlay).
  // Latest = createdAt desc, id desc (UUIDv7 monotonic tiebreaker, same rule as
  // getLatestExplanation / projectExplanation — deterministic on same-ms appends).
  const event = await prisma.hotEvent.findUnique({
    where: { id: hotEventId },
    select: {
      title: true,
      revisions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { title: true, tags: true },
      },
    },
  });

  if (event === null) {
    return { appended: false, notFound: true };
  }

  const latestRevision = event.revisions[0] ?? null;
  const effectiveTitle = latestRevision !== null ? latestRevision.title : event.title;
  const effectiveTags = latestRevision !== null ? latestRevision.tags : [];

  // Normalize the incoming title + tags. Title is trimmed (empty title after
  // trim is rejected — an event must have a non-empty title). Tags run through
  // normalizeTags (split/trim/dedupe).
  const normalizedTitle = title.trim();
  if (normalizedTitle === "") {
    return { appended: false, invalidTitle: true };
  }
  const normalizedTags = normalizeTags(tags);

  // Change detection: append ONLY when title or the normalized tags differ from
  // effective. This prevents a dirty version (no-op submit) and, when paired
  // with saveExplanation's own change detection, prevents a spurious explanation
  // source flip (e.g. "operator only changed the title, do not rewrite the
  // template explanation as human"). Array comparison is order-sensitive (the
  // normalized array preserves operator intent; reordering tags is a change).
  const titleChanged = normalizedTitle !== effectiveTitle;
  const tagsChanged = !tagsEqual(normalizedTags, effectiveTags);
  if (!titleChanged && !tagsChanged) {
    return { appended: false };
  }

  const created = await prisma.hotEventRevision.create({
    data: {
      id: newTraceId(),
      hotEventId,
      title: normalizedTitle,
      tags: normalizedTags,
      reviewer,
      note: note !== undefined && note.trim() !== "" ? note.trim() : null,
      traceId,
    },
    select: { id: true },
  });

  return { appended: true, revisionId: created.id };
}

/**
 * Order-sensitive array equality for tag sets. ["a","b"] !== ["b","a"] — the
 * normalized order reflects operator intent (preserve-order dedupe), so a
 * reordering is a real change worth appending. Same length + pairwise equality.
 */
function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
