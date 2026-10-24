import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist as buildDirectory, listBuiltRoutes, readDistFile, root as repositoryRoot } from "../shared/node-helpers.mjs";

// Check files that Cloudflare serves from the static build.
// Check page content in tests/integration/pages.test.mjs.

function assertBuildPathExists(...segments) {
  const buildPath = join(buildDirectory, ...segments);
  assert.equal(existsSync(buildPath), true, `build output ${buildPath} must exist; run \`npm test\` or \`npm run build\``);
}

test("the built sitemap lists every public route and references an existing child sitemap", () => {
  // robots.txt directs crawlers to this index. Check that its child sitemap exists and lists current routes.
  const sitemapIndex = readDistFile("sitemap-index.xml");
  const childSitemapFilename = sitemapIndex.match(/<loc>https:\/\/cristianvega\.ai\/(sitemap-\d+\.xml)<\/loc>/)?.[1];
  assert.ok(childSitemapFilename, `sitemap index must reference a child sitemap: ${sitemapIndex}`);
  assert.equal(existsSync(join(buildDirectory, childSitemapFilename)), true, `referenced child sitemap ${childSitemapFilename} must exist`);

  const sitemapLocations = [...readDistFile(childSitemapFilename).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => location);
  const expectedLocations = listBuiltRoutes().map((route) => `https://cristianvega.ai${route}`);

  assert.ok(expectedLocations.length > 0, "the build must produce public routes for the sitemap");
  assert.deepEqual(
    [...sitemapLocations].sort(),
    [...expectedLocations].sort(),
    "the sitemap must list exactly the public built routes as absolute URLs with trailing slashes",
  );
});

test("the build includes required hosting files and omits Apache configuration", () => {
  assert.equal(existsSync(join(buildDirectory, "robots.txt")), true);
  assert.equal(existsSync(join(buildDirectory, "404.html")), true);
  assert.equal(existsSync(join(buildDirectory, "_headers")), true);
  assert.equal(existsSync(join(buildDirectory, "_redirects")), true);
  assert.equal(existsSync(join(buildDirectory, ".htaccess")), false);

  const robotsRecord = readDistFile("robots.txt");
  assert.match(robotsRecord, /Sitemap:\s*https:\/\/cristianvega\.ai\/sitemap-index\.xml/);

  const notFoundHtml = readDistFile("404.html");
  assertPageBasics(notFoundHtml, { titleFragment: "This page doesn&#39;t exist\\." });
  assert.match(notFoundHtml, /href="\/"/);
});

// The About page moved to the homepage. The build must not emit it, and Cloudflare must send its old addresses home.
test("the build redirects the retired About addresses to the homepage and emits no About page", () => {
  assert.equal(existsSync(join(buildDirectory, "about")), false, "the build must not emit /about/");
  assert.equal(existsSync(join(buildDirectory, "about.html")), false, "the build must not emit about.html");
  const redirectRules = readDistFile("_redirects").split("\n").map((line) => line.trim().split(/\s+/)).filter((fields) => fields.length === 3);
  for (const oldAddress of ["/about", "/about/"]) {
    assert.ok(
      redirectRules.some(([from, to, status]) => from === oldAddress && to === "/" && status === "301"),
      `_redirects must send ${oldAddress} to / with status 301`,
    );
  }
  assert.ok(!listBuiltRoutes().includes("/about/"), "the built routes must not include /about/");
});

