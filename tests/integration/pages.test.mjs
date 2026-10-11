import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, escapeHtml, publishedContent, readContentInventory, readDistFile } from "../shared/node-helpers.mjs";

// Check rendered landmarks, metadata, navigation, and asset delivery.
// Publication fixtures live in publication.test.mjs. Browsers check runtime behavior.

const visibleText = (pageHtml = "") => pageHtml.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

test("the About page renders readable profile content and marks its current navigation link", () => {
  const pageHtml = readDistFile("about", "index.html");
  assertPageBasics(pageHtml, { titleFragment: "About · Cristian Vega" });
  assert.match(pageHtml, /rel="canonical" href="https:\/\/cristianvega\.ai\/about\/"/);
  assert.match(pageHtml, /href="\/about\/" aria-current="page"/);
  assert.match(pageHtml, /class="skip-link"[^>]*href="#main-content"/);
  assert.match(pageHtml, /data-graphic="about" aria-hidden="true"/, "the About graphic must be decorative");
  assert.doesNotMatch(pageHtml, /name="robots" content="noindex/);

  assert.match(pageHtml, /<article\b[^>]*aria-labelledby="about-title"/);
  assert.match(pageHtml, /<h1\b[^>]*id="about-title"[^>]*>Cristian <span[^>]*>Vega<\/span><\/h1>/);
  const introduction = pageHtml.match(/<p class="about__lede">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(visibleText(introduction), "about must show its introduction");
  const profileHtml = pageHtml.match(/<div class="about__profile">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(profileHtml, "about must render the profile");
  const profileParagraphs = [...profileHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)];
  assert.ok(profileParagraphs.length > 0 && profileParagraphs.every(([, content]) => visibleText(content)), "the profile must contain readable paragraphs");
  const principlesHtml = profileHtml.match(/<ul class="about__principles">([\s\S]*?)<\/ul>/)?.[1];
  const principleItems = [...(principlesHtml ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)];
  assert.ok(principleItems.length > 0 && principleItems.every(([, content]) => visibleText(content)), "the profile must list nonempty principles");
});

test("the homepage renders introduction text and marks its globe as decorative", () => {
  const pageHtml = readDistFile("index.html");
  const normalizedHtml = pageHtml.replace(/\s+/g, " ");

  assertPageBasics(pageHtml, { titleFragment: "Cristian Vega" });
  assert.match(pageHtml, /<h1 id="home-title" class="hero__name">Cristian <span class="highlight">Vega<\/span><\/h1>/);
  for (const paragraphName of ["lede", "thesis"]) {
    const paragraph = normalizedHtml.match(new RegExp(`<p class="hero__${paragraphName}">([\\s\\S]*?)</p>`))?.[1];
    assert.ok(visibleText(paragraph), `the homepage must show its ${paragraphName}`);
  }

  const globeElement = pageHtml.match(/<div class="lyra-globe"[^>]*>/)?.[0];
  assert.ok(globeElement, "the homepage must contain its globe");
  assert.match(globeElement, /aria-hidden="true"/, "the globe must be decorative");
});

test("primary navigation includes published sections and preserves all profile links", () => {
  const publishedEntries = publishedContent(readContentInventory());
  const homepageHtml = readDistFile("index.html");
  const navigationHtml = homepageHtml.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
  assert.ok(navigationHtml, "the homepage must contain primary navigation");

  const navigationAnchors = [...navigationHtml.matchAll(/<a\b[^>]*>/gi)].map(([anchorTag]) => anchorTag);
  const publishedSections = Object.keys(publishedEntries).filter((section) => publishedEntries[section].length > 0);
  assert.equal(navigationAnchors.length, 4 + publishedSections.length, `navigation must match published sections: ${navigationHtml}`);
  const aboutLinks = navigationAnchors.filter((anchorTag) => /href="\/about\/"/.test(anchorTag));
  assert.equal(aboutLinks.length, 1, "navigation must link to About exactly once");
  assert.doesNotMatch(aboutLinks[0], /target=/, "the About link must open in the current tab");
  for (const section of Object.keys(publishedEntries)) {
    const sectionLinks = navigationAnchors.filter((anchorTag) => anchorTag.includes(`href="/${section}/"`));
    assert.equal(sectionLinks.length, publishedEntries[section].length > 0 ? 1 : 0, `${section} navigation must match publication`);
    for (const anchorTag of sectionLinks) assert.doesNotMatch(anchorTag, /target=/, `${section} must open in the current tab`);
  }
  const outboundLinks = navigationAnchors.filter((anchorTag) => /href="https:\/\//.test(anchorTag));
  assert.equal(outboundLinks.length, 3, "navigation must keep all three profile links");

  for (const profileHost of ["linkedin.com", "x.com", "github.com"]) {
    assert.ok(
      navigationAnchors.some((anchorTag) => anchorTag.includes(profileHost)),
      `navigation must link ${profileHost}`,
    );
  }

});

test("each page header renders one primary navigation and a menu with matching links", () => {
  const navigationLinkAddresses = (navigationHtml) => [...navigationHtml.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map(([, linkAddress]) => linkAddress);
  for (const pathSegments of [["index.html"], ["about", "index.html"], ["404.html"]]) {
    const pageHtml = readDistFile(...pathSegments);
    assert.equal((pageHtml.match(/<nav\b[^>]*aria-label="Primary"/g) ?? []).length, 1);
    assert.equal((pageHtml.match(/<details class="navigation-menu">/g) ?? []).length, 1);
    assert.match(pageHtml, /<nav class="navigation-menu__panel" aria-label="Menu">/);
    const primaryNavigationHtml = pageHtml.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
    const menuHtml = pageHtml.match(/<details class="navigation-menu">[\s\S]*?<\/details>/i)?.[0];
    assert.ok(primaryNavigationHtml && menuHtml, "each page header must contain primary navigation and the menu");
    assert.match(menuHtml, /<summary class="navigation-menu__toggle">menu<\/summary>/);
    assert.deepEqual(navigationLinkAddresses(menuHtml), navigationLinkAddresses(primaryNavigationHtml), "the menu must reach every primary navigation link");
  }
});

test("home, About, and missing pages include accessibility landmarks, metadata, and safe outbound links", () => {
  const pagePaths = [
    ["index.html"],
    ["about", "index.html"],
    ["404.html"],
  ];

  for (const pathSegments of pagePaths) {
    const pageHtml = readDistFile(...pathSegments);
    assertPageBasics(pageHtml);
    assert.match(pageHtml, /class="skip-link"[^>]*href="#main-content"/i, "each page must include a skip link");
    assert.match(pageHtml, /id="main-content"/i, "each page must include the skip-link target");
    assert.match(
      pageHtml,
      /property="og:image"[^>]*content="https:\/\/cristianvega\.ai\/images\/cristian-vega-social-preview\.jpg"/i,
    );
    assert.match(pageHtml, /property="og:image:alt"/i);
    // Each external link must protect the opener and referrer.
    const newTabLinks = [...pageHtml.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)];
    for (const [anchorTag] of newTabLinks) {
      assert.match(anchorTag, /\brel="/i, `external link ${anchorTag} must include a rel attribute`);
      assert.match(anchorTag, /noopener/i, `external link ${anchorTag} must include noopener`);
      assert.match(anchorTag, /noreferrer/i, `external link ${anchorTag} must include noreferrer`);
    }
  }
});

test("home, About, and missing pages omit Google Fonts requests and font preconnections", () => {
  const pagePaths = [
    ["index.html"],
    ["about", "index.html"],
    ["404.html"],
  ];

  for (const pathSegments of pagePaths) {
    const pageHtml = readDistFile(...pathSegments);
    const pagePath = pathSegments.join("/");
    assert.doesNotMatch(
      pageHtml,
      /fonts\.googleapis\.com|fonts\.gstatic\.com/,
      `${pagePath} must not request Google Fonts`,
    );
    assert.doesNotMatch(
      pageHtml,
      /preconnect[^>]+fonts\./i,
      `${pagePath} must not preconnect to a font delivery host`,
    );
  }
});

// Keep the homepage title and structured data consistent with the rendered role.
test("the homepage title and structured data name the current role", () => {
  const pageHtml = readDistFile("index.html");

  const structuredDataJson = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(structuredDataJson, "the homepage must include JSON-LD structured data");
  const personRecord = JSON.parse(structuredDataJson)["@graph"].find((node) => node["@type"] === "Person");
  assert.ok(personRecord, "the structured data must describe a person");
  assert.equal(personRecord.name, "Cristian Vega", "the structured data must name the owner");
  assert.ok(typeof personRecord.jobTitle === "string" && personRecord.jobTitle.trim(), "the structured data must name the role");
  assert.ok(pageHtml.includes(`<title>${escapeHtml(personRecord.name)} · ${escapeHtml(personRecord.jobTitle)}</title>`));
  assert.ok(pageHtml.includes(`<span class="eyebrow__part">${escapeHtml(personRecord.jobTitle)}</span>`));
  assert.equal(personRecord.worksFor?.["@type"], "Organization");
  assert.ok(typeof personRecord.worksFor.name === "string" && personRecord.worksFor.name.trim());
});
