import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, escapeHtml, publishedContent, readContentInventory, readDistFile } from "../shared/helpers.mjs";

// Check rendered landmarks, metadata, navigation, and asset delivery.
// Publication fixtures live in publication.test.mjs. Browsers check runtime behavior.

const visibleText = (html = "") => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

test("about holds the profile and marks its own navigation link", () => {
  const html = readDistFile("about", "index.html");
  assertPageBasics(html, { titleFragment: "About · Cristian Vega" });
  assert.match(html, /rel="canonical" href="https:\/\/cristianvega\.ai\/about\/"/);
  assert.match(html, /href="\/about\/" aria-current="page"/);
  assert.match(html, /class="skip-link"[^>]*href="#main-content"/);
  assert.match(html, /data-graphic="about" aria-hidden="true"/, "the About graphic must be decorative");
  assert.doesNotMatch(html, /name="robots" content="noindex/);

  assert.match(html, /<article\b[^>]*aria-labelledby="about-title"/);
  assert.match(html, /<h1\b[^>]*id="about-title"[^>]*>Cristian <span[^>]*>Vega<\/span><\/h1>/);
  const introduction = html.match(/<p class="about__lede">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(visibleText(introduction), "about must show its introduction");
  const profile = html.match(/<div class="about__profile">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(profile, "about must render the profile");
  const paragraphs = [...profile.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)];
  assert.ok(paragraphs.length > 0 && paragraphs.every(([, content]) => visibleText(content)), "the profile must contain readable paragraphs");
  const principles = profile.match(/<ul class="about__principles">([\s\S]*?)<\/ul>/)?.[1];
  const items = [...(principles ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)];
  assert.ok(items.length > 0 && items.every(([, content]) => visibleText(content)), "the profile must list nonempty principles");
});

test("homepage holds the intro and decorative globe", () => {
  const html = readDistFile("index.html");
  const text = html.replace(/\s+/g, " ");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });
  assert.match(html, /<h1 id="home-title" class="hero__name">Cristian <span class="highlight">Vega<\/span><\/h1>/);
  for (const name of ["lede", "thesis"]) {
    const paragraph = text.match(new RegExp(`<p class="hero__${name}">([\\s\\S]*?)</p>`))?.[1];
    assert.ok(visibleText(paragraph), `the homepage must show its ${name}`);
  }

  const globe = html.match(/<div class="lyra-globe"[^>]*>/)?.[0];
  assert.ok(globe, "the homepage must contain its globe");
  assert.match(globe, /aria-hidden="true"/, "the globe must be decorative");
});

test("navigation follows published content and keeps profile links", () => {
  const published = publishedContent(readContentInventory());
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

});

test("the header keeps one primary nav and a menu with the same links", () => {
  const links = (nav) => [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map(([, href]) => href);
  for (const segments of [["index.html"], ["about", "index.html"], ["404.html"]]) {
    const html = readDistFile(...segments);
    assert.equal((html.match(/<nav\b[^>]*aria-label="Primary"/g) ?? []).length, 1);
    assert.equal((html.match(/<details class="navigation-menu">/g) ?? []).length, 1);
    assert.match(html, /<nav class="navigation-menu__panel" aria-label="Menu">/);
    const primary = html.match(/<nav\b[^>]*aria-label="Primary"[\s\S]*?<\/nav>/i)?.[0];
    const menu = html.match(/<details class="navigation-menu">[\s\S]*?<\/details>/i)?.[0];
    assert.ok(primary && menu, "primary navigation and menu required");
    assert.match(menu, /<summary class="navigation-menu__toggle">menu<\/summary>/);
    assert.deepEqual(links(menu), links(primary), "the menu must reach every primary navigation link");
  }
});

test("key pages share accessibility and SEO basics", () => {
  const pages = [
    ["index.html"],
    ["about", "index.html"],
    ["404.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    assertPageBasics(html);
    assert.match(html, /class="skip-link"[^>]*href="#main-content"/i, "skip link required");
    assert.match(html, /id="main-content"/i, "skip target required");
    assert.match(
      html,
      /property="og:image"[^>]*content="https:\/\/cristianvega\.ai\/images\/cristian-vega-social-preview\.jpg"/i,
    );
    assert.match(html, /property="og:image:alt"/i);
    // Each external link must protect the opener and referrer.
    const blankLinks = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)];
    for (const [tag] of blankLinks) {
      assert.match(tag, /\brel="/i, `target=_blank without rel: ${tag}`);
      assert.match(tag, /noopener/i, `target=_blank missing noopener: ${tag}`);
      assert.match(tag, /noreferrer/i, `target=_blank missing noreferrer: ${tag}`);
    }
  }
});

test("pages do not load fonts from Google", () => {
  const pages = [
    ["index.html"],
    ["about", "index.html"],
    ["404.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    const name = segments.join("/");
    assert.doesNotMatch(
      html,
      /fonts\.googleapis\.com|fonts\.gstatic\.com/,
      `${name} must not request Google Fonts`,
    );
    assert.doesNotMatch(
      html,
      /preconnect[^>]+fonts\./i,
      `${name} must not preconnect to a font CDN`,
    );
  }
});

// Search engines and link previews take the role from the page title and the
// structured data, not from the profile. When the role changes, both change.
test("the homepage title and structured data name the current role", () => {
  const html = readDistFile("index.html");

  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, "the homepage must ship JSON-LD structured data");
  const person = JSON.parse(json)["@graph"].find((node) => node["@type"] === "Person");
  assert.ok(person, "the structured data must describe a person");
  assert.equal(person.name, "Cristian Vega", "the structured data must name the owner");
  assert.ok(typeof person.jobTitle === "string" && person.jobTitle.trim(), "the structured data must name the role");
  assert.ok(html.includes(`<title>${escapeHtml(person.name)} · ${escapeHtml(person.jobTitle)}</title>`));
  assert.ok(html.includes(`<span class="eyebrow__part">${escapeHtml(person.jobTitle)}</span>`));
  assert.equal(person.worksFor?.["@type"], "Organization");
  assert.ok(typeof person.worksFor.name === "string" && person.worksFor.name.trim());
});
