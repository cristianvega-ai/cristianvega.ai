import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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
const scriptPaths = [
  "/_astro/orbit.a1b2c3d4.js",
  "/_astro/metrics.e5f6a7b8.js",
  "/_astro/interface.c9d0e1f2.js",
];
const homepage = `<!doctype html><script type="module" src="${scriptPaths[0]}"></script>`
  + `<script src='${scriptPaths[1]}'></script><script src=${scriptPaths[2]}></script>`;
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

async function listen(t, server) {
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function checkDeployment(t, {
  html = homepage,
  expectedHtml = homepage,
  redirectStatus = 301,
  redirectLocation = "/",
  missingStatus = 404,
  aboutStatus = 200,
  writingStatus = 404,
  scriptResponses = {},
  headers = {},
  notFoundHeaders = {},
  aboutHeaders = {},
  writingHeaders = {},
  postStatus = 405,
  securityStatus = 200,
  securityExpires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "deploy-gate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expectedPath = join(directory, "index.html");
  if (expectedHtml !== null) await writeFile(expectedPath, expectedHtml);
  const resources = new Map(scriptPaths.map((path) => [path, {}]));
  for (const [path, response] of Object.entries(scriptResponses)) resources.set(path, response);
  const requests = [];
  const routeHeaders = new Map([
    ["/__deploy-gate-missing-path__/", notFoundHeaders],
    ["/about/", aboutHeaders],
    ["/writing/", writingHeaders],
  ]);

  const server = createServer((request, response) => {
    requests.push(request.url);
    const responseHeaders = { ...approvedHeaders, ...headers, ...routeHeaders.get(request.url) };
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
    } else if (request.url === "/writing/") {
      response.writeHead(writingStatus, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Writing</title>");
    } else if (["/contact", "/contact/"].includes(request.url)) {
      response.writeHead(redirectStatus, { Location: redirectLocation });
      response.end();
    } else if (resources.has(request.url) && resources.get(request.url) !== null) {
      const resource = resources.get(request.url);
      if (resource.disconnect) {
        response.destroy();
        return;
      }
      response.writeHead(resource.status ?? 200, {
        "Content-Type": resource.type ?? "text/javascript",
        "Content-Encoding": resource.encoding ?? "gzip",
        "Cache-Control": resource.cache ?? "public, max-age=31536000, immutable",
        ...(resource.location ? { Location: resource.location } : {}),
      });
      response.end(script);
    } else {
      response.writeHead(missingStatus);
      response.end("Page not found");
    }
  });
  const origin = await listen(t, server);
  const expectedIndex = expectedHtml === null ? "" : expectedPath;
  return { ...await runGate({ ORIGIN: origin, EXPECTED_INDEX: expectedIndex }), requests };
}

async function runGate(env, timeout = 10_000) {
  try {
    const result = await run(process.execPath, [join(root, "scripts/verify-deployment.mjs")], {
      env: { ...process.env, CHECK_CANONICAL_REDIRECTS: "false", ...env },
      timeout,
    });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    return { code: error.code, output: error.stdout + error.stderr };
  }
}

// Serve dist/ with the local Cloudflare runtime on a free port.
// Wrangler applies dist/_headers with the same rules as Cloudflare.
async function startLocalCloudflare(t) {
  const wrangler = spawn(process.execPath, [
    join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--env", "test",
    "--ip", "127.0.0.1", "--port", "0", "--inspector-port", "0",
    "--show-interactive-dev-session", "false",
  ], {
    cwd: root,
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => wrangler.once("exit", resolve));
  const stop = (signal) => {
    try {
      process.kill(-wrangler.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  t.after(async () => {
    if (wrangler.exitCode !== null || wrangler.signalCode !== null) return;
    stop("SIGTERM");
    const timer = setTimeout(() => stop("SIGKILL"), 10_000);
    await exited;
    clearTimeout(timer);
  });

  let output = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Wrangler did not start:\n${output}`)), 60_000);
    const read = (chunk) => {
      output += chunk;
      const ready = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (ready) {
        clearTimeout(timer);
        resolve(ready[1]);
      }
    };
    wrangler.stdout.setEncoding("utf8").on("data", read);
    wrangler.stderr.setEncoding("utf8").on("data", read);
    wrangler.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Wrangler stopped (${signal ?? code}):\n${output}`));
    });
  });
}

