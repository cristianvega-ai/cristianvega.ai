import test from "node:test";
import assert from "node:assert/strict";

import { LYRA as lyraStars } from "../../src/shared/lyra/constellation.ts";
import { MAXIMUM_SLOTS as maximumSlots } from "../../src/shared/page-graphics/scenes/product-slots.ts";
import { fitLyraAtVega } from "../../src/shared/page-graphics/lyra.ts";
import { orbitSlot, planOrbit, productProgress } from "../../src/shared/page-graphics/scenes/products-layout.ts";

// Exercise the column and band layout branches.
const orbitBounds = [
  { layoutName: "column", width: 380, height: 720, usesBandLayout: false },
  { layoutName: "band", width: 700, height: 150, usesBandLayout: true },
];

test("productProgress preserves endpoints, monotonic progress, and product order for each active node and link", () => {
  // Exercise a single product and the capacity boundary.
  for (const productCount of [1, maximumSlots]) {
    for (let productIndex = 0; productIndex < productCount; productIndex += 1) {
      for (const graphicPart of ["node", "link"]) {
        assert.equal(productProgress(0, productIndex, productCount, graphicPart), 0, `${productCount} products: ${graphicPart} ${productIndex} must start at zero progress`);
        assert.equal(productProgress(1, productIndex, productCount, graphicPart), 1, `${productCount} products: ${graphicPart} ${productIndex} must finish at full progress`);
        let previousProgress = 0;
        for (let progress = 0; progress <= 1; progress += 0.05) {
          const partProgress = productProgress(progress, productIndex, productCount, graphicPart);
          assert.ok(partProgress >= previousProgress, `${productCount} products: ${graphicPart} ${productIndex} must not decrease in progress`);
          if (productIndex > 0) {
            assert.ok(partProgress <= productProgress(progress, productIndex - 1, productCount, graphicPart), `${productCount} products: ${graphicPart} ${productIndex} must not exceed the previous product progress`);
          }
          previousProgress = partProgress;
        }
      }
    }
  }
});

test("orbitSlot assigns distinct positions inside column and band bounds for each supported slot count", () => {
  for (const bounds of orbitBounds) {
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const halfWidth = bounds.width * 0.46;
    const halfHeight = bounds.height * 0.46;
    // Exercise the minimum orbit and the expanded capacity boundary.
    for (const productCount of [1, maximumSlots]) {
      const { total: slotCount } = planOrbit(productCount);
      const slotPositions = Array.from({ length: slotCount }, (unusedValue, slotIndex) => orbitSlot({ x: 0, y: 0 }, slotIndex, bounds.usesBandLayout, centerX, centerY, halfWidth, halfHeight));
      for (const [slotIndex, slotPosition] of slotPositions.entries()) {
        assert.ok(slotPosition.x > 0 && slotPosition.x < bounds.width && slotPosition.y > 0 && slotPosition.y < bounds.height, `${bounds.layoutName}: slot ${slotIndex} must remain inside the layout bounds`);
        assert.ok(slotPosition.x !== centerX || slotPosition.y !== centerY, `${bounds.layoutName}: slot ${slotIndex} must not overlap Vega`);
        for (let previousSlotIndex = 0; previousSlotIndex < slotIndex; previousSlotIndex += 1) {
          const slotDistance = Math.hypot(slotPosition.x - slotPositions[previousSlotIndex].x, slotPosition.y - slotPositions[previousSlotIndex].y);
          assert.ok(slotDistance > 0, `${bounds.layoutName}: slots ${previousSlotIndex} and ${slotIndex} must have different positions`);
        }
      }
    }
  }
});

test("fitLyraAtVega centers Vega and keeps every star within the horizontal and vertical radii", () => {
  for (const bounds of orbitBounds) {
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const horizontalRadius = bounds.width * 0.46 * 0.8;
    const verticalRadius = bounds.height * 0.46 * 0.8;
    const points = fitLyraAtVega([], centerX, centerY, horizontalRadius, verticalRadius, bounds.usesBandLayout);
    assert.equal(points.length, lyraStars.length);
    assert.deepEqual(points[0], { x: centerX, y: centerY });
    for (const point of points) {
      assert.ok(Math.abs(point.x - centerX) <= horizontalRadius + 1e-9, `${bounds.layoutName}: x ${point.x} must remain within the horizontal radius`);
      assert.ok(Math.abs(point.y - centerY) <= verticalRadius + 1e-9, `${bounds.layoutName}: y ${point.y} must remain within the vertical radius`);
    }
  }
});
