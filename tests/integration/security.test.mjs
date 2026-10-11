import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist as buildDirectory, permissionsPolicy, readDistFile } from "../shared/node-helpers.mjs";

// Check the compiled policy. Browser tests check Cloudflare's response.
const headerRules = readDistFile("_headers");

function findHeaderBlock(routePattern) {
  const ruleBlocks = headerRules.split(/\n(?=\S)/);
  const ruleBlock = ruleBlocks.find((value) => value.startsWith(`${routePattern}\n`));
  assert.ok(ruleBlock, `the compiled headers must include a rule for ${routePattern}`);
  return ruleBlock;
}

test("the Cloudflare header rules apply approved security headers to all static paths", () => {
  const ruleBlock = findHeaderBlock("/*");
  for (const expectedHeader of [
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Referrer-Policy: strict-origin-when-cross-origin",
    `Permissions-Policy: ${permissionsPolicy}`,
    "Strict-Transport-Security: max-age=31536000",
  ]) assert.ok(ruleBlock.includes(expectedHeader), `the static-path header rule must include ${expectedHeader}`);
  assert.doesNotMatch(ruleBlock, /includeSubDomains/);
  for (const directive of ["default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'"]) {
    assert.ok(ruleBlock.includes(directive), `the static-path header rule must include ${directive}`);
  }
});

