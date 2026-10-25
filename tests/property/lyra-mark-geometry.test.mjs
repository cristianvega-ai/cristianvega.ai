import test from "node:test";
import assert from "node:assert/strict";

import { LYRA as lyraStars, LYRA_LINKS as lyraLinks } from "../../src/shared/lyra/constellation.ts";
import { FIGURE_STROKES as figureStrokes, MARK_EXTENT as markExtent, MARK_LINES as markLines, MARK_STARS as markStars } from "../../src/shared/lyra/mark-geometry.ts";

test("LYRA_LINKS references existing stars for every constellation link", () => {
  assert.ok(lyraStars.length > 0 && lyraLinks.length > 0, "the Lyra constellation must contain stars and links");
  for (const [startStarIndex, endStarIndex] of lyraLinks) {
    assert.ok(lyraStars[startStarIndex] && lyraStars[endStarIndex], `link ${startStarIndex}-${endStarIndex} must reference two existing stars`);
  }
});

// A stroke that is not a constellation link would draw a line Lyra does not have.
test("the mark draws each constellation link once, toward Vega", () => {
  assert.equal(figureStrokes.length, lyraLinks.length, "the mark must draw every constellation link");
  const linkKeys = lyraLinks.map(([first, second]) => [first, second].sort().join("-"));
  const strokeKeys = figureStrokes.map(([from, to]) => [from, to].sort().join("-"));
  assert.deepEqual([...strokeKeys].sort(), [...linkKeys].sort(), "the mark strokes must be the constellation links");
  for (const [fromIndex, toIndex] of figureStrokes) {
    assert.notEqual(fromIndex, 0, `stroke ${fromIndex}-${toIndex} must not start at Vega, because each line runs toward it`);
  }
});

// The figure turns about the view box origin, so every point must stay inside the
// view box at any angle: inside the circle that the view box contains.
test("every mark star and line end stays inside the view box at every sky angle", () => {
  assert.equal(markStars.length, lyraStars.length, "the mark must place every star");
  const points = [
    ...markStars.map((star) => ({ x: star.x, y: star.y, reach: star.radius })),
    ...markLines.flatMap((line) => [{ x: line.x1, y: line.y1, reach: 0 }, { x: line.x2, y: line.y2, reach: 0 }]),
  ];
  for (const point of points) {
    assert.ok(Math.hypot(point.x, point.y) + point.reach <= markExtent, `point ${point.x},${point.y} must stay inside the rotating view box`);
  }
});

// A line that touches a star dot reads as a blot at the small reading-star size.
test("every mark line stops short of both of its stars", () => {
  assert.equal(markLines.length, figureStrokes.length, "the mark must have one line for each stroke");
  markLines.forEach((line, lineIndex) => {
    const [fromIndex, toIndex] = figureStrokes[lineIndex];
    const from = markStars[fromIndex];
    const to = markStars[toIndex];
    assert.ok(Math.hypot(line.x1 - from.x, line.y1 - from.y) > from.radius, `line ${lineIndex} must start outside star ${fromIndex}`);
    assert.ok(Math.hypot(line.x2 - to.x, line.y2 - to.y) > to.radius, `line ${lineIndex} must end outside star ${toIndex}`);
    const lineLength = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const starDistance = Math.hypot(to.x - from.x, to.y - from.y);
    assert.ok(lineLength > 0 && lineLength < starDistance, `line ${lineIndex} must be shorter than the distance between its stars`);
  });
});
