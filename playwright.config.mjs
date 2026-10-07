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
  webServer: [{
    /* The test environment keeps each request's hostname for header checks. */
    command: "npx --no-install wrangler dev --local --env test --port 4323 --inspector-port 0 --show-interactive-dev-session false",
    url: "http://localhost:4323/",
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: "false" },
    timeout: 60_000,
  }, {
    // Keep draft checks separate from the production build. The test
    // configuration sends no reload to a page under test.
    command: "npm run dev -- --config tests/e2e/dev-server.config.mjs --ignore-lock --host 127.0.0.1 --port 4324",
    url: "http://127.0.0.1:4324/writing/",
    reuseExistingServer: false,
    // Keep the test server in the foreground so Playwright can stop it.
    env: { ASTRO_DEV_BACKGROUND: "1" },
    timeout: 60_000,
  }],
});
