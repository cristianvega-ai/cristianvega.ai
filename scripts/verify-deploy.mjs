#!/usr/bin/env node
// Post-deploy gate: prove the live origin emits security headers and a real 404.
// Build-time checks cannot see Apache response headers (mod_headers is IfModule-guarded).
//
// Usage:
//   npm run verify:deploy
//   ORIGIN=https://cristianvega.ai npm run verify:deploy

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

  if (process.exitCode) {
    console.error("verify-deploy: FAILED");
    process.exit(process.exitCode);
  }

  console.log("verify-deploy: OK");
}

await main();
