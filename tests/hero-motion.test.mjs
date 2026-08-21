import test from "node:test";
import assert from "node:assert/strict";

import { readDistFile } from "./helpers.mjs";

// Built-output contracts for the hero motion system. Runtime behaviour belongs
// to tests/e2e/hero.spec.mjs. Compiled CSS belongs to tests/motion-css.test.mjs.
// This file does not read .ts or .astro source.

test("the built homepage ships no superseded hero component", () => {
  const html = readDistFile("index.html");

  // A component that renders nothing can still be imported, and the build then
  // ships its bundle as a module URL in the head. That costs a request and
  // leaves no element behind, so only a scan of the built bytes finds it. The
  // DOM side of the same question is asserted in "the homepage ships exactly
  // one hero motion system" (tests/e2e/hero.spec.mjs).
  assert.doesNotMatch(html, /HeroPortrait|HeroDots/);
});

