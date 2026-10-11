import test from "node:test";
import assert from "node:assert/strict";

import { LYRA } from "../../src/shared/lyra/constellation.ts";
import { buildField, pathToVega, LYRA_EDGES } from "../../src/shared/page-graphics/scenes/writing-layout.ts";
import { starWidthsInPixels } from "../support/helpers.mjs";

// Exercise a column and a narrow band with sparse and crowded content.
const fieldSizes = [[480, 600], [320, 340]];

const fieldArticles = (count) => {
  const articleIdentifiers = Array.from({ length: count }, (_, i) => `article-${i}-lorem-ipsum`);
  return { articleIdentifiers, labels: articleIdentifiers.map((_, i) => `N\u00b0 ${String(count - i).padStart(2, "0")}`), labelWidthsInPixels: new Array(count).fill(30) };
};

test("pathToVega walks the Lyra links from a star to Vega", () => {
  assert.deepEqual(pathToVega(0, LYRA_EDGES, LYRA.length), [0]);
  for (let start = 1; start < LYRA.length; start += 1) {
    const path = pathToVega(start, LYRA_EDGES, LYRA.length);
    assert.equal(path[0], start);
    assert.equal(path[path.length - 1], 0);
    for (let i = 1; i < path.length; i += 1) {
      const linked = LYRA_EDGES.some(([a, b]) => (a === path[i - 1] && b === path[i]) || (b === path[i - 1] && a === path[i]));
      assert.ok(linked, `step ${path[i - 1]} to ${path[i]} must follow a Lyra link`);
    }
  }
});

test("the reading field keeps every article inside its box and out of the Lyra figure", () => {
  for (const [w, h] of fieldSizes) {
    for (const count of [1, 12]) {
      const { articleIdentifiers, labels, labelWidthsInPixels } = fieldArticles(count);
      const field = buildField({ articleIdentifiers, labels, labelWidthsInPixels, starWidthsInPixels, width: w, height: h });
      assert.equal(field.points.filter((point) => point.article).length, count);
      assert.ok(field.points.slice(0, count).every((point) => point.article), "articles must come first");
      for (const article of field.points.slice(0, count)) {
        assert.ok(article.x > 0 && article.x < w && article.y > 0 && article.y < h, `${w}x${h}, ${count} articles: an article must sit inside the box`);
        for (const star of field.stars) {
          assert.ok(Math.hypot(article.x - star.x, article.y - star.y) > 12, `${w}x${h}, ${count} articles: an article must not sit on a Lyra star`);
        }
      }
    }
  }
});

test("the reading field links each point once, and every link joins two real points", () => {
  const { articleIdentifiers, labels, labelWidthsInPixels } = fieldArticles(8);
  const field = buildField({ articleIdentifiers, labels, labelWidthsInPixels, starWidthsInPixels, width: 480, height: 640 });
  const seen = new Set();
  for (const link of field.links) {
    assert.ok(link.from !== link.to);
    assert.ok(field.points[link.from] && field.points[link.to]);
    const key = [Math.min(link.from, link.to), Math.max(link.from, link.to)].join("-");
    assert.ok(!seen.has(key), `link ${key} must appear once`);
    seen.add(key);
  }
  assert.ok(field.links.length > 0, "the field must contain links");
});
