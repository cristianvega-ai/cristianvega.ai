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
    baseURL: "http://localhost:4323",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Not `astro preview`: it daemonizes, so Playwright sees the command exit.
     Deliberately not 4321. reuseExistingServer adopts whatever already answers
     on the port, so sharing one with `astro dev` would silently run the whole
     suite against the dev server and report green for a build it never saw. */
  webServer: {
    command: "PORT=4323 node scripts/serve-dist.mjs",
    url: "http://localhost:4323/about/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
