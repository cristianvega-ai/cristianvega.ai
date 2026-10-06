import test from "node:test";
import assert from "node:assert/strict";

import { FIGURE_INSET } from "../src/lib/lyra-render/inset.ts";
import { RING_MARGIN, aboutLayout } from "../src/lib/lyra-render/pages/about.ts";

const aboutBoxes = [[456, 762], [696, 942], [680, 136], [326, 136], [326, 150], [560, 800]];

test("aboutLayout keeps Vega and its ring inside the box with 24px margins", () => {
  assert.equal(RING_MARGIN, 24);
  for (const [w, h] of aboutBoxes) {
    const { vx, vy, ring } = aboutLayout(w, h);
    assert.ok(ring >= 20, `${w}x${h}: the rings must stay readable`);
    assert.ok(vx + ring + RING_MARGIN <= w + 1e-9, `${w}x${h}: the outer ring must keep 24px from the right edge`);
    assert.ok(vy - ring - RING_MARGIN >= -1e-9, `${w}x${h}: the outer ring must keep 24px from the top`);
    assert.ok(vy + ring <= h - FIGURE_INSET + 1e-9 || h < 300, `${w}x${h}: the outer ring must not leave the bottom`);
    assert.ok(vx - ring >= 0, `${w}x${h}: the outer ring must not leave the left edge`);
  }
});

test("aboutLayout keeps the whole path and its control points inside the figure inset", () => {
  for (const [w, h] of aboutBoxes) {
    const { curve } = aboutLayout(w, h);
    assert.equal(curve.length, 8);
    for (let i = 0; i < 8; i += 2) {
      assert.ok(curve[i] >= FIGURE_INSET - 1e-9 && curve[i] <= w - FIGURE_INSET + 1e-9, `${w}x${h}: x ${curve[i]} must sit inside the inset`);
      assert.ok(curve[i + 1] >= FIGURE_INSET - 1e-9 && curve[i + 1] <= h - FIGURE_INSET + 1e-9, `${w}x${h}: y ${curve[i + 1]} must sit inside the inset`);
    }
  }
});

test("aboutLayout runs the path sideways in a band and upright in a column", () => {
  assert.equal(aboutLayout(680, 136).horizontal, true);
  assert.equal(aboutLayout(456, 762).horizontal, false);
});
