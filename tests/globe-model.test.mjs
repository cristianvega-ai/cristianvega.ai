import test from "node:test";
import assert from "node:assert/strict";

import { buildGlobe } from "../src/shared/lyra-globe/model.ts";

test("the globe sends entrance comets along real edges, and each one ends on Vega", () => {
  const globe = buildGlobe(600, 500);
  const vega = globe.nodes.find((node) => node.vega);
  assert.ok(vega, "the globe must contain Vega");
  assert.ok(globe.routes.length > 0, "the globe must contain routes");
  const joined = (a, b) => globe.edges.some((edge) => (
    (edge.a.x === a.x && edge.a.y === a.y && edge.b.x === b.x && edge.b.y === b.y)
    || (edge.b.x === a.x && edge.b.y === a.y && edge.a.x === b.x && edge.a.y === b.y)));
  for (const route of globe.routes) {
    const end = route.points[route.points.length - 1];
    assert.deepEqual(end, { x: vega.x, y: vega.y }, "a route ends on Vega");
    for (let i = 1; i < route.points.length; i++) assert.ok(joined(route.points[i - 1], route.points[i]), "a route follows an edge");
    assert.equal(route.lengths.length, route.points.length);
    assert.ok(Math.abs(route.lengths[route.lengths.length - 1] - route.length) < 1e-6);
  }
});

test("the globe keeps every node inside its box at both build sizes", () => {
  // Exercise the desktop model and its narrow display size.
  for (const [width, height] of [[600, 500], [280, 233]]) {
    const globe = buildGlobe(width, height);
    assert.ok(globe.nodes.length > 0, "the globe must contain nodes");
    for (const node of globe.nodes) {
      assert.ok(node.x >= 0 && node.x <= width, `node x ${node.x} must sit inside ${width}`);
      assert.ok(node.y >= 0 && node.y <= height, `node y ${node.y} must sit inside ${height}`);
    }
  }
});
