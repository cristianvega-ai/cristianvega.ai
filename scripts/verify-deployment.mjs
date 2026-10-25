#!/usr/bin/env node
// Post-deploy gate: prove the live origin emits security headers and a real 404.
// Check the headers on the homepage, /writing/, and the 404 response, and the /about/ redirect.
// When /lab/ answers 200, follow its pages to one scene and check the scene headers.
// Check the Cloudflare response and, when supplied, the exact build output.
//
// Usage:
//   npm run verify:deployment
//   ORIGIN=https://cristianvega.ai npm run verify:deployment

import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";

const origin = (process.env.ORIGIN ?? "https://cristianvega.ai").replace(/\/$/, "");

// Every request names itself. The host's web application firewall answers
// 403 to a request with no User-Agent from some address ranges, including
// GitHub-hosted runners; a real client always sends one.
const USER_AGENT = "cristianvega-verify-deploy (+https://cristianvega.ai)";

// Keep these values equal to the approved global rule in public/_headers.
// tests/integration/deployment-gate.test.mjs runs this gate on the local Cloudflare build,
// so a difference stops `npm run verify` before the deploy.
const APPROVED_SECURITY_HEADERS = new Map([
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", [
    "accelerometer", "autoplay", "camera", "display-capture", "encrypted-media",
    "fullscreen", "geolocation", "gyroscope", "magnetometer", "microphone",
    "midi", "payment", "picture-in-picture", "screen-wake-lock", "usb",
    "xr-spatial-tracking",
  ].map((feature) => `${feature}=()`).join(", ")],
  ["strict-transport-security", "max-age=31536000"],
  ["content-security-policy", [
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
  ].join("; ")],
]);

function parseContentSecurityPolicy(value) {
  const directives = new Map();
  const parts = value.split(";");
  if (parts.at(-1).trim() === "") parts.pop();
  for (const part of parts) {
    const [name, ...sources] = part.trim().split(/\s+/);
    const key = name.toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(key) || directives.has(key)) return null;
    const sourceSet = new Set(sources);
    if (sourceSet.size !== sources.length) return null;
    directives.set(key, sourceSet);
  }
  return directives;
}

// A feature allows nothing "()" or this origin "(self)". The Lab pages allow full screen for this origin.
function parsePermissionsPolicy(value) {
  const directives = new Map();
  for (const part of value.split(",")) {
    const match = part.trim().match(/^([a-z][a-z0-9-]*)=\( *(self)? *\)$/);
    if (!match || directives.has(match[1])) return null;
    directives.set(match[1], new Set(match[2] ? [match[2]] : []));
  }
  return directives;
}

function parseStrictTransportSecurity(value) {
  const directives = new Map();
  const parts = value.split(";");
  if (parts.at(-1).trim() === "") parts.pop();
  for (const part of parts) {
    const match = part.trim().match(/^([a-z][a-z0-9-]*)(?:=(\d+))?$/i);
    if (!match) return null;
    const key = match[1].toLowerCase();
    if (directives.has(key)) return null;
    directives.set(key, new Set(match[2] === undefined ? [] : [match[2]]));
  }
  return directives;
}

function sameDirectives(actual, expected) {
  if (!actual || actual.size !== expected.size) return false;
  for (const [name, values] of expected) {
    const sources = actual.get(name);
    if (!sources || sources.size !== values.size) return false;
    for (const value of values) {
      if (!sources.has(value)) return false;
    }
  }
  return true;
}

// The Lab pages differ from the global rule in one value: this origin may use full screen.
const LAB_PERMISSIONS_POLICY = APPROVED_SECURITY_HEADERS.get("permissions-policy").replace("fullscreen=()", "fullscreen=(self)");

function checkSecurityHeaders(headers, label, approvedHeaders = APPROVED_SECURITY_HEADERS) {
  const parsers = {
    "content-security-policy": parseContentSecurityPolicy,
    "permissions-policy": parsePermissionsPolicy,
    "strict-transport-security": parseStrictTransportSecurity,
  };
  let valid = true;
  for (const [name, expected] of approvedHeaders) {
    const rawValue = headers.get(name);
    const value = rawValue?.trim();
    if (!value) {
      fail(`${label} missing ${name} — check the deployed _headers file`);
      valid = false;
      continue;
    }
    const parse = parsers[name];
    const matchesPolicy = parse
      ? sameDirectives(parse(value), parse(expected))
      : name === "referrer-policy"
        ? value === expected
        : value.toLowerCase() === expected.toLowerCase();
    if (!/^[\t\x20-\x7e]+$/.test(rawValue) || !matchesPolicy) {
      fail(`${label} ${name} must match the approved _headers policy`);
      valid = false;
    }
  }
  if (valid) console.log(`verify-deployment: ${label} security headers match the approved policy`);
}

