import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist, readDistFile, root } from "./helpers.mjs";

// Check the compiled policy. Browser tests check Cloudflare's response.
const headerRules = readDistFile("_headers");

function headerBlock(path) {
  const blocks = headerRules.split(/\n(?=\S)/);
  const block = blocks.find((value) => value.startsWith(`${path}\n`));
  assert.ok(block, `missing header rule for ${path}`);
  return block;
}

test("Cloudflare keeps the security headers on all static paths", () => {
  const block = headerBlock("/*");
  for (const line of [
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security: max-age=31536000",
  ]) assert.ok(block.includes(line), `missing ${line}`);
  assert.doesNotMatch(block, /includeSubDomains/);
  for (const directive of ["default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
    assert.ok(block.includes(directive), `missing ${directive}`);
  }
});

test("Cloudflare keeps each cache policy on its own paths", () => {
  assert.match(headerBlock("/_astro/*"), /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headerBlock("/images/*"), /Cache-Control: public, max-age=604800, stale-while-revalidate=86400/);
  assert.match(headerBlock("/js/*"), /Cache-Control: public, max-age=3600, stale-while-revalidate=86400/);
  assert.doesNotMatch(headerBlock("/images/*"), /immutable/);
  assert.doesNotMatch(headerBlock("/js/*"), /immutable/);
  assert.doesNotMatch(headerBlock("/*"), /Cache-Control:/);
  assert.match(headerBlock("/"), /Cache-Control: public, max-age=0, must-revalidate, no-transform/);
});

test("Cloudflare test addresses stay out of search results", () => {
  assert.match(headerBlock("https://:worker.:account.workers.dev/*"), /X-Robots-Tag: noindex/);
});

test("Cloudflare CSP denies inline scripts while allowing inline styles", () => {
  const headers = readDistFile("_headers");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(csp, "CSP header must be present");

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "script-src directive must be present");
  assert.match(scriptSrc, /'self'/, "bundled scripts stay same-origin");
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  for (const token of scriptSrc.split(/\s+/)) {
    assert.ok(token === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(token), `unexpected script source ${token}`);
  }

  const styleSrc = csp.match(/style-src\s+([^;]+)/)?.[1] ?? "";
  assert.match(styleSrc, /'unsafe-inline'/, "style-src keeps unsafe-inline for Astro CSS");

  // Every *executable* inline script the build ships must be allow-listed by
  // hash, so no page can quietly require 'unsafe-inline' back. Script elements
  // carrying a non-JavaScript type are data blocks: the browser never executes
  // them and script-src does not govern them, so they are checked separately.
  const executableTypes = new Set([
    "",
    "module",
    "text/javascript",
    "application/javascript",
    "application/ecmascript",
    "text/ecmascript",
  ]);
  const htmlFiles = [];
  const stack = [dist];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) stack.push(path);
      else if (name.endsWith(".html")) htmlFiles.push(path);
    }
  }
  // Home and 404. The guard exists so an empty or half-written dist/ cannot
  // pass this scan by finding nothing.
  assert.ok(htmlFiles.length >= 2, "expected the static HTML pages");
  const inlineDigests = new Set();
  const dataBlockTypes = new Set();
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    for (const [, attributes, body] of html.matchAll(
      /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      const type = (attributes.match(/\btype=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase().trim();
      if (!executableTypes.has(type)) {
        dataBlockTypes.add(type);
        continue;
      }
      const digest = createHash("sha256").update(body, "utf8").digest("base64");
      inlineDigests.add(digest);
      assert.ok(
        scriptSrc.includes(`'sha256-${digest}'`),
        `inline script in ${file} is not hash-allow-listed in script-src (expected 'sha256-${digest}')`,
      );
    }
  }
  assert.deepEqual(
    [...inlineDigests],
    ["DarllRtSZBmSvCjf89jdetABo5/SYKGdWIWRem+vzIs="],
    "the hero pre-hide stamp is the only executable inline script the build may ship",
  );
  assert.deepEqual(
    [...dataBlockTypes].sort(),
    ["application/ld+json"],
    "the JSON-LD graph is the only non-executable script block the build may ship",
  );
});

test("post-deploy gate script checks live headers and 404", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  for (const header of [
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
    "content-security-policy",
  ]) {
    assert.match(script, new RegExp(`["']${header}["']`));
  }
  assert.match(script, /__deploy-gate-missing-path__/);
  assert.match(script, /status !== 404|status === 404/);
});

test("post-deploy gate requires a one-year HSTS max-age without includeSubDomains", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  assert.match(script, /strict-transport-security/i);
  assert.match(script, /expected at least 31536000/);
  assert.match(script, /live HSTS must not include includeSubDomains/);
});

test("post-deploy gate requires gzip on the hero and analytics scripts", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  assert.match(script, /content-encoding/i);
  assert.match(script, /\bgzip\b/i);
  assert.match(script, /HeroMotion/);
  assert.match(script, /\/js\/count\.v5\.js/);
});

test("post-deploy gate requires a short cache on /js/ and an immutable cache on /_astro/", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  assert.match(script, /cache-control/i);
  assert.match(script, /max-age=3600/);
  assert.match(script, /stale-while-revalidate=86400/);
  assert.match(script, /max-age=31536000/);
  assert.match(script, /immutable/);
});

test("Cloudflare CSP allows the GoatCounter beacon in connect-src only", () => {
  const headers = readDistFile("_headers");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(csp, "Content-Security-Policy header must be present");

  // The self-hosted count script sends its pageview beacon with
  // navigator.sendBeacon, which connect-src governs.
  const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(connectSrc, "CSP must declare connect-src");
  const tokens = connectSrc.split(/\s+/);
  assert.ok(tokens.includes("'self'"), "connect-src must keep 'self'");
  assert.ok(
    tokens.includes("https://cristianvegaai.goatcounter.com"),
    "connect-src must allow the GoatCounter count endpoint origin over https",
  );
  assert.deepEqual(
    [...tokens].sort(),
    ["'self'", "https://cristianvegaai.goatcounter.com"],
    "connect-src must hold exactly 'self' and the GoatCounter origin",
  );

  // The count script is self-hosted, so no analytics host may reach
  // script-src, and the GoatCounter CDN must stay out of the CSP entirely.
  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? "";
  assert.doesNotMatch(
    scriptSrc,
    /goatcounter\.com|zgo\.at/,
    "script-src must not gain an analytics host",
  );
  assert.doesNotMatch(csp, /gc\.zgo\.at/, "the GoatCounter CDN must not appear in the CSP");
});

test("Cloudflare CSP hosts fonts and styles from this origin only", () => {
  const headers = readDistFile("_headers");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(csp, "Content-Security-Policy header must be present");

  const fontSrc = csp.match(/font-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(fontSrc, "CSP must declare font-src");
  assert.deepEqual(
    fontSrc.split(/\s+/),
    ["'self'"],
    "font-src must be 'self' after fonts are self-hosted",
  );

  const styleSrc = csp.match(/style-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(styleSrc, "CSP must declare style-src");
  const styleTokens = styleSrc.split(/\s+/);
  assert.ok(styleTokens.includes("'self'"), "style-src must keep 'self'");
  assert.ok(styleTokens.includes("'unsafe-inline'"), "style-src keeps unsafe-inline for Astro CSS");
  assert.equal(
    styleTokens.some((token) => /googleapis|gstatic|fonts\./i.test(token)),
    false,
    "style-src must not list a Google Fonts host",
  );

  assert.doesNotMatch(
    csp,
    /fonts\.googleapis\.com|fonts\.gstatic\.com/,
    "the CSP must not name Google Fonts hosts",
  );
});
