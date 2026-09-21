import test from "node:test";
import assert from "node:assert/strict";

import { readSourceFile } from "./helpers.mjs";

// Design-token hygiene for the site stylesheet. global.css is the source of
// truth for the tokens. A token that is declared and never read through var()
// is dead, including one this file has never named.

test("design tokens omit unused custom properties", () => {
  const css = readSourceFile("styles", "global.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // Declaration position only, so `.btn--signal:hover` is not a token.
  const declared = new Set(
    [...css.matchAll(/(?:^|[;{}])\s*--([a-z0-9-]+)\s*:/gi)].map(([, name]) => name.toLowerCase()),
  );
  const read = new Set(
    [...css.matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map(([, name]) => name.toLowerCase()),
  );
  const unused = [...declared].filter((name) => !read.has(name)).sort();

  assert.deepEqual(
    unused,
    [],
    `unused custom properties: ${unused.map((name) => `--${name}`).join(", ")}`,
  );
});

