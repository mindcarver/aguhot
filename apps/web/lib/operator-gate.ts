/**
 * Deployment gate for the operator console. Single source of truth for "is the
 * `/console/*` write surface open in this environment?".
 *
 * In production the console is CLOSED unless `AGUHOT_OPERATOR_ENABLED=true` is
 * set in the runtime env. dev/test are always open (local development + e2e
 * seed need `/console/*`).
 *
 * Read directly from `process.env` — same pattern as `lib/session.ts` reading
 * `process.env.NODE_ENV`. Not added to `packages/config/env.ts`'s schema: this
 * is a Next.js runtime guard, not an infra contract that a workspace asserts;
 * adding a schema field for a one-off boolean gate would be over-engineering.
 *
 * This function MUST stay a pure `process.env` read (no caching, no module-level
 * capture) so each caller sees the CURRENT env value:
 *   - `(operator)/layout.tsx` — RSC render gate (GET requests).
 *   - `middleware.ts` — request-time gate covering BOTH GET and POST (server
 *     actions POST straight to the action handler and do NOT re-render the
 *     layout, so the layout gate alone does not cover the write path).
 *   - each server action in `console/[eventId]/actions.ts` — first-line
 *     defense-in-depth gate so even a misconfigured matcher cannot reach a
 *     write.
 *
 * Runtime note: any caller reading runtime-injected env (e.g. a deploy-time
 * `AGUHOT_OPERATOR_ENABLED`) MUST run on the Node.js runtime. Next.js Edge
 * runtime only sees build-time-inlined `process.env`, so a runtime-injected
 * flag would read as `undefined` and the gate would silently fail closed (or
 * appear stuck). `middleware.ts` therefore declares `runtime: "nodejs"`.
 */
export function isOperatorEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.AGUHOT_OPERATOR_ENABLED === "true";
}
