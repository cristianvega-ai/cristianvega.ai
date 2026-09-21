import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { permissionsPolicy, root } from "./helpers.mjs";

const run = promisify(execFile);
const homepage = '<!doctype html><script src="/_astro/HeroMotion.fixture.js"></script><script src="/_astro/CloudflareAnalytics.fixture.js"></script>';
const withoutAnalytics = '<!doctype html><script src="/_astro/HeroMotion.fixture.js"></script>';
const script = gzipSync("console.log('fixture');");

async function checkDeployment(t, {
  html = homepage,
  expectedHtml = homepage,
  redirectStatus = 301,
  redirectLocation = "/",
  missingStatus = 404,
  scriptEncoding = "gzip",
  scriptCache = "public, max-age=31536000, immutable",
  stylePolicy = "style-src 'self'; style-src-attr 'none'",
  browserPolicy = permissionsPolicy,
  postStatus = 405,
  securityStatus = 200,
  securityExpires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "deploy-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expectedPath = join(directory, "index.html");
  await writeFile(expectedPath, expectedHtml);

  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader("Permissions-Policy", browserPolicy);
    response.setHeader("Strict-Transport-Security", "max-age=31536000");
    response.setHeader("Content-Security-Policy",
      `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; font-src 'self'; ${stylePolicy}`);
    if (request.url === "/" && request.method === "POST") {
      response.writeHead(postStatus);
      response.end();
    } else if (request.url === "/.well-known/security.txt") {
      response.writeHead(securityStatus, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Contact: https://github.com/cristianvega-ai/cristianvega.ai/security/advisories/new\nExpires: ${securityExpires}\n`);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } else if (["/about", "/about/", "/contact", "/contact/"].includes(request.url)) {
      response.writeHead(redirectStatus, { Location: redirectLocation });
      response.end();
    } else if (request.url === "/_astro/HeroMotion.fixture.js" || request.url === "/_astro/CloudflareAnalytics.fixture.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript",
        "Content-Encoding": scriptEncoding,
        "Cache-Control": scriptCache,
      });
      response.end(script);
    } else {
      response.writeHead(missingStatus);
      response.end("Page not found");
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const result = await run(process.execPath, [join(root, "scripts/verify-deploy.mjs")], {
      env: {
        ...process.env,
        ORIGIN: `http://127.0.0.1:${server.address().port}`,
        EXPECTED_INDEX: expectedPath,
        CHECK_CANONICAL_REDIRECTS: "false",
      },
      timeout: 10_000,
    });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    return { code: error.code, output: error.stdout + error.stderr };
  }
}

test("the live gate accepts the exact verified homepage", async (t) => {
  const result = await checkDeployment(t);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /the live homepage matches the verified build/);
  assert.match(result.output, /verify-deploy: OK/);
});

for (const [name, options, message] of [
  ["an injected analytics script", { html: homepage + '<script src="/injected.js"></script>' },
    /the live homepage does not match the verified build/],
  ["a different build", { expectedHtml: homepage + "\n" },
    /the live homepage does not match the verified build/],
  ["a temporary redirect", { redirectStatus: 302 },
    /must redirect to the homepage with HTTP 301/],
  ["a redirect to the wrong path", { redirectLocation: "/elsewhere/" },
    /must redirect to the homepage with HTTP 301/],
  ["a redirect to another host", { redirectLocation: "https://example.invalid/" },
    /must redirect to the homepage with HTTP 301/],
  ["a missing page served with HTTP 200", { missingStatus: 200 },
    /expected 404/],
  ["a missing analytics loader", { html: withoutAnalytics, expectedHtml: withoutAnalytics },
    /homepage does not load the analytics loader script/],
  ["an uncompressed analytics loader", { scriptEncoding: "identity" },
    /analytics loader.*is not gzip-compressed/],
  ["a short cache on the analytics loader", { scriptCache: "public, max-age=60" },
    /analytics loader.*expected public, max-age=31536000, immutable/],
  ["inline styles", { stylePolicy: "style-src 'self' 'unsafe-inline'" },
    /CSP must block inline styles/],
  ["an incomplete browser policy", { browserPolicy: "camera=(), microphone=(), geolocation=()" },
    /Permissions-Policy must deny payment/],
  ["a homepage that accepts POST", { postStatus: 200 },
    /the static homepage must reject POST/],
  ["a missing security contact", { securityStatus: 404 },
    /security.txt must return HTTP 200 as plain text/],
  ["an expired security contact", { securityExpires: "2020-01-01T00:00:00Z" },
    /security.txt must have a future expiry date/],
]) {
  test(`the live gate rejects ${name}`, async (t) => {
    const result = await checkDeployment(t, options);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /verify-deploy: OK/);
  });
}
