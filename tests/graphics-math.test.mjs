import test from "node:test";
import assert from "node:assert/strict";

import { stagger } from "../src/lib/lyra-render/clock.ts";
import { lerp, smooth, unit } from "../src/lib/lyra-render/math.ts";

test("stagger, smooth, and lerp stay inside their ranges", () => {
  assert.equal(stagger(0.1, 0.2, 0.4), 0);
  assert.equal(stagger(0.4, 0.2, 0.4), 0.5);
  assert.equal(stagger(0.9, 0.2, 0.4), 1);
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
  assert.equal(smooth(0.5), 0.5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
});

test("unit gives the same value for an index and stays below one", () => {
  for (let i = 0; i < 200; i += 1) {
    const value = unit(i);
    assert.equal(value, unit(i));
    assert.ok(value >= 0 && value < 1, `unit(${i}) must be in [0, 1)`);
  }
});
