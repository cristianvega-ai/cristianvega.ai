import test from "node:test";
import assert from "node:assert/strict";

import { makeLabelFont } from "../src/shared/page-graphics/label-font.ts";

function context() {
  return {
    font: "10px sans-serif",
    measurements: 0,
    scale: 1,
    measureText(text) {
      this.measurements += 1;
      const proportional = this.font.includes("Proportional");
      const width = [...text].reduce((total, letter) => total + (proportional ? letter === "W" ? 11 : 3 : 6), 0);
      return { width: width * this.scale };
    },
  };
}

test("uses the supplied family and caches each measured label", () => {
  const drawingContext = context();
  const font = makeLabelFont(drawingContext, '"Proportional", sans-serif', "10px");
  assert.equal(font.canvasFont, '400 10px "Proportional", sans-serif');
  assert.equal(font.widthInPixels("WWWW"), 44);
  assert.equal(font.widthInPixels("iiii"), 12);
  assert.equal(font.widthInPixels("WWWW"), 44);
  assert.equal(drawingContext.measurements, 2);
});

test("keeps fallback labels readable and refreshes loaded font metrics", () => {
  const drawingContext = context();
  const fallback = makeLabelFont(drawingContext, " ", " 10px ");
  assert.equal(fallback.canvasFont, "400 10px ui-monospace, monospace");
  assert.equal(fallback.widthInPixels("VEGA"), 24);
  drawingContext.scale = 1.8;
  assert.equal(fallback.widthInPixels("VEGA"), 24);
  const loaded = makeLabelFont(drawingContext, '"Loaded Family", monospace', "10px");
  assert.equal(loaded.widthInPixels("VEGA"), 43.2);
  assert.equal(drawingContext.measurements, 2);
});

test("uses the label size token in px and falls back to 10px", () => {
  assert.equal(makeLabelFont(context(), "monospace", "13px").canvasFont, "400 13px monospace");
  assert.equal(makeLabelFont(context(), "monospace", "10.5px").canvasFont, "400 10.5px monospace");
  for (const size of ["1em", "-2px"]) {
    assert.equal(makeLabelFont(context(), "monospace", size).canvasFont, "400 10px monospace", JSON.stringify(size));
  }
});