test("the Cloudflare header rules apply each cache policy to its assigned paths", () => {
  assert.match(findHeaderBlock("/_astro/*"), /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(findHeaderBlock("/images/*"), /Cache-Control: public, max-age=604800, stale-while-revalidate=86400/);
  assert.doesNotMatch(findHeaderBlock("/images/*"), /immutable/);
  assert.doesNotMatch(findHeaderBlock("/*"), /Cache-Control:/);
  assert.match(findHeaderBlock("/"), /Cache-Control: public, max-age=0, must-revalidate, no-transform/);
});

test("the Cloudflare test-origin header rule excludes preview addresses from search indexing", () => {
  assert.match(findHeaderBlock("https://:worker.:account.workers.dev/*"), /X-Robots-Tag: noindex/);
});

test("the content security policy limits script sources and the build excludes executable inline scripts and styles", () => {
  const headersRecord = readDistFile("_headers");
  const contentSecurityPolicy = headersRecord.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(contentSecurityPolicy, "the Content-Security-Policy header must exist");

  const scriptSources = contentSecurityPolicy.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSources, "script-src directive must be present");
  assert.match(scriptSources, /'self'/, "bundled scripts must use this origin");
  assert.doesNotMatch(scriptSources, /unsafe-inline|unsafe-eval/);
  for (const scriptSource of scriptSources.split(/\s+/)) {
    assert.ok(
      scriptSource === "'self'" || scriptSource === "https://static.cloudflareinsights.com/beacon.min.js",
      `script source ${scriptSource} must match an approved source`,
    );
  }

  const styleSources = contentSecurityPolicy.match(/style-src\s+([^;]+)/)?.[1] ?? "";
  assert.equal(styleSources.trim(), "'self'", "stylesheets must come from this site");
  assert.match(contentSecurityPolicy, /(?:^|;)\s*style-src-attr 'none'(?:;|$)/);

  // Executable scripts must use external files. Keep JSON-LD as a non-executable data block.
  const executableTypes = new Set([
    "",
    "module",
    "text/javascript",
    "application/javascript",
    "application/ecmascript",
    "text/ecmascript",
  ]);
  const htmlFiles = [];
  const stack = [buildDirectory];
  while (stack.length) {
    const directory = stack.pop();
    for (const filename of readdirSync(directory)) {
      const builtPath = join(directory, filename);
      if (statSync(builtPath).isDirectory()) stack.push(builtPath);
      else if (filename.endsWith(".html")) htmlFiles.push(builtPath);
    }
  }
  // Require homepage and missing-page output before scanning inline scripts.
  assert.ok(htmlFiles.length >= 2, "the build must contain at least two static HTML pages");
  const dataBlockTypes = new Set();
  for (const htmlFilePath of htmlFiles) {
    const pageHtml = readFileSync(htmlFilePath, "utf8");
    assert.doesNotMatch(pageHtml, /<style\b|<[^>]+\sstyle\s*=/i, `${htmlFilePath} must not contain inline styles`);
    for (const [, attributes] of pageHtml.matchAll(
      /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi,
    )) {
      const scriptType = (attributes.match(/\btype=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase().trim();
      if (!executableTypes.has(scriptType)) {
        dataBlockTypes.add(scriptType);
        continue;
      }
      assert.fail(`executable inline script in ${htmlFilePath} must use an external file`);
    }
  }
  assert.deepEqual(
    [...dataBlockTypes].sort(),
    ["application/ld+json"],
    "the build must include only JSON-LD graph data in non-executable script blocks",
  );
});

test("the content security policy allows only approved connection sources and the Cloudflare beacon script", () => {
  const headersRecord = readDistFile("_headers");
  const contentSecurityPolicy = headersRecord.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(contentSecurityPolicy, "Content-Security-Policy header must be present");

  const connectionSources = contentSecurityPolicy.match(/connect-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(connectionSources, "the content security policy must declare connect-src");
  const connectionSourceTokens = connectionSources.split(/\s+/);
  assert.deepEqual(
    [...connectionSourceTokens].sort(),
    ["'self'", "https://cloudflareinsights.com"],
    "connect-src must allow only this site and Cloudflare Web Analytics",
  );

  const scriptSources = contentSecurityPolicy.match(/script-src\s+([^;]+)/)?.[1] ?? "";
  assert.deepEqual(
    scriptSources.trim().split(/\s+/).filter((source) => source.startsWith("https:")),
    ["https://static.cloudflareinsights.com/beacon.min.js"],
    "the external script sources must contain only the Cloudflare beacon URL",
  );
});

test("the content security policy restricts fonts and styles to this origin", () => {
  const headersRecord = readDistFile("_headers");
  const contentSecurityPolicy = headersRecord.match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(contentSecurityPolicy, "Content-Security-Policy header must be present");

  const fontSources = contentSecurityPolicy.match(/font-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(fontSources, "the content security policy must declare font-src");
  assert.deepEqual(
    fontSources.split(/\s+/),
    ["'self'"],
    "font-src must allow only this origin",
  );

  const styleSources = contentSecurityPolicy.match(/style-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(styleSources, "the content security policy must declare style-src");
  const styleSourceTokens = styleSources.split(/\s+/);
  assert.deepEqual(styleSourceTokens, ["'self'"], "stylesheets must come from this site");
  assert.equal(
    styleSourceTokens.some((styleSource) => /googleapis|gstatic|fonts\./i.test(styleSource)),
    false,
    "style-src must not list a Google Fonts host",
  );

  assert.doesNotMatch(
    contentSecurityPolicy,
    /fonts\.googleapis\.com|fonts\.gstatic\.com/,
    "the content security policy must not name Google Fonts hosts",
  );
});

test("security.txt declares private reporting addresses and an expiry date within the next year", () => {
  const record = readDistFile(".well-known", "security.txt");
  assert.match(record, /^Contact: https:\/\/github\.com\/cristianvega-ai\/cristianvega\.ai\/security\/advisories\/new$/m);
  assert.match(record, /^Canonical: https:\/\/cristianvega\.ai\/\.well-known\/security\.txt$/m);
  assert.match(record, /^Policy: https:\/\/github\.com\/cristianvega-ai\/cristianvega\.ai\/security\/policy$/m);
  const expiryTimestamp = Date.parse(record.match(/^Expires: (.+)$/m)?.[1] ?? "");
  assert.ok(expiryTimestamp > Date.now(), "security.txt must not be expired");
  assert.ok(expiryTimestamp < Date.now() + 366 * 24 * 60 * 60 * 1000, "security.txt must expire within one year");
});
