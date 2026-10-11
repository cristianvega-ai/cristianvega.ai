import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, contentRoutes, createIsolatedBuild, dist as buildDirectory, escapeAttribute, escapeHtml, headerLinks, latestWork, listBuiltRoutes, publishedContent, readContentInventory, sitemapPaths, withContentBuild } from "../shared/node-helpers.mjs";

// Build each publication fixture once. Check routes and rendered pages against the same independent inventory.

function assertContentBuild(buildDirectory, sourceInventory) {
  const builtRoutes = listBuiltRoutes(buildDirectory);
  const sitemapRoutes = sitemapPaths(buildDirectory);
  const expectedRoutes = ["/", "/about/", ...contentRoutes(sourceInventory)].sort();
  assert.deepEqual(builtRoutes, expectedRoutes, "build routes must match published content");
  assert.deepEqual(sitemapRoutes, expectedRoutes, "sitemap routes must match published content");
  const homepageHtml = readFileSync(join(buildDirectory, "index.html"), "utf8");
  for (const [section, entries] of Object.entries(sourceInventory)) {
    const publishedEntries = entries.filter((entry) => !entry.data.draft);
    assert.equal(existsSync(join(buildDirectory, section, "index.html")), publishedEntries.length > 0, `${section} index must follow visibility`);
    assert.equal(homepageHtml.includes(`href="/${section}/"`), publishedEntries.length > 0, `${section} homepage links must follow visibility`);
    for (const entry of entries.filter((entry) => entry.data.draft)) {
      assert.equal(existsSync(join(buildDirectory, section, entry.id)), false, `${entry.id} draft route must be absent`);
      assert.ok(!sitemapRoutes.includes(entry.href), `${entry.id} draft must stay out of the sitemap`);
      assert.ok(!homepageHtml.includes(`href="${entry.href}"`), `${entry.id} draft link must stay off the homepage`);
    }
  }
}

function assertPublicationNavigation(pageHtml, sourceInventory) {
  const expectedRoutes = headerLinks(sourceInventory).map((link) => link.href).filter((linkAddress) => linkAddress.startsWith("/"));
  for (const navigationLabel of ["Primary", "Menu"]) {
    const navigationHtml = pageHtml.match(new RegExp(`<nav\\b[^>]*aria-label="${navigationLabel}"[\\s\\S]*?</nav>`))?.[0];
    assert.ok(navigationHtml, `${navigationLabel} navigation must exist`);
    const internalLinkAddresses = [...navigationHtml.matchAll(/<a\b[^>]*href="(\/[^\"]*)"/g)].map(([, linkAddress]) => linkAddress);
    assert.deepEqual(internalLinkAddresses, expectedRoutes, `${navigationLabel} navigation must follow publication`);
  }
}

function assertHomepagePublication(pageHtml, sourceInventory) {
  assert.equal((pageHtml.match(/<h2\b/g) ?? []).length, 0, "the homepage must contain no section heading");
  assert.doesNotMatch(pageHtml, /href="#"/);
  const actionListHtml = pageHtml.match(/<ul class="hero__next"[^>]*>[\s\S]*?<\/ul>/)?.[0];
  assert.ok(actionListHtml, "the homepage must contain its calls to action");
  const actionItems = [...actionListHtml.matchAll(/<li class="hero__next-item" data-state="(\w+)">([\s\S]*?)<\/li>/g)];
  assert.equal(actionItems.length, 2, "the homepage must contain two calls to action");
  const publishedEntries = publishedContent(sourceInventory);
  for (const [actionIndex, expectedAction] of latestWork.entries()) {
    const sectionIsPublished = publishedEntries[expectedAction.section].length > 0;
    assert.equal(actionItems[actionIndex][1], sectionIsPublished ? "live" : "soon", `${expectedAction.section} state must follow publication`);
    if (sectionIsPublished) {
      assert.ok(actionItems[actionIndex][2].includes(`href="${expectedAction.href}"`), `${expectedAction.section} must link to its index`);
      assert.ok(actionItems[actionIndex][2].includes(expectedAction.label), `${expectedAction.section} link must keep its label`);
      assert.match(actionItems[actionIndex][2], /class="hero__next-arrow" aria-hidden="true">→<\/span>/);
    } else {
      assert.equal(actionItems[actionIndex][2], `<span class="hero__next-soon">${expectedAction.soon}</span>`);
      assert.doesNotMatch(actionItems[actionIndex][2], /<a\b|href=|tabindex/, "coming-soon text must not take focus");
      assert.ok(!pageHtml.includes(`href="${expectedAction.href}"`), `${expectedAction.section} must not link to an absent index`);
    }
  }
  assertPublicationNavigation(pageHtml, sourceInventory);
}

