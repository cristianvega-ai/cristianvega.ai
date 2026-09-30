import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, readDistFile } from "./helpers.mjs";

// What each rendered page must say, and the contracts every page shares:
// accessibility landmarks, SEO metadata, navigation state, and truthful links.
// Globe behavior belongs to tests/e2e/home.spec.mjs, even on the homepage.

test("about holds the profile and marks its own navigation link", () => {
  const html = readDistFile("about", "index.html");
  assertPageBasics(html, { titleFragment: "About · Cristian Vega" });
  assert.match(html, /rel="canonical" href="https:\/\/cristianvega\.ai\/about\/"/);
  assert.match(html, /href="\/about\/" aria-current="page"/);
  assert.match(html, /class="skip-link"[^>]*href="#main-content"/);
  assert.match(html, /<meta name="color-scheme" content="dark"/);
  assert.match(
    html,
    /<div class="page-graphic" data-graphic="about" aria-hidden="true"[^>]*>\s*<canvas class="page-graphic__canvas"><\/canvas>\s*<\/div>/,
    "about must hold one hidden graphic with one canvas",
  );
  assert.equal([...html.matchAll(/<canvas/g)].length, 1, "about must draw one canvas");
  assert.doesNotMatch(html, /<svg[^>]*class="[^"]*page-graphic/, "the graphic must have no SVG fallback");
  assert.doesNotMatch(html, /name="robots" content="noindex/);

  for (const copy of [
    "AI Engineering Leader",
    "Ten years building software. The last five building production AI from the ground up.",
    "I'm an AI engineering leader who never stopped building.",
    "Deterministic execution wherever it will do the job.",
    "Models only where reasoning is genuinely required.",
    "Reusable building blocks instead of one-off pipelines.",
    "Instrumentation on everything, so quality is a number rather than an opinion.",
    "At Patra that shape scaled document intelligence",
    "four and a half years shipping digital",
    "Now I'm at Vertafore.",
    "OpenCatalyst",
    "U.S. Patent 12,639,972 B2",
  ]) {
    assert.ok(html.replace(/\s+/g, " ").includes(copy), `about must keep the copy: ${copy}`);
  }
  assert.equal([...html.matchAll(/<li>/g)].length, 4, "about must hold four principles");
});

