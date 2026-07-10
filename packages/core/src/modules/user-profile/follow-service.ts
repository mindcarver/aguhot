/**
 * follow-service — read/write follow_targets rows.
 *
 * Story 3.2 (deferred-login follow action). The user-profile module is the sole
 * writer of `follow_targets` (AD-2 single ownership boundary). A follow row
 * references its target by id STRING ONLY — no FK to hot_events / themes /
 * published_* (AD-3 + epic-3-context "Single ownership boundary"). A taken-down
 * event's follow row stays; 3.3 owns the "offline" annotation on the watchlist.
 * 3.2 deliberately does NOT validate target existence against published_*.
 *
 *   - followTarget: validate the ref (kind whitelist + targetId non-empty +
 *     length cap) → map ref → nullable columns → upsert against the matching
 *       partial @@unique. Idempotent: a repeat follow on an already-followed
 *       target is a no-op (AC2 / I/O matrix "重复收藏幂等").
 *   - unfollowTarget: deleteMany on (userAccountId, targetKind, target col).
 *       Idempotent: deleting an already-gone row is a no-op (no throw).
 *   - listFollows: all follow rows for a user (3.3 watchlist will consume this).
 *   - listFollowedTargetIds: the set of target ids a user follows under one
 *       kind — used by the feed page to batch-render EventCard follow state
 *       without an N+1 per card.
 *   - isFollowing: single boolean check — used by detail/theme pages.
 *
 * Trust boundary: every entry point re-validates targetKind against the
 * FollowTargetKind whitelist AND targetId non-empty + length cap, so a forged
 * server-action form post with targetKind=evil or an over-long id is rejected
 * before any DB write (never throws 500; the server action surfaces a domain
 * error). TS already narrows the union at compile time, but the runtime check
 * is the binding guard (the server action receives raw form strings).
 */

import { uuidv7 } from "../../shared/ids.js";
import { FollowTargetKind } from "./types.js";
import type {
  FollowRef,
  FollowTarget,
  FollowTargetKindType,
  FollowTargetOptions,
  IsFollowingOptions,
  ListFollowedTargetIdsOptions,
  ListFollowsOptions,
  UnfollowTargetOptions,
} from "./types.js";

/** Maximum length of a theme slug. Hot-event ids are UUIDv7 (36 chars). */
const MAX_TARGET_ID_LEN = 128;
/** Maximum length of a UUIDv7 string. */
const UUIDV7_LEN = 36;
/** Loose UUIDv7 shape check (8-4-4-4-12 hex), enough for a trust-boundary guard. */
const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a FollowRef at the trust boundary. Throws a domain error on any
 * invalid shape so the caller (server action) can surface it without a 500.
 * The TS union already guarantees shape at compile time; this is the binding
 * runtime guard against forged form input.
 *
 * Exported (pure, no Prisma) so the trust-boundary rejection matrix (spec
 * rows 7 + 8: targetKind outside whitelist, empty / over-long / wrong-shape
 * targetId) can be exercised deterministically by
 * `follow-service.selfcheck.ts` without a DB. Every public writer/reader in
 * this module (followTarget / unfollowTarget / isFollowing) calls this first,
 * so a forged ref is rejected before any prisma call.
 */
export function assertValidFollowRef(ref: FollowRef): void {
  if (ref.kind === FollowTargetKind.HotEvent) {
    if (ref.hotEventId.trim() === "") {
      throw new Error("[user-profile] follow target hotEventId is empty");
    }
    if (ref.hotEventId.length > UUIDV7_LEN || !UUIDV7_RE.test(ref.hotEventId)) {
      throw new Error(
        `[user-profile] follow target hotEventId is not a valid UUIDv7: ${ref.hotEventId.length > UUIDV7_LEN ? "too long" : "wrong shape"}`,
      );
    }
    return;
  }
  if (ref.kind === FollowTargetKind.Theme) {
    if (ref.themeSlug.trim() === "") {
      throw new Error("[user-profile] follow target themeSlug is empty");
    }
    if (ref.themeSlug.length > MAX_TARGET_ID_LEN) {
      throw new Error(
        `[user-profile] follow target themeSlug exceeds ${MAX_TARGET_ID_LEN} chars`,
      );
    }
    return;
  }
  // Defensive: an unknown kind (forged input bypassing the TS union) is rejected.
  throw new Error(`[user-profile] unknown follow targetKind: ${String((ref as { kind?: string }).kind)}`);
}

/**
 * Map a FollowRef to the two nullable DB columns. hot_event → targetHotEventId
 * set + targetThemeSlug null; theme → the reverse. Kept inside this module so
 * the call surface only sees the discriminated union.
 */
function refToColumns(
  ref: FollowRef,
): { targetKind: FollowTargetKindType; targetHotEventId: string | null; targetThemeSlug: string | null } {
  if (ref.kind === FollowTargetKind.HotEvent) {
    return {
      targetKind: FollowTargetKind.HotEvent,
      targetHotEventId: ref.hotEventId,
      targetThemeSlug: null,
    };
  }
  return {
    targetKind: FollowTargetKind.Theme,
    targetHotEventId: null,
    targetThemeSlug: ref.themeSlug,
  };
}

