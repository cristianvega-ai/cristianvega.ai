import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, listBuiltRoutes, readDistFile, root } from "../support/helpers.mjs";

// Build output contract: the files the static deploy uploads must exist and be
// complete. Page copy lives in tests/integration/pages.test.mjs; this suite only asks
// whether the build emitted the files Cloudflare serves.

function assertDistPath(...segments) {
  const path = join(dist, ...segments);
  assert.equal(existsSync(path), true, `missing build output: ${path} (run \`npm test\` or \`npm run build\`)`);
}

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

test("the build ships usable self-hosted fonts", () => {
  const astroDirectory = join(dist, "_astro");
  const files = readdirSync(astroDirectory);
  const fonts = files.filter((file) => file.endsWith(".woff2"));
  assert.ok(fonts.length > 0, "the build must contain font files");
  for (const file of fonts) {
    assert.ok(statSync(join(astroDirectory, file)).size > 1_000, `${file} must contain font data`);
  }
  const css = files.filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(astroDirectory, file), "utf8")).join("\n");
  assert.match(css, /@font-face/, "the build must declare its fonts");
  const references = [...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)];
  assert.ok(references.length > 0, "the stylesheet must reference font files");
  for (const [, fontPath] of references) {
    assert.ok(fontPath.startsWith("/_astro/"), `${fontPath} must use a local asset URL`);
    assertDistPath(fontPath.slice(1));
  }
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
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
  assert.ok(files.length > 0, "the build must contain files");
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
