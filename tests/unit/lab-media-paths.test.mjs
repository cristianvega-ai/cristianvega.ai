import test from "node:test";
import assert from "node:assert/strict";

import { assertExperimentSlug, clipSources, experimentAddress, RESERVED_EXPERIMENT_SLUGS as reservedSlugs, resultAddress, sceneAddress } from "../../src/shared/lab/media-paths.ts";

test("Lab addresses name the experiment page, the result page, and the scene folder", () => {
  assert.equal(experimentAddress("floating-castles"), "/lab/floating-castles/");
  assert.equal(resultAddress("floating-castles", "opus-5-5"), "/lab/floating-castles/opus-5-5/");
  assert.equal(sceneAddress("floating-castles", "opus-5-5"), "/lab/scenes/floating-castles/opus-5-5/");
});

test("a result page address and its scene address differ, so the page never serves the model's own page", () => {
  assert.notEqual(resultAddress("floating-castles", "opus-5-5"), sceneAddress("floating-castles", "opus-5-5"));
});

test("clipSources names the AV1 clip, the H.264 clip, and the poster under the media folder", () => {
  assert.deepEqual(clipSources("floating-castles", "mosaic"), {
    av1: "/lab/media/floating-castles/clips/mosaic.av1.mp4",
    h264: "/lab/media/floating-castles/clips/mosaic.h264.mp4",
    poster: "/lab/media/floating-castles/posters/mosaic.webp",
  });
});

test("the reserved slugs are the two folders that the Lab media uses", () => {
  assert.deepEqual([...reservedSlugs].sort(), ["media", "scenes"]);
});

for (const reservedSlug of ["media", "scenes"]) {
  test(`assertExperimentSlug rejects the reserved slug ${reservedSlug} and names its content file`, () => {
    assert.throws(() => assertExperimentSlug(reservedSlug), (error) => {
      assert.match(error.message, new RegExp(`"${reservedSlug}" takes a reserved path`));
      assert.ok(error.message.includes(`src/content/lab/${reservedSlug}.md`), "the message must name the file to rename");
      return true;
    });
  });
}

test("assertExperimentSlug accepts an ordinary slug and a slug that only contains a reserved word", () => {
  for (const slug of ["floating-castles", "media-lab", "scenes-2"]) {
    assert.doesNotThrow(() => assertExperimentSlug(slug), `${slug} must be a valid experiment slug`);
  }
});
