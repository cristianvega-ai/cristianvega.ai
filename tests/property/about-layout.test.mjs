import test from "node:test";
import assert from "node:assert/strict";

import { aboutLayout } from "../../src/shared/page-graphics/scenes/about-layout.ts";

// Exercise the two layout branches: a tall column and a short band.
const aboutBounds = [[456, 762], [680, 136]];

test("aboutLayout keeps the control points and Vega ring inside column and band bounds", () => {
  for (const [width, height] of aboutBounds) {
    const { vx: vegaX, vy: vegaY, ring: ringRadius, curve: controlPoints } = aboutLayout(width, height);
    assert.ok(ringRadius > 0, `${width}x${height}: the ring must have a positive radius`);
    assert.ok(vegaX - ringRadius >= 0 && vegaX + ringRadius <= width, `${width}x${height}: the ring must fit horizontally`);
    assert.ok(vegaY - ringRadius >= 0 && vegaY + ringRadius <= height, `${width}x${height}: the ring must fit vertically`);
    assert.equal(controlPoints.length, 8, "the path must contain four control points");
    for (let coordinateIndex = 0; coordinateIndex < controlPoints.length; coordinateIndex += 2) {
      assert.ok(controlPoints[coordinateIndex] >= 0 && controlPoints[coordinateIndex] <= width, `${width}x${height}: the control point x coordinate must fit the width`);
      assert.ok(controlPoints[coordinateIndex + 1] >= 0 && controlPoints[coordinateIndex + 1] <= height, `${width}x${height}: the control point y coordinate must fit the height`);
    }
  }
});
