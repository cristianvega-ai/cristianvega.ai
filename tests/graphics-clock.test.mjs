import test from "node:test";
import assert from "node:assert/strict";

import { DURATION, entranceProgress } from "../src/lib/lyra-render/clock.ts";

test("the page graphic entrance clock starts at zero, ends at one, and never falls", () => {
  assert.equal(entranceProgress(0), 0);
  assert.equal(entranceProgress(DURATION), 1);
  assert.equal(entranceProgress(DURATION * 3), 1);
  let previous = 0;
  for (let elapsed = 0; elapsed <= DURATION; elapsed += 50) {
    const value = entranceProgress(elapsed);
    assert.ok(value >= previous, `the clock must not fall at ${elapsed} ms`);
    previous = value;
  }
});
