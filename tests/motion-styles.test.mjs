import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist } from "./helpers.mjs";

// Check the compiled CSS reset. Browser tests check content visibility and canvas behavior.

const astroDir = join(dist, "_astro");

function readAstroAssets(extension) {
  return readdirSync(astroDir)
    .filter((file) => file.endsWith(extension))
    .map((file) => readFileSync(join(astroDir, file), "utf8"));
}

/**
 * Flatten a stylesheet into leaf rules, keeping the at-rule preludes each rule
 * sits under and the full selector path when nesting is present.
 */
function parseRules(css, context = []) {
  const rules = [];
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) break;

    let depth = 0;
    let close = open;
    for (; close < css.length; close += 1) {
      if (css[close] === "{") depth += 1;
      else if (css[close] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;

    const prelude = css.slice(index, open).trim();
    const body = css.slice(open + 1, close);

    if (/^@(?:media|supports|layer|container|scope)\b/.test(prelude)) {
      rules.push(...parseRules(body, [...context, prelude]));
    } else if (!prelude.startsWith("@")) {
      if (body.includes("{")) rules.push(...parseRules(body, [...context, prelude]));
      const media = context.filter((entry) => entry.startsWith("@"));
      const parents = context.filter((entry) => !entry.startsWith("@"));
      rules.push({
        selector: [...parents, prelude].join(" "),
        declarations: body.replace(/[^{}]*\{[^{}]*\}/g, ""),
        media,
      });
    }

    index = close + 1;
  }

  return rules;
}

function declarations(rule) {
  return rule.declarations
    .split(";")
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon === -1) return null;
      return {
        property: declaration.slice(0, colon).trim().toLowerCase(),
        value: declaration
          .slice(colon + 1)
          .replace(/!important/gi, "")
          .trim()
          .toLowerCase(),
      };
    })
    .filter(Boolean);
}

function declarationValue(rule, property) {
  return declarations(rule).findLast((entry) => entry.property === property)?.value;
}

const css = readAstroAssets(".css").join("\n");
const rules = parseRules(css);

test("compiled css ships a meaningful reduced-motion contract", () => {
  assert.ok(css.length > 1_000, "compiled stylesheet required");

  const isReduce = (rule) =>
    rule.media.some((query) => /prefers-reduced-motion\s*:\s*reduce/.test(query));
  const reduceRules = rules.filter(isReduce);
  assert.ok(reduceRules.length > 0, "a prefers-reduced-motion: reduce block is required");

  // Site-wide reset: animations and transitions collapse instead of playing.
  const reset = reduceRules.find((rule) => /(?:^|,)\s*\*/.test(rule.selector));
  assert.ok(reset, "reduce block must reset every element");
  assert.match(declarationValue(reset, "animation-duration") ?? "", /^0?\.01ms$/);
  assert.match(declarationValue(reset, "transition-duration") ?? "", /^0?\.01ms$/);
  assert.equal(declarationValue(reset, "animation-iteration-count"), "1");

  // Page entrances must live inside the no-preference wrapper, so a new one
  // cannot animate for users who asked for reduced motion.
  for (const rule of rules) {
    if (!/\[data-page[=~^|$*\]]/.test(rule.selector)) continue;
    const animation = declarationValue(rule, "animation") ?? declarationValue(rule, "animation-name");
    if (!animation || /^none\b/.test(animation)) continue;
    assert.ok(
      rule.media.some((query) => /prefers-reduced-motion\s*:\s*no-preference/.test(query)),
      `page entrance animates outside a no-preference block: ${rule.selector}`,
    );
  }
});
