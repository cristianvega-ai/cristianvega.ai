import test from "node:test";
import assert from "node:assert/strict";

import { LYRA, LYRA_LINKS } from "../src/shared/lyra/constellation.ts";
import { layoutLyra } from "../src/shared/page-graphics/lyra.ts";
import { makeMesh } from "../src/shared/page-graphics/mesh.ts";
import { makeRoute } from "../src/shared/page-graphics/marks.ts";

test("the Lyra figure links only stars that exist", () => {
  assert.ok(LYRA.length > 0 && LYRA_LINKS.length > 0, "the figure must contain stars and links");
  for (const [from, to] of LYRA_LINKS) {
    assert.ok(LYRA[from] && LYRA[to], `link ${from}-${to} must name two stars`);
  }
});

test("layoutLyra fits the Lyra figure inside the padded box and keeps Vega first", () => {
  const points = layoutLyra(400, 200, { padding: 20 });
  assert.equal(points.length, LYRA.length);
  assert.equal(points[0].vega, true);
  assert.equal(points.filter((point) => point.vega).length, 1);
  for (const point of points) {
    assert.ok(point.x >= 19.999 && point.x <= 380.001, `x ${point.x} must sit inside the box`);
    assert.ok(point.y >= 19.999 && point.y <= 180.001, `y ${point.y} must sit inside the box`);
  }
});

test("makeRoute keeps running lengths along the points", () => {
  const route = makeRoute([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
  assert.deepEqual([...route.lengths], [0, 5, 11]);
  assert.equal(route.length, 11);
});

test("the neural mesh keeps nodes inside the box and links valid nodes", () => {
  const mesh = makeMesh(460, 700, 3);
  assert.ok(mesh.count > 0, "the mesh must contain nodes");
  assert.ok(mesh.linkCount > 0, "the mesh must contain links");
  for (let index = 0; index < mesh.count; index += 1) {
    assert.ok(mesh.xs[index] >= 0 && mesh.xs[index] <= 460, `node ${index}: x must fit`);
    assert.ok(mesh.ys[index] >= 0 && mesh.ys[index] <= 700, `node ${index}: y must fit`);
  }
  for (let index = 0; index < mesh.linkCount * 2; index += 1) {
    assert.ok(mesh.links[index] < mesh.count, `link endpoint ${index} must name a node`);
  }
});
