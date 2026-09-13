import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile } from "./helpers.mjs";

// What each rendered page must say, and the contracts every page shares:
// accessibility landmarks, SEO metadata, navigation state, and truthful links.
// Hero motion belongs to tests/hero-motion.test.mjs, even on the homepage.

test("homepage keeps the portfolio theme and the profile copy", () => {
  const html = readDistFile("index.html");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });

  // The profile is the page. It replaced a separate About page, so the words
  // must be in the served HTML, not assembled by script after load.
  assert.match(html, /class="[^"]*hero__profile[^"]*"/);
  assert.match(html, /Ten years building software\. The last five building production AI/);
  assert.match(html, /never stopped building/);
  assert.match(html, /governed system with contracts, evaluation, and a unit cost/);
  assert.match(html, /12,000 documents and 400,000\+ data points/);
  assert.match(html, /\$0\.20 per document/);
  assert.match(html, /grew it to a peak of 100 people, and owned the budget down to the cost of a single policy check/);
  assert.match(html, /BBVA/);
  assert.match(html, /Now I'm at Vertafore\./);
  assert.match(html, /OpenCatalyst/);
  assert.match(html, /U\.S\. Patent 12,639,972 B2/);

  // The four working principles are a real list, served as markup. A styled
  // run of paragraphs would look the same and mean nothing to a screen reader.
  assert.match(html, /<ul class="hero__principles">/);
  assert.equal((html.match(/<ul class="hero__principles">.*?<\/ul>/s)?.[0].match(/<li>/g) ?? []).length, 4);
  assert.match(html, /Deterministic execution wherever it will do the job/);
  assert.match(html, /Models only where reasoning is genuinely required/);
  assert.match(html, /Reusable building blocks instead of one-off pipelines/);
  assert.match(html, /Instrumentation on everything, so quality is a number/);

  // The hero holds a name and the profile now. A stray button or subhead would
  // re-enter the motion choreography, which no longer has a window for one.
  assert.doesNotMatch(html, /data-motion-target="(primary|secondary)-action"/);
  assert.doesNotMatch(html, /class="[^"]*hero__actions[^"]*"/);
  assert.doesNotMatch(html, /data-motion-target="subhead"/);
  assert.doesNotMatch(html, /class="[^"]*hero__sub[^"]*"/);
  // Hero copy must remain in HTML. Pre-hide is gated on a head-stamped attribute
  // (not html.js), so no-JS never blanks the copy.
  assert.match(html, /class="[^"]*hero__name[^"]*"/);
  assert.doesNotMatch(html, /html\.js|classList\.add\(["']js["']\)/);
  assert.match(html, /data-hero-motion-pending/);
});

test("key pages share accessibility and SEO basics", () => {
  const pages = [
    ["index.html"],
    ["404.html"],
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

test("pages do not load fonts from Google", () => {
  const pages = [
    ["index.html"],
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

test("pages preload only the measured critical font files", () => {
  const pages = [
    ["index.html"],
    ["404.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    const name = segments.join("/");
    const preloads = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*>/gi)].map(([tag]) => tag);
    const fontPreloads = preloads.filter((tag) => /\bas="font"/.test(tag));
    assert.equal(
      fontPreloads.length,
      2,
      `${name} must preload exactly two fonts (LCP body + display heading), got ${fontPreloads.join(" ")}`,
    );
    for (const tag of fontPreloads) {
      assert.match(tag, /type="font\/woff2"/, `${name} font preload must declare woff2: ${tag}`);
      assert.match(tag, /\bcrossorigin\b/, `${name} font preload needs crossorigin: ${tag}`);
      assert.match(tag, /href="\/_astro\/[^"]+\.woff2"/, `${name} font preload must be a hashed /_astro/ file: ${tag}`);
    }
    const hrefs = fontPreloads.map((tag) => tag.match(/href="([^"]+)"/)?.[1] ?? "").join(" ");
    assert.match(hrefs, /ibm-plex-sans-latin-400\./, `${name} must preload IBM Plex Sans 400 (LCP)`);
    assert.match(hrefs, /space-grotesk-latin-600-700\./, `${name} must preload Space Grotesk 600–700 (heading)`);
    assert.doesNotMatch(hrefs, /ibm-plex-mono/, `${name} must not preload mono; measurement did not mark it critical`);
    assert.doesNotMatch(
      hrefs,
      /italic/,
      `${name} must not preload italic; measurement did not mark it critical`,
    );
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

  // Projects, writing, and the posts held placeholder content. Nothing links to
  // them, so they return the 404 page. The deploy receiver deletes live files
  // that a package does not hold, so the build must not emit them.
  for (const route of ["projects", "writing", "posts"]) {
    assert.equal(existsSync(join(dist, route)), false, `${route}/ must not be built`);
  }
});

test("every key page loads the self-hosted GoatCounter count script", () => {
  const pages = [
    ["index.html"],
    ["404.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    const name = segments.join("/");
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag);

    const counter = scriptTags.find((tag) => tag.includes('src="/js/count.v5.js"'));
    assert.ok(counter, `${name} must load the vendored count script from /js/`);
    assert.match(
      counter,
      /data-goatcounter="https:\/\/cristianvegaai\.goatcounter\.com\/count"/,
      `${name} must aim the beacon at the https GoatCounter count URL`,
    );
    assert.match(counter, /\basync\b/, `${name} must not block rendering on the count script`);

    assert.equal(
      scriptTags.some((tag) => tag.includes('src="/js/goatcounter.js"')),
      false,
      `${name} must not load the retired ClientRouter swap counter`,
    );
    assert.equal(
      scriptTags.some((tag) => /ClientRouter/i.test(tag)),
      false,
      `${name} must not load the ClientRouter`,
    );

    // Self-hosted means self-hosted: no page may reference the GoatCounter CDN.
    assert.doesNotMatch(html, /gc\.zgo\.at/, `${name} must not load the GoatCounter CDN`);
  }
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

// Search engines and link previews take the role from the page title and the
// structured data, not from the profile. When the role changes, both change.
test("the homepage title and structured data name the current role", () => {
  const html = readDistFile("index.html");

  assert.match(html, /<title>Cristian Vega · AI Engineering Leader<\/title>/);

  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, "the homepage must ship JSON-LD structured data");
  const person = JSON.parse(json)["@graph"].find((node) => node["@type"] === "Person");
  assert.ok(person, "the structured data must describe a person");
  assert.deepEqual(
    { jobTitle: person.jobTitle, worksFor: person.worksFor },
    { jobTitle: "AI Engineering Leader", worksFor: { "@type": "Organization", name: "Vertafore" } },
  );
});
