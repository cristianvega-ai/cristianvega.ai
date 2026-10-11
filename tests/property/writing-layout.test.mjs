import test from "node:test";
import assert from "node:assert/strict";

import { LYRA as lyraStars } from "../../src/shared/lyra/constellation.ts";
import { buildField, pathToVega, LYRA_EDGES as lyraEdges } from "../../src/shared/page-graphics/scenes/writing-layout.ts";
import { starWidthsInPixels } from "../shared/node-helpers.mjs";

// Exercise a column and a narrow band with sparse and crowded content.
const fieldDimensions = [[480, 600], [320, 340]];

const createFieldArticles = (articleCount) => {
  const articleIdentifiers = Array.from({ length: articleCount }, (unusedValue, articleIndex) => `article-${articleIndex}-lorem-ipsum`);
  return { articleIdentifiers, labels: articleIdentifiers.map((unusedIdentifier, articleIndex) => `N\u00b0 ${String(articleCount - articleIndex).padStart(2, "0")}`), labelWidthsInPixels: new Array(articleCount).fill(30) };
};

test("pathToVega returns a connected path from each star to Vega", () => {
  assert.deepEqual(pathToVega(0, lyraEdges, lyraStars.length), [0]);
  for (let startStarIndex = 1; startStarIndex < lyraStars.length; startStarIndex += 1) {
    const starPath = pathToVega(startStarIndex, lyraEdges, lyraStars.length);
    assert.equal(starPath[0], startStarIndex);
    assert.equal(starPath[starPath.length - 1], 0);
    for (let pathIndex = 1; pathIndex < starPath.length; pathIndex += 1) {
      const pointsShareLink = lyraEdges.some(([startStarIndex, endStarIndex]) => (startStarIndex === starPath[pathIndex - 1] && endStarIndex === starPath[pathIndex]) || (endStarIndex === starPath[pathIndex - 1] && startStarIndex === starPath[pathIndex]));
      assert.ok(pointsShareLink, `step ${starPath[pathIndex - 1]} to ${starPath[pathIndex]} must follow a Lyra link`);
    }
  }
});

test("buildField places every article inside the layout bounds and clear of Lyra stars", () => {
  for (const [width, height] of fieldDimensions) {
    for (const articleCount of [1, 12]) {
      const { articleIdentifiers, labels, labelWidthsInPixels } = createFieldArticles(articleCount);
      const field = buildField({ articleIdentifiers, labels, labelWidthsInPixels, starWidthsInPixels, width, height });
      assert.equal(field.points.filter((point) => point.article).length, articleCount);
      assert.ok(field.points.slice(0, articleCount).every((point) => point.article), "article points must precede star points");
      for (const article of field.points.slice(0, articleCount)) {
        assert.ok(article.x > 0 && article.x < width && article.y > 0 && article.y < height, `${width}x${height}, ${articleCount} articles: each article must remain inside the layout bounds`);
        for (const star of field.stars) {
          assert.ok(Math.hypot(article.x - star.x, article.y - star.y) > 12, `${width}x${height}, ${articleCount} articles: each article must remain clear of Lyra stars`);
        }
      }
    }
  }
});

test("buildField creates unique links between distinct existing points", () => {
  const { articleIdentifiers, labels, labelWidthsInPixels } = createFieldArticles(8);
  const field = buildField({ articleIdentifiers, labels, labelWidthsInPixels, starWidthsInPixels, width: 480, height: 640 });
  const seenLinkKeys = new Set();
  for (const link of field.links) {
    assert.ok(link.from !== link.to);
    assert.ok(field.points[link.from] && field.points[link.to]);
    const linkKey = [Math.min(link.from, link.to), Math.max(link.from, link.to)].join("-");
    assert.ok(!seenLinkKeys.has(linkKey), `link ${linkKey} must appear once`);
    seenLinkKeys.add(linkKey);
  }
  assert.ok(field.links.length > 0, "the field must contain links");
});
