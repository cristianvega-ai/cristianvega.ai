import { expect, test } from "@playwright/test";

import { join } from "node:path";
import { listFiles, permissionsPolicy, root as repositoryRoot } from "../shared/node-helpers.mjs";
import { labTest } from "../shared/browser-fixtures.mjs";

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
      expect(await response.text()).toContain("This page doesn&#39;t exist.");
    } else {
      expect(headers["cache-control"]).toContain("no-transform");
    }
  });
}

// The contact and About pages moved to the homepage. Cloudflare must send their old addresses there.
for (const requestPath of ["/contact", "/contact/", "/about", "/about/"]) {
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
  // The mark script and the transition script load from the head as classic scripts. The analytics script is a module.
  const expectedScripts = ["lyra-mark", "page-transitions", "CloudflareAnalytics"];
  for (const scriptName of expectedScripts) {
    const scriptAddress = scriptAddresses.find((address) => address.startsWith(`/_astro/${scriptName}`));
    expect(scriptAddress, `The homepage must load ${scriptName} from /_astro/`).toBeTruthy();
    const response = await request.get(scriptAddress, { headers: { "accept-encoding": "gzip" } });
    expect(response.status(), scriptAddress).toBe(200);
    expect(response.headers()["content-type"], scriptAddress).toMatch(/javascript/);
    expect(response.headers()["content-encoding"], scriptAddress).toBe("gzip");
    expect(response.headers()["cache-control"], scriptAddress).toBe("public, max-age=31536000, immutable");
  }
  const portraitResponse = await request.get("/images/cristian-vega-social-preview.jpg");
  expect(portraitResponse.status()).toBe(200);
  expect(portraitResponse.headers()["cache-control"]).toBe("public, max-age=604800, stale-while-revalidate=86400");
});

