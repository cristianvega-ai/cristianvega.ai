import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile, root } from "./helpers.mjs";

// Build output contract: the files the static deploy uploads must exist and be
// complete. Page copy lives in tests/pages.test.mjs; this suite only asks
// whether the build emitted the files Cloudflare serves.

function assertDistPath(...segments) {
  const path = join(dist, ...segments);
  assert.equal(existsSync(path), true, `missing build output: ${path} (run \`npm test\` or \`npm run build\`)`);
}

/** Every public route the build emits, as absolute paths with trailing slashes. */
function listBuiltRoutes(dir = dist, prefix = "/") {
  const routes = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_astro") continue;
      routes.push(...listBuiltRoutes(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "index.html") {
      routes.push(prefix);
    }
  }

  return routes;
}

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

test("the navigation leaves the site, and every outbound link is safe", () => {
  // The site is one page. The navigation carries the owner's profiles instead
  // of internal routes, so each link opens a new tab and must not hand the
  // opener or the referrer to the destination.
  const home = readDistFile("index.html");
  const nav = home.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(nav, "primary navigation required");

  const anchors = [...nav.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag);
  assert.equal(anchors.length, 3, `navigation must hold three links: ${nav}`);

  for (const host of ["linkedin.com", "x.com", "github.com"]) {
    assert.ok(
      anchors.some((tag) => tag.includes(host)),
      `navigation must link ${host}`,
    );
  }

  for (const tag of anchors) {
    assert.match(tag, /href="https:\/\//, `navigation link must be absolute: ${tag}`);
    assert.match(tag, /target="_blank"/, `navigation link must open a new tab: ${tag}`);
    assert.match(tag, /rel="[^"]*noopener/, `navigation link needs noopener: ${tag}`);
    assert.match(tag, /rel="[^"]*noreferrer/, `navigation link needs noreferrer: ${tag}`);
  }
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

test("analytics scripts ship with the build and match the pinned release", () => {
  assert.equal(
    existsSync(join(dist, "js", "goatcounter.js")),
    false,
    "the ClientRouter swap counter must not ship",
  );
  assert.equal(existsSync(join(dist, "js", "count.v5.js")), true);

  // The vendored file must stay byte-identical to the upstream release. The
  // expected value is the SRI hash GoatCounter publishes for count.v5.js, so
  // anyone can re-check the pin against https://gc.zgo.at/count.v5.js.
  const digest = createHash("sha384")
    .update(readFileSync(join(dist, "js", "count.v5.js")))
    .digest("base64");
  assert.equal(
    `sha384-${digest}`,
    "sha384-atnOLvQb9t+jTSipvd75X2yginT4PjVbqDdlJAmxMm+wYElFmeR6EmLP5bYeoRVQ",
    "dist/js/count.v5.js must stay byte-identical to the pinned GoatCounter release",
  );
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

  // The no-JS pre-hide and reduced-motion contracts over this CSS are enforced
  // mechanism-agnostically in tests/motion-css.test.mjs. What stays here is the
  // positive check that the cold-load pre-hide gate actually reaches the build.
  const css = cssFiles.map((file) => readFileSync(join(astroDir, file), "utf8")).join("\n");
  assert.match(css, /html\[data-hero-motion-pending\]/);
});

test("the build ships hashed self-hosted latin font files", () => {
  const fontDir = join(root, "src", "assets", "fonts");
  for (const file of [
    "space-grotesk-latin-600-700.woff2",
    "ibm-plex-sans-latin-400.woff2",
    "ibm-plex-sans-latin-400-italic.woff2",
    "ibm-plex-mono-latin-400.woff2",
    "ibm-plex-mono-latin-500.woff2",
    "OFL-space-grotesk.txt",
    "OFL-ibm-plex.txt",
  ]) {
    assert.equal(existsSync(join(fontDir, file)), true, `missing font source: ${file}`);
  }

  const astroDir = join(dist, "_astro");
  const fonts = readdirSync(astroDir).filter((file) => file.endsWith(".woff2"));
  assert.equal(
    fonts.length,
    5,
    `expected five hashed woff2 files (Space Grotesk 600–700, Plex Sans 400 roman and italic, Plex Mono 400 and 500), got ${fonts.join(", ")}`,
  );
  for (const file of fonts) {
    assert.match(file, /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.woff2/, `font must be content-hashed: ${file}`);
    assert.ok(statSync(join(astroDir, file)).size > 1_000, `${file} is too small to be a real woff2`);
  }

  const css = readdirSync(astroDir)
    .filter((file) => file.endsWith(".css"))
    .map((file) => readFileSync(join(astroDir, file), "utf8"))
    .join("\n");
  assert.match(css, /font-family:\s*"?Space Grotesk"?/);
  assert.match(css, /font-family:\s*"?IBM Plex Sans"?/);
  assert.match(css, /font-family:\s*"?IBM Plex Mono"?/);
  assert.match(css, /font-weight:\s*600 700/);
  assert.match(css, /ibm-plex-sans-latin-400\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /ibm-plex-sans-latin-400-italic\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(
    css,
    /font-style:\s*italic;[^}]*ibm-plex-sans-latin-400-italic\.[A-Za-z0-9_-]+\.woff2/,
    "Plex Sans italic 400 must ship as an italic @font-face, not a roman file",
  );
  assert.match(css, /ibm-plex-mono-latin-400\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /ibm-plex-mono-latin-500\.[A-Za-z0-9_-]+\.woff2/);
  assert.match(css, /space-grotesk-latin-600-700\.[A-Za-z0-9_-]+\.woff2/);
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
    if (["_headers", "_redirects"].includes(rel)) continue;
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
  for (const required of ["_headers", "_redirects", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assertDistPath(required);
  }
});
