import test from "node:test";
import assert from "node:assert/strict";

import { buildGlobe } from "../../src/shared/lyra-globe/model.ts";

test("buildGlobe creates entrance routes along existing edges and ends each route at Vega", () => {
  const globe = buildGlobe(600, 500);
  const vegaNode = globe.nodes.find((node) => node.vega);
  assert.ok(vegaNode, "the globe must contain Vega");
  assert.ok(globe.routes.length > 0, "the globe must contain routes");
  const pointsShareEdge = (startPoint, endPoint) => globe.edges.some((edge) => (
    (edge.a.x === startPoint.x && edge.a.y === startPoint.y && edge.b.x === endPoint.x && edge.b.y === endPoint.y)
    || (edge.b.x === startPoint.x && edge.b.y === startPoint.y && edge.a.x === endPoint.x && edge.a.y === endPoint.y)));
  for (const route of globe.routes) {
    const routeEndpoint = route.points[route.points.length - 1];
    assert.deepEqual(routeEndpoint, { x: vegaNode.x, y: vegaNode.y }, "each entrance route must end at Vega");
    for (let pointIndex = 1; pointIndex < route.points.length; pointIndex++) assert.ok(pointsShareEdge(route.points[pointIndex - 1], route.points[pointIndex]), "each route segment must follow an existing edge");
    assert.equal(route.lengths.length, route.points.length);
    assert.ok(Math.abs(route.lengths[route.lengths.length - 1] - route.length) < 1e-6);
  }
});

test("buildGlobe keeps every node inside the bounds at desktop and narrow sizes", () => {
  // Exercise the desktop model and its narrow display size.
  for (const [width, height] of [[600, 500], [280, 233]]) {
    const globe = buildGlobe(width, height);
    assert.ok(globe.nodes.length > 0, "the globe must contain nodes");
    for (const node of globe.nodes) {
      assert.ok(node.x >= 0 && node.x <= width, `node x ${node.x} must remain within width ${width}`);
      assert.ok(node.y >= 0 && node.y <= height, `node y ${node.y} must remain within height ${height}`);
    }
  }
});