test("the live gate accepts the exact verified homepage", async (t) => {
  const result = await checkDeployment(t);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /the live homepage matches the verified build/);
  assert.match(result.output, /verify-deployment: OK/);
  for (const path of scriptPaths) {
    assert.equal(result.requests.filter((request) => request === path).length, 1, path);
  }
});

// Run the gate against the build before deploy. A changed or missing
// approved header in public/_headers then stops the verification before
// Cloudflare receives the build. The gate reads only the approved headers,
// so a new header or a change to a cache rule does not change this result.
test("the live gate accepts the security headers of the local Cloudflare build", async (t) => {
  const origin = await startLocalCloudflare(t);
  const result = await runGate({ ORIGIN: origin, EXPECTED_INDEX: "" }, 30_000);
  assert.equal(result.code, 0, result.output);
  for (const label of ["homepage", "404 response", "/about/", "/writing/"]) {
    assert.ok(result.output.includes(`verify-deployment: ${label} security headers match the approved policy`), result.output);
  }
});

test("the live gate rejects an injected script without requesting it", async (t) => {
  const result = await checkDeployment(t, { html: homepage + '<script src="/injected.js"></script>' });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /the live homepage does not match the verified build/);
  assert.ok(!result.requests.includes("/injected.js"));
  assert.doesNotMatch(result.output, /verify-deployment: OK/);
});

test("the live gate does not request external scripts", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, {
      "Content-Type": "text/javascript",
      "Content-Encoding": "gzip",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(script);
  });
  const externalOrigin = await listen(t, server);
  const html = homepage + `<script src="${externalOrigin}/external.js"></script>`
    + `<script src="${externalOrigin.slice(5)}/other.js"></script>`;
  const result = await checkDeployment(t, { html, expectedHtml: html });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(requests, []);
});

test("the live gate rejects a missing built script", async (t) => {
  const path = scriptPaths[2];
  const result = await checkDeployment(t, { scriptResponses: { [path]: null } });
  assert.equal(result.code, 1, result.output);
  assert.ok(result.output.includes(`${path} returned HTTP 404`), result.output);
  assert.doesNotMatch(result.output, /verify-deployment: OK/);
});

// Each input breaks a different asset delivery check.
for (const [name, response, message] of [
  ["a script error", { status: 503 }, /returned HTTP 503/],
  ["a script redirect", { status: 302, location: "https://example.invalid/script.js" }, /returned HTTP 302/],
  ["a disconnected script", { disconnect: true }, /could not reach/],
  ["an HTML script response", { type: "text/html" }, /must return a JavaScript content type/],
  ["an uncompressed script", { encoding: "identity" }, /is not gzip-compressed/],
  ["a short script cache", { cache: "public, max-age=60, immutable" }, /expected public, max-age=31536000, immutable/],
]) {
  test(`the live gate rejects ${name}`, async (t) => {
    const result = await checkDeployment(t, { scriptResponses: { [scriptPaths[2]]: response } });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, message);
    assert.ok(result.output.includes(scriptPaths[2]), result.output);
    assert.doesNotMatch(result.output, /verify-deployment: OK/);
  });
}

// Cover missing values, URL parsing, unsupported schemes, and embedded credentials.
for (const [name, reference, message] of [
  ["an empty script reference", 'src=""', /empty src reference/],
  ["a malformed script URL", 'src="http://["', /invalid src reference/],
  ["a data script URL", 'src="data:text/javascript,console.log(1)"', /unsupported URL/],
  ["a script URL with credentials", 'src="http://user:pass@example.invalid/script.js"', /must not contain credentials/],
]) {
  test(`the live gate rejects ${name}`, async (t) => {
    const html = homepage + `<script ${reference}></script>`;
    const result = await checkDeployment(t, { html, expectedHtml: html });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /verify-deployment: OK/);
  });
}