// Follow the pages of the Lab to one scene, then check the headers of the scene.
// A scene runs the model's own page in a sandbox, so its policy differs from the global one.
async function checkLab() {
  const read = (path) => fetch(`${origin}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": USER_AGENT },
  });
  const labResponse = await read("/lab/");
  if (labResponse.status === 404) {
    console.log("verify-deployment: /lab/ is not published; the scene check is skipped");
    await labResponse.body?.cancel();
    return;
  }
  if (labResponse.status !== 200) {
    fail(`GET ${origin}/lab/ returned HTTP ${labResponse.status}, expected 200 or 404`);
    await labResponse.body?.cancel();
    return;
  }
  const labApproved = new Map(APPROVED_SECURITY_HEADERS).set("permissions-policy", LAB_PERMISSIONS_POLICY);
  checkSecurityHeaders(labResponse.headers, "/lab/", labApproved);

  // Pick the first experiment, its first result, and the scene frame of that result.
  const firstAddress = (markup, pattern) => markup.match(pattern)?.[1];
  const experimentPath = firstAddress(await labResponse.text(), /<a\b[^>]*\bclass="lab-card"[^>]*\bhref="(\/lab\/[^"/]+\/)"/);
  if (!experimentPath) {
    fail("/lab/ does not link to an experiment");
    return;
  }
  const experimentResponse = await read(experimentPath);
  if (experimentResponse.status !== 200) {
    fail(`GET ${origin}${experimentPath} returned HTTP ${experimentResponse.status}, expected 200`);
    await experimentResponse.body?.cancel();
    return;
  }
  checkSecurityHeaders(experimentResponse.headers, experimentPath, labApproved);
  const resultPath = firstAddress(await experimentResponse.text(), /<a\b[^>]*\bhref="(\/lab\/[^"/]+\/[^"/]+\/)"[^>]*data-stage-key=/);
  if (!resultPath) {
    fail(`${experimentPath} does not link to a result`);
    return;
  }
  const resultResponse = await read(resultPath);
  if (resultResponse.status !== 200) {
    fail(`GET ${origin}${resultPath} returned HTTP ${resultResponse.status}, expected 200`);
    await resultResponse.body?.cancel();
    return;
  }
  checkSecurityHeaders(resultResponse.headers, resultPath, labApproved);
  const scenePath = firstAddress(await resultResponse.text(), /<iframe\b[^>]*\bsrc="(\/lab\/scenes\/[^"]+)"/);
  if (!scenePath) {
    fail(`${resultPath} does not load a scene frame`);
    return;
  }
  const scene = await read(scenePath);
  await scene.body?.cancel();
  if (scene.status !== 200) {
    fail(`GET ${origin}${scenePath} returned HTTP ${scene.status}, expected 200`);
    return;
  }
  let sceneIsValid = true;
  const policy = scene.headers.get("content-security-policy") ?? "";
  const sandbox = policy.match(/^sandbox ([^;]*);/)?.[1].trim().split(/\s+/).sort().join(" ");
  if (sandbox !== "allow-downloads allow-pointer-lock allow-scripts") {
    fail(`scene ${scenePath} content-security-policy must start with the sandbox allow-scripts allow-pointer-lock allow-downloads`);
    sceneIsValid = false;
  } else if (!/(?:^|;)\s*frame-ancestors 'self'(?:;|$)/.test(policy)) {
    fail(`scene ${scenePath} content-security-policy must allow framing by this site only`);
    sceneIsValid = false;
  }
  if (scene.headers.has("x-frame-options")) {
    fail(`scene ${scenePath} must not send x-frame-options`);
    sceneIsValid = false;
  }
  if (scene.headers.get("access-control-allow-origin") !== "*") {
    fail(`scene ${scenePath} access-control-allow-origin must be *`);
    sceneIsValid = false;
  }
  if (scene.headers.get("permissions-policy") !== APPROVED_SECURITY_HEADERS.get("permissions-policy")) {
    fail(`scene ${scenePath} permissions-policy must block every feature`);
    sceneIsValid = false;
  }
  if (sceneIsValid) console.log(`verify-deployment: scene ${scenePath} headers match the approved policy`);
}

function fail(message) {
  console.error(`verify-deployment: ${message}`);
  process.exitCode = 1;
}

function headerValue(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function hasGzip(headers) {
  return /\bgzip\b/i.test(headerValue(headers, "content-encoding"));
}

// Remove each HTML comment where a browser ends it: at the first "-->", or at
// the end of the document. The search for "-->" starts after "<!", so "<!-->"
// ends at once. One pass keeps two removed parts from making a new comment.
function withoutComments(markup) {
  let text = "";
  let index = 0;
  for (;;) {
    const start = markup.indexOf("<!--", index);
    if (start === -1) return text + markup.slice(index);
    text += markup.slice(index, start);
    const end = markup.indexOf("-->", start + 2);
    if (end === -1) return text;
    index = end + 3;
  }
}

function scriptAddresses(markup) {
  const addresses = new Set();
  const base = new URL(`${origin}/`);
  const document = withoutComments(markup);
  const elements = document.matchAll(/<script(?=[\s/>])([^>]*)>(?:[\s\S]*?<\/script\s*>|$)/gi);
  for (const [, attributes] of elements) {
    const sources = [...attributes.matchAll(
      /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    )].filter((match) => match[1].toLowerCase() === "src");
    if (sources.length === 0) continue;
    if (sources.length > 1) {
      fail("homepage script has multiple src attributes");
      continue;
    }

    const [, , doubleQuoted, singleQuoted, unquoted] = sources[0];
    const value = (doubleQuoted ?? singleQuoted ?? unquoted ?? "").trim();
    if (!value) {
      fail("homepage script has an empty src reference");
      continue;
    }

    let address;
    try {
      const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
      const source = value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt));/gi,
        (_, decimal, hexadecimal, name) => name
          ? entities[name.toLowerCase()]
          : String.fromCodePoint(parseInt(decimal ?? hexadecimal, decimal ? 10 : 16)),
      );
      if (/[\x00-\x1f\x7f]/.test(source)) throw new Error("invalid control character");
      address = new URL(source, base);
    } catch {
      fail(`homepage script has an invalid src reference: ${JSON.stringify(value)}`);
      continue;
    }
    if (address.protocol !== "http:" && address.protocol !== "https:") {
      fail(`homepage script uses an unsupported URL: ${address.href}`);
      continue;
    }
    if (address.username || address.password) {
      fail("homepage script URL must not contain credentials");
      continue;
    }
    if (address.origin !== base.origin) continue;
    address.hash = "";
    addresses.add(address.href);
  }
  if (addresses.size === 0) fail("homepage does not load a same-origin script");
  return addresses;
}

/**
 * GET a URL and return status, raw headers, and the first bytes of the body.
 * fetch() strips Content-Encoding, so this uses node:http directly. The body
 * sample is for the failure message: a 403 page names its origin.
 */
function requestHeaders(address, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(address);
    const transport = target.protocol === "https:" ? https : http;
    const headers = { "user-agent": USER_AGENT, accept: "*/*", ...extraHeaders };
    const request = transport.request(target, { method: "GET", headers }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("error", reject);
      response.on("data", (chunk) => {
        if (size < 240) {
          chunks.push(chunk.subarray(0, 240 - size));
          size += chunk.length;
        }
      });
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          sample: Buffer.concat(chunks).toString("latin1").replace(/\s+/g, " ").trim(),
        }),
      );
    });
    request.on("error", reject);
    request.setTimeout(15_000, () => request.destroy(new Error("request timed out")));
    request.end();
  });
}

async function main() {
  console.log(`verify-deployment: checking ${origin}`);

  let home;
  try {
    home = await fetch(`${origin}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": USER_AGENT, "cache-control": "no-cache" },
    });
  } catch (error) {
    fail(`could not reach ${origin}/ (${error.cause?.code ?? error.message})`);
    fail("publish DNS for the apex (and www if used), then redeploy before re-running");
    return;
  }

  if (home.status !== 200) {
    fail(`GET ${origin}/ returned HTTP ${home.status}`);
  }

  checkSecurityHeaders(home.headers, "homepage");

  const missingPath = `${origin}/__deploy-gate-missing-path__/`;
  let notFound;
  try {
    notFound = await fetch(missingPath, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": USER_AGENT },
    });
  } catch (error) {
    fail(`could not probe missing path (${error.cause?.code ?? error.message})`);
    return;
  }

  if (notFound.status !== 404) {
    fail(
      `GET ${missingPath} returned HTTP ${notFound.status}, expected 404`,
    );
  } else {
    console.log("verify-deployment: missing path returns HTTP 404");
  }
  checkSecurityHeaders(notFound.headers, "404 response");
  await notFound.body?.cancel();

  const postResponse = await fetch(`${origin}/`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": USER_AGENT },
  });
  if (postResponse.status !== 405) fail("the static homepage must reject POST with HTTP 405");
  await postResponse.body?.cancel();

  const security = await fetch(`${origin}/.well-known/security.txt`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": USER_AGENT },
  });
  const record = await security.text();
  const expires = Date.parse(record.match(/^Expires: (.+)$/m)?.[1] ?? "");
  if (security.status !== 200 || !/^text\/plain(?:;|$)/.test(security.headers.get("content-type") ?? "")) {
    fail("security.txt must return HTTP 200 as plain text");
  }
  if (!/^Contact: https:\/\/github\.com\/cristianvega-ai\/cristianvega\.ai\/security\/advisories\/new$/m.test(record)) {
    fail("security.txt must give the private report contact");
  }
  if (!(expires > Date.now())) fail("security.txt must have a future expiry date");

  const markup = await home.text();
  let verifiedMarkup = markup;
  if (process.env.EXPECTED_INDEX) {
    const expected = await readFile(process.env.EXPECTED_INDEX);
    verifiedMarkup = expected.toString("utf8");
    if (!expected.equals(Buffer.from(markup))) {
      fail("the live homepage does not match the verified build");
    } else {
      console.log("verify-deployment: the live homepage matches the verified build");
    }
  }

  // The build omits /writing/ until an article is published. Both responses
  // must carry the approved headers.
  const writing = await fetch(`${origin}/writing/`, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": USER_AGENT },
  });
  if (writing.status !== 200 && writing.status !== 404) {
    fail(`GET ${origin}/writing/ returned HTTP ${writing.status}, expected 200 or 404`);
  }
  checkSecurityHeaders(writing.headers, "/writing/");
  await writing.body?.cancel();

  // The build omits /lab/ until an experiment is published.
  await checkLab();

  // The contact and about pages moved to the homepage.
  for (const path of ["/contact", "/contact/", "/about", "/about/"]) {
    const response = await fetch(`${origin}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": USER_AGENT },
    });
    const location = response.headers.get("location");
    if (response.status !== 301 || !location || new URL(location, origin).href !== `${origin}/`) {
      fail(`${path} must redirect to the homepage with HTTP 301`);
    }
    await response.body?.cancel();
  }

  if (process.env.CHECK_CANONICAL_REDIRECTS === "true") {
    const path = "/__canonical-check__/?from=deploy";
    for (const base of ["http://cristianvega.ai", "http://www.cristianvega.ai", "https://www.cristianvega.ai"]) {
      const response = await fetch(`${base}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": USER_AGENT },
      });
      if (response.status !== 301 || response.headers.get("location") !== `https://cristianvega.ai${path}`) {
        fail(`${base} must redirect to HTTPS on the apex in one step`);
      }
      await response.body?.cancel();
    }
  }
  for (const address of scriptAddresses(verifiedMarkup)) {
    const label = `script at ${address}`;
    let script;
    try {
      script = await requestHeaders(address, { "accept-encoding": "gzip" });
    } catch (error) {
      fail(`could not reach ${address} (${error.cause?.code ?? error.message})`);
      continue;
    }

    if (script.status !== 200) {
      const server = headerValue(script.headers, "server") || "unknown server";
      fail(`GET ${address} returned HTTP ${script.status}; ${server}; body: ${script.sample || "(empty)"}`);
      continue;
    }
    const type = headerValue(script.headers, "content-type").trim();
    if (!/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(type)) {
      fail(`${label} must return a JavaScript content type (Content-Type: ${type || "none"})`);
      continue;
    }
    if (!hasGzip(script.headers)) {
      const encoding = headerValue(script.headers, "content-encoding") || "none";
      fail(`${label} is not gzip-compressed (Content-Encoding: ${encoding})`);
      continue;
    }
    console.log(`verify-deployment: ${label} is gzip-compressed`);

    const cache = headerValue(script.headers, "cache-control");
    const directives = cache.toLowerCase().split(",").map((value) => value.trim()).sort();
    if (directives.join(",") !== "immutable,max-age=31536000,public") {
      fail(
        `${label} Cache-Control is ${cache || "none"} (expected public, max-age=31536000, immutable)`,
      );
      continue;
    } else {
      console.log(`verify-deployment: ${label} cache is immutable`);
    }
  }

  if (process.exitCode) {
    console.error("verify-deployment: FAILED");
    process.exit(process.exitCode);
  }

  console.log("verify-deployment: OK");
}

await main();
