import test from "node:test";
import assert from "node:assert/strict";

import { around, placeLabel, rectanglesOverlap, segmentIntersectsRectangle } from "../src/shared/page-graphics/labels.ts";

const HERE = { x0: 0, y0: 0, x1: 400, y1: 300 };

test("segmentIntersectsRectangle finds a segment that crosses, touches, or lies inside a box", () => {
  const box = { x0: 10, y0: 10, x1: 20, y1: 20 };
  assert.equal(segmentIntersectsRectangle({ ax: 0, ay: 15, bx: 30, by: 15 }, box), true, "a line through the box");
  assert.equal(segmentIntersectsRectangle({ ax: 12, ay: 12, bx: 14, by: 14 }, box), true, "a line inside the box");
  assert.equal(segmentIntersectsRectangle({ ax: 0, ay: 0, bx: 30, by: 5 }, box), false, "a line above the box");
  assert.equal(segmentIntersectsRectangle({ ax: 25, ay: 0, bx: 25, by: 40 }, box), false, "a vertical line beside the box");
});

test("placeLabel takes the first side that no edge crosses", () => {
  const free = placeLabel("VEGA", 200, 150, { widthInPixels: 24, bounds: HERE });
  assert.equal(free.side, "right", "with nothing in the way, the label goes right");
  assert.equal(free.align, "left");
  const blocked = [{ ax: 200, ay: 150, bx: 320, by: 150 }];
  const around = placeLabel("VEGA", 200, 150, { widthInPixels: 24, bounds: HERE, segments: blocked });
  assert.notEqual(around.side, "right", "an edge to the right must move the label");
  assert.ok(!blocked.some((segment) => segmentIntersectsRectangle(segment, around.rectangle)), "the chosen box must not touch the edge");
  assert.equal(around.clear, true);
});

test("placeLabel stays inside the bounds and keeps clear of earlier labels", () => {
  const bounds = { x0: 30, y0: 30, x1: 170, y1: 100 };
  const nearRight = placeLabel("VEGA · α LYR", 160, 60, { widthInPixels: 66, bounds });
  assert.ok(nearRight.rectangle.x0 >= bounds.x0 && nearRight.rectangle.x1 <= bounds.x1, "the label must not pass the right bound");
  assert.notEqual(nearRight.side, "right");
  const avoid = [];
  const first = placeLabel("ONE", 100, 60, { widthInPixels: 18, bounds: HERE, avoid });
  const second = placeLabel("TWO", 100, 60, { widthInPixels: 18, bounds: HERE, avoid });
  assert.equal(avoid.length, 2, "each label must reserve its box");
  assert.ok(!rectanglesOverlap(first.rectangle, second.rectangle), "two labels must not overlap");
  const none = placeLabel("VEGA", 5, 5, { widthInPixels: 24, bounds: { x0: 0, y0: 0, x1: 20, y1: 20 } });
  assert.equal(none.clear, false, "a label with no free place must say so");
  assert.ok(around(5, 5, 3).x1 === 8);
});
