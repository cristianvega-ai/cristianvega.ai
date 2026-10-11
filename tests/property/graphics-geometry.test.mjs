import test from "node:test";
import assert from "node:assert/strict";

import { LYRA as lyraStars, LYRA_LINKS as lyraLinks } from "../../src/shared/lyra/constellation.ts";
import { layoutLyra } from "../../src/shared/page-graphics/lyra.ts";
import { makeMesh } from "../../src/shared/page-graphics/mesh.ts";

test("LYRA_LINKS references existing stars for every constellation link", () => {
  assert.ok(lyraStars.length > 0 && lyraLinks.length > 0, "the Lyra constellation must contain stars and links");
  for (const [startStarIndex, endStarIndex] of lyraLinks) {
    assert.ok(lyraStars[startStarIndex] && lyraStars[endStarIndex], `link ${startStarIndex}-${endStarIndex} must reference two existing stars`);
  }
});

test("layoutLyra keeps all stars inside padded bounds and places the only Vega point first", () => {
  const points = layoutLyra(400, 200, { padding: 20 });
  assert.equal(points.length, lyraStars.length);
  assert.equal(points[0].vega, true);
  assert.equal(points.filter((point) => point.vega).length, 1);
  for (const point of points) {
    assert.ok(point.x >= 19.999 && point.x <= 380.001, `x ${point.x} must remain inside the padded bounds`);
    assert.ok(point.y >= 19.999 && point.y <= 180.001, `y ${point.y} must remain inside the padded bounds`);
  }
});

test("makeMesh keeps all nodes inside its bounds and references existing nodes in every link", () => {
  const mesh = makeMesh(460, 700, 3);
  assert.ok(mesh.count > 0, "the mesh must contain nodes");
  assert.ok(mesh.linkCount > 0, "the mesh must contain links");
  for (let nodeIndex = 0; nodeIndex < mesh.count; nodeIndex += 1) {
    assert.ok(mesh.nodeX[nodeIndex] >= 0 && mesh.nodeX[nodeIndex] <= 460, `node ${nodeIndex}: x must fit the mesh width`);
    assert.ok(mesh.nodeY[nodeIndex] >= 0 && mesh.nodeY[nodeIndex] <= 700, `node ${nodeIndex}: y must fit the mesh height`);
  }
  for (let linkEndpointIndex = 0; linkEndpointIndex < mesh.linkCount * 2; linkEndpointIndex += 1) {
    assert.ok(mesh.links[linkEndpointIndex] < mesh.count, `link endpoint ${linkEndpointIndex} must reference an existing node`);
  }
});
