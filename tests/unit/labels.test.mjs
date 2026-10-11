import test from "node:test";
import assert from "node:assert/strict";

import { around, placeLabel, rectanglesOverlap, segmentIntersectsRectangle } from "../../src/shared/page-graphics/labels.ts";

const labelBounds = { x0: 0, y0: 0, x1: 400, y1: 300 };
// The line of a 10px label.
const lineHeightInPixels = 12;

test("segmentIntersectsRectangle detects crossing and contained segments and rejects segments outside the rectangle", () => {
  const rectangle = { x0: 10, y0: 10, x1: 20, y1: 20 };
  assert.equal(segmentIntersectsRectangle({ startX: 0, startY: 15, endX: 30, endY: 15 }, rectangle), true, "a segment crossing the rectangle must intersect");
  assert.equal(segmentIntersectsRectangle({ startX: 12, startY: 12, endX: 14, endY: 14 }, rectangle), true, "a segment inside the rectangle must intersect");
  assert.equal(segmentIntersectsRectangle({ startX: 0, startY: 0, endX: 30, endY: 5 }, rectangle), false, "a segment above the rectangle must not intersect");
  assert.equal(segmentIntersectsRectangle({ startX: 25, startY: 0, endX: 25, endY: 40 }, rectangle), false, "a vertical segment beside the rectangle must not intersect");
});

test("placeLabel uses the first side that avoids blocking segments", () => {
  const unobstructedLabel = placeLabel("VEGA", 200, 150, { widthInPixels: 24, lineHeightInPixels, bounds: labelBounds });
  assert.equal(unobstructedLabel.side, "right", "an unobstructed label must use the right side");
  assert.equal(unobstructedLabel.align, "left");
  const blockingSegments = [{ startX: 200, startY: 150, endX: 320, endY: 150 }];
  const labelBesideSegment = placeLabel("VEGA", 200, 150, { widthInPixels: 24, lineHeightInPixels, bounds: labelBounds, segments: blockingSegments });
  assert.notEqual(labelBesideSegment.side, "right", "a blocking segment on the right must change the label side");
  assert.ok(!blockingSegments.some((segment) => segmentIntersectsRectangle(segment, labelBesideSegment.rectangle)), "the selected label rectangle must not intersect a blocking segment");
  assert.equal(labelBesideSegment.clear, true);
});

test("placeLabel respects placement bounds and reserved rectangles and reports insufficient space", () => {
  const placementBounds = { x0: 30, y0: 30, x1: 170, y1: 100 };
  const labelNearRightBoundary = placeLabel("VEGA · α LYR", 160, 60, { widthInPixels: 66, lineHeightInPixels, bounds: placementBounds });
  assert.ok(labelNearRightBoundary.rectangle.x0 >= placementBounds.x0 && labelNearRightBoundary.rectangle.x1 <= placementBounds.x1, "a label near the right boundary must remain inside the horizontal bounds");
  assert.notEqual(labelNearRightBoundary.side, "right");
  const reservedRectangles = [];
  const firstLabel = placeLabel("ONE", 100, 60, { widthInPixels: 18, lineHeightInPixels, bounds: labelBounds, avoid: reservedRectangles });
  const secondLabel = placeLabel("TWO", 100, 60, { widthInPixels: 18, lineHeightInPixels, bounds: labelBounds, avoid: reservedRectangles });
  assert.equal(reservedRectangles.length, 2, "each placed label must reserve its rectangle");
  assert.ok(!rectanglesOverlap(firstLabel.rectangle, secondLabel.rectangle), "the placed label rectangles must not overlap");
  const labelWithoutSpace = placeLabel("VEGA", 5, 5, { widthInPixels: 24, lineHeightInPixels, bounds: { x0: 0, y0: 0, x1: 20, y1: 20 } });
  assert.equal(labelWithoutSpace.clear, false, "a label without sufficient space must report clear as false");
  assert.ok(around(5, 5, 3).x1 === 8);
});