/**
 * Follow one target for one user. Idempotent: if a matching row already exists
 * (findFirst on the unique key) the call is a no-op; otherwise a new row is
 * created. The two partial `@@unique` constraints are the concurrency backstop
 * — a racing double-create raises Prisma P2002 (unique violation), which the
 * server action treats as success (the follow is recorded either way). This
 * avoids relying on a single Prisma-generated compound-unique `where` name,
 * which is awkward with TWO partial uniques over nullable columns.
 *
 * Validates the ref first (trust boundary).
 */
export async function followTarget(options: FollowTargetOptions): Promise<void> {
  assertValidFollowRef(options.ref);
  const cols = refToColumns(options.ref);
  const existing = await options.prisma.followTarget.findFirst({
    where: {
      userAccountId: options.userAccountId,
      targetKind: cols.targetKind,
      targetHotEventId: cols.targetHotEventId,
      targetThemeSlug: cols.targetThemeSlug,
    },
  });
  if (existing !== null) {
    // Idempotent: already followed, no-op (AC2 / I/O matrix "重复收藏幂等").
    void options.traceId;
    return;
  }
  try {
    await options.prisma.followTarget.create({
      data: {
        id: cryptoFollowId(),
        userAccountId: options.userAccountId,
        targetKind: cols.targetKind,
        targetHotEventId: cols.targetHotEventId,
        targetThemeSlug: cols.targetThemeSlug,
      },
    });
  } catch (error) {
    // P2002 (unique violation) under a concurrent follow race → the row exists,
    // treat as success. Any other error propagates.
    if (isPrismaUniqueViolation(error)) {
      void options.traceId;
      return;
    }
    throw error;
  }
  void options.traceId;
}

/**
 * Narrow a Prisma unique-constraint violation (P2002). Used by followTarget to
 * treat a concurrent-race duplicate as idempotent success.
 */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Unfollow one target for one user. Idempotent: deleteMany returns count=0 when
 * the row is already gone (no throw). Validates the ref first so a forged
 * unfollow with an invalid target is still rejected.
 */
export async function unfollowTarget(options: UnfollowTargetOptions): Promise<void> {
  assertValidFollowRef(options.ref);
  const cols = refToColumns(options.ref);
  await options.prisma.followTarget.deleteMany({
    where: {
      userAccountId: options.userAccountId,
      targetKind: cols.targetKind,
      targetHotEventId: cols.targetHotEventId,
      targetThemeSlug: cols.targetThemeSlug,
    },
  });
  void options.traceId;
}

/**
 * List all follow rows for a user. 3.3's watchlist will consume this. 3.2 does
 * not render the list itself but exposes the read for cross-page consistency
 * checks. The returned `targetKind` is narrowed to the FollowTargetKindType
 * union (the DB column is String; the app-layer whitelist guarantees only the
 * two union values are ever written).
 */
export async function listFollows(options: ListFollowsOptions): Promise<FollowTarget[]> {
  const rows = await options.prisma.followTarget.findMany({
    where: { userAccountId: options.userAccountId },
  });
  void options.traceId;
  return rows as FollowTarget[];
}

/**
 * Return the set of target ids a user follows under one kind. Used by the feed
 * page to batch-render EventCard follow state in one read (no N+1 per card).
 * For kind="hot_event" the set contains hotEventIds; for kind="theme" slugs.
 */
export async function listFollowedTargetIds(
  options: ListFollowedTargetIdsOptions,
): Promise<Set<string>> {
  // Re-validate the kind whitelist even on the read path (defense-in-depth).
  if (
    options.kind !== FollowTargetKind.HotEvent &&
    options.kind !== FollowTargetKind.Theme
  ) {
    throw new Error(`[user-profile] listFollowedTargetIds: unknown kind ${options.kind}`);
  }
  const rows = await options.prisma.followTarget.findMany({
    where: { userAccountId: options.userAccountId, targetKind: options.kind },
    select: { targetHotEventId: true, targetThemeSlug: true },
  });
  void options.traceId;
  const ids = new Set<string>();
  for (const r of rows) {
    if (options.kind === FollowTargetKind.HotEvent && r.targetHotEventId !== null) {
      ids.add(r.targetHotEventId);
    } else if (options.kind === FollowTargetKind.Theme && r.targetThemeSlug !== null) {
      ids.add(r.targetThemeSlug);
    }
  }
  return ids;
}

/**
 * Single boolean check: is this user following this target? Used by detail and
 * theme pages to render the initial FollowButton state (SSR).
 */
export async function isFollowing(options: IsFollowingOptions): Promise<boolean> {
  assertValidFollowRef(options.ref);
  const cols = refToColumns(options.ref);
  const row = await options.prisma.followTarget.findFirst({
    where: {
      userAccountId: options.userAccountId,
      targetKind: cols.targetKind,
      targetHotEventId: cols.targetHotEventId,
      targetThemeSlug: cols.targetThemeSlug,
    },
  });
  void options.traceId;
  return row !== null;
}

/**
 * Generate the follow_targets id app-side. Reuses uuidv7 to mirror the
 * system-wide app-side PK convention.
 */
function cryptoFollowId(): string {
  return uuidv7();
}
