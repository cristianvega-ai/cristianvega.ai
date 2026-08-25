import { expect, test } from "@playwright/test";

/**
 * GoatCounter counting on a full page load.
 *
 * The Node contract tests prove the script tag, the vendored file, and the
 * CSP ship. Only a browser can prove the wiring runs: count.v5.js executes
 * and defines the API. There is no ClientRouter, so the library's own onload
 * hook is the only count path. No beacon leaves the machine here: the
 * library's localhost filter drops the initial onload hit.
 */

test("count.v5.js defines the GoatCounter API on a full page load", async ({ page }) => {
  await page.goto("/");

  await expect
    .poll(() =>
      page.evaluate(
        () => Boolean(window.goatcounter && typeof window.goatcounter.count === "function"),
      ),
    )
    .toBe(true);
});
