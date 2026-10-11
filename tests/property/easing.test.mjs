import test from "node:test";
import assert from "node:assert/strict";

import { easeOutCubic } from "../../src/shared/motion/easing.ts";

test("easeOutCubic starts at zero, ends at one, and never falls", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let previous = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const value = easeOutCubic(t);
    assert.ok(value >= previous, `easeOutCubic must not fall at ${t}`);
    previous = value;
  }
});
