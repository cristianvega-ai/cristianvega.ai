import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync } from "node:fs";

import { readSourceFile } from "./helpers.mjs";

// Design-token hygiene for the site stylesheet. global.css is the source of
// truth for the tokens. A token that is declared and never read through var()
// in any site stylesheet is dead, including one this file has never named.
// Page stylesheets (home.css, writing.css) read tokens that global.css declares.

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

test("global.css defines the sky token that the graphics read", () => {
  // The canvas resolves any CSS color through the browser, so the token can use any color format.
  const css = readSourceFile("styles", "global.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const sky = css.match(/(?:^|[;{}])\s*--sky\s*:\s*([^;}]+)/)?.[1]?.trim();
  assert.ok(sky, "global.css must define --sky");
});

// A page stylesheet may redefine a global.css token only for the reason listed here. Audit finding 1
// came from this pattern: writing.css gave --ink-2 a light value on article pages, and the shared menu panel
// that reads --ink-2 turned light on light. Add an entry only with the reason the new meaning is safe.
const TOKEN_OVERRIDES = {
  "writing.css": {
    // Article pages sit on ink. The shared header, brand, and nav rules in global.css read the "on surface"
    // tokens, so the article page gives them their ink values. Each one keeps its role: text stays text,
    // and a ground stays a ground.
    "--fg": "article pages sit on ink",
    "--muted": "article pages sit on ink",
    "--line": "article pages sit on ink",
    "--surface-well": "article pages sit on ink",
    "--mark2-surface": "article pages sit on ink",
  },
  "home.css": {
    // The homepage grid is faded, so its lines can be a little stronger. The token keeps its meaning.
    "--grid-line": "the homepage grid is faded",
    // From 1100px the homepage does not scroll, so it needs no fade above the footer.
    "--footer-fade": "the homepage does not scroll from 1100px",
  },
};

test("page stylesheets redefine global tokens only from the commented allowlist", () => {
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = (css) => [...strip(css).matchAll(/(?:^|[;{}])\s*(--[a-z0-9-]+)\s*:/gi)].map(([, name]) => name.toLowerCase());
  const global = new Set(declarations(readSourceFile("styles", "global.css")));
  const sheets = readdirSync(new URL("../src/styles/", import.meta.url)).filter((name) => name.endsWith(".css") && name !== "global.css");
  const found = {};
  for (const sheet of sheets) {
    for (const name of declarations(readSourceFile("styles", sheet))) {
      if (!global.has(name)) continue;
      (found[sheet] ??= new Set()).add(name);
      assert.ok(TOKEN_OVERRIDES[sheet]?.[name], `${sheet} redefines the global token ${name}. Use a page token, or add a reason to TOKEN_OVERRIDES.`);
    }
  }
  for (const [sheet, names] of Object.entries(TOKEN_OVERRIDES)) {
    for (const name of Object.keys(names)) {
      assert.ok(found[sheet]?.has(name), `${sheet} no longer redefines ${name}. Remove it from TOKEN_OVERRIDES.`);
    }
  }
});
