/**
 * account-service — credential-free user account creation/lookup.
 *
 * Story 3.2 (deferred-login follow action). The user-profile module is the sole
 * writer of `user_accounts` (AD-2 single ownership boundary). An account is a
 * bare UUIDv7 id with NO credential columns — the "login" action
 * (startSessionAndFollow server action) creates the account and sets a signed
 * cookie (apps/web/lib/session.ts). Real credential auth (password / OAuth /
 * magic-link / email verification + identity provider selection) is deferred to
 * a later epic (registered in deferred-work.md).
 *
 *   - createAccount: prisma.userAccount.create({ data: { id: uuidv7() } }) →
 *     returns the new accountId. App-side UUIDv7 PK (no DB default) per the
 *     system-wide convention.
 *   - tryGetAccount: findUnique by id → { accountId } | null. Currently
 *     reserved (the session cookie carries the id; no caller reads the row
 *     directly yet), but exists so session validation can check the account
 *     still exists when real auth lands.
 *
 * This module NEVER reads or writes HotEvent / Theme / published_* aggregates
 * (AD-3 + ownership boundary). It only owns user_accounts.
 */

import { uuidv7 } from "../../shared/ids.js";
import type { CreateAccountOptions, TryGetAccountOptions } from "./types.js";

/**
 * Create a credential-free UserAccount row. Returns the new accountId.
 *
 * The id is generated app-side via uuidv7() (time-ordered, system-wide PK
 * convention — no DB default, no Prisma autogenerate). The caller (the web
 * layer's startSessionAndFollow server action) then sets the signed session
 * cookie carrying this id and writes any requested follow row in the same
 * user action.
 */
export async function createAccount(
  options: CreateAccountOptions,
): Promise<{ accountId: string }> {
  const accountId = uuidv7();
  await options.prisma.userAccount.create({
    data: { id: accountId },
  });
  // traceId is on `options` for downstream logging/audit; this minimal write
  // has no separate log emission (mirrors the other module generators).
  void options.traceId;
  return { accountId };
}

/**
 * Look up an account by id. Returns { accountId } or null when the id has no
 * row (e.g. a stale/tampered cookie whose id was never created, or an account
 * removed by a future deletion flow). Reserved for session-validation use when
 * real auth lands; the V1 session cookie is HMAC-signed so tampering is caught
 * at readSession before this is reached.
 */
export async function tryGetAccount(
  options: TryGetAccountOptions,
): Promise<{ accountId: string } | null> {
  const row = await options.prisma.userAccount.findUnique({
    where: { id: options.userAccountId },
  });
  if (row === null) return null;
  void options.traceId;
  return { accountId: row.id };
}
