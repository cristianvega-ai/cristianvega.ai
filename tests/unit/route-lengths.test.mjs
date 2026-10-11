import test from "node:test";
import assert from "node:assert/strict";

import { makeRoute } from "../../src/shared/canvas/comets.ts";

test("makeRoute calculates cumulative lengths for a route with fixed points", () => {
  const route = makeRoute([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
  assert.deepEqual([...route.lengths], [0, 5, 11]);
  assert.equal(route.length, 11);
});
