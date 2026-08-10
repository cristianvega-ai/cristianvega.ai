import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

// fileURLToPath, not URL.pathname: the latter stays percent-encoded, so a
// checkout under a path with spaces or non-ASCII characters would ENOENT.
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

function readDistFile(...segments) {
  return readFileSync(join(dist, ...segments), "utf8");
}

function readSourceFile(...segments) {
  return readFileSync(join(root, "src", ...segments), "utf8");
}

/** Count <h1>…</h1> occurrences (case-insensitive tag). */
function countH1(html) {
  return (html.match(/<h1\b[^>]*>/gi) || []).length;
}

function assertPageBasics(html, { titleFragment, descriptionFragment } = {}) {
  assert.match(html, /<html\b[^>]*\blang="en"/i, "document language should be en");
  assert.match(html, /<link\b[^>]*rel="canonical"/i, "canonical URL required");
  assert.match(html, /<meta\b[^>]*name="description"/i, "meta description required");
  assert.equal(countH1(html), 1, "each page should have exactly one H1");
  if (titleFragment) assert.match(html, new RegExp(titleFragment, "i"));
  if (descriptionFragment) assert.match(html, new RegExp(descriptionFragment, "i"));
}

/** Every public route the build emits, as absolute paths with trailing slashes. */
function listBuiltRoutes(dir = dist, prefix = "/") {
  const routes = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_astro") continue;
      routes.push(...listBuiltRoutes(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "index.html") {
      routes.push(prefix);
    }
  }

  return routes;
}

/** The opening tag of the anchor carrying a given data-motion-target, if any. */
function findMotionAnchor(html, target) {
  return [...html.matchAll(/<a\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`data-motion-target="${target}"`));
}

/**
 * The brace-matched `{ … }` block that follows `anchor`, so assertions can talk
 * about a branch as a unit instead of comparing byte offsets. Braces inside
 * strings and comments are skipped; regex literals are not parsed.
 */
function extractBlock(source, anchor) {
  const start = source.indexOf(anchor);
  if (start === -1) return null;

  const open = source.indexOf("{", start);
  if (open === -1) return null;

  let depth = 0;

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) return null;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 1;
    } else if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < source.length && source[i] !== char) {
        i += source[i] === "\\" ? 2 : 1;
      }
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }

  return null;
}

test("build emits the core static pages DreamHost will serve", () => {
  assert.equal(existsSync(join(dist, "index.html")), true);
  assert.equal(existsSync(join(dist, "writing", "index.html")), true);
  assert.equal(existsSync(join(dist, "projects", "index.html")), true);
  assert.equal(existsSync(join(dist, "about", "index.html")), true);
  assert.equal(existsSync(join(dist, "contact", "index.html")), true);
  assert.equal(existsSync(join(dist, "rss.xml")), true);
  assert.equal(existsSync(join(dist, "sitemap-index.xml")), true);
});

