import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the AGUHOT web app tests.
 *
 * Two test surfaces, kept strictly separate so the public e2e stays
 * DATABASE_URL-free:
 *
 *   1. Public e2e — `pnpm --filter web e2e` (default `playwright test`).
 *      Covers home/navigation/design. The web server boots on-demand; the
 *      homepage is anonymous and needs no DB/Redis, so it runs even without
 *      infrastructure. Tests in e2e/*.spec.ts that are NOT tagged @console.
 *
 *   2. Console e2e — `pnpm --filter web e2e:console` (--grep @console).
 *      Covers the operator review console (Story 1.6). Requires DATABASE_URL +
 *      a seed step (seed:console) to produce deterministic candidates. The
 *      seed runs as a globalSetup so the DB is populated before the web server
 *      serves /console. These tests must NOT run under the default public e2e
 *      (which has no DATABASE_URL).
 *
 * The e2e script sets NO_PROXY/no_proxy to exclude localhost so a developer's
 * system HTTP proxy cannot intercept the webServer readiness probe or the
 * browser. The webServer + baseURL pin 127.0.0.1 for deterministic loopback.
 */

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Production mode (build + start), NOT `next dev`: Turbopack dev
    // cold-compiles each route on first hit, which routinely exceeds the 30s
    // `page.goto` timeout and flakes the suite (`waiting until "load"`).
    // `next start` serves pre-built routes with no cold-compile window, so e2e
    // is deterministic. Build adds ~30s up front per run, within the webServer
    // timeout. To avoid rebuilding across multiple `pnpm e2e:*` runs,
    // `reuseExistingServer` reuses a server already on :3000 — run
    // `pnpm build && pnpm start` once and every suite reuses it.
    command: "pnpm build && pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
