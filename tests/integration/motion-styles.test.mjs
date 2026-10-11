import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist as buildDirectory } from "../shared/node-helpers.mjs";

// Check the compiled CSS reset. Browser tests check content visibility and canvas behavior.

const astroDirectory = join(buildDirectory, "_astro");

function readAstroAssets(extension) {
  return readdirSync(astroDirectory)
    .filter((file) => file.endsWith(extension))
    .map((file) => readFileSync(join(astroDirectory, file), "utf8"));
}

/**
 * Extract leaf rules with their at-rule preludes and complete nested selector paths.
 */
function parseRules(stylesheet, ruleContext = []) {
  const stylesheetRules = [];
  let characterIndex = 0;

  while (characterIndex < stylesheet.length) {
    const openingBraceIndex = stylesheet.indexOf("{", characterIndex);
    if (openingBraceIndex === -1) break;

    let braceDepth = 0;
    let closingBraceIndex = openingBraceIndex;
    for (; closingBraceIndex < stylesheet.length; closingBraceIndex += 1) {
      if (stylesheet[closingBraceIndex] === "{") braceDepth += 1;
      else if (stylesheet[closingBraceIndex] === "}") {
        braceDepth -= 1;
        if (braceDepth === 0) break;
      }
    }
    if (braceDepth !== 0) break;

    const prelude = stylesheet.slice(characterIndex, openingBraceIndex).trim();
    const ruleBody = stylesheet.slice(openingBraceIndex + 1, closingBraceIndex);

    if (/^@(?:media|supports|layer|container|scope)\b/.test(prelude)) {
      stylesheetRules.push(...parseRules(ruleBody, [...ruleContext, prelude]));
    } else if (!prelude.startsWith("@")) {
      if (ruleBody.includes("{")) stylesheetRules.push(...parseRules(ruleBody, [...ruleContext, prelude]));
      const atRulePreludes = ruleContext.filter((entry) => entry.startsWith("@"));
      const parentSelectors = ruleContext.filter((entry) => !entry.startsWith("@"));
      stylesheetRules.push({
        selector: [...parentSelectors, prelude].join(" "),
        declarations: ruleBody.replace(/[^{}]*\{[^{}]*\}/g, ""),
        atRulePreludes,
      });
    }

    characterIndex = closingBraceIndex + 1;
  }

  return stylesheetRules;
}

function parseDeclarations(rule) {
  return rule.declarations
    .split(";")
    .map((declaration) => {
      const colonIndex = declaration.indexOf(":");
      if (colonIndex === -1) return null;
      return {
        property: declaration.slice(0, colonIndex).trim().toLowerCase(),
        value: declaration
          .slice(colonIndex + 1)
          .replace(/!important/gi, "")
          .trim()
          .toLowerCase(),
      };
    })
    .filter(Boolean);
}

function declarationValue(rule, property) {
  return parseDeclarations(rule).findLast((entry) => entry.property === property)?.value;
}

const stylesheet = readAstroAssets(".css").join("\n");
const stylesheetRules = parseRules(stylesheet);

test("compiled styles reset motion for reduced preferences and limit page entrances to unrestricted motion preferences", () => {
  assert.ok(stylesheet.length > 1_000, "the build must contain a compiled stylesheet");

  const usesReducedMotion = (rule) =>
    rule.atRulePreludes.some((query) => /prefers-reduced-motion\s*:\s*reduce/.test(query));
  const reducedMotionRules = stylesheetRules.filter(usesReducedMotion);
  assert.ok(reducedMotionRules.length > 0, "the stylesheet must contain rules for reduced motion");

  // Check that the site reset limits animation and transition duration.
  const motionResetRule = reducedMotionRules.find((rule) => /(?:^|,)\s*\*/.test(rule.selector));
  assert.ok(motionResetRule, "reduced-motion rules must reset every element");
  assert.match(declarationValue(motionResetRule, "animation-duration") ?? "", /^0?\.01ms$/);
  assert.match(declarationValue(motionResetRule, "transition-duration") ?? "", /^0?\.01ms$/);
  assert.equal(declarationValue(motionResetRule, "animation-iteration-count"), "1");

  // Require the no-preference media condition for every page entrance animation.
  for (const rule of stylesheetRules) {
    if (!/\[data-page[=~^|$*\]]/.test(rule.selector)) continue;
    const animationValue = declarationValue(rule, "animation") ?? declarationValue(rule, "animation-name");
    if (!animationValue || /^none\b/.test(animationValue)) continue;
    assert.ok(
      rule.atRulePreludes.some((query) => /prefers-reduced-motion\s*:\s*no-preference/.test(query)),
      `page entrance ${rule.selector} must require the no-preference motion condition`,
    );
  }
});
