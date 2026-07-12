import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
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

test("build emits the core static pages DreamHost will serve", () => {
  assert.equal(existsSync(join(dist, "index.html")), true);
  assert.equal(existsSync(join(dist, "writing", "index.html")), true);
  assert.equal(existsSync(join(dist, "projects", "index.html")), true);
  assert.equal(existsSync(join(dist, "about", "index.html")), true);
  assert.equal(existsSync(join(dist, "contact", "index.html")), true);
  assert.equal(existsSync(join(dist, "rss.xml")), true);
  assert.equal(existsSync(join(dist, "sitemap-index.xml")), true);
});

test("homepage keeps the portfolio theme and links to the writing index", () => {
  const html = readDistFile("index.html");

  assertPageBasics(html, { titleFragment: "Cristian Vega" });
  assert.match(html, /reads the documents/);
  assert.match(html, /href="\/writing\/"/);
  assert.match(html, /href="\/projects\/"/);
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
  assert.match(html, /href="\/projects\/"/);
  assert.match(html, /href="\/writing\/"/);
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
  // Quick path returns before the await fonts / prepareMotion call sites
  const quickIdx = source.indexOf('dataset.motionMode = "quick"');
  const fontsCallIdx = source.indexOf("await fontsReadyWithin");
  const prepCallIdx = source.indexOf("prep = prepareMotion(");
  assert.ok(quickIdx > 0, "quick mode is set");
  assert.ok(fontsCallIdx > quickIdx, "font wait call follows quick mode");
  assert.ok(prepCallIdx > fontsCallIdx, "full particle prep follows font wait");

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
});

test("post pages are generated from markdown content", () => {
  const html = readDistFile("posts", "from-bert-to-agents", "index.html");

  assertPageBasics(html);
  assert.match(html, /From BERT to agents/);
  assert.match(html, /400K\+ documents/);
  assert.match(html, /Cristian Vega/);
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

  // Any project <a href> that is only /writing/ is not a credible case study link.
  const projectAnchors = [...html.matchAll(/<a\b[^>]*class="[^"]*project__(?:preview|link)[^"]*"[^>]*>/gi)];
  for (const [tag] of projectAnchors) {
    const href = tag.match(/\bhref="([^"]*)"/i)?.[1];
    assert.ok(href, `project link missing href: ${tag}`);
    assert.notEqual(
      href,
      "/writing/",
      "project cards must not use the writing archive as a fake case-study destination",
    );
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
});

test("compiled css assets are emitted", () => {
  const astroDir = join(dist, "_astro");
  assert.equal(existsSync(astroDir), true);

  const cssFiles = readdirSync(astroDir).filter((file) => file.endsWith(".css"));
  assert.ok(cssFiles.length > 0);
  assert.ok(cssFiles.some((file) => statSync(join(astroDir, file)).size > 1_000));

  // Hero must not pre-hide copy solely because JS is present.
  const css = cssFiles.map((file) => readFileSync(join(astroDir, file), "utf8")).join("\n");
  assert.doesNotMatch(css, /html\.js[^{]*hero__name[^{]*\{[^}]*opacity\s*:\s*0/s);
});