test("homepage holds the intro, the globe, and a link to about", () => {
  const html = readDistFile("index.html");
  const text = html.replace(/\s+/g, " ");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });
  assert.match(html, /<meta name="color-scheme" content="dark"/);
  assert.match(html, /<h1 id="home-title" class="hero__name">Cristian <span class="highlight">Vega<\/span><\/h1>/);
  // The two clauses are separate spans, so the dot between them can drop out when they wrap.
  assert.match(text, /<span class="eyebrow__part">AI Engineering Leader<\/span> <span class="eyebrow__part">Agentic&nbsp;Systems<\/span>/);

  for (const copy of [
    "Ten years building software. The last five building production AI from the ground up.",
    "My work has a consistent shape: take AI from a promising demo to a governed system with contracts, evaluation, and a unit cost.",
  ]) {
    assert.ok(text.includes(copy), `the intro must keep the copy: ${copy}`);
  }
  assert.doesNotMatch(html, /More about me/, "the homepage must not carry the old about link");

  // The long profile lives on /about/. The homepage must not repeat it.
  for (const copy of ["never stopped building", "12,000 documents", "Now I'm at Vertafore", "U.S. Patent", "OpenCatalyst"]) {
    assert.ok(!text.includes(copy), `the homepage must not repeat the profile copy: ${copy}`);
  }
  assert.doesNotMatch(html, /hero__principles|hero__profile/);

  // The globe is decorative. The canvas draws it. The SVG sits in the served
  // HTML twice, in a noscript for visitors without JavaScript and in a template
  // for the script to copy in when canvas is missing. It is never a live
  // element of the page, so a visitor with canvas never sees it.
  const globe = html.match(/<div class="lyra-globe"[^>]*>/)?.[0];
  assert.ok(globe, "the globe must be in the served HTML");
  assert.match(globe, /aria-hidden="true"/);
  assert.match(globe, /data-lyra-globe/);
  assert.match(html, /<svg class="lyra-globe__fallback"[^>]*viewBox="0 0 600 500"/);
  assert.match(html, /<noscript><svg class="lyra-globe__fallback"/);
  assert.match(html, /<template><svg class="lyra-globe__fallback"/);
  assert.equal(html.match(/class="lyra-globe__fallback"/g)?.length, 2, "the SVG appears once in the noscript and once in the template");
  assert.doesNotMatch(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "").replace(/<template>[\s\S]*?<\/template>/g, ""), /lyra-globe__fallback/, "no live SVG sits outside the two fallbacks");
  assert.match(html, /<canvas class="lyra-globe__canvas">/);
  assert.match(html, />LYRA \/ NEURAL SPHERE</);

  // The retired hero motion and its inline pre-hide must not return.
  assert.doesNotMatch(html, /data-hero-motion|data-motion-target|hero__sky-canvas|hero__copy-canvas/);
  assert.doesNotMatch(html, /html\.js|classList\.add\(["']js["']\)/);
});

test("homepage lists no writing or products and shows two coming-soon lines in production", () => {
  const html = readDistFile("index.html");
  assert.equal((html.match(/<h2\b/g) ?? []).length, 0, "the homepage must hold no section heading");
  assert.doesNotMatch(html, /home-writing|home-products|entries__item|data-post-id|data-product-id/);
  // Every entry is a draft, so no line may point at a route the build omits.
  assert.doesNotMatch(html, /href="\/(?:writing|products)\//);
  assert.doesNotMatch(html, /href="#"/);

  const list = html.match(/<ul class="hero__next"[^>]*>[\s\S]*?<\/ul>/)?.[0];
  assert.ok(list, "the homepage must hold the list of calls to action");
  const items = [...list.matchAll(/<li class="hero__next-item" data-state="(\w+)">([\s\S]*?)<\/li>/g)];
  assert.equal(items.length, 2, "the homepage must hold two calls to action");
  assert.deepEqual(items.map((item) => item[1]), ["soon", "soon"]);
  assert.equal(items[0][2], '<span class="hero__next-soon">Latest writing · coming soon</span>');
  assert.equal(items[1][2], '<span class="hero__next-soon">Latest products · coming soon</span>');
  assert.doesNotMatch(list, /<a\b|href=|tabindex/, "a coming-soon line must not be a link or take focus");
  assert.doesNotMatch(html, /class="path"|path__|Coming soon|Explore/, "the old cards must not return");
});

test("the header keeps one primary nav and a menu with the same links", () => {
  for (const segments of [["index.html"], ["about", "index.html"], ["404.html"]]) {
    const html = readDistFile(...segments);
    assert.equal((html.match(/<nav\b[^>]*aria-label="Primary"/g) ?? []).length, 1);
    assert.equal((html.match(/<details class="nav-menu">/g) ?? []).length, 1);
    assert.match(html, /<nav class="nav-menu__panel" aria-label="Menu">/);
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

test("pages preload only the measured critical font files", () => {
  const pages = [
    ["index.html"],
    ["about", "index.html"],
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
    assert.match(hrefs, /geist-latin-600\./, `${name} must preload Geist 600 (heading)`);
    assert.doesNotMatch(hrefs, /ibm-plex-mono/, `${name} must not preload mono; measurement did not mark it critical`);
    assert.doesNotMatch(
      hrefs,
      /italic/,
      `${name} must not preload italic; measurement did not mark it critical`,
    );
  }
});

test("the retired pages are gone from the build", () => {
  // Contact was public. Keep its redirects in the build. About is a page again.
  assert.equal(existsSync(join(dist, "contact", "index.html")), false, "contact page must be gone");

  const redirects = readDistFile("_redirects").split("\n");
  for (const path of ["/contact", "/contact/"]) {
    assert.ok(redirects.includes(`${path} / 301`));
  }
  for (const path of ["/about", "/about/"]) {
    assert.ok(!redirects.includes(`${path} / 301`), `${path} must not redirect`);
  }

  // These routes held placeholder content. Cloudflare must serve the 404 page.
  for (const route of ["projects", "posts"]) {
    assert.equal(existsSync(join(dist, route)), false, `${route}/ must not be built`);
  }
});

test("each page loads one Cloudflare analytics loader", () => {
  const pages = [
    ["index.html"],
    ["about", "index.html"],
    ["404.html"],
  ];

  for (const segments of pages) {
    const html = readDistFile(...segments);
    const name = segments.join("/");
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag);

    const loaders = scriptTags.filter((tag) => /src="\/_astro\/CloudflareAnalytics\.[^"]+\.js"/.test(tag));
    assert.equal(loaders.length, 1, `${name} must load analytics once`);
    assert.match(loaders[0], /type="module"/, `${name} must defer the analytics loader`);

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

    assert.doesNotMatch(html, /goatcounter|count\.v5|gc\.zgo\.at/i, `${name} must not load GoatCounter`);
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
