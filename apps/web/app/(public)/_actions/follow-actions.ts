"use server";

import { revalidatePath } from "next/cache";

import {
  createAccount,
  followTarget,
  FollowTargetKind,
  getPrisma,
  isFollowing,
  newTraceId,
  unfollowTarget,
  type FollowRef,
} from "@aguhot/core";

import { createSession, readSession } from "@/lib/session";

// parseFollowRef is the pure trust-boundary parser. It lives in a separate
// non-"use server" module (follow-ref-parser.ts, no Next imports) so it can be
// imported + exercised by a plain tsx selfcheck (`pnpm --filter web
// verify:follow-ref`). The action module imports it for its own use; callers
// that want the pure function import it directly from follow-ref-parser.
import { parseFollowRef } from "./follow-ref-parser";

/**
 * Server actions for the deferred-login follow flow — Story 3.2.
 *
 * Two actions cover the two write paths:
 *   - toggleFollow: the logged-in path. Reads the session; if present, toggles
 *     the follow (isFollowing ? unfollowTarget : followTarget). If the session
 *     is absent it throws a domain error — the front-end FollowButton never
 *     sends this path for an anonymous user (it opens the login dialog instead,
 *     which uses startSessionAndFollow). The throw is the binding guard against
 *     an anonymous direct POST.
 *   - startSessionAndFollow: the anonymous→logged-in path. Creates a
 *     credential-free UserAccount, sets the signed session cookie, then writes
 *     the follow row. This is the "login action" (deferred-login pattern: login
 *     = create account + set cookie + write follow, no credential).
 *
 * Trust boundary (mandatory, not simplifiable): both actions parse
 * `targetKind` + `targetId` out of formData via `parseFollowRef` before any DB
 * write. `parseFollowRef` maps the raw form strings to a typed FollowRef and
 * delegates to core's `assertValidFollowRef` so BOTH layers enforce identically
 * (the action layer no longer carries a divergent 128-char cap that would let a
 * 50-char non-UUID hot_event id slip past the action only to be rejected by
 * core). A forged post with an invalid kind/id is rejected with a thrown Error
 * (the Next server-action boundary surfaces this to the caller; it never
 * reaches the DB and never returns a 500 from a raw prisma throw). The parser
 * is pure + covered by `apps/web/.../follow-ref-parser.selfcheck.ts`.
 *
 * revalidatePath keeps the feed / detail / theme pages in sync after a toggle
 * so the cross-page follow-state consistency (AC2) is observable on next
 * render. CSRF: Next server actions carry a built-in Origin check; we rely on
 * that (an explicit CSRF token is deferred — see deferred-work.md).
 */

/**
 * Revalidate the surfaces that render this target's follow state, so the next
 * render reflects the change (AC2 cross-page consistency). Called after both
 * follow and unfollow.
 */
function revalidateFollowSurfaces(ref: FollowRef): void {
  revalidatePath("/");
  if (ref.kind === FollowTargetKind.HotEvent) {
    revalidatePath(`/events/${ref.hotEventId}`);
  } else {
    revalidatePath(`/topics/${encodeURIComponent(ref.themeSlug)}`);
  }
}

/**
 * Toggle the follow state for a logged-in user. Reads the session first; if
 * absent, throws (the anonymous path must go through startSessionAndFollow,
 * never this action). Toggles follow/unfollow idempotently.
 *
 * Returns a small JSON-serializable result so the FollowButton client
 * component can reflect the new state without a full refetch (though
 * revalidatePath also triggers a server re-render). Errors surface as thrown
 * Errors at the server-action boundary.
 */
export async function toggleFollow(
  formData: FormData,
): Promise<{ ok: true; following: boolean }> {
  const session = await readSession();
  if (session === null) {
    // Anonymous direct POST — the front-end never sends this (the dialog goes
    // through startSessionAndFollow). Reject; never write anonymously.
    throw new Error("[follow] toggleFollow requires a session");
  }
  const ref = parseFollowRef(formData);
  const prisma = getPrisma();
  const traceId = newTraceId();
  const following = await isFollowing({ prisma, traceId, userAccountId: session.accountId, ref });
  if (following) {
    await unfollowTarget({ prisma, traceId, userAccountId: session.accountId, ref });
  } else {
    await followTarget({ prisma, traceId, userAccountId: session.accountId, ref });
  }
  revalidateFollowSurfaces(ref);
  return { ok: true, following: !following };
}

/**
 * The "login action" (deferred-login pattern): create a credential-free
 * UserAccount, set the signed session cookie, then write the follow row. No
 * credential input of any kind. This is the anonymous→logged-in transition
 * triggered by the FollowButton's "登录并收藏" dialog button.
 *
 * Returns a JSON-serializable result so the client can update its state.
 */
export async function startSessionAndFollow(
  formData: FormData,
): Promise<{ ok: true; following: true }> {
  const ref = parseFollowRef(formData);
  const prisma = getPrisma();
  const traceId = newTraceId();
  const { accountId } = await createAccount({ prisma, traceId });
  await createSession(accountId);
  await followTarget({ prisma, traceId, userAccountId: accountId, ref });
  revalidateFollowSurfaces(ref);
  return { ok: true, following: true };
}
