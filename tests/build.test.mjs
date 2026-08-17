import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile, root } from "./helpers.mjs";

// Build output contract: the files the static deploy uploads must exist and be
// complete. Page copy lives in tests/pages.test.mjs; this suite only asks
// whether the build emitted the artefacts DreamHost serves.

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

test("build emits the core static pages DreamHost will serve", () => {
  assertDistPath("index.html");
  assertDistPath("writing", "index.html");
  assertDistPath("projects", "index.html");
  assertDistPath("about", "index.html");
  assertDistPath("contact", "index.html");
  assertDistPath("rss.xml");
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

  assert.ok(expected.length > 0, "build must emit routes to enumerate");
  assert.deepEqual(
    [...locations].sort(),
    [...expected].sort(),
    "sitemap must list exactly the built routes, absolute and trailing-slashed",
  );
});

test("static ops assets ship with the build", () => {
  assert.equal(existsSync(join(dist, "robots.txt")), true);
  assert.equal(existsSync(join(dist, "404.html")), true);
  assert.equal(existsSync(join(dist, ".htaccess")), true);

  const robots = readDistFile("robots.txt");
  assert.match(robots, /Sitemap:\s*https:\/\/cristianvega\.ai\/sitemap-index\.xml/);

  const notFound = readDistFile("404.html");
  assertPageBasics(notFound, { titleFragment: "Page not found" });
  assert.match(notFound, /href="\/"/);
});

test("rss feed includes published posts", () => {
  const xml = readDistFile("rss.xml");

  assert.match(xml, /<rss/);
  assert.match(xml, /From BERT to agents/);

  // Item set must match non-draft content slugs exactly (not a /draft/i substring proxy).
  const postsDir = join(root, "src", "content", "posts");
  const expectedSlugs = readdirSync(postsDir)
    .filter((file) => /\.(md|mdx)$/.test(file))
    .flatMap((file) => {
      const fm = readFileSync(join(postsDir, file), "utf8").match(
        /^---\r?\n([\s\S]*?)\r?\n---/,
      )?.[1];
      if (!fm || /^draft:\s*true\s*$/m.test(fm)) return [];
      return [file.replace(/\.(md|mdx)$/, "")];
    })
    .sort();

  const itemLinks = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map(
    (match) => match[1],
  );
  const feedSlugs = itemLinks
    .map((href) => href.match(/\/posts\/([^/]+)\/?$/)?.[1])
    .filter(Boolean)
    .sort();

  assert.deepEqual(feedSlugs, expectedSlugs);
  assert.equal(itemLinks.length, expectedSlugs.length, "no extra non-post channel links as items");

  // Channel essentials readers depend on.
  assert.match(xml, /<channel>/);
  assert.match(xml, /<title>Cristian Vega Writing<\/title>/);
  assert.match(xml, /<link>https:\/\/cristianvega\.ai\/<\/link>/);
  assert.match(xml, /<language>en-us<\/language>/);
  assert.match(
    xml,
    /<atom:link\b[^>]*href="https:\/\/cristianvega\.ai\/rss\.xml"[^>]*rel="self"/,
    "feed must reference itself with atom:link rel=self",
  );
  assert.match(xml, /<lastBuildDate>[^<]+GMT<\/lastBuildDate>/);

  // Every published post ships with an absolute, trailing-slash link and a date.
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => item);
  const published = readdirSync(join(dist, "posts"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(published.length > 0, "build must emit post pages to compare against");
  assert.equal(items.length, published.length, "feed must carry every published post");

  const links = items.map((item) => item.match(/<link>([^<]+)<\/link>/)?.[1]);
  for (const [index, item] of items.entries()) {
    assert.match(item, /<title>[^<]+<\/title>/);
    assert.match(item, /<pubDate>[^<]+GMT<\/pubDate>/, "each item needs a pubDate");
    assert.match(
      links[index] ?? "",
      /^https:\/\/cristianvega\.ai\/posts\/[a-z0-9-]+\/$/,
      `item link must be absolute with a trailing slash: ${links[index]}`,
    );
  }

  for (const slug of published) {
    assert.ok(
      links.includes(`https://cristianvega.ai/posts/${slug}/`),
      `feed is missing /posts/${slug}/`,
    );
  }
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
