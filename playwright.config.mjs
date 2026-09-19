import { defineConfig, devices } from "@playwright/test";

/**
 * Browser coverage for behavior the Node contract tests cannot reach: computed
 * layout, sticky positioning, and viewport-dependent rules.
 *
 * Wrangler serves the build with the same headers, redirects, and asset
 * rules as Cloudflare. The tests do not need a Cloudflare account.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:4323",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Use a dedicated port. Never test a server from another checkout. */
  webServer: {
    command: "npx --no-install wrangler dev --local --port 4323 --inspector-port 0 --show-interactive-dev-session false",
    url: "http://localhost:4323/",
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: "false" },
    timeout: 60_000,
  },
});
