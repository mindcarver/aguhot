import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the AGUHOT web app smoke tests.
 *
 * `pnpm --filter web e2e` runs `playwright test` from apps/web. The web server
 * is started on-demand; the homepage is anonymous and needs no DB/Redis, so
 * it boots even without infrastructure configured.
 *
 * The e2e script sets NO_PROXY/no_proxy to exclude localhost so that a
 * developer's system HTTP proxy (corporate/VPN tools) cannot intercept the
 * webServer readiness probe or the browser and return a misleading 502. The
 * webServer + baseURL pin 127.0.0.1 for deterministic loopback binding.
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
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
