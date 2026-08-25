import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist, readSourceFile } from "./helpers.mjs";

// Selector hygiene for global.css. A class that appears in the markup is not
// enough: :focus and :focus-visible match the focused element itself, so the
// class must sit on an element that can receive focus. `.hero :focus-visible`
// is a different shape — the class is a container, not the subject — and is
// not this check.

/**
 * Class names that are the subject of :focus or :focus-visible.
 * `.project__preview:focus-visible` is one. `.hero :focus-visible` is not.
 */
function focusClassSubjects(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set();
  const pattern = /\.([a-z0-9_-]+)(?::[a-z][\w()-]*)*:focus(?:-visible)?(?![\w-])/gi;
  for (const match of stripped.matchAll(pattern)) names.add(match[1]);
  return [...names].sort();
}

function isFocusable(tag, attrs) {
  const name = tag.toLowerCase();
  if (/\btabindex\s*=/i.test(attrs)) return true;
  if (/\bcontenteditable\b/i.test(attrs) && !/\bcontenteditable\s*=\s*(["']?)false\1/i.test(attrs)) {
    return true;
  }
  if (name === "a" || name === "area") return /\bhref\s*=/i.test(attrs);
  if (name === "input") return !/\btype\s*=\s*(["']?)hidden\1/i.test(attrs);
  if (name === "audio" || name === "video") return /\bcontrols\b/i.test(attrs);
  return name === "button" || name === "select" || name === "textarea" || name === "summary" || name === "iframe";
}

function classCanReceiveFocus(html, className) {
  const tagRe = /<([a-zA-Z][\w:-]*)(\s[^>]*)?>/g;
  for (const match of html.matchAll(tagRe)) {
    const attrs = match[2] ?? "";
    const classAttr = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!classAttr) continue;
    const names = (classAttr[2] ?? classAttr[3]).trim().split(/\s+/);
    if (names.includes(className) && isFocusable(match[1], attrs)) return true;
  }
  return false;
}

function unreachableFocusClasses(css, html) {
  return focusClassSubjects(css).filter((name) => !classCanReceiveFocus(html, name));
}

function builtHtml() {
  assert.equal(existsSync(dist), true, `missing ${dist}/ — run \`npm test\` or \`npm run build\` first`);

  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "_astro") continue;
        walk(path);
      } else if (entry.name.endsWith(".html")) {
        pages.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(dist);
  assert.ok(pages.length > 0, "build must emit HTML to inspect");
  return pages.join("\n");
}

test("the focus-subject guard flags a class that cannot receive focus", () => {
  // Keeps the guard below falsifiable: it must flag a real class on an element
  // that can never enter :focus-visible, and must not flag a descendant
  // combinator or a class that sits on a link.

  assert.deepEqual(
    unreachableFocusClasses(
      ".project__preview:focus-visible { outline: 3px solid red }",
      '<div class="project__preview"><span>DS</span></div>',
    ),
    ["project__preview"],
    "a class on a non-focusable element must fail",
  );

  assert.deepEqual(
    unreachableFocusClasses(
      ".hero :focus-visible { outline-color: orange }",
      '<section class="hero"><a href="/">home</a></section>',
    ),
    [],
    "a descendant combinator is not a class subject",
  );

  assert.deepEqual(
    unreachableFocusClasses(
      ".skip-link:focus { outline: 2px solid red }",
      '<a class="skip-link" href="#main-content">Skip</a>',
    ),
    [],
    "a class on a link must pass",
  );

  assert.deepEqual(
    unreachableFocusClasses(
      ".ghost:focus-visible { outline: 1px solid red }",
      "<div></div>",
    ),
    ["ghost"],
    "a class that never appears in the HTML must fail",
  );

  assert.deepEqual(
    unreachableFocusClasses(
      ".preview:focus-within { outline: 1px solid red }",
      '<div class="preview"><a href="/">x</a></div>',
    ),
    [],
    ":focus-within is not :focus — a container can match it",
  );
});

test("class subjects of :focus and :focus-visible can receive focus", () => {
  const css = readSourceFile("styles", "global.css");
  const html = builtHtml();
  assert.deepEqual(
    unreachableFocusClasses(css, html),
    [],
    "every :focus / :focus-visible class subject must sit on a focusable element",
  );
});
