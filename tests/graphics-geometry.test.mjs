import test from "node:test";
import assert from "node:assert/strict";

import { LYRA, LYRA_LINKS } from "../src/shared/lyra/constellation.ts";
import { LYRA_MAXIMUM_SIZE, layoutLyra } from "../src/shared/page-graphics/lyra.ts";
import { FIGURE_INSET, figureRectangle } from "../src/shared/page-graphics/inset.ts";
import { makeMesh } from "../src/shared/page-graphics/mesh.ts";
import { makeRoute } from "../src/shared/page-graphics/marks.ts";
import { figureBox } from "./helpers.mjs";

test("the Lyra figure links only stars that exist", () => {
  assert.equal(LYRA.length, 6);
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
  const reused = layoutLyra(300, 300, { outputPoints: points });
  assert.equal(reused, points, "layoutLyra must fill the array it receives");
});

test("layoutLyra keeps the same proportions and a capped size on every canvas", () => {
  assert.ok(LYRA_MAXIMUM_SIZE <= 320, "the cap must stay near the size of the homepage and Writing figures");
  const native = figureBox(LYRA.map((star) => ({ x: star.x, y: star.y })));
  for (const [w, h] of [[300, 300], [380, 720], [460, 900], [700, 150], [1200, 1200], [2000, 3000], [3000, 400]]) {
    const box = figureBox(layoutLyra(w, h));
    assert.ok(Math.abs(box.aspect - native.aspect) < 1e-9, `${w}x${h}: the aspect must match the figure, not the canvas`);
    assert.ok(Math.max(box.width, box.height) <= LYRA_MAXIMUM_SIZE + 1e-9, `${w}x${h}: the figure must not grow past the cap`);
  }
  const small = figureBox(layoutLyra(200, 120, { padding: 10 }));
  assert.ok(Math.max(small.width, small.height) < LYRA_MAXIMUM_SIZE, "a small canvas must still shrink the figure");
  const tall = layoutLyra(460, 900);
  const cx = (Math.min(...tall.map((p) => p.x)) + Math.max(...tall.map((p) => p.x))) / 2;
  assert.ok(Math.abs(cx - 230) < 1e-6, "a capped figure must sit centred in the canvas");
});

test("makeRoute keeps running lengths along the points", () => {
  const route = makeRoute([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
  assert.deepEqual([...route.lengths], [0, 5, 11]);
  assert.equal(route.length, 11);
});

test("the neural mesh is the same on every call, stays in the box, and is sparse", () => {
  const first = makeMesh(460, 700, 3);
  const second = makeMesh(460, 700, 3);
  assert.deepEqual([...first.xs], [...second.xs]);
  assert.deepEqual([...first.links.subarray(0, first.linkCount * 2)], [...second.links.subarray(0, second.linkCount * 2)]);
  assert.notDeepEqual([...first.xs], [...makeMesh(460, 700, 4).xs], "a new seed must give a new mesh");
  for (let i = 0; i < first.count; i += 1) {
    assert.ok(first.xs[i] >= 0 && first.xs[i] <= 460 && first.ys[i] >= 0 && first.ys[i] <= 700, "a node must sit inside the box");
  }
  for (let i = 0; i < first.linkCount * 2; i += 1) assert.ok(first.links[i] < first.count, "a link must join real nodes");
  assert.ok(first.count > 20 && first.count < 45, `the mesh must be sparse, and not empty (${first.count} nodes)`);
  assert.ok(first.linkCount > first.count * 0.5, "the mesh must hold synapses");
});

test("the shared mesh reduces node count and draws fewer diagonal arcs after straight links", () => {
  // The old cell was 68px. The one shared density on every page is sparser.
  for (const [w, h, seed] of [[460, 760, 5], [700, 940, 3], [520, 800, 11]]) {
    const dense = makeMesh(w, h, seed, 68);
    const shared = makeMesh(w, h, seed);
    assert.ok(shared.count <= dense.count * 0.62, `${w}x${h}: ${shared.count} nodes must be about half of ${dense.count}`);
    assert.ok(shared.diagonalFrom > 0 && shared.diagonalFrom <= shared.linkCount);
    assert.ok(shared.linkCount - shared.diagonalFrom < shared.diagonalFrom, `${w}x${h}: the diagonal arcs must be fewer than the straight links`);
  }
});

test("the figure inset is 32px, larger than the 24px edge fade, and figureRectangle follows it", () => {
  assert.equal(FIGURE_INSET, 32);
  assert.deepEqual(figureRectangle(456, 762), { x0: 32, y0: 32, x1: 424, y1: 730 });
});
