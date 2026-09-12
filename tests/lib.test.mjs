import test from "node:test";
import assert from "node:assert/strict";

import {
  backingScale,
  MAX_COPY_BACKING_PIXELS,
  MAX_PIXEL_RATIO,
  MAX_SKY_BACKING_PIXELS,
} from "../src/lib/hero-motion/layout.ts";

test("backingScale honours the device-pixel-ratio cap on a small canvas", () => {
  assert.equal(backingScale(200, 200, MAX_SKY_BACKING_PIXELS, 3), MAX_PIXEL_RATIO);
});

test("backingScale drops below the DPR cap when the sky area budget binds", () => {
  const scale = backingScale(1440, 900, MAX_SKY_BACKING_PIXELS, 3);
  assert.ok(scale < MAX_PIXEL_RATIO, "a 1440x900 retina sky must not use a full 2x buffer");
  assert.ok(scale * scale * 1440 * 900 <= MAX_SKY_BACKING_PIXELS + 1e-6);
});

test("backingScale can drop below 1 for a large copy canvas", () => {
  const scale = backingScale(1440, 900, MAX_COPY_BACKING_PIXELS, 2);
  assert.ok(scale < 1, "copy particles must not keep a full-grid buffer");
});

test("backingScale returns 1 for empty geometry", () => {
  assert.equal(backingScale(0, 100, MAX_SKY_BACKING_PIXELS, 2), 1);
  assert.equal(backingScale(100, 100, 0, 2), 1);
});
