/**
 * Types for the user-profile module — Story 3.2 (deferred-login follow action).
 *
 * This module owns `user_accounts` + `follow_targets` (AD-2 single ownership
 * boundary). It is credential-free: a UserAccount is a bare UUIDv7 id with NO
 * password/OAuth/email columns; the "login" action (apps/web/lib/session.ts +
 * the startSessionAndFollow server action) creates the account + sets a signed
 * cookie. Real credential auth is deferred (deferred-work.md).
 *
 * Follow records reference their target by id STRING ONLY — no FK to
 * hot_events / themes / published_* (AD-3: public site reads published_*; a
 * follow is a user-owned annotation, not a publish-path read). This module
 * never reads or writes HotEvent / Theme / published_* aggregates.
 */

import type { Prisma } from "../../../generated/client.js";

/**
 * Whitelisted follow target kinds. Stored as a String column (`target_kind`)
 * with a TS union (no Prisma enum, per erasableSyntaxOnly). The const object is
 * the runtime whitelist used by the service layer to reject arbitrary
 * targetKind values at the trust boundary (server action form input).
 */
export const FollowTargetKind = {
  HotEvent: "hot_event",
  Theme: "theme",
} as const;

export type FollowTargetKindType = (typeof FollowTargetKind)[keyof typeof FollowTargetKind];

/**
 * A discriminated union modeling the call-surface follow ref. The caller MUST
 * supply a correctly-shaped ref (TS enforces this at compile time). Internally
 * the service maps kind → one of two nullable DB columns
 * (target_hot_event_id / target_theme_slug), keeping the kind→column mapping
 * inside follow-service (the call surface only sees the union).
 */
export type FollowRef =
  | { kind: typeof FollowTargetKind.HotEvent; hotEventId: string }
  | { kind: typeof FollowTargetKind.Theme; themeSlug: string };

/**
 * One follow_targets row (as read back from the DB). Exactly one of
 * targetHotEventId / targetThemeSlug is non-null depending on targetKind.
 */
export interface FollowTarget {
  id: string;
  userAccountId: string;
  targetKind: FollowTargetKindType;
  targetHotEventId: string | null;
  targetThemeSlug: string | null;
  createdAt: Date;
}

/** Shared shape for every user-profile command: a prisma client + trace id. */
export interface UserProfileOptions {
  prisma: Prisma.TransactionClient | PrismaClientLike;
  traceId: string;
}

export type CreateAccountOptions = UserProfileOptions;

export interface TryGetAccountOptions extends UserProfileOptions {
  userAccountId: string;
}

export interface FollowTargetOptions extends UserProfileOptions {
  userAccountId: string;
  ref: FollowRef;
}

export interface UnfollowTargetOptions extends UserProfileOptions {
  userAccountId: string;
  ref: FollowRef;
}

export interface ListFollowsOptions extends UserProfileOptions {
  userAccountId: string;
}

export interface ListFollowedTargetIdsOptions extends UserProfileOptions {
  userAccountId: string;
  /** Filter to one target kind (e.g. "hot_event" for the feed batch read). */
  kind: FollowTargetKindType;
}

export interface IsFollowingOptions extends UserProfileOptions {
  userAccountId: string;
  ref: FollowRef;
}

/**
 * Prisma client structural type — accepts either the full PrismaClient or a
 * transaction client. Kept local (structural, not imported from generated) so
 * the module signature stays stable across Prisma minor versions.
 */
export interface PrismaClientLike {
  userAccount: {
    create(args: { data: { id: string } }): Promise<{ id: string }>;
    findUnique(args: { where: { id: string } }): Promise<{ id: string } | null>;
  };
  followTarget: {
    create(args: { data: object }): Promise<FollowTarget>;
    deleteMany(args: { where: object }): Promise<{ count: number }>;
    findMany(args: {
      where: object;
      select?: object;
    }): Promise<FollowTarget[]>;
    findFirst(args: { where: object }): Promise<FollowTarget | null>;
  };
}
