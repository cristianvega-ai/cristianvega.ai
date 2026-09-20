import { expect, test } from "@playwright/test";

import { settle, useReducedMotion } from "./fixtures.mjs";

const production = "https://cristianvega.ai";
const beaconScript = "https://static.cloudflareinsights.com/beacon.min.js";
const beaconEndpoint = "https://cloudflareinsights.com/cdn-cgi/rum";

// Serve the local build at a chosen browser origin. No production request leaves the test.
async function serveAtOrigin(page, baseURL, origin) {
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await page.request.get(new URL(url.pathname + url.search, baseURL).href);
    await route.fulfill({ response });
  });
}

// The probe checks script loading, the site identifier, and the browser's CSP.
// Live deployment checks use the real Cloudflare script and endpoint.
async function installBeaconProbe(page) {
  await page.route(beaconScript, (route) => route.fulfill({
    contentType: "text/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: `
      const script = document.querySelector('script[data-cf-beacon]');
      const config = JSON.parse(script.dataset.cfBeacon);
      fetch('${beaconEndpoint}', {
        method: 'POST',
        body: JSON.stringify({ siteToken: config.token, location: location.href })
      });
    `,
  }));
  await page.route(beaconEndpoint, (route) => route.fulfill({
    status: 204,
    headers: { "access-control-allow-origin": "*" },
  }));
}

for (const [path, status] of [["/", 200], ["/missing-analytics-check/", 404]]) {
  test(`${path} loads one Cloudflare beacon and sends its site identifier`, async ({ page, baseURL }) => {
    await serveAtOrigin(page, baseURL, production);
    await installBeaconProbe(page);
    const errors = [];
    const goatRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const missingPage = status === 404 && message.location().url === `${production}${path}` && message.text().includes("404");
      if (message.type() === "error" && !missingPage) errors.push(message.text());
    });
    page.on("request", (request) => {
      if (/goatcounter|count\.v5|gc\.zgo\.at/.test(request.url())) goatRequests.push(request.url());
    });
    const sent = page.waitForRequest((request) => request.url() === beaconEndpoint && request.method() === "POST");
    const response = await page.goto(`${production}${path}`);
    expect(response.status()).toBe(status);
    const request = await sent;
    expect(request.postDataJSON()).toEqual({
      siteToken: "4de814b85a2343b0a5ccfea91d96fc4f",
      location: `${production}${path}`,
    });
    const beacon = page.locator("script[data-cf-beacon]");
    await expect(beacon).toHaveCount(1);
    await expect(beacon).toHaveAttribute("type", "module");
    await expect(beacon).toHaveAttribute("src", beaconScript);
    await page.waitForLoadState("networkidle");
    expect(goatRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const origin of ["http://localhost:4323", "https://cristianvega-ai.preview.workers.dev"]) {
  test(`${origin} does not load the analytics beacon`, async ({ page, baseURL }) => {
    if (origin.startsWith("https:")) await serveAtOrigin(page, baseURL, origin);
    await installBeaconProbe(page);
    const requests = [];
    page.on("request", (request) => {
      if (request.url().includes("cloudflareinsights.com")) requests.push(request.url());
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    await expect(page.locator('script[src*="CloudflareAnalytics"]')).toHaveCount(1);
    await expect(page.locator("script[data-cf-beacon]")).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}

test("the page works when the analytics script is blocked", async ({ page, baseURL }) => {
  await serveAtOrigin(page, baseURL, production);
  await page.route(beaconScript, (route) => route.abort());
  await useReducedMotion(page);
  const blocked = page.waitForEvent("requestfailed", (request) => request.url() === beaconScript);
  await page.goto(production);
  await blocked;
  await settle(page);
  await expect(page.locator(".hero__name")).toHaveText("Cristian Vega");
  await expect(page.locator(".hero__name")).toHaveCSS("opacity", "1");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});
