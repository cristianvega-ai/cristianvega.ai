import test from "node:test";
import assert from "node:assert/strict";

import { unit } from "../../src/shared/page-graphics/math.ts";

test("unit gives the same value for an index and stays below one", () => {
  for (let i = 0; i < 200; i += 1) {
    const value = unit(i);
    assert.equal(value, unit(i));
    assert.ok(value >= 0 && value < 1, `unit(${i}) must be in [0, 1)`);
  }
});
