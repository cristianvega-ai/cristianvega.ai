import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, contentRoutes, dist as buildDirectory, escapeAttribute, escapeHtml, homeSectionSize, homeSections, listBuiltRoutes, publishedContent, readContentInventory, sitemapPaths, withContentBuild } from "../shared/node-helpers.mjs";

// Build each publication fixture once. Check routes and rendered pages against the same independent inventory.

function assertContentBuild(buildDirectory, sourceInventory) {
  const builtRoutes = listBuiltRoutes(buildDirectory);
  const sitemapRoutes = sitemapPaths(buildDirectory);
  const expectedRoutes = ["/", ...contentRoutes(sourceInventory)].sort();
  assert.deepEqual(builtRoutes, expectedRoutes, "build routes must match published content");
  assert.deepEqual(sitemapRoutes, expectedRoutes, "sitemap routes must match published content");
  assert.equal(existsSync(join(buildDirectory, "about")), false, "the retired About route must not build");
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

// Read the link addresses inside the first element that matches a start tag and ends at the closing tag.
function linkAddresses(markup) {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(([, linkAddress]) => linkAddress);
}

function assertHomepagePublication(pageHtml, sourceInventory) {
  assert.doesNotMatch(pageHtml, /href="#"/);
  const expectedSections = homeSections(sourceInventory);
  const renderedSections = [...pageHtml.matchAll(/<section class="home-section[^"]*"[^>]*aria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.deepEqual(renderedSections.map(([, headingId]) => headingId), expectedSections.map((homeSection) => homeSection.headingId),
    "the homepage must render the published sections in page order");
  assert.equal((pageHtml.match(/<h2\b/g) ?? []).length, expectedSections.length, "the homepage must have one heading for each section");
  for (const [sectionIndex, expectedSection] of expectedSections.entries()) {
    const sectionHtml = renderedSections[sectionIndex][2];
    assert.match(sectionHtml, new RegExp(`<h2 class="home-section__label" id="${expectedSection.headingId}">${expectedSection.label}</h2>`));
    const rowTags = [...sectionHtml.matchAll(/<a class="entry-row[^"]*"[^>]*>/g)].map(([rowTag]) => rowTag);
    assert.ok(rowTags.length <= homeSectionSize, `${expectedSection.section} must show at most ${homeSectionSize} rows`);
    assert.deepEqual(rowTags.map((rowTag) => rowTag.match(/href="([^"]+)"/)[1]), expectedSection.rows.map((entry) => entry.href),
      `${expectedSection.section} must show its newest entries, newest first`);
    for (const [rowIndex, entry] of expectedSection.rows.entries()) {
      assert.ok(rowTags[rowIndex].includes(`data-morph-key="${expectedSection.section}/${entry.id}"`), `${entry.id} row must carry its transition key`);
    }
    assert.deepEqual([...sectionHtml.matchAll(/<span class="entry-row__title">([^<]*)<\/span>/g)].map(([, rowTitle]) => rowTitle),
      expectedSection.rows.map((entry) => escapeHtml(entry.data.title)), `${expectedSection.section} rows must show their titles`);
    const allLinks = [...sectionHtml.matchAll(/<a class="home-section__all" href="([^"]+)">([^<]*)<\/a>/g)];
    assert.deepEqual(allLinks.map(([, allHref, allLabel]) => [allHref, allLabel]), [[expectedSection.allHref, expectedSection.allLabel]],
      `${expectedSection.section} must end with one link to its index`);
    // A published entry that is not among the newest must not reach the homepage.
    for (const olderEntry of sourceInventory[expectedSection.section].filter((entry) => !entry.data.draft && !expectedSection.rows.includes(entry))) {
      assert.ok(!sectionHtml.includes(`href="${olderEntry.href}"`), `${olderEntry.id} is older than the newest ${homeSectionSize} and must stay off the homepage`);
    }
  }
  for (const homeSection of [{ section: "products", allHref: "/products/" }, { section: "writing", allHref: "/writing/" }]) {
    if (!expectedSections.some((expectedSection) => expectedSection.section === homeSection.section)) {
      assert.ok(!pageHtml.includes(`href="${homeSection.allHref}"`), `${homeSection.section} must not link to an absent index`);
    }
  }
}

// Check what every detail page of the kind shares: the kind, the star back to its parent, and the indexing state.
function assertDetailFrame(pageHtml, { kind, parentHref, parentLabel, label }) {
  assertPageBasics(pageHtml);
  assert.match(pageHtml, new RegExp(`<html\\b[^>]*data-page="${kind}"`), `${label} must name its kind in data-page`);
  assert.match(pageHtml, new RegExp(`<a class="reading-star__link" href="${parentHref}">[\\s\\S]*?<span class="reading-star__label">${parentLabel}</span>`), `${label} star must lead to ${parentLabel}`);
  assert.doesNotMatch(pageHtml, /name="robots" content="noindex|class="detail__draft"|class="entry-row__draft"/, `${label} must carry no draft marks`);
}

function assertPublishedPages(buildDirectory, sourceInventory) {
  const readBuiltPage = (...segments) => readFileSync(join(buildDirectory, ...segments), "utf8");
  const publishedEntries = publishedContent(sourceInventory);
  assertHomepagePublication(readBuiltPage("index.html"), sourceInventory);
  for (const [section, entries] of Object.entries(publishedEntries)) {
    if (!entries.length) continue;
    const sectionIndexHtml = readBuiltPage(section, "index.html");
    assertDetailFrame(sectionIndexHtml, { kind: section, parentHref: "/", parentLabel: "Home", label: `${section} index` });
    assert.deepEqual(linkAddresses(sectionIndexHtml.match(/<div class="detail__body">([\s\S]*)<\/div>/)[1]), entries.map((entry) => entry.href),
      `${section} list must follow its content order`);
    for (const draftEntry of sourceInventory[section].filter((entry) => entry.data.draft)) {
      assert.ok(!sectionIndexHtml.includes(`href="${draftEntry.href}"`), `${draftEntry.id} draft must stay out of the index`);
    }
    if (section === "writing") {
      // The index groups articles under year headings, newest year first.
      const expectedYears = [...new Set(entries.map((entry) => entry.data.date.getUTCFullYear()))];
      assert.deepEqual([...sectionIndexHtml.matchAll(/<h2 class="detail__section-label" id="writing-\d+">(\d+)<\/h2>/g)].map(([, year]) => Number(year)), expectedYears);
    }
    for (const [entryIndex, entry] of entries.entries()) {
      const pageHtml = readBuiltPage(section, entry.id, "index.html");
      const detailKind = section === "writing" ? "article" : "product";
      assertDetailFrame(pageHtml, { kind: detailKind, parentHref: `/${section}/`, parentLabel: section === "writing" ? "Writing" : "Products", label: entry.id });
      assert.ok(pageHtml.includes(`data-morph-key="${section}/${entry.id}"`), `${entry.id} must carry the transition key of its row`);
      assert.ok(pageHtml.includes(`data-morph-title>${escapeHtml(entry.data.title)}</h1>`), `${entry.id} must show its title`);
      assert.ok(pageHtml.includes(`name="description" content="${escapeAttribute(entry.data.description)}"`), `${entry.id} must keep its description`);
      assert.ok(pageHtml.includes(`<p class="detail__lede">${escapeHtml(entry.data.description)}</p>`), `${entry.id} must show its description as the lede`);
      assert.ok(pageHtml.includes(`rel="canonical" href="https://cristianvega.ai${entry.href}"`), `${entry.id} must keep its canonical URL`);
      if (section === "writing") {
        assert.ok(pageHtml.includes(`property="article:published_time" content="${entry.data.date.toISOString()}"`));
        assert.match(pageHtml, /<div class="article__share">/, `${entry.id} must offer sharing`);
        assert.ok(pageHtml.includes(`data-copy-link="https://cristianvega.ai${entry.href}" hidden`));
        const shareAnchors = [...pageHtml.matchAll(/<a\b[^>]*aria-label="(Share on [^"]+)"[^>]*>/g)];
        assert.deepEqual(shareAnchors.map(([, shareName]) => shareName), ["Share on LinkedIn", "Share on X"]);
        for (const [shareTag] of shareAnchors) assert.match(shareTag, /rel="noopener noreferrer"/);
        // The star reads "More writing" newest first: the newer neighbour, then the older one.
        const moreWritingHtml = pageHtml.match(/<nav class="detail__section" aria-labelledby="more-writing">([\s\S]*?)<\/nav>/)?.[1] ?? "";
        assert.deepEqual(linkAddresses(moreWritingHtml), [entries[entryIndex - 1]?.href, entries[entryIndex + 1]?.href].filter(Boolean),
          `${entry.id} must link its newer and older neighbours`);
      } else {
        assert.ok(pageHtml.includes(`<p class="detail__meta">${escapeHtml(entry.data.status)}</p>`), `${entry.id} must show its status or Product`);
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

// The crowded fixture holds six published entries in each section, so the homepage must cut two of them.
for (const fixtureKind of ["all-draft", "mixed", "crowded"]) {
  test(`the ${fixtureKind} publication build preserves routes, content order, rendered content, and metadata`, { timeout: 90_000 }, async () => {
    await withContentBuild(fixtureKind, (fixture) => {
      assertPublicationBuild(fixture.dist, fixture.inventory);
      if (fixtureKind === "crowded") {
        for (const homeSection of homeSections(fixture.inventory)) {
          assert.equal(homeSection.rows.length, homeSectionSize, `${homeSection.section} must fill its section`);
          assert.ok(publishedContent(fixture.inventory)[homeSection.section].length > homeSectionSize, `${homeSection.section} must hold more entries than the section shows`);
        }
      }
    });
  });
}
