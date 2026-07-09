// Prisma 7 CLI configuration for @aguhot/core.
//
// Prisma 7 moves datasource URL wiring out of schema.prisma into this config
// file (the schema's datasource block keeps only the provider). The CLI reads
// DATABASE_URL from the environment; the runtime client instead takes a driver
// adapter (src/db.ts), so the two paths share the same connection string but
// do not rely on Prisma's own env loading — keeping the @aguhot/config
// requireEnv pattern as the single source of truth for env vars.

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
