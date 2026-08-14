import { defineConfig, devices } from "@playwright/test";

/**
 * Browser coverage for behavior the Node contract tests cannot reach: computed
 * layout, sticky positioning, and viewport-dependent rules.
 *
 * The suite runs against the real static build through `astro preview`, not the
 * dev server, so what it asserts is what DreamHost serves.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:4321",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Not `astro preview`: it daemonizes, so Playwright sees the command exit. */
  webServer: {
    command: "node scripts/serve-dist.mjs",
    url: "http://localhost:4321/about/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
