#!/usr/bin/env node
// Post-deploy gate: prove the live origin emits security headers and a real 404.
// Build-time checks cannot see Apache response headers (mod_headers is IfModule-guarded).
//
// Usage:
//   npm run verify:deploy
//   ORIGIN=https://cristianvega.ai npm run verify:deploy

import http from "node:http";
import https from "node:https";

const origin = (process.env.ORIGIN ?? "https://cristianvega.ai").replace(/\/$/, "");

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

/** GET a URL and return status plus raw headers. fetch() strips Content-Encoding. */
function requestHeaders(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(target, { method: "GET", headers: extraHeaders }, (res) => {
      const result = { status: res.statusCode ?? 0, headers: res.headers };
      res.resume();
      res.on("end", () => resolve(result));
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  console.log(`verify-deploy: checking ${origin}`);

  let home;
  try {
    home = await fetch(`${origin}/`, { redirect: "follow" });
  } catch (error) {
    fail(`could not reach ${origin}/ (${error.cause?.code ?? error.message})`);
    fail("publish DNS for the apex (and www if used), then redeploy before re-running");
    return;
  }

  if (!home.ok) {
    fail(`GET ${origin}/ returned HTTP ${home.status}`);
  }

  const missingHeaders = REQUIRED_HEADERS.filter((name) => !home.headers.get(name));
  if (missingHeaders.length) {
    fail(
      `missing response headers: ${missingHeaders.join(", ")} — mod_headers may be off or .htaccess was not deployed`,
    );
  } else {
    console.log("verify-deploy: all six security headers present");
  }

  const csp = home.headers.get("content-security-policy") ?? "";
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]) {
    if (!csp.includes(directive)) {
      fail(`CSP missing required directive: ${directive}`);
    }
  }

  const missingPath = `${origin}/__deploy-gate-missing-path__/`;
  let notFound;
  try {
    notFound = await fetch(missingPath, { redirect: "manual" });
  } catch (error) {
    fail(`could not probe missing path (${error.cause?.code ?? error.message})`);
    return;
  }

  if (notFound.status !== 404) {
    fail(
      `GET ${missingPath} returned HTTP ${notFound.status}, expected 404 (ErrorDocument / soft-404 check)`,
    );
  } else {
    console.log("verify-deploy: missing path returns HTTP 404");
  }

  const html = await home.text();
  const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(([, src]) => src);
  const requiredScripts = [
    ["ClientRouter", "router"],
    ["HeroMotion", "hero"],
    ["/js/count.v5.js", "analytics count"],
    ["/js/goatcounter.js", "analytics swap"],
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
      fail(`GET ${url} returned HTTP ${script.status} (${label})`);
      continue;
    }
    if (!hasGzip(script.headers)) {
      const encoding = headerValue(script.headers, "content-encoding") || "none";
      fail(`${label} at ${url} is not gzip-compressed (Content-Encoding: ${encoding})`);
      continue;
    }
    console.log(`verify-deploy: ${label} is gzip-compressed`);
  }

  if (process.exitCode) {
    console.error("verify-deploy: FAILED");
    process.exit(process.exitCode);
  }

  console.log("verify-deploy: OK");
}

await main();
