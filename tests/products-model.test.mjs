import test from "node:test";
import assert from "node:assert/strict";

import { LYRA } from "../src/shared/lyra/constellation.ts";
import { stagger } from "../src/shared/motion/clock.ts";
import { LYRA_MAXIMUM_SIZE } from "../src/shared/page-graphics/lyra.ts";
import { FIGURE_INSET } from "../src/shared/page-graphics/inset.ts";
import { MAXIMUM_SLOTS, assertProductCapacity } from "../src/shared/page-graphics/scenes/product-slots.ts";
import { MINIMUM_SLOTS, SLOT_REACH, fitLyraAtVega, orbitBox, orbitSlot, planOrbit, productProgress } from "../src/shared/page-graphics/scenes/products.ts";
import { figureBox } from "./helpers.mjs";

// A box of a tall side column, and a box of a wide band, as the page graphic meets them.
const ORBIT_BOXES = [
  { name: "column", w: 380, h: 720, wide: false },
  { name: "band", w: 700, h: 150, wide: true },
];

test("planOrbit keeps six slots and lights one for each product up to the maximum", () => {
  assert.deepEqual(planOrbit(0), { lit: 0, total: MINIMUM_SLOTS });
  assert.deepEqual(planOrbit(1), { lit: 1, total: 6 });
  assert.deepEqual(planOrbit(6), { lit: 6, total: 6 });
  assert.deepEqual(planOrbit(MAXIMUM_SLOTS + 5), { lit: MAXIMUM_SLOTS, total: MAXIMUM_SLOTS });
  assert.deepEqual(planOrbit(Number.NaN), { lit: 0, total: 6 });
});

test("assertProductCapacity accepts every count up to the slots and rejects more", () => {
  assert.equal(MAXIMUM_SLOTS, 8, "the picture has eight product slots");
  for (let count = 0; count <= MAXIMUM_SLOTS; count += 1) assert.doesNotThrow(() => assertProductCapacity(count));
  assert.throws(() => assertProductCapacity(MAXIMUM_SLOTS + 1), (error) => {
    assert.match(error.message, /9 products/);
    assert.match(error.message, /8 slots/);
    assert.match(error.message, /draft: true/);
    return true;
  });
});