test("the live gate rejects a missing Content-Security-Policy header", async (t) => {
  const result = await checkDeployment(t, { headers: { "Content-Security-Policy": null } });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /homepage missing content-security-policy/);
  assert.doesNotMatch(result.output, /verify-deployment: OK/);
});

// Cover each security-header mechanism with one unsafe policy.
for (const [name, headers, header] of [
  ["an invalid content type option", { "X-Content-Type-Options": "sniff" }, "x-content-type-options"],
  ["an invalid frame option", { "X-Frame-Options": "ALLOWALL" }, "x-frame-options"],
  ["an unsafe referrer policy", { "Referrer-Policy": "unsafe-url" }, "referrer-policy"],
  ["a short HSTS lifetime", { "Strict-Transport-Security": "max-age=60" }, "strict-transport-security"],
  ["a browser permission", { "Permissions-Policy": permissionsPolicy.replace("camera=()", "camera=(self)") }, "permissions-policy"],
  ["wildcard scripts", { "Content-Security-Policy": cspWithSources("script-src", "'self' *") }, "content-security-policy"],
]) {
  test(`the live gate rejects ${name}`, async (t) => {
    const result = await checkDeployment(t, { headers });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(`homepage ${header} must match the approved _headers policy`));
    assert.doesNotMatch(result.output, /verify-deployment: OK/);
  });
}

test("the live gate rejects an unsafe 404 header", async (t) => {
  const result = await checkDeployment(t, {
    notFoundHeaders: { "X-Frame-Options": "ALLOWALL" },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /404 response x-frame-options must match the approved _headers policy/);
  assert.doesNotMatch(result.output, /verify-deployment: OK/);
});

test("the live gate accepts published Writing with HTTP 200", async (t) => {
  const result = await checkDeployment(t, { writingStatus: 200 });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /\/writing\/ security headers match the approved policy/);
  assert.equal(result.requests.filter((request) => request === "/writing/").length, 1);
});

// Check one policy failure on each additional response path and publication state.
for (const [page, route, options, headers, message] of [
  ["/about/", "/about/", {}, { "Content-Security-Policy": cspWithSources("script-src", "'self' *") }, "content-security-policy must match the approved _headers policy"],
  ["/writing/ with HTTP 404", "/writing/", {}, { "Content-Security-Policy": null }, "missing content-security-policy"],
  ["/writing/ with HTTP 200", "/writing/", { writingStatus: 200 }, { "Referrer-Policy": "unsafe-url" }, "referrer-policy must match the approved _headers policy"],
]) {
  const option = route === "/about/" ? "aboutHeaders" : "writingHeaders";
  test(`the live gate rejects an unsafe policy on ${page}`, async (t) => {
    const result = await checkDeployment(t, { ...options, [option]: headers });
    assert.equal(result.code, 1, result.output);
    assert.ok(result.output.includes(`verify-deployment: ${route} ${message}`), result.output);
    assert.match(result.output, /homepage security headers match the approved policy/);
    assert.doesNotMatch(result.output, /verify-deployment: OK/);
  });
}

test("the live gate rejects Writing with HTTP 500", async (t) => {
  const result = await checkDeployment(t, { writingStatus: 500 });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /\/writing\/ returned HTTP 500, expected 200 or 404/);
  assert.doesNotMatch(result.output, /verify-deployment: OK/);
});

// Cover response contracts that the happy path cannot prove.
for (const [name, options, message] of [
  ["a temporary redirect", { redirectStatus: 302 },
    /must redirect to the homepage with HTTP 301/],
  ["a redirect to another host", { redirectLocation: "https://example.invalid/" },
    /must redirect to the homepage with HTTP 301/],
  ["an about page that is missing", { aboutStatus: 404 },
    /\/about\/ must return HTTP 200 as HTML/],
  ["a missing page served with HTTP 200", { missingStatus: 200 },
    /expected 404/],
  ["a homepage without built scripts", { html: "<!doctype html>", expectedHtml: "<!doctype html>" },
    /homepage does not load a same-origin script/],
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
    assert.doesNotMatch(result.output, /verify-deployment: OK/);
  });
}
