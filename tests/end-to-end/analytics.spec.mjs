import { expect, test } from "@playwright/test";

import { settle, useReducedMotion } from "../shared/browser-fixtures.mjs";

const productionOrigin = "https://cristianvega.ai";
const beaconScript = "https://static.cloudflareinsights.com/beacon.min.js";
const beaconEndpoint = "https://cloudflareinsights.com/cdn-cgi/rum";

// Serve the local build at the selected browser origin.
// Keep production requests inside the test.
async function serveAtOrigin(page, baseAddress, pageOrigin) {
  await page.route(`${pageOrigin}/**`, async (route) => {
    const requestAddress = new URL(route.request().url());
    const response = await page.request.get(new URL(requestAddress.pathname + requestAddress.search, baseAddress).href);
    await route.fulfill({ response });
  });
}

// The beacon probe checks script loading, the site identifier, and the content security policy.
// Live deployment checks use the real Cloudflare script and endpoint.
async function installBeaconProbe(page) {
  await page.route(beaconScript, (route) => route.fulfill({
    contentType: "text/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: `
      const script = document.querySelector('script[data-cf-beacon]');
      const beaconConfiguration = JSON.parse(script.dataset.cfBeacon);
      fetch('${beaconEndpoint}', {
        method: 'POST',
        body: JSON.stringify({ siteToken: beaconConfiguration.token, location: location.href })
      });
    `,
  }));
  await page.route(beaconEndpoint, (route) => route.fulfill({
    status: 204,
    headers: { "access-control-allow-origin": "*" },
  }));
}

for (const [pagePath, expectedStatus] of [["/", 200], ["/missing-analytics-check/", 404]]) {
  test(`${pagePath} loads one Cloudflare beacon on the production origin and sends its site identifier`, async ({ page, baseURL: baseAddress }) => {
    await serveAtOrigin(page, baseAddress, productionOrigin);
    await installBeaconProbe(page);
    const recordedPageProblems = [];
    page.on("pageerror", (error) => recordedPageProblems.push(error.message));
    page.on("console", (message) => {
      const expectedMissingPageError = expectedStatus === 404 && message.location().url === `${productionOrigin}${pagePath}` && message.text().includes("404");
      if (message.type() === "error" && !expectedMissingPageError) recordedPageProblems.push(message.text());
    });
    const beaconRequestReceived = page.waitForRequest((request) => request.url() === beaconEndpoint && request.method() === "POST");
    const response = await page.goto(`${productionOrigin}${pagePath}`);
    expect(response.status()).toBe(expectedStatus);
    const request = await beaconRequestReceived;
    expect(request.postDataJSON()).toEqual({
      siteToken: "4de814b85a2343b0a5ccfea91d96fc4f",
      location: `${productionOrigin}${pagePath}`,
    });
    const beaconElement = page.locator("script[data-cf-beacon]");
    await expect(beaconElement).toHaveCount(1);
    await expect(beaconElement).toHaveAttribute("type", "module");
    await expect(beaconElement).toHaveAttribute("src", beaconScript);
    await page.waitForLoadState("networkidle");
    expect(recordedPageProblems).toEqual([]);
  });
}

for (const pageOrigin of ["http://localhost:4323", "https://cristianvega-ai.preview.workers.dev"]) {
  test(`${pageOrigin} omits the Cloudflare analytics beacon`, async ({ page, baseURL: baseAddress }) => {
    if (pageOrigin.startsWith("https:")) await serveAtOrigin(page, baseAddress, pageOrigin);
    await installBeaconProbe(page);
    const beaconRequestAddresses = [];
    page.on("request", (request) => {
      const requestHostname = new URL(request.url()).hostname;
      if (requestHostname === "cloudflareinsights.com" || requestHostname.endsWith(".cloudflareinsights.com")) {
        beaconRequestAddresses.push(request.url());
      }
    });
    await page.goto(pageOrigin, { waitUntil: "networkidle" });
    await expect(page.locator('script[src*="CloudflareAnalytics"]')).toHaveCount(1);
    await expect(page.locator("script[data-cf-beacon]")).toHaveCount(0);
    expect(beaconRequestAddresses).toEqual([]);
  });
}

test("Home preserves content and the skip link when the analytics script is blocked", async ({ page, baseURL: baseAddress }) => {
  await serveAtOrigin(page, baseAddress, productionOrigin);
  await page.route(beaconScript, (route) => route.abort());
  await useReducedMotion(page);
  const beaconRequestFailed = page.waitForEvent("requestfailed", (request) => request.url() === beaconScript);
  await page.goto(productionOrigin);
  await beaconRequestFailed;
  await settle(page);
  await expect(page.locator("h1.identity__name")).toHaveText("Cristian Vega");
  await expect(page.locator("h1.identity__name")).toBeVisible();
  await expect(page.locator("header.identity svg.mark")).toBeVisible();
  await expect(page.locator("ul.profile-links a")).toHaveCount(3);
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
