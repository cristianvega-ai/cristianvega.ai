import test from "node:test";
import assert from "node:assert/strict";

import { readSourceFile } from "./helpers.mjs";

// Design-token hygiene for the site stylesheet. global.css is the source of
// truth for the tokens. Dead tokens must not remain in the file.

test("design tokens omit unused custom properties", () => {
  const css = readSourceFile("styles", "global.css");
  const dead = [
    "--ink-3:",
    "--surface-2:",
    "--hairline-2:",
    "--muted-2:",
    "--grad-soft:",
    "--gradient-soft:",
    "--code-chrome:",
    "--code-line:",
    "--code-gutter:",
    "--syn-string:",
    "--syn-number:",
    "--syn-type:",
    "--seam:",
    /* The hero ticker was the only reader of this token. */
    "--mast-meta:",
    "--masthead-meta:",
  ];
  for (const decl of dead) {
    assert.doesNotMatch(css, new RegExp(decl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
