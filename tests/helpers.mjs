import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Fixtures more than one Node test file needs: the repository and build paths,
// the two file readers, and the page contract every rendered document must meet.
// A helper that only one suite uses stays in that suite.

// fileURLToPath, not URL.pathname: the latter stays percent-encoded, so a
// checkout under a path with spaces or non-ASCII characters would ENOENT.
export const root = fileURLToPath(new URL("..", import.meta.url));
export const dist = join(root, "dist");

export function readDistFile(...segments) {
  return readFileSync(join(dist, ...segments), "utf8");
}

export function readSourceFile(...segments) {
  return readFileSync(join(root, "src", ...segments), "utf8");
}

/** Count <h1>…</h1> occurrences (case-insensitive tag). */
function countH1(html) {
  return (html.match(/<h1\b[^>]*>/gi) || []).length;
}

export function assertPageBasics(html, { titleFragment, descriptionFragment } = {}) {
  assert.match(html, /<html\b[^>]*\blang="en"/i, "document language should be en");
  assert.match(html, /<link\b[^>]*rel="canonical"/i, "canonical URL required");
  assert.match(html, /<meta\b[^>]*name="description"/i, "meta description required");
  assert.equal(countH1(html), 1, "each page should have exactly one H1");
  if (titleFragment) assert.match(html, new RegExp(titleFragment, "i"));
  if (descriptionFragment) assert.match(html, new RegExp(descriptionFragment, "i"));
}
