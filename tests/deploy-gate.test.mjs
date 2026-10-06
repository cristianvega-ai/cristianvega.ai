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
const homepage = '<!doctype html><script src="/_astro/LyraGlobe.fixture.js"></script><script src="/_astro/CloudflareAnalytics.fixture.js"></script>';
const withoutAnalytics = '<!doctype html><script src="/_astro/LyraGlobe.fixture.js"></script>';
const script = gzipSync("console.log('fixture');");

// Keep this fixture separate from the verifier's policy.
const approvedCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "script-src 'self' https://static.cloudflareinsights.com/beacon.min.js",
  "connect-src 'self' https://cloudflareinsights.com",
  "upgrade-insecure-requests",
];
const approvedHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": permissionsPolicy,
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy": approvedCsp.join("; "),
};

function cspWithSources(name, sources) {
  return approvedCsp.map((directive) =>
    directive.startsWith(`${name} `) ? `${name} ${sources}` : directive,
  ).join("; ");
}

async function checkDeployment(t, {
  html = homepage,
  expectedHtml = homepage,
  redirectStatus = 301,
  redirectLocation = "/",
  missingStatus = 404,
  aboutStatus = 200,
  scriptEncoding = "gzip",
  scriptCache = "public, max-age=31536000, immutable",
  headers = {},
  notFoundHeaders = {},
  postStatus = 405,
  securityStatus = 200,
  securityExpires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "deploy-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expectedPath = join(directory, "index.html");
  await writeFile(expectedPath, expectedHtml);

  const server = createServer((request, response) => {
    const responseHeaders = { ...approvedHeaders, ...headers };
    if (request.url === "/__deploy-gate-missing-path__/") Object.assign(responseHeaders, notFoundHeaders);
    for (const [name, value] of Object.entries(responseHeaders)) {
      if (value !== null) response.setHeader(name, value);
    }
    if (request.url === "/" && request.method === "POST") {
      response.writeHead(postStatus);
      response.end();
    } else if (request.url === "/.well-known/security.txt") {
      response.writeHead(securityStatus, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Contact: https://github.com/cristianvega-ai/cristianvega.ai/security/advisories/new\nExpires: ${securityExpires}\n`);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } else if (request.url === "/about/") {
      response.writeHead(aboutStatus, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>About</title>");
    } else if (["/contact", "/contact/"].includes(request.url)) {
      response.writeHead(redirectStatus, { Location: redirectLocation });
      response.end();
    } else if (request.url === "/_astro/LyraGlobe.fixture.js" || request.url === "/_astro/CloudflareAnalytics.fixture.js") {
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

test("the live gate accepts a different CSP order on the 404 response", async (t) => {
  const reordered = [...approvedCsp].reverse().map((directive) => {
    const [name, ...sources] = directive.split(" ");
    return [name, ...sources.reverse()].join(" ");
  }).join("; ") + ";";
  const result = await checkDeployment(t, {
    notFoundHeaders: { "Content-Security-Policy": reordered },
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /verify-deploy: OK/);
});

test("the live gate accepts a different permissions order and header case", async (t) => {
  const result = await checkDeployment(t, {
    headers: {
      "X-Content-Type-Options": "NoSnIfF",
      "X-Frame-Options": "deny",
      "Strict-Transport-Security": "Max-Age=31536000;",
      "Permissions-Policy": permissionsPolicy.split(", ").reverse().join(", "),
    },
    notFoundHeaders: approvedHeaders,
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /verify-deploy: OK/);
});

for (const name of Object.keys(approvedHeaders)) {
  test(`the live gate rejects a missing ${name} header`, async (t) => {
    const result = await checkDeployment(t, { headers: { [name]: null } });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(`homepage missing ${name.toLowerCase()}`));
    assert.doesNotMatch(result.output, /verify-deploy: OK/);
  });
}

for (const [name, headers, header] of [
  ["an invalid content type option", { "X-Content-Type-Options": "sniff" }, "x-content-type-options"],
  ["a malformed content type option", { "X-Content-Type-Options": "\u00a0nosniff" }, "x-content-type-options"],
  ["duplicate content type options", { "X-Content-Type-Options": ["nosniff", "nosniff"] }, "x-content-type-options"],
  ["an invalid frame option", { "X-Frame-Options": "ALLOWALL" }, "x-frame-options"],
  ["a weaker frame option", { "X-Frame-Options": "SAMEORIGIN" }, "x-frame-options"],
  ["duplicate frame options", { "X-Frame-Options": ["DENY", "DENY"] }, "x-frame-options"],
  ["an unsafe referrer policy", { "Referrer-Policy": "unsafe-url" }, "referrer-policy"],
  ["an extra referrer policy", { "Referrer-Policy": "unsafe-url, strict-origin-when-cross-origin" }, "referrer-policy"],
  ["a short HSTS lifetime", { "Strict-Transport-Security": "max-age=60" }, "strict-transport-security"],
  ["an unapproved HSTS lifetime", { "Strict-Transport-Security": "max-age=63072000" }, "strict-transport-security"],
  ["HSTS on subdomains", { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }, "strict-transport-security"],
  ["HSTS preload", { "Strict-Transport-Security": "max-age=31536000; preload" }, "strict-transport-security"],
  ["a malformed HSTS lifetime", { "Strict-Transport-Security": "max-age=31536000invalid" }, "strict-transport-security"],
  ["duplicate HSTS lifetimes", { "Strict-Transport-Security": "max-age=31536000; max-age=0" }, "strict-transport-security"],
  ["multiple HSTS headers", { "Strict-Transport-Security": ["max-age=31536000", "max-age=0"] }, "strict-transport-security"],
  ["an incomplete browser policy", { "Permissions-Policy": "camera=(), microphone=(), geolocation=()" }, "permissions-policy"],
  ["a browser permission", { "Permissions-Policy": permissionsPolicy.replace("camera=()", "camera=(self)") }, "permissions-policy"],
  ["an extra browser permission", { "Permissions-Policy": `${permissionsPolicy}, browsing-topics=(self)` }, "permissions-policy"],
  ["duplicate browser permissions", { "Permissions-Policy": `${permissionsPolicy}, camera=()` }, "permissions-policy"],
  ["conflicting browser permissions", { "Permissions-Policy": `${permissionsPolicy}, camera=(self)` }, "permissions-policy"],
  ["a malformed browser policy", { "Permissions-Policy": `${permissionsPolicy}, invalid` }, "permissions-policy"],
  ["a tab in a browser permission", { "Permissions-Policy": permissionsPolicy.replace("camera=()", "camera=(\t)") }, "permissions-policy"],
  ["inline styles", { "Content-Security-Policy": cspWithSources("style-src", "'self' 'unsafe-inline'") }, "content-security-policy"],
  ["style attributes", { "Content-Security-Policy": cspWithSources("style-src-attr", "'none' 'unsafe-inline'") }, "content-security-policy"],
  ["wildcard scripts", { "Content-Security-Policy": cspWithSources("script-src", "'self' *") }, "content-security-policy"],
  ["inline scripts", { "Content-Security-Policy": cspWithSources("script-src", "'self' 'unsafe-inline'") }, "content-security-policy"],
  ["evaluated scripts", { "Content-Security-Policy": cspWithSources("script-src", "'self' 'unsafe-eval'") }, "content-security-policy"],
  ["an unapproved script URL", { "Content-Security-Policy": cspWithSources("script-src", "'self' https://static.cloudflareinsights.com/other.js") }, "content-security-policy"],
  ["wildcard connections", { "Content-Security-Policy": cspWithSources("connect-src", "'self' *") }, "content-security-policy"],
  ["an unapproved connection origin", { "Content-Security-Policy": cspWithSources("connect-src", "'self' https://example.invalid") }, "content-security-policy"],
  ["wildcard default sources", { "Content-Security-Policy": cspWithSources("default-src", "'self' *") }, "content-security-policy"],
  ["wildcard base URLs", { "Content-Security-Policy": cspWithSources("base-uri", "'self' *") }, "content-security-policy"],
  ["object sources", { "Content-Security-Policy": cspWithSources("object-src", "'none' *") }, "content-security-policy"],
  ["frame ancestors", { "Content-Security-Policy": cspWithSources("frame-ancestors", "'none' *") }, "content-security-policy"],
  ["wildcard form targets", { "Content-Security-Policy": cspWithSources("form-action", "'self' *") }, "content-security-policy"],
  ["wildcard image sources", { "Content-Security-Policy": cspWithSources("img-src", "'self' data: *") }, "content-security-policy"],
  ["wildcard font sources", { "Content-Security-Policy": cspWithSources("font-src", "'self' *") }, "content-security-policy"],
  ["a missing upgrade directive", { "Content-Security-Policy": approvedCsp.filter((directive) => directive !== "upgrade-insecure-requests").join("; ") }, "content-security-policy"],
  ["a missing script directive", { "Content-Security-Policy": approvedCsp.filter((directive) => !directive.startsWith("script-src ")).join("; ") }, "content-security-policy"],
  ["an extra script directive", { "Content-Security-Policy": `${approvedCsp.join("; ")}; script-src-elem *` }, "content-security-policy"],
  ["duplicate CSP directives", { "Content-Security-Policy": `${approvedCsp.join("; ")}; script-src 'self'` }, "content-security-policy"],
  ["duplicate CSP sources", { "Content-Security-Policy": cspWithSources("script-src", "'self' 'self' https://static.cloudflareinsights.com/beacon.min.js") }, "content-security-policy"],
  ["a malformed CSP directive", { "Content-Security-Policy": approvedCsp.join(";; ") }, "content-security-policy"],
  ["non-ASCII CSP spacing", { "Content-Security-Policy": approvedCsp.join("; ").replace("script-src ", "script-src\u00a0") }, "content-security-policy"],
  ["an invalid CSP flag", { "Content-Security-Policy": `${approvedCsp.join("; ")} *` }, "content-security-policy"],
  ["multiple CSP headers", { "Content-Security-Policy": [approvedCsp.join("; "), "script-src *"] }, "content-security-policy"],
]) {
  test(`the live gate rejects ${name}`, async (t) => {
    const result = await checkDeployment(t, { headers });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(`homepage ${header} must match the approved _headers policy`));
    assert.doesNotMatch(result.output, /verify-deploy: OK/);
  });
}

test("the live gate rejects an unsafe 404 header", async (t) => {
  const result = await checkDeployment(t, {
    notFoundHeaders: { "X-Frame-Options": "ALLOWALL" },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /404 response x-frame-options must match the approved _headers policy/);
  assert.doesNotMatch(result.output, /verify-deploy: OK/);
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
  ["an about page that is missing", { aboutStatus: 404 },
    /\/about\/ must return HTTP 200 as HTML/],
  ["an about page that redirects", { aboutStatus: 301 },
    /\/about\/ must return HTTP 200 as HTML/],
  ["a missing page served with HTTP 200", { missingStatus: 200 },
    /expected 404/],
  ["a missing analytics loader", { html: withoutAnalytics, expectedHtml: withoutAnalytics },
    /homepage does not load the analytics loader script/],
  ["an uncompressed analytics loader", { scriptEncoding: "identity" },
    /analytics loader.*is not gzip-compressed/],
  ["a short cache on the analytics loader", { scriptCache: "public, max-age=60" },
    /analytics loader.*expected public, max-age=31536000, immutable/],
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
