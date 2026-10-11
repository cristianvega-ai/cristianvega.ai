import test from "node:test";
import assert from "node:assert/strict";

import { LYRA } from "../../src/shared/lyra/constellation.ts";
import { MAXIMUM_SLOTS } from "../../src/shared/page-graphics/scenes/product-slots.ts";
import { fitLyraAtVega, orbitSlot, planOrbit, productProgress } from "../../src/shared/page-graphics/scenes/products.ts";

// Exercise the column and band layout branches.
const ORBIT_BOXES = [
  { name: "column", w: 380, h: 720, wide: false },
  { name: "band", w: 700, h: 150, wide: true },
];

test("productProgress finishes every active node and link at full progress", () => {
  // Exercise a single product and the capacity boundary.
  for (const count of [1, MAXIMUM_SLOTS]) {
    for (let index = 0; index < count; index += 1) {
      for (const part of ["node", "link"]) {
        assert.equal(productProgress(0, index, count, part), 0, `${count} products: ${part} ${index} must start empty`);
        assert.equal(productProgress(1, index, count, part), 1, `${count} products: ${part} ${index} must finish`);
        let previous = 0;
        for (let progress = 0; progress <= 1; progress += 0.05) {
          const value = productProgress(progress, index, count, part);
          assert.ok(value >= previous, `${count} products: ${part} ${index} must not lose progress`);
          if (index > 0) {
            assert.ok(value <= productProgress(progress, index - 1, count, part), `${count} products: ${part} ${index} must wait its turn`);
          }
          previous = value;
        }
      }
    }
  }
});

test("orbitSlot gives every supported product its own place inside the box", () => {
  for (const box of ORBIT_BOXES) {
    const cx = box.w / 2;
    const cy = box.h / 2;
    const hw = box.w * 0.46;
    const hh = box.h * 0.46;
    // Exercise the minimum orbit and the expanded capacity boundary.
    for (const count of [1, MAXIMUM_SLOTS]) {
      const { total } = planOrbit(count);
      const spots = Array.from({ length: total }, (_, i) => orbitSlot({ x: 0, y: 0 }, i, box.wide, cx, cy, hw, hh));
      for (const [i, spot] of spots.entries()) {
        assert.ok(spot.x > 0 && spot.x < box.w && spot.y > 0 && spot.y < box.h, `${box.name}: slot ${i} must sit inside the box`);
        assert.ok(spot.x !== cx || spot.y !== cy, `${box.name}: slot ${i} must not sit on Vega`);
        for (let j = 0; j < i; j += 1) {
          const apart = Math.hypot(spot.x - spots[j].x, spot.y - spots[j].y);
          assert.ok(apart > 0, `${box.name}: slots ${j} and ${i} must have different positions`);
        }
      }
    }
  }
});

test("fitLyraAtVega keeps Vega at the centre and the figure inside the half box", () => {
  for (const box of ORBIT_BOXES) {
    const cx = box.w / 2;
    const cy = box.h / 2;
    const rx = box.w * 0.46 * 0.8;
    const ry = box.h * 0.46 * 0.8;
    const points = fitLyraAtVega([], cx, cy, rx, ry, box.wide);
    assert.equal(points.length, LYRA.length);
    assert.deepEqual(points[0], { x: cx, y: cy });
    for (const point of points) {
      assert.ok(Math.abs(point.x - cx) <= rx + 1e-9, `${box.name}: x ${point.x} must stay inside the half width`);
      assert.ok(Math.abs(point.y - cy) <= ry + 1e-9, `${box.name}: y ${point.y} must stay inside the half height`);
    }
  }
});
