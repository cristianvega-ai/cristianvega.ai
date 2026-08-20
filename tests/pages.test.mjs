import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile } from "./helpers.mjs";

// What each rendered page must say, and the contracts every page shares:
// accessibility landmarks, SEO metadata, navigation state, and truthful links.
// Hero motion belongs to tests/hero-motion.test.mjs, even on the homepage.

test("homepage keeps the portfolio theme and links to the writing index", () => {
  const html = readDistFile("index.html");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });
  assert.match(html, /where mistakes are expensive/);

  // The profile is the page. It replaced a separate About page, so the words
  // must be in the served HTML, not assembled by script after load.
  assert.match(html, /class="[^"]*hero__profile[^"]*"/);
  assert.match(html, /Ten years building software, five building AI from the ground up/);
  assert.match(html, /founded the AI engineering function/);
  assert.match(html, /architected the Agent Platform/);
  assert.match(html, /45-person AI engineering organization/);
  assert.match(html, /BBVA/);

  // The hero holds copy only now. A stray button would re-enter the motion
  // choreography, which no longer has a window for one.
  assert.doesNotMatch(html, /data-motion-target="(primary|secondary)-action"/);
  assert.doesNotMatch(html, /class="[^"]*hero__actions[^"]*"/);
  // Hero copy must remain in HTML. Pre-hide is gated on a head-stamped attribute
  // (not html.js), so no-JS never blanks the copy.
  assert.match(html, /class="[^"]*hero__name[^"]*"/);
  assert.match(html, /class="[^"]*hero__sub[^"]*"/);
  assert.doesNotMatch(html, /html\.js|classList\.add\(["']js["']\)/);
  assert.match(html, /data-hero-motion-pending/);
});

test("writing index includes generated post links", () => {
  const html = readDistFile("writing", "index.html");

  assertPageBasics(html);
  assert.match(html, /From BERT to agents/);
  assert.match(html, /href="\/posts\/from-bert-to-agents\/"/);
  // Machine and human dates are both rendered, zero-padded and UTC-pinned.
  assert.match(html, /<time[^>]*datetime="2026-02-27"[^>]*>2026\.02<\/time>/);
});

test("post pages are generated from markdown content", () => {
  const html = readDistFile("posts", "from-bert-to-agents", "index.html");

  assertPageBasics(html);
  assert.match(html, /From BERT to agents/);
  assert.match(html, /400K\+ data points/);
  assert.match(html, /Cristian Vega/);

  // The byline date must render in UTC, not the builder's local day.
  assert.match(html, /<time[^>]*datetime="2026-06-12"[^>]*>June 12, 2026<\/time>/);

  // updatedDate is consumed: visible meta and the Open Graph article times.
  // The sitemap no longer carries it; see the withheld-routes test below.
  assert.match(html, /Updated\s*<time[^>]*datetime="2026-07-01"/);
  assert.match(html, /property="og:type"\s+content="article"/);
  assert.match(html, /property="article:published_time"\s+content="2026-06-12T/);
  assert.match(html, /property="article:modified_time"\s+content="2026-07-01T/);
});

test("projects page lists portfolio work with truthful destinations", () => {
  const html = readDistFile("projects", "index.html");

  assertPageBasics(html, { titleFragment: "Projects" });
  assert.match(html, /DocSieve/);
  assert.match(html, /PromptRunner/);
  assert.match(html, /Ledgerbot/);

  // Cards are the page's top-level sections: h1 then h2 (no skipped level).
  assert.match(html, /<h1\b[^>]*class="[^"]*page-title/);
  assert.match(html, /<h2\b[^>]*class="[^"]*project__name/);
  assert.doesNotMatch(html, /<h3\b/i);

  // Unavailable work is labeled explicitly rather than omitted.
  assert.match(html, /project__availability/);
  assert.match(html, /Private demo|not public yet|no public write-up/i);

  // "Read the build" must not be a stand-in for the generic writing archive.
  const readBuildToWriting =
    /Read the build[\s\S]{0,80}href="\/writing\/"|href="\/writing\/"[\s\S]{0,80}Read the build/i;
  assert.doesNotMatch(html, readBuildToWriting);

  // Scan the rendered cards themselves, so the guard runs against real markup
  // instead of a class name no card currently emits. Every card must either
  // carry a credible destination or say in words that there is none.
  const cards = [...html.matchAll(/<article\b[^>]*class="[^"]*\bproject\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)];
  assert.ok(cards.length >= 3, `expected rendered project cards, found ${cards.length}`);

  const fakeDestinations = new Set(["/", "/writing/", "#", ""]);
  for (const [, card] of cards) {
    const anchors = [...card.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => tag);
    assert.ok(
      anchors.length > 0 || /class="[^"]*project__availability[^"]*"/i.test(card),
      "a card without a destination must state availability in words",
    );

    for (const tag of anchors) {
      const href = tag.match(/\bhref="([^"]*)"/i)?.[1]?.trim();
      assert.ok(href, `project link missing href: ${tag}`);
      assert.ok(
        !fakeDestinations.has(href),
        `project cards must not use ${href} as a fake case-study destination: ${tag}`,
      );
    }
  }
});

test("key pages share accessibility and SEO basics", () => {
  const pages = [
    ["index.html"],
    ["writing", "index.html"],
    ["projects", "index.html"],
    ["posts", "from-bert-to-agents", "index.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    assertPageBasics(html);
    assert.match(html, /class="skip-link"[^>]*href="#main-content"/i, "skip link required");
    assert.match(html, /id="main-content"/i, "skip target required");
    assert.match(
      html,
      /property="og:image"[^>]*content="https:\/\/cristianvega\.ai\/images\/cristian-vega-og\.jpg"/i,
    );
    assert.match(html, /property="og:image:width"[^>]*content="1200"/i);
    assert.match(html, /property="og:image:height"[^>]*content="630"/i);
    assert.match(html, /property="og:image:alt"/i);
    assert.match(html, /name="twitter:card"[^>]*content="summary_large_image"/i);
    // External new-tab links should include a safe rel.
    const blankLinks = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)];
    for (const [tag] of blankLinks) {
      assert.match(tag, /\brel="/i, `target=_blank without rel: ${tag}`);
      assert.match(tag, /noopener/i, `target=_blank missing noopener: ${tag}`);
    }
  }
});

test("the retired pages are gone from the build", () => {
  // About and contact were public and indexed. The build must not emit them,
  // and .htaccess must send both URLs to the home page. A stale page in dist/
  // would be uploaded and would outrank the redirect.
  assert.equal(existsSync(join(dist, "about", "index.html")), false, "about page must be gone");
  assert.equal(existsSync(join(dist, "contact", "index.html")), false, "contact page must be gone");

  const htaccess = readDistFile(".htaccess");
  assert.match(htaccess, /RewriteRule \^about\/\?\$ \/ \[L,R=301\]/);
  assert.match(htaccess, /RewriteRule \^contact\/\?\$ \/ \[L,R=301\]/);
});

// The share card is the load-bearing derivative: the og:image URL asserted
// above is a promise the build has to keep. A missing file there breaks link
// previews everywhere without breaking a page. The About-strip files have no
// consumer and must not enter dist/.
test("the share card ships and the unused portrait strip does not", () => {
  assert.equal(existsSync(join(dist, "images", "cristian-vega-og.jpg")), true);
  assert.equal(existsSync(join(dist, "images", "cristian-vega-portrait.webp")), false);
  assert.equal(existsSync(join(dist, "images", "cristian-vega-portrait.avif")), false);
});
