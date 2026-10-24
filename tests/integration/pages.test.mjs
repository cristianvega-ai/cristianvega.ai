import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, escapeHtml, profileLinks, readDistFile } from "../shared/node-helpers.mjs";

// Check rendered landmarks, metadata, home content, and the detail frame of the missing page.
// Publication fixtures live in publication.test.mjs. Browsers check runtime behavior.

const hasVisibleText = (pageHtml = "") => [...pageHtml.matchAll(/<[^>]*>|([^<]+)/g)]
  .some(([, text]) => text !== undefined && !/^(?:\s|&nbsp;)*$/.test(text));

const readStructuredData = (pageHtml) => {
  const structuredDataJson = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(structuredDataJson, "the homepage must include JSON-LD structured data");
  return JSON.parse(structuredDataJson)["@graph"];
};

test("the homepage renders the identity, the bio, and the profile links", () => {
  const pageHtml = readDistFile("index.html");
  assertPageBasics(pageHtml, { titleFragment: "Cristian Vega" });
  assert.match(pageHtml, /<html\b[^>]*data-page="home"/, "the home page must name its kind in data-page");

  const identityHtml = pageHtml.match(/<header class="identity[^"]*"[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(identityHtml, "the homepage must render its identity header");
  assert.match(identityHtml, /<svg class="mark mark--draw"[^>]*aria-hidden="true"/, "the identity mark must draw itself and stay decorative");
  assert.match(identityHtml, /<h1 class="identity__name">Cristian Vega<\/h1>/);
  assert.ok(hasVisibleText(identityHtml.match(/<p class="identity__role">([\s\S]*?)<\/p>/)?.[1]), "the identity must show the role");

  assert.ok(hasVisibleText(pageHtml.match(/<p class="bio[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]), "the homepage must show its bio");

  const profileListHtml = pageHtml.match(/<ul class="profile-links[^"]*"[^>]*aria-label="Profiles"[^>]*>([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(profileListHtml, "the homepage must list the profiles");
  const profileAnchors = [...profileListHtml.matchAll(/<a\b[^>]*>/g)].map(([anchorTag]) => anchorTag);
  assert.equal(profileAnchors.length, profileLinks.length, "the profile list must keep one link for each profile");
  for (const [profileIndex, profile] of profileLinks.entries()) {
    const anchorTag = profileAnchors[profileIndex];
    assert.ok(anchorTag.includes(`href="${profile.href}"`), `profile ${profile.name} must keep its address and its place`);
    assert.ok(anchorTag.includes(`aria-label="${profile.name}"`), `profile ${profile.name} must have an accessible name`);
    assert.match(anchorTag, /target="_blank"/, `profile ${profile.name} must open in a new tab`);
  }
});

test("the homepage has no header navigation, footer, or About link", () => {
  const pageHtml = readDistFile("index.html");
  assert.doesNotMatch(pageHtml, /<nav\b/, "the homepage must have no navigation menu");
  assert.doesNotMatch(pageHtml, /<footer\b/, "the homepage must have no footer");
  assert.equal((pageHtml.match(/<header\b/g) ?? []).length, 1, "the identity must be the only header");
  assert.doesNotMatch(pageHtml, /href="\/about\/?"/, "the homepage must not link to the retired About page");
  assert.doesNotMatch(pageHtml, /<canvas\b/, "the homepage must contain no canvas");
});

test("the missing page renders the detail frame, its reading star, and a link home", () => {
  const pageHtml = readDistFile("404.html");
  assertPageBasics(pageHtml, { titleFragment: "This page doesn&#39;t exist\\." });
  assert.match(pageHtml, /<html\b[^>]*data-page="error"/, "the missing page must name its kind in data-page");
  assert.match(pageHtml, /name="robots" content="noindex/, "the missing page must stay out of search results");
  assert.match(pageHtml, /<h1 class="detail__title" id="page-title"[^>]*>This page doesn&#39;t exist\.<\/h1>/);
  assert.match(pageHtml, /<a class="reading-star__link" href="\/">[\s\S]*?<span class="reading-star__label">Home<\/span>/, "the star must lead home and say so");
  const ledeHtml = pageHtml.match(/<p class="detail__lede">([\s\S]*?)<\/p>/)?.[1] ?? "";
  assert.match(ledeHtml, /<a href="\/">home page<\/a>/, "the lede must link the home page");
});

test("home and missing pages include the skip link, the focus target, metadata, and safe outbound links", () => {
  for (const pathSegments of [["index.html"], ["404.html"]]) {
    const pageHtml = readDistFile(...pathSegments);
    assertPageBasics(pageHtml);
    assert.match(pageHtml, /<body>\s*<a class="skip-link" href="#main-content">/, "the skip link must come first in the body");
    assert.match(pageHtml, /<main id="main-content" class="page" tabindex="-1">/, "the skip link target must accept programmatic focus");
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

test("home and missing pages load the two head scripts by address and add no inline script", () => {
  for (const pathSegments of [["index.html"], ["404.html"]]) {
    const pageHtml = readDistFile(...pathSegments);
    const pagePath = pathSegments.join("/");
    const headHtml = pageHtml.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
    // A classic script in the head runs before the first render. A module script would run too late.
    for (const scriptName of ["lyra-mark", "page-transitions"]) {
      const scriptTag = headHtml.match(new RegExp(`<script\\b[^>]*src="/_astro/${scriptName}\\.[\\w-]+\\.js"[^>]*>`))?.[0];
      assert.ok(scriptTag, `${pagePath} must load ${scriptName} from the head by address`);
      assert.doesNotMatch(scriptTag, /type="module"|\bdefer\b|\basync\b/, `${pagePath}: ${scriptName} must run as a classic script`);
    }
    // Match any letter case and an end tag with spaces, as an HTML parser does.
    const inlineScripts = [...pageHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)]
      .filter(([, attributes, content]) => !/\bsrc=/.test(attributes) && content.trim());
    for (const [, attributes] of inlineScripts) {
      assert.match(attributes, /type="application\/ld\+json"/, `${pagePath}: the only inline script must be structured data`);
    }
  }
});

test("home and missing pages omit Google Fonts requests and font preconnections", () => {
  for (const pathSegments of [["index.html"], ["404.html"]]) {
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
  const personRecord = readStructuredData(pageHtml).find((node) => node["@type"] === "Person");
  assert.ok(personRecord, "the structured data must describe a person");
  assert.equal(personRecord.name, "Cristian Vega", "the structured data must name the owner");
  assert.ok(typeof personRecord.jobTitle === "string" && personRecord.jobTitle.trim(), "the structured data must name the role");
  assert.ok(pageHtml.includes(`<title>${escapeHtml(personRecord.name)} · ${escapeHtml(personRecord.jobTitle)}</title>`));
  assert.ok(pageHtml.includes(`<p class="identity__role">${escapeHtml(personRecord.jobTitle)}</p>`), "the identity role must match the structured data");
  assert.deepEqual(personRecord.sameAs, profileLinks.map((profile) => profile.href), "the structured data must name the same profiles the page links");
  assert.equal(personRecord.worksFor?.["@type"], "Organization");
  assert.ok(typeof personRecord.worksFor.name === "string" && personRecord.worksFor.name.trim());
});
