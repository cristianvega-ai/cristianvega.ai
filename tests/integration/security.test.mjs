import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist as buildDirectory, listFiles, permissionsPolicy, readDistFile, sceneRoutePrefix, withContentBuild } from "../shared/node-helpers.mjs";

// Check the compiled policy. Browser tests check Cloudflare's response.
const headerRules = readDistFile("_headers");

function findHeaderBlock(routePattern) {
  const ruleBlocks = headerRules.split(/\n(?=\S)/);
  const ruleBlock = ruleBlocks.find((value) => value.startsWith(`${routePattern}\n`));
  assert.ok(ruleBlock, `the compiled headers must include a rule for ${routePattern}`);
  return ruleBlock;
}

// Read the policy of the global block. A later block can set its own policy for a few routes.
function globalContentSecurityPolicy() {
  const contentSecurityPolicy = findHeaderBlock("/*").match(/Content-Security-Policy: ([^\n]+)/)?.[1];
  assert.ok(contentSecurityPolicy, "the static-path header rule must set a Content-Security-Policy");
  return contentSecurityPolicy;
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
  const contentSecurityPolicy = globalContentSecurityPolicy();

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
  const inlineCode = findInlineCode(buildDirectory, sceneFolderPrefixes());
  assert.ok(inlineCode.pageCount >= 2, "the build must contain at least two static HTML pages");
  assert.deepEqual(inlineCode.problems, []);
  assert.deepEqual(
    [...inlineCode.dataBlockTypes].sort(),
    ["application/ld+json"],
    "the build must include only JSON-LD graph data in non-executable script blocks",
  );
});

const executableTypes = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

/**
 * Scan the HTML files of a build for inline styles and executable inline scripts.
 * A page below an exempt folder prefix, such as a scene folder, is not scanned.
 * The scene rule in `_headers` gives those pages their own policy. The prefixes must come from that rule.
 */
function findInlineCode(directory, exemptPrefixes) {
  const problems = [];
  const dataBlockTypes = new Set();
  const exemptPages = [];
  let pageCount = 0;
  for (const relativePath of listFiles(directory).filter((filePath) => filePath.endsWith(".html"))) {
    if (exemptPrefixes.some((prefix) => `/${relativePath}`.startsWith(prefix))) {
      exemptPages.push(relativePath);
      continue;
    }
    pageCount += 1;
    const pageHtml = readFileSync(join(directory, relativePath), "utf8");
    if (/<style\b|<[^>]+\sstyle\s*=/i.test(pageHtml)) problems.push(`${relativePath} must not contain inline styles`);
    for (const [, attributes] of pageHtml.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
      const scriptType = (attributes.match(/\btype=["']([^"']*)["']/i)?.[1] ?? "").toLowerCase().trim();
      if (executableTypes.has(scriptType)) problems.push(`executable inline script in ${relativePath} must use an external file`);
      else dataBlockTypes.add(scriptType);
    }
  }
  return { problems, dataBlockTypes, exemptPages, pageCount };
}

// The folders that the scene rule covers: the rule pattern without its final star.
function sceneFolderPrefixes() {
  const scenePattern = `${sceneRoutePrefix}*`;
  findHeaderBlock(scenePattern);
  return [scenePattern.slice(0, -1)];
}

// Models write the scene pages with inline scripts, import maps, and styles. Only the scene rule allows them.
test("the inline code scan exempts only the folders that the scene rule covers", () => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "inline-scan-"));
  try {
    const inlineScript = "<script>window.run = 1;</script>";
    const importMap = '<script type="importmap">{"imports":{}}</script>';
    for (const [relativePath, markup] of [
      ["index.html", "<!doctype html><title>Home</title>"],
      ["lab/scenes/castles/opus/index.html", `${inlineScript}${importMap}<style>body{margin:0}</style>`],
      ["lab/index.html", inlineScript],
      ["lab/castles/index.html", "<p style=\"color:red\">Inline style</p>"],
      ["lab/castles/opus/index.html", importMap],
      ["lab/scenes-archive/index.html", inlineScript],
      ["scenes/lab/index.html", inlineScript],
    ]) {
      mkdirSync(dirname(join(fixtureDirectory, relativePath)), { recursive: true });
      writeFileSync(join(fixtureDirectory, relativePath), markup);
    }
    const inlineCode = findInlineCode(fixtureDirectory, sceneFolderPrefixes());
    assert.deepEqual(inlineCode.exemptPages, ["lab/scenes/castles/opus/index.html"], "only the scene folder is exempt");
    assert.deepEqual(inlineCode.problems.sort(), [
      "executable inline script in lab/index.html must use an external file",
      "executable inline script in lab/scenes-archive/index.html must use an external file",
      "executable inline script in scenes/lab/index.html must use an external file",
      "lab/castles/index.html must not contain inline styles",
    ].sort());
    assert.deepEqual([...inlineCode.dataBlockTypes], ["importmap"], "a page outside the scene folders keeps a data block type check");
    assert.equal(findInlineCode(fixtureDirectory, []).exemptPages.length, 0, "with no exemption, every page is scanned");
    assert.ok(findInlineCode(fixtureDirectory, []).problems.some((problem) => problem.includes("lab/scenes/castles/opus/index.html")), "without the exemption, the scan must report the scene page");
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});

