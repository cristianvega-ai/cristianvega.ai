import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist as buildDirectory, listFiles, listPageRoutes, readDistFile, root as repositoryRoot, sceneRoutePrefix, withContentBuild } from "../shared/node-helpers.mjs";

// Check files that Cloudflare serves from the static build.
// Check page content in tests/integration/pages.test.mjs.

function assertBuildPathExists(...segments) {
  const buildPath = join(buildDirectory, ...segments);
  assert.equal(existsSync(buildPath), true, `build output ${buildPath} must exist; run \`npm test\` or \`npm run build\``);
}

// A published scene folder holds the model's own files. Its pages are not Astro pages, so the sitemap does not list them.
function assertSitemapListsPages(buildDirectory) {
  // robots.txt directs crawlers to this index. Check that its child sitemap exists and lists current routes.
  const sitemapIndex = readFileSync(join(buildDirectory, "sitemap-index.xml"), "utf8");
  const childSitemapFilename = sitemapIndex.match(/<loc>https:\/\/cristianvega\.ai\/(sitemap-\d+\.xml)<\/loc>/)?.[1];
  assert.ok(childSitemapFilename, `sitemap index must reference a child sitemap: ${sitemapIndex}`);
  assert.equal(existsSync(join(buildDirectory, childSitemapFilename)), true, `referenced child sitemap ${childSitemapFilename} must exist`);

  const sitemapLocations = [...readFileSync(join(buildDirectory, childSitemapFilename), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => location);
  const expectedLocations = listPageRoutes(buildDirectory).map((route) => `https://cristianvega.ai${route}`);

  assert.ok(expectedLocations.length > 0, "the build must produce public routes for the sitemap");
  assert.deepEqual(
    [...sitemapLocations].sort(),
    [...expectedLocations].sort(),
    "the sitemap must list exactly the public built routes as absolute URLs with trailing slashes",
  );
  assert.ok(sitemapLocations.every((location) => !location.includes(sceneRoutePrefix)), "the sitemap must not list a scene folder");
}

test("the built sitemap lists every public route and references an existing child sitemap", () => {
  assertSitemapListsPages(buildDirectory);
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
  assert.ok(!listPageRoutes().includes("/about/"), "the built routes must not include /about/");
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
// Lab clips and posters are the only media files. The media integration copies them under /lab/media/.
const mediaSuffixes = new Set(["mp4", "webp"]);
const mediaPrefix = "lab/media/";
// The model's own files in a scene folder need no short path. The Astro pages and the media keep the limit.
const scenePrefix = sceneRoutePrefix.slice(1);
const forbiddenSuffixComponents = new Set([
  "php", "php3", "php4", "php5", "php7", "php8", "phtml", "phar", "phps", "pht",
  "cgi", "fcgi", "pl", "py", "rb", "sh", "bash", "zsh",
  "shtml", "shtm", "stm", "inc", "ini", "user",
  "htaccess", "htpasswd", "htgroups", "asp", "aspx", "jsp", "cfm",
  "exe", "dll", "so",
]);

/** List the reasons a built file is not publishable. An empty list means the file is approved. */
function staticFileProblems(relativePath) {
  if (["_headers", "_redirects", ".well-known/security.txt"].includes(relativePath)) return [];
  const problems = [];
  const pathComponents = relativePath.split("/");
  for (const pathComponent of pathComponents) {
    if (pathComponent.startsWith(".")) problems.push(`${relativePath}: hidden names must not be published`);
  }
  const filenameComponents = pathComponents.at(-1).split(".");
  const suffix = filenameComponents.at(-1);
  if (filenameComponents.length < 2) problems.push(`${relativePath}: static files must have a filename extension`);
  else if (!approvedStaticSuffixes.has(suffix) && !(mediaSuffixes.has(suffix) && relativePath.startsWith(mediaPrefix))) {
    problems.push(`${relativePath}: .${suffix} is not an approved static type`);
  }
  for (const suffixComponent of filenameComponents.slice(1)) {
    if (forbiddenSuffixComponents.has(suffixComponent.toLowerCase())) problems.push(`${relativePath}: the filename must not contain forbidden suffix component .${suffixComponent}`);
  }
  // The package is ustar; a plain ustar name holds 100 bytes.
  if (!relativePath.startsWith(scenePrefix) && relativePath.length > 100) problems.push(`${relativePath}: the published path must fit the 100-byte ustar filename limit`);
  return problems;
}

test("the build contains only approved static files and Cloudflare rules", () => {
  const builtFilenames = listFiles(buildDirectory);
  assert.ok(builtFilenames.length > 0, "the build must contain files");
  assert.deepEqual(builtFilenames.flatMap(staticFileProblems), []);
  for (const requiredPath of ["_headers", "_redirects", ".well-known/security.txt", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assertBuildPathExists(requiredPath);
  }
});

// Each case breaks one rule. The media and scene exemptions must stay narrow.
for (const [conditionName, relativePath, expectedProblem] of [
  ["a clip outside the Lab media folder", "images/clip.mp4", /\.mp4 is not an approved static type/],
  ["a poster outside the Lab media folder", "lab/floating-castles/poster.webp", /\.webp is not an approved static type/],
  ["a clip in a scene folder", "lab/scenes/castles/opus/clip.mp4", /\.mp4 is not an approved static type/],
  ["another media type under the Lab media folder", "lab/media/castles/clips/a.mov", /\.mov is not an approved static type/],
  ["a long page path outside the scene folder", `lab/floating-castles/${"a".repeat(90)}/index.html`, /100-byte ustar/],
  ["a long media path", `lab/media/castles/clips/${"a".repeat(90)}.mp4`, /100-byte ustar/],
  ["a hidden file in a scene folder", "lab/scenes/castles/opus/.env", /hidden names/],
  ["a forbidden suffix in a scene folder", "lab/scenes/castles/opus/run.php.js", /forbidden suffix component \.php/],
  ["a scene file without an extension", "lab/scenes/castles/opus/LICENSE", /must have a filename extension/],
]) {
  test(`the static file check rejects ${conditionName}`, () => {
    assert.match(staticFileProblems(relativePath).join("\n"), expectedProblem);
  });
}

test("the static file check accepts Lab media and long scene paths", () => {
  for (const relativePath of ["lab/media/castles/clips/a.av1.mp4", "lab/media/castles/posters/a.webp", `lab/scenes/castles/opus/${"a".repeat(90)}/app.js`]) {
    assert.deepEqual(staticFileProblems(relativePath), [], relativePath);
  }
});

// A published Lab adds media and scene files to the build. They must pass the same checks as the other files.
test("a build with a published Lab keeps an exact sitemap and approved static files", { timeout: 90_000 }, async () => {
  await withContentBuild("mixed", (fixture) => {
    assertSitemapListsPages(fixture.dist);
    const builtFilenames = listFiles(fixture.dist);
    assert.deepEqual(builtFilenames.flatMap(staticFileProblems), []);
    assert.ok(builtFilenames.some((relativePath) => relativePath.startsWith(mediaPrefix) && relativePath.endsWith(".mp4")), "the build must hold Lab clips");
    assert.ok(builtFilenames.some((relativePath) => relativePath.startsWith(mediaPrefix) && relativePath.endsWith(".webp")), "the build must hold Lab posters");
    assert.ok(builtFilenames.some((relativePath) => relativePath.startsWith(scenePrefix) && relativePath.endsWith("/index.html")), "the build must hold scene entry pages");
    assert.ok(listPageRoutes(fixture.dist).includes("/lab/"), "the build must hold the Lab page");
  }, { lab: { state: "published" } });
});
