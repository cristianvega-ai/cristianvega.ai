import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync } from "node:fs";

import { readSourceFile } from "./helpers.mjs";

// Design-token hygiene for the site stylesheet. global.css is the source of
// truth for the tokens. A token that is declared and never read through var()
// in any site stylesheet is dead, including one this file has never named.
// Page stylesheets (home.css, blog.css) read tokens that global.css declares.

test("design tokens omit unused custom properties", () => {
  const css = readSourceFile("styles", "global.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // Declaration position only, so `.btn--signal:hover` is not a token.
  const declared = new Set(
    [...css.matchAll(/(?:^|[;{}])\s*--([a-z0-9-]+)\s*:/gi)].map(([, name]) => name.toLowerCase()),
  );
  const sheets = readdirSync(new URL("../src/styles/", import.meta.url)).filter((name) => name.endsWith(".css"));
  const readable = sheets
    .map((name) => readSourceFile("styles", name))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const read = new Set(
    [...readable.matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map(([, name]) => name.toLowerCase()),
  );
  const unused = [...declared].filter((name) => !read.has(name)).sort();

  assert.deepEqual(
    unused,
    [],
    `unused custom properties: ${unused.map((name) => `--${name}`).join(", ")}`,
  );
});

test("graphic sky tokens use six hexadecimal digits", () => {
  const sheets = readdirSync(new URL("../src/styles/", import.meta.url)).filter((name) => name.endsWith(".css"));
  const definitions = sheets.flatMap((name) => {
    const css = readSourceFile("styles", name).replace(/\/\*[\s\S]*?\*\//g, "");
    return [...css.matchAll(/(?:^|[;{}])\s*--sky\s*:\s*([^;}]+)/g)].map(([, value]) => ({ name, value: value.trim() }));
  });

  assert.ok(definitions.some(({ name }) => name === "global.css"), "global.css must define --sky");
  for (const { name, value } of definitions) {
    assert.equal(value.length, 7, `${name}: --sky must contain seven characters`);
    assert.match(value, /^#[0-9a-f]{6}$/i, `${name}: --sky must use #RRGGBB`);
  }
});
