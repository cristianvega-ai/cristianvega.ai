import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, contentRoutes, createIsolatedBuild, dist, escapeAttribute, escapeHtml, headerLinks, latestWork, listBuiltRoutes, publishedContent, readContentInventory, sitemapPaths, withContentBuild } from "./helpers.mjs";

// Build each publication fixture once. Check routes and rendered pages against the same independent inventory.

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

function assertPublicationNavigation(html, sourceInventory) {
  const expected = headerLinks(sourceInventory).map((link) => link.href).filter((href) => href.startsWith("/"));
  for (const label of ["Primary", "Menu"]) {
    const nav = html.match(new RegExp(`<nav\\b[^>]*aria-label="${label}"[\\s\\S]*?</nav>`))?.[0];
    assert.ok(nav, `${label} navigation must exist`);
    const internal = [...nav.matchAll(/<a\b[^>]*href="(\/[^\"]*)"/g)].map(([, href]) => href);
    assert.deepEqual(internal, expected, `${label} navigation must follow publication`);
  }
}

function assertHomepagePublication(html, sourceInventory) {
  assert.equal((html.match(/<h2\b/g) ?? []).length, 0, "the homepage must hold no section heading");
  assert.doesNotMatch(html, /href="#"/);
  const list = html.match(/<ul class="hero__next"[^>]*>[\s\S]*?<\/ul>/)?.[0];
  assert.ok(list, "the homepage must hold the calls to action");
  const items = [...list.matchAll(/<li class="hero__next-item" data-state="(\w+)">([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, 2, "the homepage must hold two calls to action");
  const published = publishedContent(sourceInventory);
  for (const [index, expected] of latestWork.entries()) {
    const live = published[expected.section].length > 0;
    assert.equal(items[index][1], live ? "live" : "soon", `${expected.section} state must follow publication`);
    if (live) {
      assert.ok(items[index][2].includes(`href="${expected.href}"`), `${expected.section} must link to its index`);
      assert.ok(items[index][2].includes(expected.label), `${expected.section} link must keep its label`);
      assert.match(items[index][2], /class="hero__next-arrow" aria-hidden="true">→<\/span>/);
    } else {
      assert.equal(items[index][2], `<span class="hero__next-soon">${expected.soon}</span>`);
      assert.doesNotMatch(items[index][2], /<a\b|href=|tabindex/, "coming-soon text must not take focus");
      assert.ok(!html.includes(`href="${expected.href}"`), `${expected.section} must not link to an absent index`);
    }
  }
  assertPublicationNavigation(html, sourceInventory);
}

function assertPublishedPages(buildDirectory, sourceInventory) {
  const read = (...segments) => readFileSync(join(buildDirectory, ...segments), "utf8");
  const published = publishedContent(sourceInventory);
  assertHomepagePublication(read("index.html"), sourceInventory);
  for (const [section, entries] of Object.entries(published)) {
    if (!entries.length) continue;
    const index = read(section, "index.html");
    assertPageBasics(index);
    assertPublicationNavigation(index, sourceInventory);
    assert.doesNotMatch(index, /name="robots" content="noindex|class="draft-label"|local preview/i);
    const attribute = section === "writing" ? "data-article-identifier" : "data-product-identifier";
    const listed = [...index.matchAll(new RegExp(`<li\\b[^>]*${attribute}="([^"]+)"`, "g"))].map(([, id]) => id);
    assert.deepEqual(listed, entries.map((entry) => entry.id), `${section} list must follow its content order`);
    for (const draft of sourceInventory[section].filter((entry) => entry.data.draft)) {
      assert.ok(!index.includes(`href="${draft.href}"`), `${draft.id} draft must stay out of the index`);
    }
    for (const [position, entry] of entries.entries()) {
      const html = read(section, entry.id, "index.html");
      assertPageBasics(html);
      assertPublicationNavigation(html, sourceInventory);
      assert.ok(html.includes(`>${escapeHtml(entry.data.title)}</h1>`), `${entry.id} must show its title`);
      assert.ok(html.includes(`name="description" content="${escapeAttribute(entry.data.description)}"`), `${entry.id} must keep its description`);
      assert.ok(html.includes(`rel="canonical" href="https://cristianvega.ai${entry.href}"`), `${entry.id} must keep its canonical URL`);
      assert.doesNotMatch(html, /name="robots" content="noindex|class="article__draft"|class="draft-label"/);
      const current = html.match(new RegExp(`<a\\b[^>]*href="/${section}/"[^>]*aria-current="location"[^>]*>`));
      assert.ok(current, `${entry.id} navigation must mark its section`);
      if (section === "writing") {
        assert.ok(html.includes(`property="article:published_time" content="${entry.data.date.toISOString()}"`));
        assert.match(html, /class="author__share"/);
        assert.ok(html.includes(`data-copy-link="https://cristianvega.ai${entry.href}" hidden`));
        const adjacent = html.match(/<nav class="read-next[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
        const hrefs = [...adjacent.matchAll(/href="([^"]+)"/g)].map(([, href]) => href);
        assert.deepEqual(hrefs, [entries[position + 1]?.href, entries[position - 1]?.href].filter(Boolean));
      } else {
        assert.ok(html.includes(`<p class="eyebrow">${escapeHtml(entry.data.status)}</p>`));
        const outbound = html.match(/<a class="product__link"[^>]*target="_blank"[^>]*>/)?.[0];
        if (entry.data.url) {
          assert.ok(outbound?.includes(`href="${escapeAttribute(entry.data.url)}"`));
          assert.match(outbound, /rel="noopener noreferrer"/);
        } else assert.equal(outbound, undefined, `${entry.id} must omit an absent outbound address`);
      }
    }
  }
}

function assertPublicationBuild(buildDirectory, inventory) {
  assertContentBuild(buildDirectory, inventory);
  assertPublishedPages(buildDirectory, inventory);
}

test("current publication keeps private drafts, routes, content, and metadata", () => {
  assertPublicationBuild(dist, readContentInventory());
});

for (const kind of ["all-draft", "mixed"]) {
  test(`${kind} publication keeps routes, ordering, content, and metadata`, { timeout: 90_000 }, async () => {
    await withContentBuild(kind, (fixture) => assertPublicationBuild(fixture.dist, fixture.inventory));
  });
}

function buildProductCapacityFixture(publishedCount) {
  return createIsolatedBuild({
    prefix: "cristianai-product-capacity-",
    async prepare(projectRoot) {
      const directory = join(projectRoot, "src", "content", "products");
      await rm(directory, { recursive: true });
      await mkdir(directory, { recursive: true });
      for (let index = 0; index < 9; index += 1) {
        const number = index + 1;
        const frontmatter = [
          "---",
          `title: Capacity product ${number}`,
          "description: Product capacity fixture.",
          `draft: ${index >= publishedCount}`,
          `order: ${number}`,
          "---",
          "",
          "Product capacity fixture.",
        ];
        await writeFile(join(directory, `capacity-product-${number}.md`), frontmatter.join("\n"));
      }
    },
  });
}

test("product routes build for eight published products and omit the ninth draft", { timeout: 90_000 }, async () => {
  const fixture = await buildProductCapacityFixture(8);
  try {
    assertPublicationBuild(fixture.dist, readContentInventory(fixture.root));
    const productRoutes = listBuiltRoutes(fixture.dist).filter((route) => route.startsWith("/products/"));
    assert.equal(productRoutes.length, 9, "the product index and eight detail pages must build");
    assert.ok(!productRoutes.includes("/products/capacity-product-9/"), "the ninth draft must stay hidden");
  } finally {
    await fixture.cleanup();
  }
});

test("product routes reject nine published products during the build", { timeout: 90_000 }, async () => {
  await assert.rejects(buildProductCapacityFixture(9), (error) => {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    assert.match(output, /9 products/);
    assert.match(output, /8 slots/);
    assert.match(output, /draft: true/);
    return true;
  });
});