test("productProgress finishes every active node and link at full progress", () => {
  for (let count = MAXIMUM_SLOTS; count > 0; count -= 1) {
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

test("productProgress keeps the entrance timing for one product", () => {
  for (const progress of [0, 0.42, 0.5, 0.55, 0.58, 0.7, 1]) {
    assert.ok(Math.abs(productProgress(progress, 0, 1, "node") - stagger(progress, 0.42, 0.16)) < 1e-12);
    assert.ok(Math.abs(productProgress(progress, 0, 1, "link") - stagger(progress, 0.5, 0.2)) < 1e-12);
  }
});

test("orbitSlot gives every supported product its own place inside the box", () => {
  for (const box of ORBIT_BOXES) {
    const cx = box.w / 2;
    const cy = box.h / 2;
    const hw = box.w * 0.46;
    const hh = box.h * 0.46;
    for (let count = 1; count <= MAXIMUM_SLOTS; count += 1) {
      const { total } = planOrbit(count);
      const spots = Array.from({ length: total }, (_, i) => orbitSlot({ x: 0, y: 0 }, i, box.wide, cx, cy, hw, hh));
      for (const [i, spot] of spots.entries()) {
        assert.ok(spot.x > 0 && spot.x < box.w && spot.y > 0 && spot.y < box.h, `${box.name}: slot ${i} must sit inside the box`);
        assert.ok(Math.hypot(spot.x - cx, spot.y - cy) > 8, `${box.name}: slot ${i} must not sit on Vega`);
        for (let j = 0; j < i; j += 1) {
          const apart = Math.hypot(spot.x - spots[j].x, spot.y - spots[j].y);
          assert.ok(apart >= 16, `${box.name}: slots ${j} and ${i} must be 16 px apart or more, not ${apart}`);
        }
      }
    }
  }
});

test("orbitSlot puts a slot on its orbit ellipse", () => {
  const spot = orbitSlot({ x: 0, y: 0 }, 2, false, 100, 200, 50, 80);
  // Slot 2 is on the innermost orbit, at 0.36 of the half box.
  const share = ((spot.x - 100) / 50) ** 2 + ((spot.y - 200) / 80) ** 2;
  assert.ok(Math.abs(share - 0.36 ** 2) < 1e-9);
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

test("fitLyraAtVega never grows the figure past the cap, and keeps its proportions", () => {
  assert.ok(LYRA_MAXIMUM_SIZE <= 320, "the cap must stay near the size of the homepage and Writing figures");
  const native = figureBox(LYRA.map((star) => ({ x: star.x, y: star.y })));
  for (const [rx, ry] of [[100, 150], [500, 900], [2000, 2000]]) {
    const box = figureBox(fitLyraAtVega([], 0, 0, rx, ry, false));
    assert.ok(Math.abs(box.aspect - native.aspect) < 1e-9, `${rx}x${ry}: the aspect must match the figure`);
    assert.ok(Math.max(box.width, box.height) <= LYRA_MAXIMUM_SIZE + 1e-9, `${rx}x${ry}: the figure must not grow past the cap`);
  }
});

test("fitLyraAtVega turns the figure only in a wide box, and reuses the array it receives", () => {
  const upright = fitLyraAtVega([], 0, 0, 100, 100, false);
  const turned = fitLyraAtVega(upright.map((point) => ({ ...point })), 0, 0, 100, 100, true);
  assert.ok(Math.abs(turned[5].x) > Math.abs(turned[5].y) * 0.5, "the long side of the figure must run across a wide box");
  const reused = fitLyraAtVega(upright, 0, 0, 50, 50, false);
  assert.equal(reused, upright);
});

// Graphic boxes that the product pages measure: side columns from 1100px, and bands below it.
const GRAPHIC_BOXES = [[408, 762], [456, 762], [696, 942], [680, 154], [680, 136], [326, 169], [326, 136]];

test("the products orbits keep the outer ellipse inside the figure inset", () => {
  for (const [w, h] of GRAPHIC_BOXES) {
    const { halfWidth: hw, halfHeight: hh } = orbitBox(w, h);
    assert.ok(w / 2 - hw * 0.95 >= FIGURE_INSET - 1e-9, `${w}x${h}: the outer orbit must keep the inset on the sides`);
    assert.ok(h / 2 - hh * 0.95 >= FIGURE_INSET - 1e-9, `${w}x${h}: the outer orbit must keep the inset above and below`);
  }
});

test("the products slot reach covers the current product ring and the halo", () => {
  // The current product ring has a radius of 11.5 and a line of 0.8. A lit product halo reaches 8.
  assert.ok(SLOT_REACH >= 11.5 + 0.8 / 2 - 1e-9, "the reach must cover the current product ring");
  assert.ok(SLOT_REACH >= 8, "the reach must cover the halo of a lit product");
});

test("the products marks stay inside the figure inset for one, two, and eight products", () => {
  for (const [w, h] of GRAPHIC_BOXES) {
    const { halfWidth: hw, halfHeight: hh, wide } = orbitBox(w, h);
    assert.equal(wide, w > h * 1.6, `${w}x${h}: a band must turn the slots`);
    for (const count of [1, 2, MAXIMUM_SLOTS]) {
      const { total } = planOrbit(count);
      for (let i = 0; i < total; i += 1) {
        const spot = orbitSlot({ x: 0, y: 0 }, i, wide, w / 2, h / 2, hw, hh);
        const where = `${w}x${h}, ${count} products: slot ${i}`;
        assert.ok(spot.x - SLOT_REACH >= FIGURE_INSET - 1e-9, `${where} must keep its marks inside the left inset`);
        assert.ok(spot.x + SLOT_REACH <= w - FIGURE_INSET + 1e-9, `${where} must keep its marks inside the right inset`);
        assert.ok(spot.y - SLOT_REACH >= FIGURE_INSET - 1e-9, `${where} must keep its marks inside the top inset`);
        assert.ok(spot.y + SLOT_REACH <= h - FIGURE_INSET + 1e-9, `${where} must keep its marks inside the bottom inset`);
      }
    }
  }
});
