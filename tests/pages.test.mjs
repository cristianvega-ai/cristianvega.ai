import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile } from "./helpers.mjs";

// What each rendered page must say, and the contracts every page shares:
// accessibility landmarks, SEO metadata, navigation state, and truthful links.
// Hero motion belongs to tests/hero-motion.test.mjs, even on the homepage.

/** The opening tag of the anchor carrying a given data-motion-target, if any. */
function findMotionAnchor(html, target) {
  return [...html.matchAll(/<a\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`data-motion-target="${target}"`));
}

test("homepage keeps the portfolio theme and links to the writing index", () => {
  const html = readDistFile("index.html");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });
  assert.match(html, /reads the documents/);
  // Scoped to the hero CTAs: the global nav renders both hrefs on every page,
  // so a bare href match stays green with the call to action deleted.
  const primaryCta = findMotionAnchor(html, "primary-action");
  const secondaryCta = findMotionAnchor(html, "secondary-action");
  assert.ok(primaryCta, "hero primary call to action required");
  assert.ok(secondaryCta, "hero secondary call to action required");
  assert.match(primaryCta, /href="\/projects\/"/);
  assert.match(secondaryCta, /href="\/writing\/"/);
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

  // updatedDate is consumed: visible meta, Open Graph article times, sitemap lastmod
  assert.match(html, /Updated\s*<time[^>]*datetime="2026-07-01"/);
  assert.match(html, /property="og:type"\s+content="article"/);
  assert.match(html, /property="article:published_time"\s+content="2026-06-12T/);
  assert.match(html, /property="article:modified_time"\s+content="2026-07-01T/);

  const sitemap = readDistFile("sitemap-0.xml");
  assert.match(
    sitemap,
    /posts\/from-bert-to-agents\/[\s\S]*?<lastmod>2026-07-01T/,
  );
});

test("about page ships experience and education content", () => {
  const html = readDistFile("about", "index.html");

  assertPageBasics(html, { titleFragment: "About" });
  assert.match(html, /Patra Corporation/);
  assert.match(html, /Georgia Tech/);
  assert.match(html, /Head of AI R&amp;D|Head of AI R&D/);
});

test("contact page exposes email and social destinations", () => {
  const html = readDistFile("contact", "index.html");

  assertPageBasics(html, { titleFragment: "Contact" });
  assert.match(html, /mailto:hello@cristianvega\.ai/);
  assert.match(html, /linkedin\.com\/in\/cristianvega-ai/);
  assert.match(html, /github\.com\/cristianvega-ai/);
  assert.match(html, /href="\/rss\.xml"/);
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
    ["about", "index.html"],
    ["contact", "index.html"],
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

test("active navigation exposes aria-current=page", () => {
  const about = readDistFile("about", "index.html");
  assert.match(about, /href="\/about\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/about\/"/i);

  const writing = readDistFile("writing", "index.html");
  assert.match(writing, /href="\/writing\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/writing\/"/i);
  assert.doesNotMatch(writing, /href="\/about\/"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/about\/"/i);
});

test("about page uses optimized portrait derivatives", () => {
  const html = readDistFile("about", "index.html");
  assert.match(html, /cristian-vega-portrait\.avif/);
  assert.match(html, /cristian-vega-portrait\.webp/);
  assert.equal(existsSync(join(dist, "images", "cristian-vega-portrait.webp")), true);
  assert.equal(existsSync(join(dist, "images", "cristian-vega-portrait.avif")), true);
  assert.equal(existsSync(join(dist, "images", "cristian-vega-og.jpg")), true);
});
