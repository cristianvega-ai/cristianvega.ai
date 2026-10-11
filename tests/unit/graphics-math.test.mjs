import test from "node:test";
import assert from "node:assert/strict";

import { stagger } from "../../src/shared/motion/clock.ts";
import { interpolate, smooth } from "../../src/shared/page-graphics/math.ts";

test("stagger, smooth, and interpolate return expected values for fixed boundary and intermediate inputs", () => {
  assert.equal(stagger(0.1, 0.2, 0.4), 0);
  assert.equal(stagger(0.4, 0.2, 0.4), 0.5);
  assert.equal(stagger(0.9, 0.2, 0.4), 1);
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
  assert.equal(smooth(0.5), 0.5);
  assert.equal(interpolate(10, 20, 0.25), 12.5);
});
