import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { createContentBuild, permissionsPolicy, root as repositoryRoot } from "../shared/node-helpers.mjs";

const runCommand = promisify(execFile);
const scriptPaths = [
  "/_astro/orbit.a1b2c3d4.js",
  "/_astro/metrics.e5f6a7b8.js",
  "/_astro/interface.c9d0e1f2.js",
];
const homepageHtml = `<!doctype html><script type="module" src="${scriptPaths[0]}"></script>`
  + `<script src='${scriptPaths[1]}'></script><script src=${scriptPaths[2]}></script>`;
const compressedScript = gzipSync("console.log('fixture');");

// Keep this fixture separate from the verifier's policy.
const approvedContentSecurityPolicy = [
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
  "Content-Security-Policy": approvedContentSecurityPolicy.join("; "),
};

// The Lab pages allow full screen for this origin. A scene has its own sandbox policy and blocks every feature.
const labPermissionsPolicy = permissionsPolicy.replace("fullscreen=()", "fullscreen=(self)");
const approvedSceneHeaders = {
  "Content-Security-Policy": "sandbox allow-scripts allow-pointer-lock allow-downloads; default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'",
  "Permissions-Policy": permissionsPolicy,
  "Access-Control-Allow-Origin": "*",
  "X-Robots-Tag": "noindex",
  "X-Frame-Options": null,
};
const labPagePaths = { lab: "/lab/", experiment: "/lab/castles/", result: "/lab/castles/opus/", scene: "/lab/scenes/castles/opus/" };

function contentSecurityPolicyWithSources(directiveName, directiveSources) {
  return approvedContentSecurityPolicy.map((directive) =>
    directive.startsWith(`${directiveName} `) ? `${directiveName} ${directiveSources}` : directive,
  ).join("; ");
}

async function listenForRequests(testContext, fixtureServer) {
  testContext.after(() => new Promise((resolve, reject) => {
    fixtureServer.closeAllConnections();
    fixtureServer.close((error) => error ? reject(error) : resolve());
  }));
  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");
  return `http://127.0.0.1:${fixtureServer.address().port}`;
}

