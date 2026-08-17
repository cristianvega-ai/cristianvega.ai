import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist, readDistFile, root } from "./helpers.mjs";

// The production edge contract: the .htaccess DreamHost applies — canonical
// host, cache lifetimes, security headers, CSP, HSTS — and the post-deploy gate
// that confirms the live server sends what the build shipped.

test("htaccess canonicalises www to https apex in one hop", () => {
  const htaccess = readDistFile(".htaccess");
  const wwwIdx = htaccess.search(
    /RewriteCond %\{HTTP_HOST\} \^www\\\.cristianvega\\\.ai\$[\s\S]*?RewriteRule \^ https:\/\/cristianvega\.ai%\{REQUEST_URI\}/,
  );
  const httpsIdx = htaccess.search(
    /RewriteCond %\{HTTPS\} !=on[\s\S]*?RewriteRule \^ https:\/\/cristianvega\.ai%\{REQUEST_URI\}/,
  );

  assert.ok(wwwIdx >= 0, "www→apex rule must rewrite scheme and host together");
  assert.ok(httpsIdx >= 0, "HTTPS-forcing rule must remain for non-www http");
  assert.ok(
    wwwIdx < httpsIdx,
    "www host canonicalisation must run before HTTPS-on-current-host to avoid a two-hop chain",
  );
  assert.doesNotMatch(
    htaccess,
    /RewriteRule \^ https:\/\/%\{HTTP_HOST\}%\{REQUEST_URI\}/,
    "no redirect target may reflect the request Host header",
  );
});

test("htaccess scopes immutable caching away from stable image URLs", () => {
  const htaccess = readDistFile(".htaccess");

  assert.match(
    htaccess,
    /REQUEST_URI\}\s*=~\s*m#\^\/_astro\/#[\s\S]*?max-age=31536000,\s*immutable/,
    "hashed /_astro/ assets should remain immutable",
  );
  assert.match(
    htaccess,
    /REQUEST_URI\}\s*=~\s*m#\^\/images\/#[\s\S]*?max-age=604800,\s*stale-while-revalidate=86400/,
    "stable /images/ URLs should revalidate after portrait regenerations",
  );
  assert.doesNotMatch(
    htaccess,
    /FilesMatch\s+"\\\.\(css\|js\|webp\|avif\|png\|svg\)\$"/,
    "extension-wide immutable FilesMatch must not cover public images",
  );
  assert.doesNotMatch(
    htaccess,
    /ExpiresByType\s+image\/(webp|avif|png|svg\+xml)\s+"access plus 1 year"/,
    "image Expires must not keep a one-year freshness lifetime",
  );
});

test("htaccess CSP denies inline scripts while allowing inline styles", () => {
  const htaccess = readDistFile(".htaccess");
  const csp = htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/)?.[1];
  assert.ok(csp, "CSP header must be present");

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "script-src directive must be present");
  assert.match(scriptSrc, /'self'/, "bundled scripts stay same-origin");
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);

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
  assert.ok(htmlFiles.length >= 9, "expected the static HTML pages");
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
    ["XAmQDOZkZmpTCL+kRJn5V0l3aQGa2/ZQ/miN4MqFqnI="],
    "the hero pre-hide stamp is the only executable inline script the build may ship",
  );
  assert.deepEqual(
    [...dataBlockTypes].sort(),
    ["application/ld+json"],
    "the JSON-LD graph is the only non-executable script block the build may ship",
  );
});

test("htaccess ships bootstrap HSTS until HTTPS is confirmed", () => {
  const htaccess = readDistFile(".htaccess");
  assert.match(
    htaccess,
    /Header always set Strict-Transport-Security "max-age=300"/,
    "first-deploy HSTS must stay short and reversible",
  );
  assert.doesNotMatch(
    htaccess,
    /Strict-Transport-Security "[^"]*includeSubDomains/,
    "do not pin includeSubDomains before a live SAN audit",
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

test("htaccess preserves production security headers and CSP", () => {
  const htaccess = readDistFile(".htaccess");

  assert.match(htaccess, /Header always set X-Content-Type-Options "nosniff"/);
  assert.match(htaccess, /Header always set X-Frame-Options "DENY"/);
  assert.match(htaccess, /Header always set Referrer-Policy "strict-origin-when-cross-origin"/);
  assert.match(
    htaccess,
    /Header always set Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/,
  );
  // Presence and shape only: the exact bootstrap value is pinned by
  // "htaccess ships bootstrap HSTS until HTTPS is confirmed".
  assert.match(htaccess, /Header always set Strict-Transport-Security "max-age=\d+/);
  assert.match(htaccess, /ErrorDocument 404 \/404\.html/);

  const cspMatch = htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/);
  assert.ok(cspMatch, "Content-Security-Policy header must be present");
  const csp = cspMatch[1];

  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.match(
      csp,
      new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `CSP must keep ${directive}`,
    );
  }

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "CSP must declare script-src");
  assert.doesNotMatch(scriptSrc, /unsafe-eval/, "script-src must not allow unsafe-eval");
  assert.doesNotMatch(scriptSrc, /unsafe-inline/, "script-src must not allow unsafe-inline");
  for (const token of scriptSrc.split(/\s+/)) {
    assert.ok(
      token === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(token),
      `script-src must not widen beyond 'self' and per-script hashes (found ${token})`,
    );
  }
});
