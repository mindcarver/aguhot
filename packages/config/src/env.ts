/**
 * Typed environment variable parsing for AGUHOT.
 *
 * Parsed with zod. The parser is NOT evaluated at module load — callers must
 * invoke `loadEnv()` to validate and obtain the typed `Env` object. This keeps
 * the web build/first-paint path decoupled from DB/Redis availability: the
 * public homepage is anonymous and never calls `loadEnv()`, so it builds and
 * renders even when `DATABASE_URL` / `REDIS_URL` are absent.
 *
 * Binding source: spec 1.1 + ARCHITECTURE-SPINE.md (env injection by variable).
 */

import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]);

/**
 * The full environment contract. Workspaces that need real infra (worker,
 * operator flows) call `loadEnv()` which throws on a missing required var.
 *
 * SESSION_SECRET is optional at the schema level (so `loadEnv` / `next build`
 * do not require it). The web session helper (apps/web/lib/session.ts) asserts
 * its presence at REQUEST time via `requireEnv("SESSION_SECRET")` — mirroring
 * the DATABASE_URL pattern: the public web build stays SESSION_SECRET-free, and
 * only force-dynamic routes / server actions that touch the session resolve it.
 *
 * AGUHOT_OPERATOR_TOKEN follows the SAME pattern: optional at the schema level
 * so `next build` stays token-free. The operator login server action
 * (apps/web/app/(operator)/console/login/actions.ts) asserts its presence at
 * REQUEST time via `requireEnv("AGUHOT_OPERATOR_TOKEN")`. The shared operator
 * key gates `/console/*` in production (signed cookie issued on login).
 */
export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  AGUHOT_OPERATOR_TOKEN: z.string().min(16).optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("AGUHOT"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse `process.env` into a typed `Env`. Throws if a present value fails
 * validation. `DATABASE_URL` / `REDIS_URL` are optional here — infra-owning
 * modules must assert their own presence before use (see `requireEnv`).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`[config] Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the internal cache. Intended for tests. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Narrow helper for modules that genuinely require a value (worker, prisma).
 * Throws a clear, traceable error when infra is not configured.
 */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const env = loadEnv();
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`[config] Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<Env[K]>;
}
