import test from "node:test";
import assert from "node:assert/strict";

import { aboutLayout } from "../src/shared/page-graphics/scenes/about.ts";

// Exercise the two layout branches: a tall column and a short band.
const aboutBoxes = [[456, 762], [680, 136]];

test("the About path and ring stay inside a column and a band", () => {
  for (const [width, height] of aboutBoxes) {
    const { vx, vy, ring, curve } = aboutLayout(width, height);
    assert.ok(ring > 0, `${width}x${height}: the ring must have a positive radius`);
    assert.ok(vx - ring >= 0 && vx + ring <= width, `${width}x${height}: the ring must fit horizontally`);
    assert.ok(vy - ring >= 0 && vy + ring <= height, `${width}x${height}: the ring must fit vertically`);
    assert.equal(curve.length, 8, "the path must contain four control points");
    for (let index = 0; index < curve.length; index += 2) {
      assert.ok(curve[index] >= 0 && curve[index] <= width, `${width}x${height}: path x must fit`);
      assert.ok(curve[index + 1] >= 0 && curve[index + 1] <= height, `${width}x${height}: path y must fit`);
    }
  }
});
