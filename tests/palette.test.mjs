import test from "node:test";
import assert from "node:assert/strict";

import { hexChannels } from "../src/lib/page-graphics/palette.ts";

test("hex channels convert six digits with either letter case", () => {
  for (const [color, channels] of [
    ["#000000", "0, 0, 0"],
    ["#FFFFFF", "255, 255, 255"],
    ["#38BDF8", "56, 189, 248"],
    ["#38bdf8", "56, 189, 248"],
    ["#aBcDeF", "171, 205, 239"],
    ["#010203", "1, 2, 3"],
  ]) {
    assert.equal(hexChannels(color), channels, color);
  }
});

test("hex channels reject unsupported color formats", () => {
  for (const color of [
    "", "#3bf", "#38BDF", "#38BDF80", "#38BDF880", "#38BDGG", "38BDF8",
    "rgb(56, 189, 248)", "hsl(198, 93%, 60%)", "color(srgb 0.2 0.7 1)", "skyblue", "transparent",
    " #38BDF8", "#38BDF8 ", "#38BDF8\n",
  ]) {
    assert.equal(hexChannels(color), null, JSON.stringify(color));
  }
});
