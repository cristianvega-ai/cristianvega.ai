import { expect, test } from "@playwright/test";

import { settle, VIEWPORTS } from "./fixtures.mjs";

for (const [path, status] of [["/", 200], ["/missing-hosting-check/", 404]]) {
  test(`${path} sends the security policy with HTTP ${status}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(status);
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    expect(headers["cache-control"]).toContain("max-age=0");
    expect(headers["cache-control"]).toContain("must-revalidate");
    if (status === 404) {
      expect(await response.text()).toContain("Page not found");
    } else {
      expect(headers["cache-control"]).toContain("no-transform");
    }
  });
}

for (const path of ["/about", "/about/", "/contact", "/contact/"]) {
  test(`${path} redirects to the homepage and keeps the query`, async ({ request }) => {
    const response = await request.get(`${path}?from=hosting-check`, { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    const location = new URL(response.headers().location, response.url());
    expect(location.origin).toBe(new URL(response.url()).origin);
    expect(location.pathname).toBe("/");
    expect(location.search).toBe("?from=hosting-check");
  });
}

test("only the Cloudflare test address sends noindex", async ({ request }) => {
  for (const [host, robots] of [
    ["cristianvega-ai.preview.workers.dev", "noindex"],
    ["cristianvega.ai", undefined],
  ]) {
    const response = await request.get("/", { headers: { host } });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"], host).toBe(robots);
  }
});

test("Cloudflare compresses built scripts and gives them an immutable cache", async ({ request }) => {
  const home = await request.get("/");
  const html = await home.text();
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(([, src]) => src);
  const hero = sources.find((src) => src.includes("HeroMotion"));
  const analytics = sources.find((src) => src.includes("CloudflareAnalytics"));
  expect(hero).toBeTruthy();
  expect(analytics).toBeTruthy();
  const paths = [
    [hero, "public, max-age=31536000, immutable"],
    [analytics, "public, max-age=31536000, immutable"],
  ];
  for (const [path, cache] of paths) {
    const response = await request.get(path, { headers: { "accept-encoding": "gzip" } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    expect(response.headers()["content-encoding"]).toBe("gzip");
    expect(response.headers()["cache-control"]).toBe(cache);
  }
  const portrait = await request.get("/images/cristian-vega-og.jpg");
  expect(portrait.status()).toBe(200);
  expect(portrait.headers()["cache-control"]).toBe("public, max-age=604800, stale-while-revalidate=86400");
});

test("Cloudflare does not serve configuration files or directory listings", async ({ request }) => {
  for (const path of ["/_headers", "/_redirects", "/.htaccess", "/.env", "/_astro/", "/images/"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).toContain("Page not found");
  }
});

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test(`${name} loads without script or policy errors`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await settle(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('script[src*="CloudflareAnalytics"]')).toHaveCount(1);
    await expect(page.locator('script[data-cf-beacon], script[data-goatcounter]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
