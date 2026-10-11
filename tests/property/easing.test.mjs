import test from "node:test";
import assert from "node:assert/strict";

import { easeOutCubic } from "../../src/shared/canvas/easing.ts";

test("easeOutCubic returns zero and one at the endpoints and increases monotonically across progress samples", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let previousValue = 0;
  for (let progress = 0.05; progress <= 1; progress += 0.05) {
    const easedProgress = easeOutCubic(progress);
    assert.ok(easedProgress >= previousValue, `easeOutCubic must not decrease at progress ${progress}`);
    previousValue = easedProgress;
  }
});
