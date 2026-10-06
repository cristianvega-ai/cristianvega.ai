import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { assertPageBasics, contentRoutes, dist, listBuiltRoutes, publishedContent, readContentInventory, readDistFile, root, sitemapPaths, withContentBuild } from "./helpers.mjs";

// Build output contract: the files the static deploy uploads must exist and be
// complete. Page copy lives in tests/pages.test.mjs; this suite only asks
// whether the build emitted the files Cloudflare serves.

function assertDistPath(...segments) {
  const path = join(dist, ...segments);
  assert.equal(existsSync(path), true, `missing build output: ${path} (run \`npm test\` or \`npm run build\`)`);
}

const inventory = readContentInventory();
const published = publishedContent(inventory);

test("dist build is present for contract tests", () => {
  assert.equal(
    existsSync(dist),
    true,
    `missing ${dist}/ — run \`npm test\` (builds first) or \`npm run build\` before node --test`,
  );
  assertDistPath("index.html");
});

test("build emits the core static pages Cloudflare will serve", () => {
  assertDistPath("index.html");
  assertDistPath("about", "index.html");
  assertDistPath("sitemap-index.xml");
});

test("the sitemap lists the about page", () => {
  assert.match(readDistFile("sitemap-0.xml"), /<loc>https:\/\/cristianvega\.ai\/about\/<\/loc>/);
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

test("navigation follows published content and keeps outbound links safe", () => {
  const home = readDistFile("index.html");
  const nav = home.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(nav, "primary navigation required");

  const anchors = [...nav.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag);
  const sections = Object.keys(published).filter((section) => published[section].length > 0);
  assert.equal(anchors.length, 4 + sections.length, `navigation must match published sections: ${nav}`);
  const about = anchors.filter((tag) => /href="\/about\/"/.test(tag));
  assert.equal(about.length, 1, "navigation must link to about once");
  assert.doesNotMatch(about[0], /target=/, "about must open in the current tab");
  for (const section of Object.keys(published)) {
    const sectionLinks = anchors.filter((tag) => tag.includes(`href="/${section}/"`));
    assert.equal(sectionLinks.length, published[section].length > 0 ? 1 : 0, `${section} navigation must match publication`);
    for (const tag of sectionLinks) assert.doesNotMatch(tag, /target=/, `${section} must open in the current tab`);
  }
  const outbound = anchors.filter((tag) => /href="https:\/\//.test(tag));
  assert.equal(outbound.length, 3, "navigation must keep all three profile links");

  for (const host of ["linkedin.com", "x.com", "github.com"]) {
    assert.ok(
      anchors.some((tag) => tag.includes(host)),
      `navigation must link ${host}`,
    );
  }

  for (const tag of outbound) {
    assert.match(tag, /href="https:\/\//, `navigation link must be absolute: ${tag}`);
    assert.match(tag, /target="_blank"/, `navigation link must open a new tab: ${tag}`);
    assert.match(tag, /rel="[^"]*noopener/, `navigation link needs noopener: ${tag}`);
    assert.match(tag, /rel="[^"]*noreferrer/, `navigation link needs noreferrer: ${tag}`);
  }
});

test("the narrow-screen menu holds the same links as the primary navigation", () => {
  const home = readDistFile("index.html");
  const links = (nav) => [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map(([, href]) => href);
  const primary = home.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
  const menu = home.match(/<details class="nav-menu">[\s\S]*?<\/details>/i)?.[0];
  assert.ok(primary && menu, "primary navigation and menu required");
  assert.match(menu, /<summary class="nav-menu__toggle">menu<\/summary>/);
  assert.deepEqual(links(menu), links(primary), "the menu must reach every link the primary navigation reaches");
});

function assertContentBuild(buildDirectory, sourceInventory) {
  const routes = listBuiltRoutes(buildDirectory);
  const locations = sitemapPaths(buildDirectory);
  const expected = ["/", "/about/", ...contentRoutes(sourceInventory)].sort();
  assert.deepEqual(routes, expected, "build routes must match published content");
  assert.deepEqual(locations, expected, "sitemap routes must match published content");
  const home = readFileSync(join(buildDirectory, "index.html"), "utf8");
  for (const [section, entries] of Object.entries(sourceInventory)) {
    const visible = entries.filter((entry) => !entry.data.draft);
    assert.equal(existsSync(join(buildDirectory, section, "index.html")), visible.length > 0, `${section} index must follow visibility`);
    assert.equal(home.includes(`href="/${section}/"`), visible.length > 0, `${section} homepage links must follow visibility`);
    for (const entry of entries.filter((entry) => entry.data.draft)) {
      assert.equal(existsSync(join(buildDirectory, section, entry.id)), false, `${entry.id} draft route must be absent`);
      assert.ok(!locations.includes(entry.href), `${entry.id} draft must stay out of the sitemap`);
      assert.ok(!home.includes(`href="${entry.href}"`), `${entry.id} draft link must stay off the homepage`);
    }
  }
}

test("content routes follow publication and omit every current draft", () => {
  assertContentBuild(dist, inventory);
  assert.equal(existsSync(join(dist, "blog")), false, "the old blog routes must not be built");
  assert.ok(!sitemapPaths().some((path) => path.startsWith("/blog/")), "old blog routes must stay out of the sitemap");
});

for (const kind of ["all-draft", "mixed"]) {
  test(`${kind} fixture emits only published routes and sitemap entries`, { timeout: 90_000 }, async () => {
    await withContentBuild(kind, (fixture) => assertContentBuild(fixture.dist, fixture.inventory));
  });
}

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

test("the build removes the GoatCounter scripts", () => {
  assert.equal(
    existsSync(join(dist, "js", "goatcounter.js")),
    false,
    "the ClientRouter swap counter must not ship",
  );
  assert.equal(existsSync(join(dist, "js", "count.v5.js")), false);
});

test("the ClientRouter bundle does not ship", () => {
  const astroDir = join(dist, "_astro");
  assert.equal(existsSync(astroDir), true, "hashed assets required");
  const jsFiles = readdirSync(astroDir).filter((file) => file.endsWith(".js"));
  assert.equal(
    jsFiles.some((file) => /ClientRouter/i.test(file)),
    false,
    "the ClientRouter bundle must not ship",
  );
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
  assert.doesNotMatch(css, /data-hero-motion-pending/);
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
    "OFL-geist.txt",
    "OFL-ibm-plex.txt",
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
    "cristian-vega-og.jpg",
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
