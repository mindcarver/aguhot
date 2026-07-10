/**
 * Pure trust-boundary parser for the follow form fields — Story 3.2.
 *
 * Extracted from follow-actions.ts (a `"use server"` module) so it can be
 * imported by a pure tsx selfcheck without dragging in the Next server-action
 * runtime. This module has NO Next imports and NO I/O: it reads only
 * `formData.get` and delegates the authoritative shape check to core's
 * `assertValidFollowRef`. The web server action re-exports this so its
 * trust-boundary behavior is identical to what the selfcheck pins.
 *
 * The action layer + core layer MUST enforce identically. Before this module
 * existed, the action layer carried its own 128-char cap that diverged from
 * core's UUIDv7 shape check for hot_event — a 50-char non-UUID hot_event id
 * passed the action then failed only inside core. Delegating to
 * `assertValidFollowRef` closes that gap.
 */

import { assertValidFollowRef, FollowTargetKind, type FollowRef } from "@aguhot/core";

/**
 * Maximum length of a target id (theme slug). Kept as a local first-line cap so
 * an over-long id is rejected before the (pure) core validator runs; core's
 * assertValidFollowRef is the authoritative second gate and enforces the same
 * cap (128 for theme; UUIDv7 shape for hot_event).
 */
const MAX_TARGET_ID_LEN = 128;

/**
 * Parse + validate the (targetKind, targetId) pair from formData at the trust
 * boundary. Returns the typed FollowRef, or throws a domain Error describing
 * the violation. Throws (never returns null) so the caller surfaces a clear
 * error rather than silently no-op'ing on a forged post.
 *
 * Rejection matrix (pinned by follow-ref-parser.selfcheck.ts):
 *   - targetKind missing / not a string
 *   - targetId missing / not a string
 *   - targetId empty / whitespace-only
 *   - targetId > 128 chars
 *   - targetKind outside {hot_event, theme} whitelist (e.g. "evil")
 *   - hot_event id not UUIDv7-shaped (e.g. a 50-char non-UUID string) —
 *     caught by the delegated assertValidFollowRef, NOT the local 128 cap.
 */
export function parseFollowRef(formData: FormData): FollowRef {
  const rawKind = formData.get("targetKind");
  const rawId = formData.get("targetId");

  if (typeof rawKind !== "string") {
    throw new Error("[follow] targetKind is missing");
  }
  if (typeof rawId !== "string") {
    throw new Error("[follow] targetId is missing");
  }
  const targetId = rawId.trim();
  if (targetId === "") {
    throw new Error("[follow] targetId is empty");
  }
  if (targetId.length > MAX_TARGET_ID_LEN) {
    throw new Error(`[follow] targetId exceeds ${MAX_TARGET_ID_LEN} chars`);
  }

  // Whitelist check (binding runtime guard — the TS union is compile-time only).
  let ref: FollowRef;
  if (rawKind === FollowTargetKind.HotEvent) {
    ref = { kind: FollowTargetKind.HotEvent, hotEventId: targetId };
  } else if (rawKind === FollowTargetKind.Theme) {
    ref = { kind: FollowTargetKind.Theme, themeSlug: targetId };
  } else {
    throw new Error(`[follow] unknown targetKind: ${rawKind}`);
  }

  // Delegate to core's authoritative validator so the action + core layers
  // enforce identically (hot_event UUIDv7 shape, theme length cap, kind
  // whitelist). Without this, a 50-char non-UUID hot_event id would pass the
  // action layer's generic 128 cap and be rejected only inside core.
  assertValidFollowRef(ref);
  return ref;
}
