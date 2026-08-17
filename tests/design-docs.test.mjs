import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { readSourceFile, root } from "./helpers.mjs";

// The standalone design contract documents at the repository root —
// reference.html and spec-template.html — plus the design tokens they copy.
// These files are not part of the Astro build, so nothing else covers them:
// their content must stay reachable without JavaScript, and dead tokens must
// not keep propagating from the stylesheet into the documents.

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