test("a build with a published Lab keeps its Astro pages free of inline code and exempts the scene pages", { timeout: 90_000 }, async () => {
  await withContentBuild("mixed", (fixture) => {
    const inlineCode = findInlineCode(fixture.dist, sceneFolderPrefixes());
    assert.deepEqual(inlineCode.problems, []);
    assert.deepEqual([...inlineCode.dataBlockTypes].sort(), ["application/ld+json"]);
    assert.ok(inlineCode.exemptPages.length >= 8, "the build must hold the scene pages");
    assert.ok(inlineCode.exemptPages.every((relativePath) => relativePath.startsWith(sceneRoutePrefix.slice(1))));
    assert.ok(inlineCode.pageCount > 10, "the scan must read the Lab Astro pages");
    // The exemption is needed: the scenes do hold inline code.
    assert.ok(findInlineCode(fixture.dist, []).problems.length > 0, "the scene pages must hold inline code, or the exemption is dead");
  }, { lab: { state: "published" } });
});

test("the content security policy allows only approved connection sources and the Cloudflare beacon script", () => {
  const contentSecurityPolicy = globalContentSecurityPolicy();

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
  const contentSecurityPolicy = globalContentSecurityPolicy();

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

// Cloudflare merges the rules in file order, and "! Name" drops a header that an earlier rule set.
test("the Lab header rules follow the global rule in a fixed order", () => {
  const rulePositions = ["/*", "/lab/media/*", "/lab/*", "/lab/scenes/*", "/lab/scenes/:experiment/:result/"].map((routePattern) => {
    findHeaderBlock(routePattern);
    return headerRules.indexOf(`\n${routePattern}\n`) + 1;
  });
  assert.deepEqual([...rulePositions].sort((first, second) => first - second), rulePositions, "the rules must come in this order: global, media, Lab pages, scenes, scene entry pages");
  assert.equal(new Set(rulePositions).size, rulePositions.length, "each rule must appear once");
});

test("the Lab pages may use full screen and keep every other blocked feature", () => {
  const labBlock = findHeaderBlock("/lab/*");
  const lines = labBlock.split("\n").map((line) => line.trim());
  const dropIndex = lines.indexOf("! Permissions-Policy");
  const restateIndex = lines.findIndex((line) => line.startsWith("Permissions-Policy: "));
  assert.ok(dropIndex > 0 && restateIndex > dropIndex, "the Lab rule must drop the global Permissions-Policy before it sets its own");
  assert.equal(lines[restateIndex], `Permissions-Policy: ${permissionsPolicy.replace("fullscreen=()", "fullscreen=(self)")}`, "only full screen may differ from the global policy");
  assert.doesNotMatch(labBlock, /Content-Security-Policy|X-Frame-Options/, "the Lab pages keep the global policy and frame rule");
});

test("the scene rule sandboxes the model's page and allows only what the scene needs", () => {
  const sceneBlock = findHeaderBlock("/lab/scenes/*");
  const lines = sceneBlock.split("\n").map((line) => line.trim());
  const firstSetIndex = lines.findIndex((line) => /^[A-Z]/.test(line));
  for (const detachedHeader of ["Content-Security-Policy", "X-Frame-Options", "Permissions-Policy"]) {
    const dropIndex = lines.indexOf(`! ${detachedHeader}`);
    assert.ok(dropIndex > 0 && dropIndex < firstSetIndex, `the scene rule must drop ${detachedHeader} before it sets a header`);
  }
  const headerValue = (name) => {
    const matches = lines.filter((line) => line.startsWith(`${name}: `));
    assert.equal(matches.length, 1, `the scene rule must set ${name} once`);
    return matches[0].slice(name.length + 2);
  };
  const policy = headerValue("Content-Security-Policy");
  assert.match(policy, /^sandbox allow-scripts allow-pointer-lock allow-downloads;/, "the scene policy must start with the sandbox directive");
  assert.doesNotMatch(policy, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms/, "the sandbox must keep the opaque origin");
  const directives = new Map(policy.split(";").map((directive) => directive.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
  assert.deepEqual(directives.get("frame-ancestors"), ["'self'"], "only this site may frame a scene");
  assert.deepEqual(directives.get("script-src"), ["'self'", "'unsafe-inline'"], "a scene may run its own inline scripts");
  assert.deepEqual(directives.get("default-src"), ["'self'"]);
  for (const closedDirective of ["base-uri", "form-action", "object-src"]) assert.deepEqual(directives.get(closedDirective), ["'none'"], `${closedDirective} must stay closed`);
  assert.doesNotMatch(policy, /https?:|\*/, "a scene must load nothing from another host");
  assert.equal(headerValue("Permissions-Policy"), permissionsPolicy, "a scene must keep every blocked feature, including full screen");
  assert.equal(headerValue("Access-Control-Allow-Origin"), "*", "the opaque origin of a scene needs CORS to load its own scripts");
  assert.equal(headerValue("X-Robots-Tag"), "noindex");
  // Only the scene rule may relax the script policy.
  assert.ok(!globalContentSecurityPolicy().includes("'unsafe-inline'"), "the global policy must stay strict");
});

test("the media and scene entry rules set their cache policies", () => {
  assert.match(findHeaderBlock("/lab/media/*"), /Cache-Control: public, max-age=604800, stale-while-revalidate=86400/);
  assert.doesNotMatch(findHeaderBlock("/lab/media/*"), /immutable/, "media keeps a stable name, so it must not be immutable");
  assert.match(findHeaderBlock("/lab/scenes/:experiment/:result/"), /Cache-Control: public, max-age=0, must-revalidate, no-transform/);
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
