import test from "node:test";
import assert from "node:assert/strict";

import { cubicPoint } from "../../src/shared/canvas/geometry.ts";

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
