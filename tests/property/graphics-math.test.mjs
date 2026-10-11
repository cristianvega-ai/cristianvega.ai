import test from "node:test";
import assert from "node:assert/strict";

import { unit } from "../../src/shared/page-graphics/math.ts";

test("unit returns a repeatable value in the unit interval for each sampled index", () => {
  for (let sampleIndex = 0; sampleIndex < 200; sampleIndex += 1) {
    const sampleValue = unit(sampleIndex);
    assert.equal(sampleValue, unit(sampleIndex));
    assert.ok(sampleValue >= 0 && sampleValue < 1, `unit(${sampleIndex}) must be in [0, 1)`);
  }
});
