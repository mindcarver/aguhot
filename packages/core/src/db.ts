/**
 * Prisma client singleton for the worker runtime.
 *
 * Prisma 7 runs the client through a driver adapter; we wire @prisma/adapter-pg
 * with a connection string resolved via @aguhot/config's `requireEnv`. This
 * keeps DATABASE_URL validation on the same `requireEnv` path the rest of the
 * system uses (rather than Prisma's own env loading), and means a missing
 * DATABASE_URL fails loudly at the worker entry point instead of at first
 * query. The public web build never imports this module, so it stays
 * DATABASE_URL-free (AD-3/AD-6).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { requireEnv } from "@aguhot/config";

import { PrismaClient } from "../generated/client.js";

let prisma: PrismaClient | null = null;

/**
 * Return the shared PrismaClient. Constructs one (with the pg driver adapter)
 * on first call. The connection string is read once at construction; later
 * `requireEnv("DATABASE_URL")` cache hits do not re-open the adapter.
 */
export function getPrisma(): PrismaClient {
  if (prisma !== null) return prisma;
  const connectionString = requireEnv("DATABASE_URL");
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  return prisma;
}

/**
 * Reset the singleton. Intended for tests/verify scripts that need to force a
 * fresh client (e.g. after seeding).
 */
export function resetPrisma(): void {
  prisma = null;
}
