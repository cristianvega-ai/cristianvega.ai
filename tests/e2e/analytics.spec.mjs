import { expect, test } from "@playwright/test";

/**
 * GoatCounter counting behind the ClientRouter.
 *
 * The Node contract tests prove the script tags, the vendored file, and the
 * CSP ship. Only a browser can prove the wiring runs: count.v5.js executes
 * and defines the API, and each client-side swap triggers exactly one
 * goatcounter.count() call after the router updates the URL. No beacon
 * leaves the machine here: the spy below replaces the sender before any
 * swap, and the library's own localhost filter drops the initial onload hit.
 */

test("each client-side swap counts one pageview on the new path", async ({ page }) => {
  // The archive and a post: two routes the router swaps between. About and
  // contact were retired, so the pair this used to walk no longer exists.
  await page.goto("/writing/");

  // count.v5.js loads async; wait for it to define the API.
  await page.waitForFunction(
    () => window.goatcounter && typeof window.goatcounter.count === "function",
  );

  // Spy on the sender. Recording location.pathname at call time also proves
  // each count runs after the URL changes, so the new page is what counts.
  await page.evaluate(() => {
    window.__gcPaths = [];
    window.goatcounter.count = () => window.__gcPaths.push(location.pathname);
  });

  await page.locator('a[href="/posts/from-bert-to-agents/"]').first().click();
  await expect(page).toHaveURL(/\/posts\/from-bert-to-agents\/$/);
  await expect
    .poll(() => page.evaluate(() => window.__gcPaths))
    .toEqual(["/posts/from-bert-to-agents/"]);

  // The next swap counts again, and the first one is not repeated.
  await page.locator('header a.brand[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => window.__gcPaths))
    .toEqual(["/posts/from-bert-to-agents/", "/"]);
});