async function checkDeployment(testContext, {
  html: responseHtml = homepageHtml,
  expectedHtml: expectedHomepageHtml = homepageHtml,
  redirectStatus = 301,
  redirectLocation = "/",
  missingStatus = 404,
  aboutStatus = 301,
  writingStatus = 404,
  scriptResponses = {},
  headers: responseHeaderOverrides = {},
  notFoundHeaders: notFoundHeaderOverrides = {},
  writingHeaders: writingHeaderOverrides = {},
  postStatus = 405,
  // A published Lab answers its pages with 200. An unpublished one answers 404.
  labStatus = 404,
  labHeaders: labHeaderOverrides = {},
  sceneStatus = 200,
  sceneHeaders: sceneHeaderOverrides = {},
  labMarkup: labMarkupOverrides = {},
  securityStatus = 200,
  securityExpires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
} = {}) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "deploy-gate-"));
  testContext.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  const expectedHomepagePath = join(fixtureDirectory, "index.html");
  if (expectedHomepageHtml !== null) await writeFile(expectedHomepagePath, expectedHomepageHtml);
  const scriptResources = new Map(scriptPaths.map((scriptPath) => [scriptPath, {}]));
  for (const [scriptPath, response] of Object.entries(scriptResponses)) scriptResources.set(scriptPath, response);
  const requestedAddresses = [];
  const labPageHeaders = { "Permissions-Policy": labPermissionsPolicy, ...labHeaderOverrides };
  const routeHeaders = new Map([
    ["/__deploy-gate-missing-path__/", notFoundHeaderOverrides],
    ["/writing/", writingHeaderOverrides],
    [labPagePaths.lab, labPageHeaders],
    [labPagePaths.experiment, labPageHeaders],
    [labPagePaths.result, labPageHeaders],
    [labPagePaths.scene, { ...approvedSceneHeaders, ...sceneHeaderOverrides }],
  ]);
  const labMarkup = {
    [labPagePaths.lab]: `<a class="lab-card" href="${labPagePaths.experiment}" data-morph-key="lab/castles">Castles</a>`,
    [labPagePaths.experiment]: `<a class="result-tile" href="${labPagePaths.result}" data-stage-key="opus">Opus</a>`,
    [labPagePaths.result]: `<iframe class="scene-stage__frame" src="${labPagePaths.scene}"></iframe>`,
    [labPagePaths.scene]: "<!doctype html><title>Scene</title>",
    ...labMarkupOverrides,
  };

  const fixtureServer = createServer((request, response) => {
    requestedAddresses.push(request.url);
    const responseHeaders = { ...approvedHeaders, ...responseHeaderOverrides, ...routeHeaders.get(request.url) };
    for (const [headerName, headerValue] of Object.entries(responseHeaders)) {
      if (headerValue !== null) response.setHeader(headerName, headerValue);
    }
    if (request.url === "/" && request.method === "POST") {
      response.writeHead(postStatus);
      response.end();
    } else if (request.url === "/.well-known/security.txt") {
      response.writeHead(securityStatus, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`Contact: https://github.com/cristianvega-ai/cristianvega.ai/security/advisories/new\nExpires: ${securityExpires}\n`);
    } else if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(responseHtml);
    } else if (["/about", "/about/"].includes(request.url)) {
      // The About page moved to the homepage. A status of 200 stands for a page that stayed.
      response.writeHead(aboutStatus, aboutStatus === 301 ? { Location: "/" } : { "Content-Type": "text/html; charset=utf-8" });
      response.end(aboutStatus === 301 ? undefined : "<!doctype html><title>About</title>");
    } else if (request.url in labMarkup) {
      // The Lab status decides the Lab page. The pages below it follow the walk that the gate makes after a 200.
      const pageStatus = request.url === labPagePaths.lab ? labStatus : request.url === labPagePaths.scene ? sceneStatus : 200;
      response.writeHead(pageStatus, { "Content-Type": "text/html; charset=utf-8" });
      response.end(labMarkup[request.url]);
    } else if (request.url === "/writing/") {
      response.writeHead(writingStatus, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Writing</title>");
    } else if (["/contact", "/contact/"].includes(request.url)) {
      response.writeHead(redirectStatus, { Location: redirectLocation });
      response.end();
    } else if (scriptResources.has(request.url) && scriptResources.get(request.url) !== null) {
      const scriptResource = scriptResources.get(request.url);
      if (scriptResource.disconnect) {
        response.destroy();
        return;
      }
      response.writeHead(scriptResource.status ?? 200, {
        "Content-Type": scriptResource.type ?? "text/javascript",
        "Content-Encoding": scriptResource.encoding ?? "gzip",
        "Cache-Control": scriptResource.cache ?? "public, max-age=31536000, immutable",
        ...(scriptResource.location ? { Location: scriptResource.location } : {}),
      });
      response.end(compressedScript);
    } else {
      response.writeHead(missingStatus);
      response.end("Page not found");
    }
  });
  const serverOrigin = await listenForRequests(testContext, fixtureServer);
  const expectedHomepagePathArgument = expectedHomepageHtml === null ? "" : expectedHomepagePath;
  return { ...await runDeploymentGate({ ORIGIN: serverOrigin, EXPECTED_INDEX: expectedHomepagePathArgument }), requests: requestedAddresses };
}

async function runDeploymentGate(environment, timeoutMilliseconds = 10_000) {
  try {
    const deploymentResult = await runCommand(process.execPath, [join(repositoryRoot, "scripts/verify-deployment.mjs")], {
      env: { ...process.env, CHECK_CANONICAL_REDIRECTS: "false", ...environment },
      timeout: timeoutMilliseconds,
    });
    return { code: 0, output: deploymentResult.stdout + deploymentResult.stderr };
  } catch (error) {
    return { code: error.code, output: error.stdout + error.stderr };
  }
}

