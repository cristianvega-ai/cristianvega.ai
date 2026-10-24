import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist as buildDirectory } from "../shared/node-helpers.mjs";

// Check the compiled CSS reset and the page transition switch. Browser tests check content visibility and motion.

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
    } else if (prelude === "@view-transition") {
      // The rule has no selector. Record it as a rule named by its at-rule.
      stylesheetRules.push({ selector: prelude, declarations: ruleBody, atRulePreludes: ruleContext.filter((entry) => entry.startsWith("@")) });
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

test("compiled styles reset animation and transition time for reduced motion preferences", () => {
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
});

test("compiled styles opt in to cross-document page transitions and switch them off for reduced motion", () => {
  const transitionRules = stylesheetRules.filter((rule) => rule.selector === "@view-transition");
  const isReduced = (rule) => rule.atRulePreludes.some((query) => /prefers-reduced-motion\s*:\s*reduce/.test(query));
  const optInRule = transitionRules.find((rule) => !isReduced(rule));
  assert.ok(optInRule, "the stylesheet must contain an @view-transition rule outside reduced motion");
  assert.equal(declarationValue(optInRule, "navigation"), "auto", "page transitions must be on by default");
  const reducedRule = transitionRules.find(isReduced);
  assert.ok(reducedRule, "the stylesheet must switch page transitions off for reduced motion");
  assert.equal(declarationValue(reducedRule, "navigation"), "none", "reduced motion must switch page transitions off");
});

test("compiled styles run the page entrance only under the no-preference motion condition", () => {
  const entranceRules = stylesheetRules.filter((rule) => /(^|[\s,])\.enter(?:\[|\s|,|$)/.test(rule.selector) && !/\.arrived/.test(rule.selector));
  assert.ok(entranceRules.length > 0, "the stylesheet must contain the entrance rules");
  const animatedRules = entranceRules.filter((rule) => {
    const animationValue = declarationValue(rule, "animation") ?? declarationValue(rule, "animation-name");
    return animationValue && !/^none\b/.test(animationValue);
  });
  assert.ok(animatedRules.length > 0, "the entrance must animate");
  for (const rule of animatedRules) {
    assert.ok(
      rule.atRulePreludes.some((query) => /prefers-reduced-motion\s*:\s*no-preference/.test(query)),
      `entrance ${rule.selector} must require the no-preference motion condition`,
    );
  }
  // The entrance steps only delay the animation, so they carry the same condition.
  const delayedRules = entranceRules.filter((rule) => /\[data-step/.test(rule.selector));
  assert.ok(delayedRules.length >= 6, "the entrance must stagger six steps");
  for (const rule of delayedRules) {
    assert.ok(rule.atRulePreludes.some((query) => /no-preference/.test(query)), `step ${rule.selector} must require the no-preference motion condition`);
  }
});