test("the build includes font data and references each font through a local asset URL", () => {
  const astroDirectory = join(buildDirectory, "_astro");
  const builtFilenames = readdirSync(astroDirectory);
  const fontFilenames = builtFilenames.filter((filename) => filename.endsWith(".woff2"));
  assert.ok(fontFilenames.length > 0, "the build must contain font files");
  for (const filename of fontFilenames) {
    assert.ok(statSync(join(astroDirectory, filename)).size > 1_000, `${filename} must contain font data`);
  }
  const compiledStylesheet = builtFilenames.filter((filename) => filename.endsWith(".css"))
    .map((filename) => readFileSync(join(astroDirectory, filename), "utf8")).join("\n");
  assert.match(compiledStylesheet, /@font-face/, "the build must declare its fonts");
  const fontReferences = [...compiledStylesheet.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)];
  assert.ok(fontReferences.length > 0, "the stylesheet must reference font files");
  for (const [, fontPath] of fontReferences) {
    assert.ok(fontPath.startsWith("/_astro/"), `${fontPath} must use a local asset URL`);
    assertBuildPathExists(fontPath.slice(1));
  }
  assert.doesNotMatch(compiledStylesheet, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  // The site sets IBM Plex Sans in three faces and IBM Plex Mono in one. The old faces must not ship.
  assert.deepEqual(
    fontFilenames.map((filename) => filename.replace(/\.[\w-]{8}\.woff2$/, "")).sort(),
    ["ibm-plex-mono-latin-400", "ibm-plex-sans-latin-400", "ibm-plex-sans-latin-400-italic", "ibm-plex-sans-latin-500"],
    "the build must ship only the four IBM Plex faces",
  );
});

// Keep the portrait master outside public/.
// Publish only the image derivatives that pages use.
test("the build publishes approved image derivatives and excludes the portrait master", () => {
  assert.equal(existsSync(join(repositoryRoot, "assets", "cristian-vega.png")), true);
  assert.deepEqual(readdirSync(join(buildDirectory, "images")).sort(), [
    "apple-touch-icon.png",
    "cristian-vega-social-preview.jpg",
  ]);
});

// Publish static assets and the two Cloudflare rule files only.
const approvedStaticSuffixes = new Set(["html", "css", "js", "jpg", "png", "svg", "txt", "xml", "woff2"]);
const forbiddenSuffixComponents = new Set([
  "php", "php3", "php4", "php5", "php7", "php8", "phtml", "phar", "phps", "pht",
  "cgi", "fcgi", "pl", "py", "rb", "sh", "bash", "zsh",
  "shtml", "shtm", "stm", "inc", "ini", "user",
  "htaccess", "htpasswd", "htgroups", "asp", "aspx", "jsp", "cfm",
  "exe", "dll", "so",
]);

function listBuildFiles(directory = buildDirectory, prefix = "") {
  const builtFilenames = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) builtFilenames.push(...listBuildFiles(join(directory, entry.name), `${relativePath}/`));
    else builtFilenames.push(relativePath);
  }
  return builtFilenames.sort();
}

test("the build contains only approved static files and Cloudflare rules", () => {
  const builtFilenames = listBuildFiles();
  assert.ok(builtFilenames.length > 0, "the build must contain files");
  for (const relativePath of builtFilenames) {
    if (["_headers", "_redirects", ".well-known/security.txt"].includes(relativePath)) continue;
    const pathComponents = relativePath.split("/");
    for (const pathComponent of pathComponents) {
      assert.ok(!pathComponent.startsWith("."), `${relativePath}: hidden names must not be published`);
    }
    const filenameComponents = pathComponents.at(-1).split(".");
    assert.ok(filenameComponents.length >= 2, `${relativePath}: static files must have a filename extension`);
    assert.ok(approvedStaticSuffixes.has(filenameComponents.at(-1)), `${relativePath}: .${filenameComponents.at(-1)} is not an approved static type`);
    for (const suffixComponent of filenameComponents.slice(1)) {
      assert.ok(!forbiddenSuffixComponents.has(suffixComponent.toLowerCase()), `${relativePath}: the filename must not contain forbidden suffix component .${suffixComponent}`);
    }
    // The package is ustar; a plain ustar name holds 100 bytes.
    assert.ok(relativePath.length <= 100, `${relativePath}: the published path must fit the 100-byte ustar filename limit`);
  }
  for (const requiredPath of ["_headers", "_redirects", ".well-known/security.txt", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assertBuildPathExists(requiredPath);
  }
});
