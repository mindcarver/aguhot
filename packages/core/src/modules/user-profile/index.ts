/**
 * user-profile module barrel — Story 3.2 (deferred-login follow action).
 *
 * Owns `user_accounts` (credential-free accounts) + `follow_targets` (follow
 * state). AD-2 single ownership boundary: this module is the sole writer of
 * those two tables and NEVER reads or writes HotEvent / Theme / published_*
 * aggregates — follow rows reference targets by id STRING ONLY (epic-3-context
 * "Single ownership boundary"). A taken-down event's follow row stays; 3.3 owns
 * the offline annotation.
 *
 * The Prisma client lives one level up and is re-exported from the package
 * barrel. Cookie/session concerns live in apps/web/lib/session.ts (Next runtime
 * concept, not in core).
 */

export { createAccount, tryGetAccount } from "./account-service.js";
export {
  followTarget,
  unfollowTarget,
  listFollows,
  listFollowedTargetIds,
  isFollowing,
  assertValidFollowRef,
} from "./follow-service.js";
export { FollowTargetKind } from "./types.js";
export type {
  FollowTargetKindType,
  FollowRef,
  FollowTarget,
  UserProfileOptions,
  CreateAccountOptions,
  TryGetAccountOptions,
  FollowTargetOptions,
  UnfollowTargetOptions,
  ListFollowsOptions,
  ListFollowedTargetIdsOptions,
  IsFollowingOptions,
} from "./types.js";
