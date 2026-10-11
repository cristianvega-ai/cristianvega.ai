import test from "node:test";
import assert from "node:assert/strict";

import { MAXIMUM_SLOTS as maximumSlots, assertProductCapacity } from "../../src/shared/page-graphics/scenes/product-slots.ts";
import { MINIMUM_SLOTS as minimumSlots, planOrbit } from "../../src/shared/page-graphics/scenes/products.ts";

test("planOrbit provides minimum slots for empty content and limits active slots to capacity", () => {
  assert.deepEqual(planOrbit(0), { lit: 0, total: minimumSlots });
  assert.deepEqual(planOrbit(1), { lit: 1, total: minimumSlots });
  assert.deepEqual(planOrbit(minimumSlots + 1), { lit: minimumSlots + 1, total: minimumSlots + 1 });
  assert.deepEqual(planOrbit(maximumSlots + 5), { lit: maximumSlots, total: maximumSlots });
  assert.deepEqual(planOrbit(Number.NaN), { lit: 0, total: minimumSlots });
});

test("assertProductCapacity accepts counts within capacity and rejects a count above capacity", () => {
  assert.equal(maximumSlots, 8, "the product graphic must provide eight slots");
  for (const productCount of [0, maximumSlots]) assert.doesNotThrow(() => assertProductCapacity(productCount));
  assert.throws(() => assertProductCapacity(maximumSlots + 1), (error) => {
    assert.match(error.message, /9 products/);
    assert.match(error.message, /8 slots/);
    assert.match(error.message, /draft: true/);
    return true;
  });
});
