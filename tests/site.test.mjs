import { createHash } from "node:crypto";
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

function assertDistPath(...segments) {
  const path = join(dist, ...segments);
  assert.equal(existsSync(path), true, `missing build output: ${path} (run \`npm test\` or \`npm run build\`)`);
}

test("dist build is present for contract tests", () => {
  assert.equal(
    existsSync(dist),
    true,
    `missing ${dist}/ — run \`npm test\` (builds first) or \`npm run build\` before node --test`,
  );
  assertDistPath("index.html");
});

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
  assertDistPath("index.html");
  assertDistPath("writing", "index.html");
  assertDistPath("projects", "index.html");
  assertDistPath("about", "index.html");
  assertDistPath("contact", "index.html");
  assertDistPath("rss.xml");
  assertDistPath("sitemap-index.xml");
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
  // Hero copy must remain in HTML. Pre-hide is gated on a head-stamped attribute
  // (not html.js), so no-JS never blanks the copy.
  assert.match(html, /class="[^"]*hero__name[^"]*"/);
  assert.match(html, /class="[^"]*hero__sub[^"]*"/);
  assert.doesNotMatch(html, /html\.js|classList\.add\(["']js["']\)/);
  assert.match(html, /data-hero-motion-pending/);
});

test("homepage ships one progressive hero motion system", () => {
  const html = readDistFile("index.html");

  assert.match(html, /data-hero-motion(?!-)/);
  assert.equal((html.match(/data-hero-motion(?!-)/g) || []).length, 1);
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
  // Reduced-motion preference is live: hold MediaQueryList, re-check .matches,
  // and tear down ambient/entrance motion when the preference flips on.
  assert.match(source, /matchMedia\(\s*["']\(prefers-reduced-motion:\s*reduce\)["']\s*\)/);
  assert.doesNotMatch(
    source,
    /const reduceMotion\s*=\s*matchMedia\([^)]+\)\.matches/,
    "do not capture a one-shot reduced-motion boolean for the ambient loop",
  );
  assert.match(source, /motionQuery\.matches/);
  assert.match(source, /motionQuery\.addEventListener\(\s*["']change["']/);
  assert.match(source, /motionQuery\.removeEventListener\(\s*["']change["']/);
  // Cold-load pre-hide attribute must be cleared on every static reveal path
  assert.match(source, /function clearHeroMotionPending/);
  assert.match(
    source,
    /function clearTargetStyles[\s\S]*?clearHeroMotionPending\(\)/,
  );
});

test("homepage head script and CSS gate cold-load hero pre-hide", () => {
  const layout = readSourceFile("layouts", "BaseLayout.astro");
  const css = readSourceFile("styles", "global.css");
  const motion = readSourceFile("components", "HeroMotion.astro");
  const homeHtml = readDistFile("index.html");
  const aboutHtml = readDistFile("about", "index.html");

  // Home-only inline stamp; session replay and reduced motion skip pre-hide
  assert.match(layout, /active === "home"/);
  assert.match(layout, /is:inline/);
  assert.match(layout, /data-hero-motion-pending/);
  assert.match(layout, /cristianvega:hero-motion:v1/);
  assert.match(layout, /prefers-reduced-motion:\s*reduce/);
  assert.match(layout, /setTimeout[\s\S]*?3000/);

  // Built homepage ships the stamp script; other pages must not
  assert.match(homeHtml, /data-hero-motion-pending/);
  assert.doesNotMatch(aboutHtml, /data-hero-motion-pending/);

  // CSS hide is attribute-gated and outside the reduce branch
  assert.match(
    css,
    /prefers-reduced-motion:\s*no-preference[\s\S]*?html\[data-hero-motion-pending\]\s*\.hero\s*\[data-motion-target\]\s*\{\s*opacity:\s*0/,
  );
  assert.match(
    css,
    /html\[data-hero-motion-pending\]\s*\.hero__ticker\s*\{\s*opacity:\s*0/,
  );

  // Session key string stays aligned between head stamp and motion module
  const sessionKey = motion.match(/SESSION_KEY\s*=\s*"([^"]+)"/)?.[1];
  assert.ok(sessionKey, "SESSION_KEY defined");
  assert.match(layout, new RegExp(sessionKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("hero motion marks session only after successful completion", () => {
  const source = readSourceFile("components", "HeroMotion.astro");

  // Natural completions opt in to markSession: true
  assert.match(source, /completeMotion\(\s*\{\s*markSession:\s*true\s*\}\s*\)/);
  // Interrupts and failsafe must not claim a successful play
  assert.match(source, /markSession:\s*false/);
  // Failsafe timer callback itself refuses the session key (not merely some
  // earlier markSession:false like the focusin interrupt).
  assert.match(
    source,
    /failsafeTimer\s*=\s*window\.setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?completeMotion\(\s*\{\s*markSession:\s*false\s*\}\s*\)[\s\S]*?\},\s*FAILSAFE_DURATION\s*\)/,
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
  // PortraitPrep no longer keeps unused layout offsets or local-only scale
  assert.doesNotMatch(source, /offX:\s*number;\s*offY:\s*number/);
  assert.doesNotMatch(
    source,
    /type PortraitPrep\s*=\s*\{[^}]*scale:\s*number/s,
  );
  // TransferParticle no longer stores unused destination target
  assert.doesNotMatch(
    source,
    /type TransferParticle\s*=\s*\{[^}]*target:\s*TargetKind/s,
  );
  // data-motion-active was write-only; live hooks are mode/state/reveal
  assert.doesNotMatch(source, /data-motion-active/);

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

test("htaccess canonicalises www to https apex in one hop", () => {
  const htaccess = readDistFile(".htaccess");
  const wwwIdx = htaccess.search(
    /RewriteCond %\{HTTP_HOST\} \^www\\\.cristianvega\\\.ai\$[\s\S]*?RewriteRule \^ https:\/\/cristianvega\.ai%\{REQUEST_URI\}/,
  );
  const httpsIdx = htaccess.search(
    /RewriteCond %\{HTTPS\} !=on[\s\S]*?RewriteRule \^ https:\/\/cristianvega\.ai%\{REQUEST_URI\}/,
  );

  assert.ok(wwwIdx >= 0, "www→apex rule must rewrite scheme and host together");
  assert.ok(httpsIdx >= 0, "HTTPS-forcing rule must remain for non-www http");
  assert.ok(
    wwwIdx < httpsIdx,
    "www host canonicalisation must run before HTTPS-on-current-host to avoid a two-hop chain",
  );
  assert.doesNotMatch(
    htaccess,
    /RewriteRule \^ https:\/\/%\{HTTP_HOST\}%\{REQUEST_URI\}/,
    "no redirect target may reflect the request Host header",
  );
});

test("htaccess scopes immutable caching away from stable image URLs", () => {
  const htaccess = readDistFile(".htaccess");

  assert.match(
    htaccess,
    /REQUEST_URI\}\s*=~\s*m#\^\/_astro\/#[\s\S]*?max-age=31536000,\s*immutable/,
    "hashed /_astro/ assets should remain immutable",
  );
  assert.match(
    htaccess,
    /REQUEST_URI\}\s*=~\s*m#\^\/images\/#[\s\S]*?max-age=604800,\s*stale-while-revalidate=86400/,
    "stable /images/ URLs should revalidate after portrait regenerations",
  );
  assert.doesNotMatch(
    htaccess,
    /FilesMatch\s+"\\\.\(css\|js\|webp\|avif\|png\|svg\)\$"/,
    "extension-wide immutable FilesMatch must not cover public images",
  );
  assert.doesNotMatch(
    htaccess,
    /ExpiresByType\s+image\/(webp|avif|png|svg\+xml)\s+"access plus 1 year"/,
    "image Expires must not keep a one-year freshness lifetime",
  );
});

test("htaccess CSP denies inline scripts while allowing inline styles", () => {
  const htaccess = readDistFile(".htaccess");
  const csp = htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/)?.[1];
  assert.ok(csp, "CSP header must be present");

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "script-src directive must be present");
  assert.match(scriptSrc, /'self'/, "bundled scripts stay same-origin");
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval/);

  const styleSrc = csp.match(/style-src\s+([^;]+)/)?.[1] ?? "";
  assert.match(styleSrc, /'unsafe-inline'/, "style-src keeps unsafe-inline for Astro CSS");

  // Every inline script the build ships must be allow-listed by hash, so no
  // page can quietly require 'unsafe-inline' back.
  const htmlFiles = [];
  const stack = [dist];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) stack.push(path);
      else if (name.endsWith(".html")) htmlFiles.push(path);
    }
  }
  assert.ok(htmlFiles.length >= 9, "expected the static HTML pages");
  const inlineDigests = new Set();
  for (const file of htmlFiles) {
    const html = readFileSync(file, "utf8");
    for (const [, , body] of html.matchAll(
      /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi,
    )) {
      const digest = createHash("sha256").update(body, "utf8").digest("base64");
      inlineDigests.add(digest);
      assert.ok(
        scriptSrc.includes(`'sha256-${digest}'`),
        `inline script in ${file} is not hash-allow-listed in script-src (expected 'sha256-${digest}')`,
      );
    }
  }
  assert.deepEqual(
    [...inlineDigests],
    ["XAmQDOZkZmpTCL+kRJn5V0l3aQGa2/ZQ/miN4MqFqnI="],
    "the hero pre-hide stamp is the only inline script the build may ship",
  );
});

test("htaccess ships bootstrap HSTS until HTTPS is confirmed", () => {
  const htaccess = readDistFile(".htaccess");
  assert.match(
    htaccess,
    /Header always set Strict-Transport-Security "max-age=300"/,
    "first-deploy HSTS must stay short and reversible",
  );
  assert.doesNotMatch(
    htaccess,
    /Strict-Transport-Security "[^"]*includeSubDomains/,
    "do not pin includeSubDomains before a live SAN audit",
  );
});

test("post-deploy gate script checks live headers and 404", () => {
  const script = readFileSync(join(root, "scripts", "verify-deploy.mjs"), "utf8");
  for (const header of [
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "strict-transport-security",
    "content-security-policy",
  ]) {
    assert.match(script, new RegExp(`["']${header}["']`));
  }
  assert.match(script, /__deploy-gate-missing-path__/);
  assert.match(script, /status !== 404|status === 404/);
});

test("htaccess preserves production security headers and CSP", () => {
  const htaccess = readDistFile(".htaccess");

  assert.match(htaccess, /Header always set X-Content-Type-Options "nosniff"/);
  assert.match(htaccess, /Header always set X-Frame-Options "DENY"/);
  assert.match(htaccess, /Header always set Referrer-Policy "strict-origin-when-cross-origin"/);
  assert.match(
    htaccess,
    /Header always set Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)"/,
  );
  // Presence and shape only: the exact bootstrap value is pinned by
  // "htaccess ships bootstrap HSTS until HTTPS is confirmed".
  assert.match(htaccess, /Header always set Strict-Transport-Security "max-age=\d+/);
  assert.match(htaccess, /ErrorDocument 404 \/404\.html/);

  const cspMatch = htaccess.match(/Header always set Content-Security-Policy "([^"]+)"/);
  assert.ok(cspMatch, "Content-Security-Policy header must be present");
  const csp = cspMatch[1];

  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.match(
      csp,
      new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `CSP must keep ${directive}`,
    );
  }

  const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1]?.trim();
  assert.ok(scriptSrc, "CSP must declare script-src");
  assert.doesNotMatch(scriptSrc, /unsafe-eval/, "script-src must not allow unsafe-eval");
  assert.doesNotMatch(scriptSrc, /unsafe-inline/, "script-src must not allow unsafe-inline");
  for (const token of scriptSrc.split(/\s+/)) {
    assert.ok(
      token === "'self'" || /^'sha256-[A-Za-z0-9+/=]+'$/.test(token),
      `script-src must not widen beyond 'self' and per-script hashes (found ${token})`,
    );
  }
});

test("rss feed includes published posts", () => {
  const xml = readDistFile("rss.xml");

  assert.match(xml, /<rss/);
  assert.match(xml, /From BERT to agents/);

  // Item set must match non-draft content slugs exactly (not a /draft/i substring proxy).
  const postsDir = join(root, "src", "content", "posts");
  const expectedSlugs = readdirSync(postsDir)
    .filter((file) => /\.(md|mdx)$/.test(file))
    .flatMap((file) => {
      const fm = readFileSync(join(postsDir, file), "utf8").match(
        /^---\r?\n([\s\S]*?)\r?\n---/,
      )?.[1];
      if (!fm || /^draft:\s*true\s*$/m.test(fm)) return [];
      return [file.replace(/\.(md|mdx)$/, "")];
    })
    .sort();

  const itemLinks = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>/g)].map(
    (match) => match[1],
  );
  const feedSlugs = itemLinks
    .map((href) => href.match(/\/posts\/([^/]+)\/?$/)?.[1])
    .filter(Boolean)
    .sort();

  assert.deepEqual(feedSlugs, expectedSlugs);
  assert.equal(itemLinks.length, expectedSlugs.length, "no extra non-post channel links as items");

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
  // mechanism-agnostically in tests/motion-css.test.mjs. What stays here is the
  // positive check that the cold-load pre-hide gate actually reaches the build.
  const css = cssFiles.map((file) => readFileSync(join(astroDir, file), "utf8")).join("\n");
  assert.match(css, /html\[data-hero-motion-pending\]/);
});

test("design tokens omit unused custom properties", () => {
  const css = readSourceFile("styles", "global.css");
  const dead = [
    "--ink-3:",
    "--surface-2:",
    "--hairline-2:",
    "--muted-2:",
    "--grad-soft:",
    "--code-chrome:",
    "--code-line:",
    "--code-gutter:",
    "--syn-string:",
    "--syn-number:",
    "--syn-type:",
    "--seam:",
  ];
  for (const decl of dead) {
    assert.doesNotMatch(css, new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  // Orphan ink-3 must not keep propagating through the design contract docs.
  assert.doesNotMatch(readFileSync(join(root, "reference.html"), "utf8"), /--ink-3\s*:/);
  assert.doesNotMatch(readFileSync(join(root, "spec-template.html"), "utf8"), /--ink-3\s*:/);
});

test("reference brief keeps reveal content visible without JavaScript", () => {
  const html = readFileSync(join(root, "reference.html"), "utf8");

  assert.match(
    html,
    /document\.documentElement\.classList\.add\(['"]js-enabled['"]\)/,
    "head script should mark JS-capable documents before paint",
  );
  assert.match(
    html,
    /html\.js-enabled\s+\.reveal:not\(\.in\)\s*\{[^}]*opacity\s*:\s*0/,
    "entrance hiding must be gated on js-enabled",
  );
  assert.doesNotMatch(
    html,
    /^\s*\.reveal\s*\{[^}]*opacity\s*:\s*0/m,
    ".reveal must not start hidden when JavaScript is unavailable",
  );
});

test("spec template keeps every sheet reachable without JavaScript", () => {
  const html = readFileSync(join(root, "spec-template.html"), "utf8");

  assert.match(
    html,
    /document\.documentElement\.classList\.add\(['"]js-enabled['"]\)/,
    "head script should mark JS-capable documents before paint",
  );
  assert.match(
    html,
    /html\.js-enabled\s+\.panel\s*\{[^}]*display\s*:\s*none/,
    "single-panel hiding must be gated on js-enabled",
  );
  assert.match(
    html,
    /^\s*\.panel\s*\{[^}]*display\s*:\s*block/m,
    "panels must start visible when JavaScript is unavailable",
  );
  assert.doesNotMatch(
    html,
    /^\s*\.panel\s*\{[^}]*display\s*:\s*none/m,
    "ungated display:none on .panel would hide sheets 02–04 without JS",
  );
});

test("spec template wireframe kit keeps role=img free of focusable controls", () => {
  const html = readFileSync(join(root, "spec-template.html"), "utf8");
  const windowMatch = html.match(
    /<div class="proto-window"[^>]*role="img"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/,
  );
  assert.ok(windowMatch, "prototype wireframe window should be present");
  assert.doesNotMatch(
    windowMatch[0],
    /<(button|a|input|select|textarea)\b/i,
    "decorative wireframe controls must not be focusable inside role=img",
  );
  assert.match(
    html,
    /never\s+<button>/i,
    "GUIDE should tell copies to use span.proto-btn instead of button",
  );
});
