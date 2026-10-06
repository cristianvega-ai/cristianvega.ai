import test from "node:test";
import assert from "node:assert/strict";

import { LYRA, LYRA_LINKS } from "../src/lib/lyra/constellation.ts";
import { layoutLyra } from "../src/lib/page-graphics/lyra.ts";
import { segmentHitsRect } from "../src/lib/page-graphics/labels.ts";
import { FIGURE_INSET } from "../src/lib/page-graphics/inset.ts";
import { MISSING, PULSE_MS, PULSE_STARTS, REST_MS, missingLayout, layoutMissing } from "../src/lib/page-graphics/scenes/404.ts";
import { starWidthsCssPx } from "./helpers.mjs";

test("missingLayout chooses a turned figure and tight padding only for a band", () => {
  const band = missingLayout(700, 150);
  const column = missingLayout(380, 720);
  assert.equal(band.wide, true);
  assert.equal(column.wide, false);
  assert.ok(band.rotate !== 0 && column.rotate === 0);
  assert.ok(band.pad < column.pad);
  assert.equal(band.showNames, false);
  assert.equal(column.showNames, true);
  assert.equal(column.reach, 58);
  assert.equal(band.reach, 30);
});

test("the missing star and its empty ring stay inside the box for a column and a band", () => {
  for (const [w, h] of [[380, 720], [700, 150], [320, 150]]) {
    const layout = missingLayout(w, h);
    const stars = layoutLyra(w, h, { pad: layout.pad, rotate: layout.rotate });
    assert.equal(stars.length, LYRA.length);
    assert.ok(MISSING > 0 && MISSING < stars.length, "the missing star is not Vega");
    const gap = stars[MISSING];
    assert.ok(gap.x > 7 && gap.x < w - 7 && gap.y > 7 && gap.y < h - 7, `the ring at ${w} by ${h} must fit in the box`);
  }
});

test("the search pulses start at 2.9 s, come at most every 8 s, and all end before the picture rests", () => {
  assert.equal(PULSE_STARTS[0], 2900);
  for (let i = 1; i < PULSE_STARTS.length; i += 1) {
    assert.ok(PULSE_STARTS[i] - PULSE_STARTS[i - 1] >= 8000, `pulse ${i} must come 8 s or more after the last`);
  }
  assert.ok(PULSE_STARTS[PULSE_STARTS.length - 1] + PULSE_MS < REST_MS, "the last pulse must end before the rest");
  assert.ok(REST_MS <= 31_000, "the picture must rest after about 30 s");
});

test("the 404 star names never sit on a Lyra link and stay inside the box", () => {
  for (const [w, h] of [[380, 720], [286, 770], [700, 150], [350, 150], [460, 800], [1000, 150]]) {
    const layout = missingLayout(w, h);
    const bounds = { x0: 28, y0: 20, x1: w - 28, y1: h - 20 };
    const { stars, labels } = layoutMissing(w, h, layout, bounds, starWidthsCssPx);
    assert.ok(labels.length >= 1 && labels[0].text === LYRA[0].name, `${w}x${h}: Vega must have its name`);
    for (const label of labels) {
      assert.ok(label.clear, `${w}x${h}: "${label.text}" must find a clear place`);
      assert.ok(label.rect.x0 >= bounds.x0 && label.rect.x1 <= bounds.x1 && label.rect.y0 >= bounds.y0 && label.rect.y1 <= bounds.y1, `${w}x${h}: "${label.text}" must stay inside the bounds`);
      for (const [a, b] of LYRA_LINKS) {
        const hit = segmentHitsRect({ ax: stars[a].x, ay: stars[a].y, bx: stars[b].x, by: stars[b].y }, label.rect);
        assert.equal(hit, false, `${w}x${h}: a link must not cross "${label.text}"`);
      }
    }
  }
});

test("the 404 figure keeps every star inside the figure inset", () => {
  for (const [w, h] of [[456, 762], [696, 942], [680, 136], [326, 136]]) {
    const layout = missingLayout(w, h);
    const stars = layoutLyra(w, h, { pad: layout.pad, rotate: layout.rotate });
    for (const star of stars) {
      assert.ok(star.x >= FIGURE_INSET - 1e-9 && star.x <= w - FIGURE_INSET + 1e-9, `${w}x${h}: x ${star.x} must sit inside the inset`);
      assert.ok(star.y >= FIGURE_INSET - 1e-9 && star.y <= h - FIGURE_INSET + 1e-9, `${w}x${h}: y ${star.y} must sit inside the inset`);
    }
  }
});
