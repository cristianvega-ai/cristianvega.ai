import test from "node:test";
import assert from "node:assert/strict";

import { clamp } from "../../src/shared/motion/easing.ts";

test("clamp returns boundary values for out-of-range inputs and preserves values inside the range", () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
  assert.equal(clamp(15, 10, 20), 15);
  assert.equal(clamp(25, 10, 20), 20);
});
