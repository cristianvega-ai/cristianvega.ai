import test from "node:test";
import assert from "node:assert/strict";

import { glowStops } from "../src/shared/motion/palette.ts";

test("glow stops keep the sky channels and scale the glow by the color alpha", () => {
  for (const [color, stops] of [
    [{ r: 56, g: 189, b: 248, a: 1 }, ["rgba(56, 189, 248, 0.45)", "rgba(56, 189, 248, 0)"]],
    [{ r: 0, g: 0, b: 0, a: 1 }, ["rgba(0, 0, 0, 0.45)", "rgba(0, 0, 0, 0)"]],
    [{ r: 255, g: 128, b: 1, a: 128 / 255 }, ["rgba(255, 128, 1, 0.226)", "rgba(255, 128, 1, 0)"]],
    [{ r: 0, g: 0, b: 0, a: 0 }, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]],
  ]) {
    assert.deepEqual(glowStops(color), stops, JSON.stringify(color));
  }
});
