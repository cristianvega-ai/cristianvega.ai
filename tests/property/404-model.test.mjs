import test from "node:test";
import assert from "node:assert/strict";

import { LYRA } from "../../src/shared/lyra/constellation.ts";
import { layoutLyra } from "../../src/shared/page-graphics/lyra.ts";
import { MISSING, missingLayout } from "../../src/shared/page-graphics/scenes/404.ts";

test("the missing star and its empty ring stay inside the box for a column and a band", () => {
  // Exercise the column and band layout branches.
  for (const [w, h] of [[380, 720], [700, 150]]) {
    const layout = missingLayout(w, h);
    const stars = layoutLyra(w, h, { padding: layout.padding, rotate: layout.rotate });
    assert.equal(stars.length, LYRA.length);
    assert.ok(MISSING > 0 && MISSING < stars.length, "the missing star is not Vega");
    const gap = stars[MISSING];
    assert.ok(gap.x > 7 && gap.x < w - 7 && gap.y > 7 && gap.y < h - 7, `the ring at ${w} by ${h} must fit in the box`);
  }
});
