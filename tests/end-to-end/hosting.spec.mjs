import { expect, test } from "@playwright/test";

import { permissionsPolicy } from "../shared/node-helpers.mjs";

for (const [requestPath, expectedStatus] of [["/", 200], ["/missing-hosting-check/", 404]]) {
  test(`${requestPath} sends security headers with HTTP ${expectedStatus}`, async ({ request }) => {
    const response = await request.get(requestPath, { maxRedirects: 0 });
    expect(response.status()).toBe(expectedStatus);
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe(permissionsPolicy);
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    expect(headers["cache-control"]).toContain("max-age=0");
    expect(headers["cache-control"]).toContain("must-revalidate");
    if (expectedStatus === 404) {
      expect(await response.text()).toContain("Page not found");
    } else {
      expect(headers["cache-control"]).toContain("no-transform");
    }
  });
}

for (const requestPath of ["/contact", "/contact/"]) {
  test(`${requestPath} redirects to home and preserves the query string`, async ({ request }) => {
    const response = await request.get(`${requestPath}?from=hosting-check`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const redirectAddress = new URL(response.headers().location, response.url());
    expect(redirectAddress.origin).toBe(new URL(response.url()).origin);
    expect(redirectAddress.pathname).toBe("/");
    expect(redirectAddress.search).toBe("?from=hosting-check");
  });
}

test("Cloudflare sends noindex only for the preview hostname", async ({ request }) => {
  for (const [requestHostname, expectedRobotsHeader] of [
    ["cristianvega-ai.preview.workers.dev", "noindex"],
    ["cristianvega.ai", undefined],
  ]) {
    const response = await request.get("/", { headers: { host: requestHostname } });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"], requestHostname).toBe(expectedRobotsHeader);
  }
});

test("Cloudflare compresses built scripts and sets immutable caching", async ({ request }) => {
  const homeResponse = await request.get("/");
  const pageMarkup = await homeResponse.text();
  const scriptAddresses = [...pageMarkup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(([, scriptAddress]) => scriptAddress);
  const globeScriptAddress = scriptAddresses.find((scriptAddress) => scriptAddress.includes("LyraGlobe"));
  const analyticsScriptAddress = scriptAddresses.find((scriptAddress) => scriptAddress.includes("CloudflareAnalytics"));
  expect(globeScriptAddress).toBeTruthy();
  expect(analyticsScriptAddress).toBeTruthy();
  const scriptCacheExpectations = [
    [globeScriptAddress, "public, max-age=31536000, immutable"],
    [analyticsScriptAddress, "public, max-age=31536000, immutable"],
  ];
  for (const [requestPath, expectedCacheHeader] of scriptCacheExpectations) {
    const response = await request.get(requestPath, { headers: { "accept-encoding": "gzip" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    expect(response.headers()["content-encoding"]).toBe("gzip");
    expect(response.headers()["cache-control"]).toBe(expectedCacheHeader);
  }
  const portraitResponse = await request.get("/images/cristian-vega-social-preview.jpg");
  expect(portraitResponse.status()).toBe(200);
  expect(portraitResponse.headers()["cache-control"]).toBe("public, max-age=604800, stale-while-revalidate=86400");
});

test("Cloudflare does not serve configuration files or directory listings", async ({ request }) => {
  for (const requestPath of ["/_headers", "/_redirects", "/.htaccess", "/.env", "/.well-known/.env", "/_astro/", "/images/"]) {
    const response = await request.get(requestPath, { maxRedirects: 0 });
    expect(response.status(), requestPath).toBe(404);
    expect(await response.text(), requestPath).toContain("Page not found");
  }
});

test("Cloudflare serves the security contact as plain text", async ({ request }) => {
  const response = await request.get("/.well-known/security.txt", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain(?:;|$)/);
  expect(response.headers()["cache-control"]).toBe("public, max-age=3600");
  expect(await response.text()).toContain("Contact: https://github.com/cristianvega-ai/cristianvega.ai/security/advisories/new");
});

test("Cloudflare rejects POST requests to the static homepage", async ({ request }) => {
  const response = await request.post("/", { maxRedirects: 0 });
  expect(response.status()).toBe(405);
});