// Serve dist/ with the local Cloudflare runtime on a free port.
// Wrangler applies dist/_headers with the same rules as Cloudflare.
async function startLocalCloudflare(testContext, projectRoot = repositoryRoot) {
  const wranglerProcess = spawn(process.execPath, [
    join(repositoryRoot, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--env", "test",
    "--ip", "127.0.0.1", "--port", "0", "--inspector-port", "0",
    "--show-interactive-dev-session", "false",
  ], {
    cwd: projectRoot,
    detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const processExited = new Promise((resolve) => wranglerProcess.once("exit", resolve));
  const stopProcess = (signal) => {
    try {
      process.kill(-wranglerProcess.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  testContext.after(async () => {
    if (wranglerProcess.exitCode !== null || wranglerProcess.signalCode !== null) return;
    stopProcess("SIGTERM");
    const timeoutHandle = setTimeout(() => stopProcess("SIGKILL"), 10_000);
    await processExited;
    clearTimeout(timeoutHandle);
  });

  let output = "";
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new Error(`Wrangler did not start:\n${output}`)), 60_000);
    const readProcessOutput = (outputChunk) => {
      output += outputChunk;
      const readyAddressMatch = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (readyAddressMatch) {
        clearTimeout(timeoutHandle);
        resolve(readyAddressMatch[1]);
      }
    };
    wranglerProcess.stdout.setEncoding("utf8").on("data", readProcessOutput);
    wranglerProcess.stderr.setEncoding("utf8").on("data", readProcessOutput);
    wranglerProcess.on("exit", (exitCode, signal) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Wrangler stopped (${signal ?? exitCode}):\n${output}`));
    });
  });
}

test("the deployment gate accepts the exact verified homepage", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext);
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.match(deploymentResult.output, /the live homepage matches the verified build/);
  assert.match(deploymentResult.output, /verify-deployment: OK/);
  for (const scriptPath of scriptPaths) {
    assert.equal(deploymentResult.requests.filter((request) => request === scriptPath).length, 1, scriptPath);
  }
});

// Check approved headers through the local Cloudflare runtime before deployment.
// Missing or changed approved headers must fail the gate.
test("the deployment gate accepts the security headers of the local Cloudflare build", async (testContext) => {
  const serverOrigin = await startLocalCloudflare(testContext);
  const deploymentResult = await runDeploymentGate({ ORIGIN: serverOrigin, EXPECTED_INDEX: "" }, 30_000);
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  for (const responseLabel of ["homepage", "404 response", "/writing/"]) {
    assert.ok(deploymentResult.output.includes(`verify-deployment: ${responseLabel} security headers match the approved policy`), deploymentResult.output);
  }
});

test("the deployment gate rejects an injected script without requesting it", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { html: homepageHtml + '<script src="/injected.js"></script>' });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.match(deploymentResult.output, /the live homepage does not match the verified build/);
  assert.ok(!deploymentResult.requests.includes("/injected.js"));
  assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
});

test("the deployment gate does not request external scripts", async (testContext) => {
  const requestedAddresses = [];
  const fixtureServer = createServer((request, response) => {
    requestedAddresses.push(request.url);
    response.writeHead(200, {
      "Content-Type": "text/javascript",
      "Content-Encoding": "gzip",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(compressedScript);
  });
  const externalOrigin = await listenForRequests(testContext, fixtureServer);
  const responseHtml = homepageHtml + `<script src="${externalOrigin}/external.js"></script>`
    + `<script src="${externalOrigin.slice(5)}/other.js"></script>`;
  const deploymentResult = await checkDeployment(testContext, { html: responseHtml, expectedHtml: responseHtml });
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.deepEqual(requestedAddresses, []);
});

test("the deployment gate rejects a missing built script", async (testContext) => {
  const scriptPath = scriptPaths[2];
  const deploymentResult = await checkDeployment(testContext, { scriptResponses: { [scriptPath]: null } });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.ok(deploymentResult.output.includes(`${scriptPath} returned HTTP 404`), deploymentResult.output);
  assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
});

// Each input breaks a different asset delivery check.
for (const [conditionName, response, expectedMessage] of [
  ["a script error", { status: 503 }, /returned HTTP 503/],
  ["a script redirect", { status: 302, location: "https://example.invalid/script.js" }, /returned HTTP 302/],
  ["a disconnected script", { disconnect: true }, /could not reach/],
  ["an HTML script response", { type: "text/html" }, /must return a JavaScript content type/],
  ["an uncompressed script", { encoding: "identity" }, /is not gzip-compressed/],
  ["a short script cache", { cache: "public, max-age=60, immutable" }, /expected public, max-age=31536000, immutable/],
]) {
  test(`the deployment gate rejects ${conditionName}`, async (testContext) => {
    const deploymentResult = await checkDeployment(testContext, { scriptResponses: { [scriptPaths[2]]: response } });
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.match(deploymentResult.output, expectedMessage);
    assert.ok(deploymentResult.output.includes(scriptPaths[2]), deploymentResult.output);
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

// Cover missing values, URL parsing, unsupported schemes, and embedded credentials.
for (const [conditionName, scriptReference, expectedMessage] of [
  ["an empty script reference", 'src=""', /empty src reference/],
  ["a malformed script URL", 'src="http://["', /invalid src reference/],
  ["a data script URL", 'src="data:text/javascript,console.log(1)"', /unsupported URL/],
  ["a script URL with credentials", 'src="http://user:pass@example.invalid/script.js"', /must not contain credentials/],
]) {
  test(`the deployment gate rejects ${conditionName}`, async (testContext) => {
    const responseHtml = homepageHtml + `<script ${scriptReference}></script>`;
    const deploymentResult = await checkDeployment(testContext, { html: responseHtml, expectedHtml: responseHtml });
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.match(deploymentResult.output, expectedMessage);
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

test("the deployment gate rejects a missing Content-Security-Policy header", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { headers: { "Content-Security-Policy": null } });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.match(deploymentResult.output, /homepage missing content-security-policy/);
  assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
});

// Cover each security-header mechanism with one unsafe policy.
for (const [conditionName, responseHeaderOverrides, headerName] of [
  ["an invalid content type option", { "X-Content-Type-Options": "sniff" }, "x-content-type-options"],
  ["an invalid frame option", { "X-Frame-Options": "ALLOWALL" }, "x-frame-options"],
  ["an unsafe referrer policy", { "Referrer-Policy": "unsafe-url" }, "referrer-policy"],
  ["a short HSTS lifetime", { "Strict-Transport-Security": "max-age=60" }, "strict-transport-security"],
  ["a browser permission", { "Permissions-Policy": permissionsPolicy.replace("camera=()", "camera=(self)") }, "permissions-policy"],
  ["wildcard scripts", { "Content-Security-Policy": contentSecurityPolicyWithSources("script-src", "'self' *") }, "content-security-policy"],
]) {
  test(`the deployment gate rejects ${conditionName}`, async (testContext) => {
    const deploymentResult = await checkDeployment(testContext, { headers: responseHeaderOverrides });
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.match(deploymentResult.output, new RegExp(`homepage ${headerName} must match the approved _headers policy`));
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

test("the deployment gate rejects an unsafe 404 header", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, {
    notFoundHeaders: { "X-Frame-Options": "ALLOWALL" },
  });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.match(deploymentResult.output, /404 response x-frame-options must match the approved _headers policy/);
  assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
});

test("the deployment gate accepts published Writing with HTTP 200", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { writingStatus: 200 });
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.match(deploymentResult.output, /\/writing\/ security headers match the approved policy/);
  assert.equal(deploymentResult.requests.filter((request) => request === "/writing/").length, 1);
});

// Check one policy failure on each additional response path and publication state.
for (const [pageCondition, route, deploymentOptions, responseHeaderOverrides, expectedMessage] of [
  ["/writing/ with HTTP 404", "/writing/", {}, { "Content-Security-Policy": null }, "missing content-security-policy"],
  ["/writing/ with HTTP 200", "/writing/", { writingStatus: 200 }, { "Referrer-Policy": "unsafe-url" }, "referrer-policy must match the approved _headers policy"],
]) {
  const headerOption = "writingHeaders";
  test(`the deployment gate rejects an unsafe policy on ${pageCondition}`, async (testContext) => {
    const deploymentResult = await checkDeployment(testContext, { ...deploymentOptions, [headerOption]: responseHeaderOverrides });
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.ok(deploymentResult.output.includes(`verify-deployment: ${route} ${expectedMessage}`), deploymentResult.output);
    assert.match(deploymentResult.output, /homepage security headers match the approved policy/);
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

test("the deployment gate rejects Writing with HTTP 500", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { writingStatus: 500 });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.match(deploymentResult.output, /\/writing\/ returned HTTP 500, expected 200 or 404/);
  assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
});

// Exercise each response contract with an invalid response.
for (const [conditionName, deploymentOptions, expectedMessage] of [
  ["a temporary redirect", { redirectStatus: 302 },
    /must redirect to the homepage with HTTP 301/],
  ["a redirect to another host", { redirectLocation: "https://example.invalid/" },
    /must redirect to the homepage with HTTP 301/],
  ["an About page that answers instead of redirecting", { aboutStatus: 200 },
    /\/about\/? must redirect to the homepage with HTTP 301/],
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
  test(`the deployment gate rejects ${conditionName}`, async (testContext) => {
    const deploymentResult = await checkDeployment(testContext, deploymentOptions);
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.match(deploymentResult.output, expectedMessage);
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

// The Lab pages answer 404 until an experiment is published. The gate must then skip the scene check.
test("the deployment gate skips the scene check while the Lab is unpublished", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext);
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.match(deploymentResult.output, /\/lab\/ is not published; the scene check is skipped/);
  assert.deepEqual(deploymentResult.requests.filter((request) => request.startsWith("/lab/")), ["/lab/"], "the gate must request nothing else under /lab/");
});

test("the deployment gate follows the Lab pages to a scene and accepts its sandbox headers", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { labStatus: 200 });
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.deepEqual(deploymentResult.requests.filter((request) => request.startsWith("/lab/")), Object.values(labPagePaths), "the gate must visit the Lab, the experiment, the result, then the scene");
  for (const checkedPath of Object.values(labPagePaths).slice(0, 3)) {
    assert.ok(deploymentResult.output.includes(`verify-deployment: ${checkedPath} security headers match the approved policy`), deploymentResult.output);
  }
  assert.match(deploymentResult.output, /scene \/lab\/scenes\/castles\/opus\/ headers match the approved policy/);
  assert.match(deploymentResult.output, /verify-deployment: OK/);
});

// Each case breaks one header of the scene or one step of the walk through the Lab.
for (const [conditionName, deploymentOptions, expectedMessage] of [
  ["a scene without the sandbox", { sceneHeaders: { "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'" } }, /content-security-policy must start with the sandbox/],
  ["a sandbox that keeps the site origin", { sceneHeaders: { "Content-Security-Policy": "sandbox allow-scripts allow-same-origin; frame-ancestors 'self'" } }, /content-security-policy must start with the sandbox/],
  ["a scene that any site can frame", { sceneHeaders: { "Content-Security-Policy": "sandbox allow-scripts allow-pointer-lock allow-downloads; frame-ancestors *" } }, /allow framing by this site only/],
  ["a scene with a frame option", { sceneHeaders: { "X-Frame-Options": "DENY" } }, /must not send x-frame-options/],
  ["a scene without the CORS header", { sceneHeaders: { "Access-Control-Allow-Origin": null } }, /access-control-allow-origin must be \*/],
  ["a scene that may use full screen", { sceneHeaders: { "Permissions-Policy": labPermissionsPolicy } }, /permissions-policy must block every feature/],
  ["a scene that answers 404", { sceneStatus: 404 }, /returned HTTP 404, expected 200/],
  ["a Lab page that blocks full screen", { labHeaders: { "Permissions-Policy": permissionsPolicy } }, /\/lab\/ permissions-policy must match the approved _headers policy/],
  ["a Lab page without a security header", { labHeaders: { "Referrer-Policy": null } }, /\/lab\/ missing referrer-policy/],
  ["a Lab with no experiment link", { labMarkup: { [labPagePaths.lab]: "<p>Empty</p>" } }, /\/lab\/ does not link to an experiment/],
  ["an experiment with no result link", { labMarkup: { [labPagePaths.experiment]: "<p>Empty</p>" } }, /does not link to a result/],
  ["a result with no scene frame", { labMarkup: { [labPagePaths.result]: "<p>Empty</p>" } }, /does not load a scene frame/],
]) {
  test(`the deployment gate rejects ${conditionName}`, async (testContext) => {
    const deploymentResult = await checkDeployment(testContext, { labStatus: 200, ...deploymentOptions });
    assert.equal(deploymentResult.code, 1, deploymentResult.output);
    assert.match(deploymentResult.output, expectedMessage);
    assert.doesNotMatch(deploymentResult.output, /verify-deployment: OK/);
  });
}

test("the deployment gate rejects a Lab that answers HTTP 500", async (testContext) => {
  const deploymentResult = await checkDeployment(testContext, { labStatus: 500 });
  assert.equal(deploymentResult.code, 1, deploymentResult.output);
  assert.match(deploymentResult.output, /\/lab\/ returned HTTP 500, expected 200 or 404/);
});

// A published Lab in the local Cloudflare runtime proves the real _headers file passes the gate.
test("the deployment gate accepts the Lab and scene headers of a local Cloudflare build with a published Lab", { timeout: 120_000 }, async (testContext) => {
  const labBuild = await createContentBuild("mixed", { lab: { state: "published" } });
  testContext.after(() => labBuild.cleanup());
  await copyFile(join(repositoryRoot, "wrangler.jsonc"), join(labBuild.root, "wrangler.jsonc"));
  const serverOrigin = await startLocalCloudflare(testContext, labBuild.root);
  const deploymentResult = await runDeploymentGate({ ORIGIN: serverOrigin, EXPECTED_INDEX: "" }, 60_000);
  assert.equal(deploymentResult.code, 0, deploymentResult.output);
  assert.match(deploymentResult.output, /scene \/lab\/scenes\/floating-castles\/[a-z0-9-]+\/ headers match the approved policy/);
  assert.doesNotMatch(deploymentResult.output, /not published/);
});
