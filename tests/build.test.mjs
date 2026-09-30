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

test("navigation links to about, hides writing while no post is published, and keeps outbound links safe", () => {
  const home = readDistFile("index.html");
  const nav = home.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(nav, "primary navigation required");

  const anchors = [...nav.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag);
  assert.equal(anchors.length, 4, `navigation must hold about and three profile links: ${nav}`);
  const about = anchors.filter((tag) => /href="\/about\/"/.test(tag));
  assert.equal(about.length, 1, "navigation must link to about once");
  assert.doesNotMatch(about[0], /target=/, "about must open in the current tab");
  // Every fixture post is a draft, so a production build hides the writing link.
  assert.doesNotMatch(nav, /href="\/writing\/"/, "navigation must hide writing while no post is published");
  assert.doesNotMatch(nav, /href="\/products\/"/, "navigation must hide products while no product is published");
  const outbound = anchors.filter((tag) => !about.includes(tag));
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

test("writing and products build no routes while every entry is a draft", () => {
  // The fixture posts and the sample product are drafts, so production emits
  // neither index. The routes exist only once an entry is published.
  assert.equal(existsSync(join(dist, "writing")), false, "writing must not build while every post is a draft");
  assert.equal(existsSync(join(dist, "products")), false, "products must not build while every product is a draft");
  assert.equal(existsSync(join(dist, "blog")), false, "the old blog routes must not be built");
  // Read each sitemap entry as a URL, so the check compares the exact path.
  const sitemapPaths = [...readDistFile("sitemap-0.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  assert.ok(sitemapPaths.length > 0, "the sitemap must list the pages");
  for (const [route, message] of [["writing", "the writing index"], ["products", "the products index"], ["blog", "the old blog routes"]]) {
    assert.ok(!sitemapPaths.some((path) => path === `/${route}` || path.startsWith(`/${route}/`)), `${message} must stay out of the sitemap`);
  }
  // The homepage calls to action must not link to a route that the build omits.
  assert.doesNotMatch(readDistFile("index.html"), /href="\/(?:writing|products)\//, "the homepage must not link to an omitted route");
  for (const [collection, route] of [["blog", "writing"], ["products", "products"]]) {
    const source = join(root, "src", "content", collection);
    for (const file of readdirSync(source).filter((name) => name.endsWith(".md"))) {
      const frontmatter = readFileSync(join(source, file), "utf8").split("---")[1];
      if (/^draft: false$/m.test(frontmatter)) continue;
      const slug = file.slice(0, -3);
      assert.equal(existsSync(join(dist, route, slug)), false, `${slug} must remain a draft`);
      assert.ok(!sitemapPaths.includes(`/${route}/${slug}/`), `${slug} must stay out of the sitemap`);
    }
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

  // The reduced-motion contract over this CSS is enforced in
  // tests/motion-css.test.mjs. What stays here is the positive check that the
  // globe reveal rules reach the build, and that the retired pre-hide is gone.
  const css = cssFiles.map((file) => readFileSync(join(astroDir, file), "utf8")).join("\n");
  assert.match(css, /\.lyra-globe\[data-ready\]/);
  assert.match(css, /@media \(scripting: ?enabled\)/);
  assert.doesNotMatch(css, /data-hero-motion-pending/);
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
