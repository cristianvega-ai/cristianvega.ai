import test from "node:test";
import assert from "node:assert/strict";

import { DURATION as entranceDuration, entranceProgress } from "../../src/shared/canvas/clock.ts";

test("entranceProgress returns bounded endpoints and increases monotonically across elapsed-time samples", () => {
  assert.equal(entranceProgress(0), 0);
  assert.equal(entranceProgress(entranceDuration), 1);
  assert.equal(entranceProgress(entranceDuration * 3), 1);
  let previousProgress = 0;
  for (let elapsedMilliseconds = 0; elapsedMilliseconds <= entranceDuration; elapsedMilliseconds += 50) {
    const progress = entranceProgress(elapsedMilliseconds);
    assert.ok(progress >= previousProgress, `entranceProgress must not decrease at elapsed time ${elapsedMilliseconds} milliseconds`);
    previousProgress = progress;
  }
});
