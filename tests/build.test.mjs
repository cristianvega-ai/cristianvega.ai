import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { assertPageBasics, dist, listBuiltRoutes, readDistFile, root } from "./helpers.mjs";

// Build output contract: the files the static deploy uploads must exist and be
// complete. Page copy lives in tests/pages.test.mjs; this suite only asks
// whether the build emitted the files Cloudflare serves.

function assertDistPath(...segments) {
  const path = join(dist, ...segments);
  assert.equal(existsSync(path), true, `missing build output: ${path} (run \`npm test\` or \`npm run build\`)`);
}

test("build emits the core static pages Cloudflare will serve", () => {
  assertDistPath("index.html");
  assertDistPath("about", "index.html");
  assertDistPath("sitemap-index.xml");
});

test("sitemap enumerates every public route the build produces", () => {
  // robots.txt points crawlers at the index, so an index that references a
  // missing or stale child sitemap is a silent SEO regression.
  const index = readDistFile("sitemap-index.xml");
  const child = index.match(/<loc>https:\/\/cristianvega\.ai\/(sitemap-\d+\.xml)<\/loc>/)?.[1];
  assert.ok(child, `sitemap index must reference a child sitemap: ${index}`);
  assert.equal(existsSync(join(dist, child)), true, `${child} is referenced but missing`);

  const locations = [...readDistFile(child).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  const expected = listBuiltRoutes().map((route) => `https://cristianvega.ai${route}`);

  assert.ok(expected.length > 0, "build must emit public routes to enumerate");
  assert.deepEqual(
    [...locations].sort(),
    [...expected].sort(),
    "sitemap must list exactly the public built routes, absolute and trailing-slashed",
  );
});

test("static ops assets ship with the build", () => {
  assert.equal(existsSync(join(dist, "robots.txt")), true);
  assert.equal(existsSync(join(dist, "404.html")), true);
  assert.equal(existsSync(join(dist, "_headers")), true);
  assert.equal(existsSync(join(dist, "_redirects")), true);
  assert.equal(existsSync(join(dist, ".htaccess")), false);

  const robots = readDistFile("robots.txt");
  assert.match(robots, /Sitemap:\s*https:\/\/cristianvega\.ai\/sitemap-index\.xml/);

  const notFound = readDistFile("404.html");
  assertPageBasics(notFound, { titleFragment: "Page not found" });
  assert.match(notFound, /href="\/"/);
});

test("compiled css assets are emitted", () => {
  const astroDir = join(dist, "_astro");
  assert.equal(existsSync(astroDir), true);

  const cssFiles = readdirSync(astroDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0);
  assert.ok(cssFiles.some((file) => statSync(join(astroDir, file)).size > 1_000));

  // Motion CSS tests enforce reduced motion. Keep the canvas readiness gate in the build.
  const css = cssFiles.map((file) => readFileSync(join(astroDir, file), "utf8")).join("\n");
  assert.match(css, /\.lyra-globe:not\(\[data-ready\]\) \.lyra-globe__canvas/);
  assert.match(css, /@media \(scripting: ?enabled\)/);
});

test("build emits a versioned external globe stylesheet", () => {
  const link = readDistFile("index.html").match(/href="(\/globe-projection\/([a-f0-9]{16})\.css)"/);
  assert.ok(link, "the homepage must link the external globe stylesheet");
  assertDistPath(link[1].slice(1));
  const stylesheet = readDistFile(link[1].slice(1));
  assert.match(stylesheet, /\.hero__globe\{/);
  assert.equal(link[2], createHash("sha256").update(stylesheet).digest("hex").slice(0, 16));
});

test("the build ships hashed self-hosted latin font files", () => {
  const fontDir = join(root, "src", "assets", "fonts");
  for (const file of [
    "geist-latin-600.woff2",
    "ibm-plex-sans-latin-400.woff2",
    "ibm-plex-sans-latin-400-italic.woff2",
    "ibm-plex-mono-latin-400.woff2",
    "ibm-plex-mono-latin-500.woff2",
    "ibm-plex-mono-latin-600.woff2",
    "font-license-geist.txt",
    "font-license-ibm-plex.txt",
  ]) {
    assert.equal(existsSync(join(fontDir, file)), true, `missing font source: ${file}`);
  }

  const astroDir = join(dist, "_astro");
  const fonts = readdirSync(astroDir).filter((file) => file.endsWith(".woff2"));
  assert.equal(
    fonts.length,
    6,
    `expected six hashed woff2 files (Geist 600, Plex Sans 400 roman and italic, Plex Mono 400, 500 and 600), got ${fonts.join(", ")}`,
  );
  for (const file of fonts) {
    assert.match(file, /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.woff2/, `font must be content-hashed: ${file}`);
    assert.ok(statSync(join(astroDir, file)).size > 1_000, `${file} is too small to be a real woff2`);
  }

  const css = readdirSync(astroDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(astroDir, file), "utf8"))
    .join("\n");
  assert.match(css, /font-family:\s*"?Geist"?/);
  assert.match(css, /font-family:\s*"?IBM Plex Sans"?/);
  assert.match(css, /font-family:\s*"?IBM Plex Mono"?/);
  // Geist ships one weight, so the measured fallback face holds the display
  // metrics until the file arrives. Without it the headline reflows.
  assert.match(css, /font-family:\s*"?Geist Fallback"?/);
  assert.match(css, /size-adjust:\s*127\.74%/);
  assert.match(css, /ibm-plex-sans-latin-400\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /ibm-plex-sans-latin-400-italic\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(
    css,
    /font-style:\s*italic;[^}]*ibm-plex-sans-latin-400-italic\.[A-Za-z0-9_-]+\.woff2/,
    "Plex Sans italic 400 must ship as an italic @font-face, not a roman file",
  );
  assert.match(css, /ibm-plex-mono-latin-400\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /ibm-plex-mono-latin-500\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /ibm-plex-mono-latin-600\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /geist-latin-600\.[A-Za-z0-9_-]+\.woff2/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.equal(
    existsSync(join(dist, "fonts")),
    false,
    "unhashed font files must not copy into dist/",
  );
});

// The portrait master is a generator source, not a page asset. Files in
// public/ copy into dist/, and the deploy uploads dist/. Keep the master
// outside public/ and keep dist/images to the URLs pages actually use.
test("the portrait master stays out of the static publish set", () => {
  assert.equal(existsSync(join(root, "assets", "cristian-vega.png")), true);
  assert.deepEqual(readdirSync(join(dist, "images")).sort(), [
    "apple-touch-icon.png",
    "cristian-vega-social-preview.jpg",
  ]);
});

// Publish static assets and the two Cloudflare rule files only.
const DEPLOY_SUFFIXES = new Set(["html", "css", "js", "jpg", "png", "svg", "txt", "xml", "woff2"]);
const DEPLOY_FORBIDDEN_COMPONENTS = new Set([
  "php", "php3", "php4", "php5", "php7", "php8", "phtml", "phar", "phps", "pht",
  "cgi", "fcgi", "pl", "py", "rb", "sh", "bash", "zsh",
  "shtml", "shtm", "stm", "inc", "ini", "user",
  "htaccess", "htpasswd", "htgroups", "asp", "aspx", "jsp", "cfm",
  "exe", "dll", "so",
]);

function listDistFiles(dir = dist, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...listDistFiles(join(dir, entry.name), `${rel}/`));
    else files.push(rel);
  }
  return files.sort();
}

test("the build contains only approved static files and Cloudflare rules", () => {
  const files = listDistFiles();
  assert.ok(files.length >= 15, "expected the full static build");
  for (const rel of files) {
    if (["_headers", "_redirects", ".well-known/security.txt"].includes(rel)) continue;
    const parts = rel.split("/");
    for (const part of parts) {
      assert.ok(!part.startsWith("."), `${rel}: hidden names must not be published`);
    }
    const pieces = parts.at(-1).split(".");
    assert.ok(pieces.length >= 2, `${rel}: static files must have a suffix`);
    assert.ok(DEPLOY_SUFFIXES.has(pieces.at(-1)), `${rel}: .${pieces.at(-1)} is not an approved static type`);
    for (const piece of pieces.slice(1)) {
      assert.ok(!DEPLOY_FORBIDDEN_COMPONENTS.has(piece.toLowerCase()), `${rel}: do not publish the suffix component .${piece}`);
    }
    // The package is ustar; a plain ustar name holds 100 bytes.
    assert.ok(rel.length <= 100, `${rel}: longer than a ustar name (100); switch the package to --format=posix`);
  }
  for (const required of ["_headers", "_redirects", ".well-known/security.txt", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assertDistPath(required);
  }
});