test("Cloudflare does not serve configuration files or directory listings", async ({ request }) => {
  for (const requestPath of ["/_headers", "/_redirects", "/.htaccess", "/.env", "/.well-known/.env", "/_astro/", "/images/"]) {
    const response = await request.get(requestPath, { maxRedirects: 0 });
    expect(response.status(), requestPath).toBe(404);
    expect(await response.text(), requestPath).toContain("This page doesn&#39;t exist.");
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

// The Lab rules apply to a published experiment. The tests below serve the real media in an isolated build.
const labPermissionsPolicy = permissionsPolicy.replace("fullscreen=()", "fullscreen=(self)");

function expectGlobalHeaders(headers, label) {
  expect(headers["x-content-type-options"], label).toBe("nosniff");
  expect(headers["x-frame-options"], label).toBe("DENY");
  expect(headers["referrer-policy"], label).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"], label).toBe("max-age=31536000");
  expect(headers["content-security-policy"], label).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"], label).toContain("script-src 'self' https://static.cloudflareinsights.com/beacon.min.js");
}

labTest("The Lab pages allow full screen for this site and keep the other security headers", async ({ request, lab }) => {
  for (const labPath of ["/lab/", lab.experiment.href, `${lab.experiment.href}${lab.results[0].slug}/`]) {
    const response = await request.get(lab.origin + labPath, { maxRedirects: 0 });
    expect(response.status(), labPath).toBe(200);
    const headers = response.headers();
    expectGlobalHeaders(headers, labPath);
    expect(headers["permissions-policy"], `${labPath}: only full screen may differ from the global policy`).toBe(labPermissionsPolicy);
    expect(headers["content-security-policy"], `${labPath}: a Lab page must not take the scene policy`).not.toContain("sandbox");
  }
});

labTest("The Lab media is cached for a week and keeps the global headers", async ({ request, lab }) => {
  const result = lab.results[0];
  for (const [mediaPath, contentType] of [
    [`/lab/media/${lab.experiment.id}/clips/${result.slug}.av1.mp4`, "video/mp4"],
    [`/lab/media/${lab.experiment.id}/clips/${result.slug}.h264.mp4`, "video/mp4"],
    [`/lab/media/${lab.experiment.id}/posters/${result.slug}.webp`, "image/webp"],
  ]) {
    const response = await request.get(lab.origin + mediaPath, { maxRedirects: 0 });
    expect(response.status(), mediaPath).toBe(200);
    expect(response.headers()["content-type"], mediaPath).toBe(contentType);
    expect(response.headers()["cache-control"], mediaPath).toBe("public, max-age=604800, stale-while-revalidate=86400");
    expect(response.headers()["permissions-policy"], mediaPath).toBe(labPermissionsPolicy);
    expectGlobalHeaders(response.headers(), mediaPath);
    expect((await response.body()).length, `${mediaPath} must hold media data`).toBeGreaterThan(1_000);
  }
});

labTest("The scene entry page runs sandboxed, may be framed by this site only, and blocks every browser feature", async ({ request, lab }) => {
  const scenePath = `/lab/scenes/${lab.experiment.id}/${lab.results[0].slug}/`;
  const response = await request.get(lab.origin + scenePath, { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toMatch(/^text\/html/);
  expect(headers["content-security-policy"], "Scene: the policy must start with the sandbox").toMatch(/^sandbox allow-scripts allow-pointer-lock allow-downloads;/);
  expect(headers["content-security-policy"]).not.toContain("allow-same-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(headers["content-security-policy"], "Scene: the scene may run its own inline scripts").toContain("script-src 'self' 'unsafe-inline'");
  expect(headers["x-frame-options"], "Scene: the global frame refusal must not reach the scene").toBeUndefined();
  expect(headers["permissions-policy"], "Scene: the scene must have no browser feature, full screen included").toBe(permissionsPolicy);
  expect(headers["access-control-allow-origin"]).toBe("*");
  expect(headers["x-robots-tag"]).toBe("noindex");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["cache-control"], "Scene: the entry page must arrive as built").toBe("public, max-age=0, must-revalidate, no-transform");
});

labTest("Every file of every scene carries the sandbox policy and the CORS header", async ({ request, lab }) => {
  // The opaque origin of a scene loads its own scripts, styles, and fonts across origins, so each file needs CORS.
  const scenesFolder = join(repositoryRoot, "assets", "lab", lab.experiment.id, "scenes");
  let checkedFiles = 0;
  for (const result of lab.results) {
    for (const sceneFile of listFiles(join(scenesFolder, result.slug))) {
      const address = `/lab/scenes/${lab.experiment.id}/${result.slug}/${sceneFile === "index.html" ? "" : sceneFile}`;
      const response = await request.get(lab.origin + address, { maxRedirects: 0 });
      expect(response.status(), address).toBe(200);
      expect(response.headers()["access-control-allow-origin"], address).toBe("*");
      expect(response.headers()["content-security-policy"], address).toMatch(/^sandbox allow-scripts allow-pointer-lock allow-downloads;/);
      expect(response.headers()["x-frame-options"], address).toBeUndefined();
      checkedFiles += 1;
    }
  }
  expect(checkedFiles, "The check must cover the scene files").toBeGreaterThan(lab.results.length);
});

labTest("Cloudflare answers missing Lab media and pages with the real 404 page and the global headers", async ({ request, lab }) => {
  for (const missingPath of ["/lab/media/no-such-experiment/clips/a.av1.mp4", "/lab/media/", `/lab/media/${lab.experiment.id}/clips/`, "/lab/no-such-experiment/"]) {
    const response = await request.get(lab.origin + missingPath, { maxRedirects: 0 });
    expect(response.status(), missingPath).toBe(404);
    expect(await response.text(), missingPath).toContain("This page doesn&#39;t exist.");
    expect(response.headers()["x-frame-options"], missingPath).toBe("DENY");
    expect(response.headers()["content-security-policy"], missingPath).not.toContain("sandbox");
  }
});

// A missing scene path answers 404 under the scene rule, so the 404 page gets the scene policy. Only this site may frame it.
labTest("Cloudflare answers a missing scene with the real 404 page and a policy that only this site can frame", async ({ request, lab }) => {
  for (const missingPath of ["/lab/scenes/no-such-experiment/opus/", `/lab/scenes/${lab.experiment.id}/no-such-result/`, "/lab/scenes/"]) {
    const response = await request.get(lab.origin + missingPath, { maxRedirects: 0 });
    expect(response.status(), missingPath).toBe(404);
    expect(await response.text(), missingPath).toContain("This page doesn&#39;t exist.");
    expect(response.headers()["content-security-policy"], missingPath).toContain("frame-ancestors 'self'");
  }
});
