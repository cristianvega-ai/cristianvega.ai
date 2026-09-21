import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist, permissionsPolicy, readDistFile, root } from "./helpers.mjs";

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
    `Permissions-Policy: ${permissionsPolicy}`,
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
  assert.doesNotMatch(headerBlock("/images/*"), /immutable/);
  assert.doesNotMatch(headerBlock("/*"), /Cache-Control:/);
  assert.match(headerBlock("/"), /Cache-Control: public, max-age=0, must-revalidate, no-transform/);
});

test("Cloudflare test addresses stay out of search results", () => {
  assert.match(headerBlock("https://:worker.:account.workers.dev/*"), /X-Robots-Tag: noindex/);
});

test("Cloudflare CSP blocks unapproved inline scripts and styles", () => {
  const headers = readDistFile("_headers");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(csp, "CSP header must be present");

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "script-src directive must be present");
  assert.match(scriptSrc, /'self'/, "bundled scripts stay same-origin");
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);
  for (const token of scriptSrc.split(/\s+/)) {
    assert.ok(
      token === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(token) ||
      token === "https://static.cloudflareinsights.com/beacon.min.js",
      `unexpected script source ${token}`,
    );
  }

  const styleSrc = csp.match(/style-src\s+([^;]+)/)?.[1] ?? "";
  assert.equal(styleSrc.trim(), "'self'", "stylesheets must come from this site");
  assert.match(csp, /(?:^|;)\s*style-src-attr 'none'(?:;|$)/);

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
    assert.doesNotMatch(html, /<style\b|<[^>]+\sstyle\s*=/i, `${file} must not contain inline styles`);
    for (const [, attributes, body] of html.matchAll(
      /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script\s*>/gi,
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

test("the live gate checks compression for the hero and analytics loader", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  assert.match(script, /content-encoding/i);
  assert.match(script, /\bgzip\b/i);
  assert.match(script, /HeroMotion/);
  assert.match(script, /CloudflareAnalytics/);
});

test("the live gate requires an immutable cache for built scripts", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  assert.match(script, /cache-control/i);
  assert.match(script, /max-age=31536000/);
  assert.match(script, /immutable/);
});

test("the security policy allows the Cloudflare script and beacon endpoint", () => {
  const headers = readDistFile("_headers");
  const csp = headers.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(csp, "Content-Security-Policy header must be present");

  const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(connectSrc, "CSP must declare connect-src");
  const tokens = connectSrc.split(/\s+/);
  assert.deepEqual(
    [...tokens].sort(),
    ["'self'", "https://cloudflareinsights.com"],
    "connect-src must allow only this site and Cloudflare Web Analytics",
  );

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? "";
  assert.deepEqual(
    scriptSrc.trim().split(/\s+/).filter((source) => source.startsWith("https:")),
    ["https://static.cloudflareinsights.com/beacon.min.js"],
    "allow only the Cloudflare beacon script URL as an external script",
  );
  assert.doesNotMatch(csp, /goatcounter|zgo\.at/, "remove the GoatCounter origins");
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
  assert.deepEqual(styleTokens, ["'self'"], "stylesheets must come from this site");
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

test("security.txt gives a private report contact and a valid expiry date", () => {
  const record = readDistFile(".well-known", "security.txt");
  assert.match(record, /^Contact: https:\/\/github\.com\/cristianvega-ai\/cristianvega\.ai\/security\/advisories\/new$/m);
  assert.match(record, /^Canonical: https:\/\/cristianvega\.ai\/\.well-known\/security\.txt$/m);
  assert.match(record, /^Policy: https:\/\/github\.com\/cristianvega-ai\/cristianvega\.ai\/security\/policy$/m);
  const expires = Date.parse(record.match(/^Expires: (.+)$/m)?.[1] ?? "");
  assert.ok(expires > Date.now(), "security.txt must not be expired");
  assert.ok(expires < Date.now() + 366 * 24 * 60 * 60 * 1000, "renew security.txt within one year");
});
