import test from "node:test";
import assert from "node:assert/strict";

import { glowStops } from "../src/shared/motion/palette.ts";

test("glow stops keep the sky channels and scale the glow by the color alpha", () => {
  for (const [color, stops] of [
    [{ red: 56, green: 189, blue: 248, alpha: 1 }, ["rgba(56, 189, 248, 0.45)", "rgba(56, 189, 248, 0)"]],
    [{ red: 0, green: 0, blue: 0, alpha: 1 }, ["rgba(0, 0, 0, 0.45)", "rgba(0, 0, 0, 0)"]],
    [{ red: 255, green: 128, blue: 1, alpha: 128 / 255 }, ["rgba(255, 128, 1, 0.226)", "rgba(255, 128, 1, 0)"]],
    [{ red: 0, green: 0, blue: 0, alpha: 0 }, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]],
  ]) {
    assert.deepEqual(glowStops(color), stops, JSON.stringify(color));
  }
});
