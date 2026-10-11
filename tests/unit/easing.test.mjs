import test from "node:test";
import assert from "node:assert/strict";

import { clamp, cubicPoint } from "../../src/shared/motion/easing.ts";

test("clamp returns boundary values for out-of-range inputs and preserves values inside the range", () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
  assert.equal(clamp(15, 10, 20), 15);
  assert.equal(clamp(25, 10, 20), 20);
});

test("cubicPoint reuses the output point and returns each endpoint at zero and full progress", () => {
  const outputPoint = { x: 0, y: 0 };
  const startPoint = { x: 0, y: 0 };
  const endPoint = { x: 10, y: 20 };
  const returnedPoint = cubicPoint(outputPoint, 0, startPoint, { x: 3, y: 0 }, { x: 7, y: 20 }, endPoint);
  assert.equal(returnedPoint, outputPoint, "cubicPoint must reuse the output point");
  assert.deepEqual(outputPoint, { x: 0, y: 0 });
  cubicPoint(outputPoint, 1, startPoint, { x: 3, y: 0 }, { x: 7, y: 20 }, endPoint);
  assert.deepEqual(outputPoint, { x: 10, y: 20 });
});
