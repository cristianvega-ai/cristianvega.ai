import test from "node:test";
import assert from "node:assert/strict";

import { MAXIMUM_SLOTS, assertProductCapacity } from "../../src/shared/page-graphics/scenes/product-slots.ts";
import { MINIMUM_SLOTS, planOrbit } from "../../src/shared/page-graphics/scenes/products.ts";

test("planOrbit handles empty content and caps active slots", () => {
  assert.deepEqual(planOrbit(0), { lit: 0, total: MINIMUM_SLOTS });
  assert.deepEqual(planOrbit(1), { lit: 1, total: MINIMUM_SLOTS });
  assert.deepEqual(planOrbit(MINIMUM_SLOTS + 1), { lit: MINIMUM_SLOTS + 1, total: MINIMUM_SLOTS + 1 });
  assert.deepEqual(planOrbit(MAXIMUM_SLOTS + 5), { lit: MAXIMUM_SLOTS, total: MAXIMUM_SLOTS });
  assert.deepEqual(planOrbit(Number.NaN), { lit: 0, total: MINIMUM_SLOTS });
});

test("assertProductCapacity accepts empty and full content and rejects overflow", () => {
  assert.equal(MAXIMUM_SLOTS, 8, "the picture has eight product slots");
  for (const count of [0, MAXIMUM_SLOTS]) assert.doesNotThrow(() => assertProductCapacity(count));
  assert.throws(() => assertProductCapacity(MAXIMUM_SLOTS + 1), (error) => {
    assert.match(error.message, /9 products/);
    assert.match(error.message, /8 slots/);
    assert.match(error.message, /draft: true/);
    return true;
  });
});
