#!/usr/bin/env node
// Post-deploy gate: prove the live origin emits security headers and a real 404.
// Check the Cloudflare response and, when supplied, the exact build output.
//
// Usage:
//   npm run verify:deploy
//   ORIGIN=https://cristianvega.ai npm run verify:deploy

import http from "node:http";
import https from "node:https";
import { readFile } from "node:fs/promises";

const origin = (process.env.ORIGIN ?? "https://cristianvega.ai").replace(/\/$/, "");

// Every request names itself. The host's web application firewall answers
// 403 to a request with no User-Agent from some address ranges, including
// GitHub-hosted runners; a real client always sends one.
const USER_AGENT = "cristianvega-verify-deploy (+https://cristianvega.ai)";

const REQUIRED_HEADERS = [
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
  "content-security-policy",
];

function fail(message) {
  console.error(`verify-deploy: ${message}`);
  process.exitCode = 1;
}

function headerValue(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function hasGzip(headers) {
  return /\bgzip\b/i.test(headerValue(headers, "content-encoding"));
}

/**
 * GET a URL and return status, raw headers, and the first bytes of the body.
 * fetch() strips Content-Encoding, so this uses node:http directly. The body
 * sample is for the failure message: a 403 page names its origin.
 */
function requestHeaders(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const headers = { "user-agent": USER_AGENT, accept: "*/*", ...extraHeaders };
    const req = lib.request(target, { method: "GET", headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        if (size < 240) {
          chunks.push(chunk.subarray(0, 240 - size));
          size += chunk.length;
        }
      });
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          sample: Buffer.concat(chunks).toString("latin1").replace(/\s+/g, " ").trim(),
        }),
      );
    });
    req.on("error", reject);
    req.setTimeout(15_000, () => req.destroy(new Error("request timed out")));
    req.end();
  });
}

async function main() {
  console.log(`verify-deploy: checking ${origin}`);

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

  const missingHeaders = REQUIRED_HEADERS.filter((name) => !home.headers.get(name));
  if (missingHeaders.length) {
    fail(
      `missing response headers: ${missingHeaders.join(", ")} — check the deployed _headers file`,
    );
  } else {
    console.log("verify-deploy: all six security headers present");
  }

  const hsts = home.headers.get("strict-transport-security") ?? "";
  const maxAgeMatch = hsts.match(/(?:^|;\s*)max-age=(\d+)/i);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 0;
  if (maxAge < 31536000) {
    fail(
      `HSTS max-age is ${maxAgeMatch ? maxAgeMatch[1] : "missing"} (expected at least 31536000)`,
    );
  } else if (/\bincludeSubDomains\b/i.test(hsts)) {
    fail("live HSTS must not include includeSubDomains");
  } else {
    console.log(`verify-deploy: HSTS max-age=${maxAge} without includeSubDomains`);
  }

  const csp = home.headers.get("content-security-policy") ?? "";
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "font-src 'self'",
  ]) {
    if (!csp.includes(directive)) {
      fail(`CSP missing required directive: ${directive}`);
    }
  }
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(csp)) {
    fail("CSP still names a Google Fonts host");
  }
  const directives = new Map(csp.split(";").map((part) => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources.join(" ")];
  }));
  if (directives.get("style-src") !== "'self'" || directives.get("style-src-attr") !== "'none'") {
    fail("CSP must block inline styles and use only same-origin stylesheets");
  }
  const permissions = (home.headers.get("permissions-policy") ?? "").split(",").map((part) => part.trim());
  for (const feature of [
    "accelerometer", "autoplay", "camera", "display-capture", "encrypted-media",
    "fullscreen", "geolocation", "gyroscope", "magnetometer", "microphone",
    "midi", "payment", "picture-in-picture", "screen-wake-lock", "usb",
    "xr-spatial-tracking",
  ]) {
    if (!permissions.includes(`${feature}=()`)) fail(`Permissions-Policy must deny ${feature}`);
  }

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
    console.log("verify-deploy: missing path returns HTTP 404");
  }
  for (const name of REQUIRED_HEADERS) {
    if (notFound.headers.get(name) !== home.headers.get(name)) {
      fail(`404 response must keep the homepage ${name} header`);
    }
  }
  await notFound.body?.cancel();

  const post = await fetch(`${origin}/`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": USER_AGENT },
  });
  if (post.status !== 405) fail("the static homepage must reject POST with HTTP 405");
  await post.body?.cancel();

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

  const html = await home.text();
  if (process.env.EXPECTED_INDEX) {
    const expected = await readFile(process.env.EXPECTED_INDEX);
    if (!expected.equals(Buffer.from(html))) {
      fail("the live homepage does not match the verified build");
    } else {
      console.log("verify-deploy: the live homepage matches the verified build");
    }
  }

  for (const path of ["/about", "/about/", "/contact", "/contact/"]) {
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
  const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(([, src]) => src);
  const requiredScripts = [
    ["HeroMotion", "hero"],
    ["CloudflareAnalytics", "analytics loader"],
  ];

  for (const [needle, label] of requiredScripts) {
    const src = scriptSrcs.find((value) => value.includes(needle));
    if (!src) {
      fail(`homepage does not load the ${label} script`);
      continue;
    }

    const url = new URL(src, `${origin}/`).href;
    let script;
    try {
      script = await requestHeaders(url, { "accept-encoding": "gzip" });
    } catch (error) {
      fail(`could not reach ${url} (${error.cause?.code ?? error.message})`);
      continue;
    }

    if (script.status !== 200) {
      const server = headerValue(script.headers, "server") || "unknown server";
      fail(`GET ${url} returned HTTP ${script.status} (${label}); ${server}; body: ${script.sample || "(empty)"}`);
      continue;
    }
    if (!hasGzip(script.headers)) {
      const encoding = headerValue(script.headers, "content-encoding") || "none";
      fail(`${label} at ${url} is not gzip-compressed (Content-Encoding: ${encoding})`);
      continue;
    }
    console.log(`verify-deploy: ${label} is gzip-compressed`);

    const cache = headerValue(script.headers, "cache-control");
    if (
      !/\bmax-age=31536000\b/.test(cache) ||
      !/\bimmutable\b/i.test(cache)
    ) {
      fail(
        `${label} at ${url} Cache-Control is ${cache || "none"} (expected public, max-age=31536000, immutable)`,
      );
      continue;
    } else {
      console.log(`verify-deploy: ${label} cache is immutable`);
    }
  }

  if (process.exitCode) {
    console.error("verify-deploy: FAILED");
    process.exit(process.exitCode);
  }

  console.log("verify-deploy: OK");
}

await main();
