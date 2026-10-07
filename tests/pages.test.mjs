import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { assertPageBasics, dist, escapeAttribute, escapeHtml, headerLinks, latestWork, publishedContent, readContentInventory, readDistFile, withContentBuild } from "./helpers.mjs";

// What each rendered page must say, and the contracts every page shares:
// accessibility landmarks, SEO metadata, navigation state, and truthful links.
// Globe behavior belongs to tests/e2e/home.spec.mjs, even on the homepage.

const inventory = readContentInventory();

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
  assert.doesNotMatch(html, /home-writing|home-products|entries__item|data-post-id|data-product-id/);
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
  assert.doesNotMatch(html, /class="path"|path__|Coming soon|Explore/, "the old cards must not return");
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
    const attribute = section === "writing" ? "data-post-id" : "data-product-id";
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
    "I build production AI and the teams behind it.",
    "I’m an AI engineering leader at Vertafore with ten years in software",
    "Use deterministic execution where it does the job.",
    "Bring in models where reasoning is needed.",
    "Build reusable components rather than one-off pipelines.",
    "Clear system contracts, evaluation, and instrumentation belong in the design from the start.",
    "Quality should be measurable, and operating costs should be understood.",
    "At Patra, I founded the AI Engineering function and grew it to a peak of ~50 people.",
    "four and a half years building digital banking software at BBVA",
    "U.S. Patent 12,639,972 B2",
  ]) {
    assert.ok(html.replace(/\s+/g, " ").includes(copy), `about must keep the copy: ${copy}`);
  }
  assert.equal([...html.matchAll(/<li>/g)].length, 5, "about must hold five principles");
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
  for (const copy of ["AI engineering leader at Vertafore", "12,000 documents", "U.S. Patent"]) {
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

test("homepage calls to action follow current publication", () => {
  assertHomepagePublication(readDistFile("index.html"), inventory);
});

test("current published pages keep content, sorting, metadata, and navigation", () => {
  assertPublishedPages(dist, inventory);
});

for (const kind of ["all-draft", "mixed"]) {
  test(`${kind} fixture preserves publication page contracts`, { timeout: 90_000 }, async () => {
    await withContentBuild(kind, (fixture) => {
      assertPublishedPages(fixture.dist, fixture.inventory);
      if (kind === "mixed") {
        assert.deepEqual(publishedContent(fixture.inventory).writing.map((entry) => entry.id), ["newer-writing", "alpha-tied", "zulu-tied"]);
        assert.deepEqual(publishedContent(fixture.inventory).products.map((entry) => entry.id), ["default-order", "alpha-product", "zulu-product"]);
        for (const section of ["writing", "products"]) {
          assert.equal(fixture.inventory[section].find((entry) => entry.id === "default-draft").data.draft, true);
        }
        const product = fixture.inventory.products.find((entry) => entry.id === "default-order");
        assert.equal(product.data.order, 0);
        assert.equal(product.data.status, "Product");
      }
    });
  });
}

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