function assertPublishedPages(buildDirectory, sourceInventory) {
  const readBuiltPage = (...segments) => readFileSync(join(buildDirectory, ...segments), "utf8");
  const publishedEntries = publishedContent(sourceInventory);
  assertHomepagePublication(readBuiltPage("index.html"), sourceInventory);
  for (const [section, entries] of Object.entries(publishedEntries)) {
    if (!entries.length) continue;
    const sectionIndexHtml = readBuiltPage(section, "index.html");
    assertPageBasics(sectionIndexHtml);
    assertPublicationNavigation(sectionIndexHtml, sourceInventory);
    assert.doesNotMatch(sectionIndexHtml, /name="robots" content="noindex|class="draft-label"|local preview/i);
    const identifierAttribute = section === "writing" ? "data-article-identifier" : "data-product-identifier";
    const listedIdentifiers = [...sectionIndexHtml.matchAll(new RegExp(`<li\\b[^>]*${identifierAttribute}="([^"]+)"`, "g"))].map(([, entryIdentifier]) => entryIdentifier);
    assert.deepEqual(listedIdentifiers, entries.map((entry) => entry.id), `${section} list must follow its content order`);
    for (const draftEntry of sourceInventory[section].filter((entry) => entry.data.draft)) {
      assert.ok(!sectionIndexHtml.includes(`href="${draftEntry.href}"`), `${draftEntry.id} draft must stay out of the index`);
    }
    for (const [entryIndex, entry] of entries.entries()) {
      const pageHtml = readBuiltPage(section, entry.id, "index.html");
      assertPageBasics(pageHtml);
      assertPublicationNavigation(pageHtml, sourceInventory);
      assert.ok(pageHtml.includes(`>${escapeHtml(entry.data.title)}</h1>`), `${entry.id} must show its title`);
      assert.ok(pageHtml.includes(`name="description" content="${escapeAttribute(entry.data.description)}"`), `${entry.id} must keep its description`);
      assert.ok(pageHtml.includes(`rel="canonical" href="https://cristianvega.ai${entry.href}"`), `${entry.id} must keep its canonical URL`);
      assert.doesNotMatch(pageHtml, /name="robots" content="noindex|class="article__draft"|class="draft-label"/);
      const currentSectionLink = pageHtml.match(new RegExp(`<a\\b[^>]*href="/${section}/"[^>]*aria-current="location"[^>]*>`));
      assert.ok(currentSectionLink, `${entry.id} navigation must mark its section`);
      if (section === "writing") {
        assert.ok(pageHtml.includes(`property="article:published_time" content="${entry.data.date.toISOString()}"`));
        assert.match(pageHtml, /class="author__share"/);
        assert.ok(pageHtml.includes(`data-copy-link="https://cristianvega.ai${entry.href}" hidden`));
        const adjacentNavigationHtml = pageHtml.match(/<nav class="read-next[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
        const adjacentLinkAddresses = [...adjacentNavigationHtml.matchAll(/href="([^"]+)"/g)].map(([, linkAddress]) => linkAddress);
        assert.deepEqual(adjacentLinkAddresses, [entries[entryIndex + 1]?.href, entries[entryIndex - 1]?.href].filter(Boolean));
      } else {
        assert.ok(pageHtml.includes(`<p class="eyebrow">${escapeHtml(entry.data.status)}</p>`));
        const outboundLink = pageHtml.match(/<a class="product__link"[^>]*target="_blank"[^>]*>/)?.[0];
        if (entry.data.url) {
          assert.ok(outboundLink?.includes(`href="${escapeAttribute(entry.data.url)}"`));
          assert.match(outboundLink, /rel="noopener noreferrer"/);
        } else assert.equal(outboundLink, undefined, `${entry.id} must omit an absent outbound address`);
      }
    }
  }
}

function assertPublicationBuild(buildDirectory, sourceInventory) {
  assertContentBuild(buildDirectory, sourceInventory);
  assertPublishedPages(buildDirectory, sourceInventory);
}

test("the current production build excludes drafts and preserves published routes, content, and metadata", () => {
  assertPublicationBuild(buildDirectory, readContentInventory());
});

for (const fixtureKind of ["all-draft", "mixed"]) {
  test(`the ${fixtureKind} publication build preserves routes, content order, rendered content, and metadata`, { timeout: 90_000 }, async () => {
    await withContentBuild(fixtureKind, (fixture) => assertPublicationBuild(fixture.dist, fixture.inventory));
  });
}

function buildProductCapacityFixture(publishedProductCount) {
  return createIsolatedBuild({
    prefix: "cristianai-product-capacity-",
    async prepare(projectRoot) {
      const contentDirectory = join(projectRoot, "src", "content", "products");
      await rm(contentDirectory, { recursive: true });
      await mkdir(contentDirectory, { recursive: true });
      for (let productIndex = 0; productIndex < 9; productIndex += 1) {
        const productNumber = productIndex + 1;
        const frontmatterLines = [
          "---",
          `title: Capacity product ${productNumber}`,
          "description: Product capacity fixture.",
          `draft: ${productIndex >= publishedProductCount}`,
          `order: ${productNumber}`,
          "---",
          "",
          "Product capacity fixture.",
        ];
        await writeFile(join(contentDirectory, `capacity-product-${productNumber}.md`), frontmatterLines.join("\n"));
      }
    },
  });
}

test("the production build creates routes for eight published products and excludes the ninth draft", { timeout: 90_000 }, async () => {
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

test("the production build rejects nine published products with a capacity error", { timeout: 90_000 }, async () => {
  await assert.rejects(buildProductCapacityFixture(9), (error) => {
    const buildOutput = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    assert.match(buildOutput, /9 products/);
    assert.match(buildOutput, /8 slots/);
    assert.match(buildOutput, /draft: true/);
    return true;
  });
});
