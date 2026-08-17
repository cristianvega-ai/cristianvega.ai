import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { dist } from "./helpers.mjs";

// Motion contracts asserted over the compiled stylesheet rather than over a
// single source spelling: reduced motion must be honoured, and hero copy must
// never be hidden by CSS that only a running script can undo.

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

/** True when the rule makes its subject invisible rather than merely animating it. */
function hidesContent(rule) {
  return declarations(rule).some(({ property, value }) => {
    if (property === "opacity") return Number(value) === 0;
    if (property === "visibility") return value === "hidden";
    if (property === "display") return value === "none";
    if (property === "content-visibility") return value === "hidden";
    return false;
  });
}

const heroCopy = /\.hero__(?:name|sub|eyebrow|title)\b|\[data-motion-target/;

/**
 * Root-level state a script could stamp: data attributes (excluding the marker
 * that identifies the copy itself) and classes attached to html/:root.
 */
function selectorGates(selector) {
  const attributes = [...selector.matchAll(/\[(data-[a-z-]+)/g)]
    .map(([, name]) => name)
    .filter((name) => name !== "data-motion-target");
  const rootClasses = [...selector.matchAll(/(?:^|[\s>+~])(?:html|:root)((?:\.[A-Za-z0-9_-]+)+)/g)]
    .flatMap(([, chain]) => chain.slice(1).split("."));

  return [...attributes, ...rootClasses];
}

function gateIsStamped(gate, scripts) {
  if (gate.startsWith("data-")) {
    const property = gate.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return scripts.includes(gate) || new RegExp(`dataset\\.${property}\\b`).test(scripts);
  }

  return new RegExp(`(?:classList|className)[^;\\n]{0,120}["'\`]${gate}["'\`]`).test(scripts);
}

/** Rules that hide hero copy without a gate that some shipped script sets. */
function findUngatedHides(rules, scripts) {
  return rules
    .filter((rule) => heroCopy.test(rule.selector) && hidesContent(rule))
    .filter((rule) => !selectorGates(rule.selector).some((gate) => gateIsStamped(gate, scripts)));
}

/**
 * Every script the site ships. If a gate is stamped nowhere in this corpus it
 * cannot be stamped at all, which is the condition the no-JS contract needs.
 */
function shippedScripts() {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc=/i.test(attributes))
    .map(([, , body]) => body);

  return [...inline, ...readAstroAssets(".js")].join("\n");
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

  // The animated hero surfaces are covered explicitly, not just blunted.
  const targetsVisible = reduceRules.some(
    (rule) => /\[data-motion-target/.test(rule.selector) && declarationValue(rule, "opacity") === "1",
  );
  assert.ok(targetsVisible, "reduce block must leave hero motion targets visible");

  const tickerSettled = reduceRules.some(
    (rule) => /\.hero__ticker\b/.test(rule.selector) && declarationValue(rule, "animation") === "none",
  );
  assert.ok(tickerSettled, "reduce block must stop the hero ticker entrance");

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

test("no compiled rule hides hero copy unless a shipped script stamps the gate", () => {
  const scripts = shippedScripts();
  assert.ok(scripts.trim().length > 0, "homepage must ship scripts to inspect");

  const ungated = findUngatedHides(rules, scripts);
  assert.deepEqual(
    ungated.map((rule) => rule.selector),
    [],
    "hero copy must stay visible when JavaScript never runs",
  );
});

test("the pre-hide guard catches the regression shapes it claims to", () => {
  // Keeps the guard above falsifiable: it must flag hides that survive a failed
  // script, and must not flag a hide gated on state the script actually sets.
  const scripts = 'root.dataset.motionState = "playing";';
  const ungatedShapes = [
    ".hero [data-motion-target]{opacity:0}",
    ".hero__name,.hero__sub{opacity:0}",
    "html.js .hero__name{opacity:0}",
    ".hero__eyebrow{visibility:hidden}",
    "@media (min-width:900px){.hero__sub{display:none}}",
  ];

  for (const shape of ungatedShapes) {
    assert.equal(
      findUngatedHides(parseRules(shape), scripts).length,
      1,
      `guard must flag this hide: ${shape}`,
    );
  }

  const gated = '.hero[data-motion-state="playing"] [data-motion-target]{opacity:0}';
  assert.deepEqual(findUngatedHides(parseRules(gated), scripts), [], "gated hides are legitimate");
});
