import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readDistFile, readSourceFile, root } from "./helpers.mjs";

/**
 * The hero motion contract now lives across HeroMotion.astro and the modules
 * under src/lib/hero-motion/. Tests that must see a name or a branch read the
 * whole set as one source, so a safe move from one file to another stays green
 * and a deleted guarantee still fails.
 */
function readHeroMotionSource() {
  const parts = [readSourceFile("components", "HeroMotion.astro")];
  const dir = join(root, "src", "lib", "hero-motion");
  for (const name of readdirSync(dir).sort()) {
    if (name.endsWith(".ts")) {
      parts.push(readFileSync(join(dir, name), "utf8"));
    }
  }
  return parts.join("\n");
}

// The residue of the hero motion contract. tests/e2e/hero.spec.mjs owns the
// behavior — the clock, the session replay, the font race, the pre-hide gate,
// the interrupts and the reduced-motion path — because a browser is the only
// place any of that is observable. What stays here is what a browser cannot
// see: a byte that never becomes an element, a teardown call that leaves no
// trace once it has run, canvas pixels too fine to assert on, and literals the
// browser can only measure against each other. Every assertion below records
// why it is not a browser spec instead. A new one earns its place the same way,
// or it belongs in that spec. The compiled-stylesheet view of the no-JS
// guarantee lives in tests/motion-css.test.mjs.

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

test("the built homepage ships no superseded hero component", () => {
  const html = readDistFile("index.html");

  // A component that renders nothing can still be imported, and the build then
  // ships its bundle as a module URL in the head. That costs a request and
  // leaves no element behind, so only a scan of the built bytes finds it. The
  // DOM side of the same question — one motion layer, two canvases, six
  // targets, and no dots canvas — is asserted in "the homepage ships exactly
  // one hero motion system" (tests/e2e/hero.spec.mjs).
  assert.doesNotMatch(html, /HeroPortrait|HeroDots/);
});

test("hero motion source keeps teardown hygiene the DOM cannot show", () => {
  const source = readHeroMotionSource();

  // A run that forgets to release its frames, listeners and predecessors still
  // settles into the same readable hero. The browser specs prove every entrance
  // and every interrupt settles; none of them can see what the settle let go
  // of. The cost lands on the next navigation, which is why it is asserted here.

  // A new setup disposes the previous one before it measures anything.
  assert.match(source, /dispose\?\.\(\)/);
  // The generation counter retires the callbacks of a superseded run. They
  // resume after an await with no other way to learn they lost the page.
  assert.match(source, /setupGen/);
  // Frames are cancelled, not merely left to return early on the next tick.
  assert.match(source, /cancelAnimationFrame/);
  // The reduced-motion listener is removed by the run that added it. That the
  // preference is live at all is proved by "the preference set during the
  // entrance stops the motion" (tests/e2e/hero.spec.mjs).
  assert.match(source, /motionQuery\.removeEventListener\(\s*["']change["']/);
});

test("hero motion source keeps glyph sampling and the quick-path shortcut", () => {
  const source = readHeroMotionSource();

  // The highlight word is sampled from its own glyphs, so the particles spell
  // it instead of drawing a bar beneath it. The difference is canvas pixels.
  // Both versions hand back the same readable DOM, which is all a browser spec
  // can compare — see "the run is in full mode and ends with every hero line
  // readable" (tests/e2e/hero.spec.mjs).
  assert.match(source, /sampleTextElement\(\s*highlight[\s\S]*?SIGNAL\s*\)/);

  // The quick replay must leave before the full path, not merely finish first.
  // A branch that fell through would settle the hero at ~250ms and then start
  // the full run behind it, hiding the copy a second time. The browser specs
  // read the first settle mark and retry until the page is readable, so that
  // second run ends inside their timeouts and passes unseen. Only the shape of
  // the branch rules it out. Asserted as a unit so that reordering or helper
  // extraction stays green while deleting the early return fails.
  const quickBranch = extractBlock(source, "if (duration <= QUICK_DURATION) {");
  assert.ok(quickBranch, "quick-path branch present");
  assert.match(
    quickBranch,
    /dataset\.motionMode\s*=\s*["']quick["']/,
    "the extracted block is the quick path",
  );
  assert.doesNotMatch(quickBranch, /\bawait\b/, "quick path must not await fonts or prep");
  assert.doesNotMatch(quickBranch, /prepareMotion\(/, "quick path must skip particle prep");
  assert.match(quickBranch, /\breturn;\s*}$/, "quick path must return before the full path");
  // The exclusion above says nothing once prep leaves the full path too.
  assert.match(source, /prep = prepareMotion\(/);
});

test("hero motion source pins the two clock constants", () => {
  const source = readHeroMotionSource();

  // Every browser spec measures a run against itself. "a finished visit
  // replays quick on the next load and settles far sooner"
  // (tests/e2e/hero.spec.mjs) compares the quick run with the full one, so it
  // stays green at any tempo. Retiming both constants keeps that relation and
  // still changes how long each visitor waits. These two literals are the
  // tempo itself, so they are pinned where they are written.
  const fullMs = Number(source.match(/const FULL_DURATION\s*=\s*(\d+)/)?.[1]);
  const quickMs = Number(source.match(/const QUICK_DURATION\s*=\s*(\d+)/)?.[1]);
  assert.equal(fullMs, 2450);
  assert.equal(quickMs, 250);
});

test("hero motion prep stores only fields the animation frame path consumes", () => {
  const source = readHeroMotionSource();

  // Prep runs once per entrance and feeds the frame loop. A field it stores but
  // never reads costs measurement and memory on every run and shows up nowhere
  // in the DOM, so a browser spec has nothing to assert against.

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
  // data-motion-active was write-only; live hooks are mode/state/reveal. "the
  // homepage ships exactly one hero motion system" counts the attribute in the
  // DOM, but that count retries until it reaches zero, so an attribute written
  // for the length of the run and cleared on completion satisfies it. That is
  // the exact shape this line exists to forbid, so it stays.
  assert.doesNotMatch(source, /data-motion-active/);

  // Animation-frame consumers still present
  assert.match(source, /sourceIndex/);
  assert.match(source, /prep\.transfers/);
  assert.match(source, /prep\.copy/);
  assert.match(source, /prep\.portrait/);
});
