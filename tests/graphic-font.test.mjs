import test from "node:test";
import assert from "node:assert/strict";

import { makeLabelFont } from "../src/shared/page-graphics/label-font.ts";
import { placeLabel } from "../src/shared/page-graphics/labels.ts";
import { buildField } from "../src/shared/page-graphics/scenes/writing-layout.ts";
import { layoutMissing, missingLayout } from "../src/shared/page-graphics/scenes/404.ts";

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
  for (const size of ["", " ", "1em", "large", "-2px", "12"]) {
    assert.equal(makeLabelFont(context(), "monospace", size).canvasFont, "400 10px monospace", JSON.stringify(size));
  }
});

test("uses measured widths to keep wide labels inside placement bounds", () => {
  const bounds = { x0: 20, y0: 20, x1: 260, y1: 150 };
  const narrow = placeLabel("WWWW", 160, 80, { bounds, widthInPixels: 12 });
  const wide = placeLabel("WWWW", 160, 80, { bounds, widthInPixels: 120 });
  assert.equal(narrow.side, "right");
  assert.equal(wide.side, "left");
  assert.equal(wide.rectangle.x1 - wide.rectangle.x0, 126);
  assert.equal(wide.clear, true);
  assert.ok(wide.rectangle.x0 >= bounds.x0 && wide.rectangle.x1 <= bounds.x1);
});

test("uses supplied widths in Writing margins and label boxes", () => {
  const input = {
    articleIdentifiers: ["post-one", "post-two"],
    labels: ["WWWW", "iiii"],
    labelWidthsInPixels: [44, 12],
    starWidthsInPixels: [96, 0, 0, 0, 64, 64],
    width: 480,
    height: 640,
  };
  const wide = buildField(input);
  const narrow = buildField({ ...input, labelWidthsInPixels: [12, 12] });
  assert.notDeepEqual(wide.points.slice(0, 2), narrow.points.slice(0, 2));
  for (const [index, label] of wide.articleLabels.entries()) {
    assert.equal(label.rectangle.x1 - label.rectangle.x0, input.labelWidthsInPixels[index] + 6);
    assert.ok(label.rectangle.x0 >= 0 && label.rectangle.x1 <= input.width);
  }
  const vega = wide.starLabels[0];
  assert.ok(vega);
  assert.equal(vega.rectangle.x1 - vega.rectangle.x0, 102);
});

test("fits the 404 figure with measured wide star names", () => {
  const w = 286;
  const h = 770;
  const bounds = { x0: 28, y0: 20, x1: w - 28, y1: h - 20 };
  const { labels } = layoutMissing(w, h, missingLayout(w, h), bounds, [108, 0, 0, 0, 72, 72]);
  assert.equal(labels[0].rectangle.x1 - labels[0].rectangle.x0, 114);
  for (const label of labels) {
    assert.equal(label.clear, true);
    assert.ok(label.rectangle.x0 >= bounds.x0 && label.rectangle.x1 <= bounds.x1);
  }
});

test("derives the label line from the label size token", () => {
  assert.equal(makeLabelFont(context(), "monospace", "10px").lineHeightInPixels, 12, "the current token keeps a 12px line");
  assert.equal(makeLabelFont(context(), "monospace", "20px").lineHeightInPixels, 24);
  assert.equal(makeLabelFont(context(), "monospace", "13px").lineHeightInPixels, 13 * 1.2);
  assert.equal(makeLabelFont(context(), "monospace", "1em").lineHeightInPixels, 12, "the fallback size keeps the fallback line");
});

test("uses the measured label line in every label box", () => {
  const line = makeLabelFont(context(), "monospace", "20px").lineHeightInPixels;
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const fallback = placeLabel("VEGA", 200, 150, { bounds, widthInPixels: 24 });
  assert.equal(fallback.rectangle.y1 - fallback.rectangle.y0, 12 + 6, "without a line, the box has the fallback line and the halo");
  const above = placeLabel("VEGA", 200, 150, { bounds, widthInPixels: 24, lineHeightInPixels: line, prefer: ["above"] });
  assert.equal(above.side, "above");
  assert.equal(above.rectangle.y1 - above.rectangle.y0, line + 6);
  assert.equal(above.y, 150 - 12 - line / 2, "a label above keeps the gap and half its line from the node");

  const field = buildField({
    articleIdentifiers: ["post-one", "post-two"],
    labels: ["WWWW", "iiii"],
    labelWidthsInPixels: [44, 12],
    starWidthsInPixels: [96, 0, 0, 0, 64, 64],
    lineHeightInPixels: line,
    width: 480,
    height: 640,
  });
  for (const label of [...field.articleLabels, ...field.starLabels.filter(Boolean)]) {
    assert.equal(label.rectangle.y1 - label.rectangle.y0, line + 6, `writing label ${label.text}`);
  }

  const w = 286;
  const h = 770;
  const missingBounds = { x0: 28, y0: 20, x1: w - 28, y1: h - 20 };
  const { labels } = layoutMissing(w, h, missingLayout(w, h), missingBounds, [108, 0, 0, 0, 72, 72], line);
  assert.ok(labels.length > 0);
  for (const label of labels) assert.equal(label.rectangle.y1 - label.rectangle.y0, line + 6, `404 label ${label.text}`);
});
