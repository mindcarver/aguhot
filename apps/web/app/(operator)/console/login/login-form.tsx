"use client";

import { useActionState } from "react";

import { loginOperator } from "./actions";

/**
 * Client component for the operator login form. Uses `useActionState` (Next 16 /
 * React 19) so the `loginOperator` server action's return value — `{ error }`
 * on failure — is surfaced inline without a full page-reload flash. On success
 * the action redirects (throws in the action boundary; this component never
 * re-renders on success).
 *
 * The initial state is `{ error: undefined }` (no error banner on first GET).
 * After a POST the action returns `{ error: "凭证无效" }` on any failure —
 * a single generic message for all failure modes (missing env / wrong value /
 * malformed) to avoid a token-enumeration oracle.
 */
export function OperatorLoginForm() {
  // useActionState wires the (prevState, formData) → result signature. The
  // login action accepts both so it can be used directly as the reducer.
  const [state, formAction, pending] = useActionState(loginOperator, undefined);

  const error = state?.error;

  return (
    <>
      {error !== undefined ? (
        <p
          role="alert"
          className="rounded-lg border border-border-hairline bg-surface-raised px-4 py-3 text-sm text-ink-primary"
        >
          {error}
        </p>
      ) : null}
      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">密钥</span>
          <input
            name="token"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            className="rounded-lg border border-border-hairline bg-surface-raised px-4 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ink-primary"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink-primary px-4 py-2 text-base font-semibold text-surface-base transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
    </>
  );
}