test("sitemap enumerates every public route the build produces", () => {
  // robots.txt points crawlers at the index, so an index that references a
  // missing or stale child sitemap is a silent SEO regression.
  const index = readDistFile("sitemap-index.xml");
  const child = index.match(/<loc>https:\/\/cristianvega\.ai\/(sitemap-\d+\.xml)<\/loc>/)?.[1];
  assert.ok(child, `sitemap index must reference a child sitemap: ${index}`);
  assert.equal(existsSync(join(dist, child)), true, `${child} is referenced but missing`);

  const locations = [...readDistFile(child).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  const expected = listBuiltRoutes().map((route) => `https://cristianvega.ai${route}`);

  assert.ok(expected.length > 0, "build must emit routes to enumerate");
  assert.deepEqual(
    [...locations].sort(),
    [...expected].sort(),
    "sitemap must list exactly the built routes, absolute and trailing-slashed",
  );
});

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
  // Hero copy must remain in HTML (progressive enhancement must not rely on
  // pre-hiding text in CSS that leaves content blank if JS fails).
  assert.match(html, /class="[^"]*hero__name[^"]*"/);
  assert.match(html, /class="[^"]*hero__sub[^"]*"/);
  assert.doesNotMatch(html, /html\.js|classList\.add\(["']js["']\)/);
});

test("homepage ships one progressive hero motion system", () => {
  const html = readDistFile("index.html");

  assert.match(html, /data-hero-motion/);
  assert.equal((html.match(/data-hero-motion/g) || []).length, 1);
  assert.match(html, /class="[^"]*hero__portrait-canvas[^"]*"/);
  assert.match(html, /class="[^"]*hero__copy-canvas[^"]*"/);
  assert.match(html, /data-motion-target="eyebrow"/);
  assert.match(html, /data-motion-target="name"/);
  assert.match(html, /data-motion-target="highlight"/);
  assert.match(html, /data-motion-target="subhead"/);
  assert.match(html, /data-motion-target="primary-action"/);
  assert.match(html, /data-motion-target="secondary-action"/);
  // CTA destinations are asserted against the hero anchors in the test above.
  // Superseded components must not ship in the built homepage
  assert.doesNotMatch(html, /hero__dots-canvas/);
  assert.doesNotMatch(html, /HeroPortrait|HeroDots/);
});

test("hero motion keeps explicit reduced-motion, session, and failure fallbacks", () => {
  const source = readSourceFile("components", "HeroMotion.astro");

  assert.match(source, /prefers-reduced-motion:\s*reduce/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /cristianvega:hero-motion:v1/);
  assert.match(source, /function revealStaticHero/);
  assert.match(source, /astro:page-load/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /cancelAnimationFrame/);
  // Task 7: font deadline, hard failsafe, resize cleanup, focus escape hatch
  assert.match(source, /FONT_DEADLINE_MS\s*=\s*1200/);
  assert.match(source, /FAILSAFE_DURATION\s*=\s*3000/);
  assert.match(source, /document\.fonts/);
  assert.match(source, /focusin/);
  assert.match(source, /["']resize["']/);
  assert.match(source, /dispose\?\.\(\)/);
  assert.match(source, /setupGen/);
});

test("hero motion marks session only after successful completion", () => {
  const source = readSourceFile("components", "HeroMotion.astro");

  // Natural completions opt in to markSession: true
  assert.match(source, /completeMotion\(\s*\{\s*markSession:\s*true\s*\}\s*\)/);
  // Interrupts and failsafe must not claim a successful play
  assert.match(source, /markSession:\s*false/);
  // Failsafe path explicitly refuses the session key
  assert.match(
    source,
    /FAILSAFE_DURATION[\s\S]*?completeMotion\(\s*\{\s*markSession:\s*false\s*\}\s*\)/,
  );
});

test("hero motion samples Vega glyphs and settles ticker with quick replay", () => {
  const source = readSourceFile("components", "HeroMotion.astro");
  const css = readSourceFile("styles", "global.css");

  // Highlight target is glyph-sampled (not underline-only)
  assert.match(
    source,
    /sampleTextElement\(\s*highlight[\s\S]*?SIGNAL\s*\)/,
  );
  // Full-grid copy canvas so transfers leave the portrait region visibly
  assert.match(source, /sizeLayer\(\s*copyCanvas,\s*gridRect,\s*gridRect\s*\)/);
  // Quick / full modes via dataset (maps to data-motion-mode)
  assert.match(source, /dataset\.motionMode\s*=\s*["']quick["']/);
  assert.match(source, /dataset\.motionMode\s*=\s*["']full["']/);
  // The quick path must settle without the font wait or particle prep. Assert
  // the branch as a unit (no await, ends in a return) instead of comparing byte
  // offsets, so reordering or extracting helpers stays green while deleting the
  // early return — the thing that actually enforces the guarantee — fails.
  const quickBranch = extractBlock(source, "if (duration <= QUICK_DURATION) {");
  assert.ok(quickBranch, "quick-path branch present");
  assert.match(quickBranch, /dataset\.motionMode\s*=\s*["']quick["']/);
  assert.doesNotMatch(quickBranch, /\bawait\b/, "quick path must not await fonts or prep");
  assert.doesNotMatch(quickBranch, /prepareMotion\(/, "quick path must skip particle prep");
  assert.match(quickBranch, /\breturn;\s*}$/, "quick path must return before the full path");
  // The full path still owns both slow steps.
  assert.match(source, /await fontsReadyWithin\(FONT_DEADLINE_MS\)/);
  assert.match(source, /prep = prepareMotion\(/);

  // Ticker delay is gated to full first-run, not a fixed 2.15s on every visit
  assert.match(
    css,
    /data-motion-mode="full"\][\s\S]*?\.hero__ticker[\s\S]*?2\.15s/,
  );
  assert.match(
    css,
    /data-motion-mode="quick"\][\s\S]*?\.hero__ticker[\s\S]*?0\.25s/,
  );
  assert.match(css, /data-motion-state="complete"\][\s\S]*?\.hero__ticker/);

  // Full ticker must finish with the 2.45s hero clock: 0.3s duration + 2.15s delay = 2.45s
  // (0.6s duration would end at 2.75s and snap when completeMotion clears the mode).
  const fullTickerRule = css.match(
    /data-motion-mode="full"\]\s*\.hero__ticker\s*\{([^}]+)\}/,
  );
  assert.ok(fullTickerRule, "full-mode ticker rule present");
  assert.match(fullTickerRule[1], /riseIn\s+0\.3s\s+2\.15s/);
  assert.doesNotMatch(fullTickerRule[1], /riseIn\s+0\.6s/);
});

/**
 * Behavioral timing invariant: hero clock and CSS ticker share one end boundary.
 * Protects the handoff snap without a browser dependency.
 */
test("hero motion clock and ticker share one end boundary", () => {
  const source = readSourceFile("components", "HeroMotion.astro");
  const css = readSourceFile("styles", "global.css");

  const fullMs = Number(source.match(/const FULL_DURATION\s*=\s*(\d+)/)?.[1]);
  const quickMs = Number(source.match(/const QUICK_DURATION\s*=\s*(\d+)/)?.[1]);
  assert.equal(fullMs, 2450);
  assert.equal(quickMs, 250);

  // Last overlapping target window must end at FULL_DURATION
  const secondaryWindow = source.match(
    /secondaryAction:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/,
  );
  assert.ok(secondaryWindow, "secondaryAction window defined");
  assert.equal(Number(secondaryWindow[2]), fullMs);

  // Full path steps while elapsed < FULL_DURATION (not a mismatched local duration)
  assert.match(source, /elapsed\s*<\s*FULL_DURATION/);

  // Parse full-mode ticker: riseIn <duration>s <delay>s
  const fullTicker = css.match(
    /data-motion-mode="full"\]\s*\.hero__ticker\s*\{[^}]*riseIn\s+([\d.]+)s\s+([\d.]+)s/,
  );
  assert.ok(fullTicker, "full ticker riseIn duration+delay parseable");
  const tickerDurMs = Math.round(Number(fullTicker[1]) * 1000);
  const tickerDelayMs = Math.round(Number(fullTicker[2]) * 1000);
  assert.equal(
    tickerDelayMs + tickerDurMs,
    fullMs,
    `ticker must end with hero clock (${tickerDelayMs}+${tickerDurMs} !== ${fullMs})`,
  );

  // Quick ticker duration must match QUICK_DURATION
  const quickTicker = css.match(
    /data-motion-mode="quick"\]\s*\.hero__ticker\s*\{[^}]*riseIn\s+([\d.]+)s/,
  );
  assert.ok(quickTicker, "quick ticker riseIn duration parseable");
  assert.equal(Math.round(Number(quickTicker[1]) * 1000), quickMs);

  // Natural completion marks session; interrupt paths do not (behavioral contract)
  const markTrueCount = (source.match(/markSession:\s*true/g) || []).length;
  const markFalseCount = (source.match(/markSession:\s*false/g) || []).length;
  assert.ok(markTrueCount >= 2, "full + quick natural completions mark session");
  assert.ok(markFalseCount >= 2, "focus/resize/failsafe refuse session mark");
});

test("hero motion prep stores only fields the RAF path consumes", () => {
  const source = readSourceFile("components", "HeroMotion.astro");

  // Dead prep shapes from the audit must stay gone
  assert.doesNotMatch(source, /type ButtonColors/);
  assert.doesNotMatch(source, /buttons:\s*\{\s*primary:/);
  assert.doesNotMatch(source, /defaultButtonColors/);
  // PortraitPrep no longer keeps unused layout offsets
  assert.doesNotMatch(source, /offX:\s*number;\s*offY:\s*number/);
  // TransferParticle no longer stores unused destination target
  assert.doesNotMatch(
    source,
    /type TransferParticle\s*=\s*\{[^}]*target:\s*TargetKind/s,
  );

  // RAF consumers still present
  assert.match(source, /sourceIndex/);
  assert.match(source, /prep\.transfers/);
  assert.match(source, /prep\.copy/);
  assert.match(source, /prep\.portrait/);
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
  assert.match(html, /400K\+ documents/);
  assert.match(html, /Cristian Vega/);
  // The byline date must render in UTC, not the builder's local day.
  assert.match(html, /<time[^>]*datetime="2026-06-12"[^>]*>June 12, 2026<\/time>/);
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
    assert.match(html, /property="og:image"[^>]*content="https:\/\/cristianvega\.ai\//i);
    assert.match(html, /property="og:image:alt"/i);
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
});

test("static ops assets ship with the build", () => {
  assert.equal(existsSync(join(dist, "robots.txt")), true);
  assert.equal(existsSync(join(dist, "404.html")), true);
  assert.equal(existsSync(join(dist, ".htaccess")), true);

  const robots = readDistFile("robots.txt");
  assert.match(robots, /Sitemap:\s*https:\/\/cristianvega\.ai\/sitemap-index\.xml/);

  const notFound = readDistFile("404.html");
  assertPageBasics(notFound, { titleFragment: "Page not found" });
  assert.match(notFound, /href="\/"/);
});

test("rss feed includes published posts", () => {
  const xml = readDistFile("rss.xml");

  assert.match(xml, /<rss/);
  assert.match(xml, /From BERT to agents/);
  assert.doesNotMatch(xml, /draft/i);

  // Channel essentials readers depend on.
  assert.match(xml, /<channel>/);
  assert.match(xml, /<title>Cristian Vega Writing<\/title>/);
  assert.match(xml, /<link>https:\/\/cristianvega\.ai\/<\/link>/);
  assert.match(xml, /<language>en-us<\/language>/);
  assert.match(
    xml,
    /<atom:link\b[^>]*href="https:\/\/cristianvega\.ai\/rss\.xml"[^>]*rel="self"/,
    "feed must reference itself with atom:link rel=self",
  );
  assert.match(xml, /<lastBuildDate>[^<]+GMT<\/lastBuildDate>/);

  // Every published post ships with an absolute, trailing-slash link and a date.
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => item);
  const published = readdirSync(join(dist, "posts"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(published.length > 0, "build must emit post pages to compare against");
  assert.equal(items.length, published.length, "feed must carry every published post");

  const links = items.map((item) => item.match(/<link>([^<]+)<\/link>/)?.[1]);
  for (const [index, item] of items.entries()) {
    assert.match(item, /<title>[^<]+<\/title>/);
    assert.match(item, /<pubDate>[^<]+GMT<\/pubDate>/, "each item needs a pubDate");
    assert.match(
      links[index] ?? "",
      /^https:\/\/cristianvega\.ai\/posts\/[a-z0-9-]+\/$/,
      `item link must be absolute with a trailing slash: ${links[index]}`,
    );
  }

  for (const slug of published) {
    assert.ok(
      links.includes(`https://cristianvega.ai/posts/${slug}/`),
      `feed is missing /posts/${slug}/`,
    );
  }
});

test("compiled css assets are emitted", () => {
  const astroDir = join(dist, "_astro");
  assert.equal(existsSync(astroDir), true);

  const cssFiles = readdirSync(astroDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0);
  assert.ok(cssFiles.some((file) => statSync(join(astroDir, file)).size > 1_000));
  // The no-JS pre-hide and reduced-motion contracts over this CSS are enforced
  // mechanism-agnostically in tests/motion-css.test.mjs.
});
