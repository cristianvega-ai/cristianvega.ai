import test from "node:test";
import assert from "node:assert/strict";

import { makeLabelFont } from "../../src/shared/page-graphics/label-font.ts";

function createDrawingContext() {
  return {
    font: "10px sans-serif",
    measurementCount: 0,
    widthScale: 1,
    measureText(labelText) {
      this.measurementCount += 1;
      const usesProportionalFont = this.font.includes("Proportional");
      const width = [...labelText].reduce((totalWidth, character) => totalWidth + (usesProportionalFont ? character === "W" ? 11 : 3 : 6), 0);
      return { width: width * this.widthScale };
    },
  };
}

test("makeLabelFont uses the supplied family and reuses cached widths for repeated labels", () => {
  const drawingContext = createDrawingContext();
  const labelFont = makeLabelFont(drawingContext, '"Proportional", sans-serif', "10px");
  assert.equal(labelFont.canvasFont, '400 10px "Proportional", sans-serif');
  assert.equal(labelFont.widthInPixels("WWWW"), 44);
  assert.equal(labelFont.widthInPixels("iiii"), 12);
  assert.equal(labelFont.widthInPixels("WWWW"), 44);
  assert.equal(drawingContext.measurementCount, 2);
});

test("makeLabelFont preserves cached fallback widths and measures labels again for a loaded font", () => {
  const drawingContext = createDrawingContext();
  const fallbackFont = makeLabelFont(drawingContext, " ", " 10px ");
  assert.equal(fallbackFont.canvasFont, "400 10px ui-monospace, monospace");
  assert.equal(fallbackFont.widthInPixels("VEGA"), 24);
  drawingContext.widthScale = 1.8;
  assert.equal(fallbackFont.widthInPixels("VEGA"), 24);
  const loadedFont = makeLabelFont(drawingContext, '"Loaded Family", monospace', "10px");
  assert.equal(loadedFont.widthInPixels("VEGA"), 43.2);
  assert.equal(drawingContext.measurementCount, 2);
});

test("makeLabelFont accepts pixel sizes and uses 10 pixels for unsupported sizes", () => {
  assert.equal(makeLabelFont(createDrawingContext(), "monospace", "13px").canvasFont, "400 13px monospace");
  assert.equal(makeLabelFont(createDrawingContext(), "monospace", "10.5px").canvasFont, "400 10.5px monospace");
  for (const fontSize of ["1em", "-2px"]) {
    assert.equal(makeLabelFont(createDrawingContext(), "monospace", fontSize).canvasFont, "400 10px monospace", `unsupported font size ${JSON.stringify(fontSize)} must use the 10-pixel fallback`);
  }
});
