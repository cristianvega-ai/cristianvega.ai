import test from "node:test";
import assert from "node:assert/strict";

import { LYRA as lyraStars } from "../../src/shared/lyra/constellation.ts";
import { layoutLyra } from "../../src/shared/page-graphics/lyra.ts";
import { MISSING as missingStarIndex, missingLayout } from "../../src/shared/page-graphics/scenes/404.ts";

test("the missing-star ring remains inside column and band layout bounds", () => {
  // Exercise the column and band layout branches.
  for (const [width, height] of [[380, 720], [700, 150]]) {
    const missingStarLayout = missingLayout(width, height);
    const stars = layoutLyra(width, height, { padding: missingStarLayout.padding, rotate: missingStarLayout.rotate });
    assert.equal(stars.length, lyraStars.length);
    assert.ok(missingStarIndex > 0 && missingStarIndex < stars.length, "the missing-star index must identify an existing star other than Vega");
    const missingStar = stars[missingStarIndex];
    assert.ok(missingStar.x > 7 && missingStar.x < width - 7 && missingStar.y > 7 && missingStar.y < height - 7, `the missing-star ring must fit within ${width} by ${height} layout bounds`);
  }
});
