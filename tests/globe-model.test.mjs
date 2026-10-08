import test from "node:test";
import assert from "node:assert/strict";

import { LYRA, LYRA_LINKS } from "../src/shared/lyra/constellation.ts";
import { buildGlobe, EDGE_SPAN, NODE_SPAN } from "../src/shared/lyra-globe/model.ts";
import { globeProjectionStylesheet, projectGlobe } from "../src/shared/lyra-globe/projection.ts";

test("the globe holds 70 neurons, the Lyra figure, and one hot route", () => {
  const globe = buildGlobe(600, 500);
  assert.equal(globe.nodes.length, 70 + LYRA.length);
  assert.equal(globe.nodes.filter((node) => node.vega).length, 1);
  // The six figure links and four route links carry the signal.
  assert.equal(globe.hotEdges.length, LYRA_LINKS.length + 4);
  assert.ok(globe.hotNodes.length >= 6, "every star of the figure is hot");
  assert.deepEqual(globe.labels.map((label) => label.text), ["VEGA", "LYRA / NEURAL SPHERE"]);
  assert.equal(globe.rings.length, 2);
});

test("the globe sends entrance comets along real edges, and each one ends on Vega", () => {
  const globe = buildGlobe(600, 500);
  const vega = globe.nodes.find((node) => node.vega);
  assert.ok(globe.routes.length >= 6, "enough comets to read as a flow");
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

test("the entrance comets start in turn and all arrive before the entrance ends", () => {
  const globe = buildGlobe(600, 500);
  const starts = globe.routes.map((route) => route.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), "the comets start in order");
  assert.ok(starts[starts.length - 1] - starts[0] > 0.3, "the starts spread over time");
  for (const route of globe.routes) {
    assert.ok(route.start >= 0, "no comet starts before the entrance");
    assert.ok(route.start + route.span <= 0.9, "a comet arrives before the last tenth, which is left for the bloom to fade");
  }
});

test("the entrance draws every neuron and edge in time, the far side first and Vega last", () => {
  const globe = buildGlobe(600, 500);
  for (const node of globe.nodes) {
    assert.ok(node.start >= 0 && node.start + NODE_SPAN <= 1, "a neuron finishes before the entrance ends");
  }
  for (const edge of globe.edges) {
    assert.ok(edge.start >= 0 && edge.start + EDGE_SPAN <= 1, "an edge finishes before the entrance ends");
    assert.ok(edge.from === edge.a || edge.from === edge.b, "an edge grows from one of its own ends");
  }
  const vega = globe.nodes.find((node) => node.vega);
  const others = globe.nodes.filter((node) => node !== vega);
  assert.ok(others.every((node) => node.start < vega.start), "Vega appears after every other neuron");
  // The mesh grows toward the near face: the far half starts before the near half.
  const mesh = globe.edges.filter((edge) => !edge.hot).sort((p, q) => p.alpha - q.alpha);
  const mean = (edges) => edges.reduce((sum, edge) => sum + edge.start, 0) / edges.length;
  const half = Math.floor(mesh.length / 2);
  assert.ok(mean(mesh.slice(0, half)) < mean(mesh.slice(half)) - 0.05, "the far side draws before the near side");
  // The figure draws toward Vega: each hot edge grows from the end far from the star.
  const reach = (node) => Math.hypot(node.x - vega.x, node.y - vega.y);
  for (const edge of globe.hotEdges) {
    const other = edge.from === edge.a ? edge.b : edge.a;
    assert.ok(reach(edge.from) >= reach(other), "a hot edge grows toward Vega");
  }
  // The figure starts after the mesh has begun, and it ends before the last comet.
  assert.ok(Math.min(...globe.hotEdges.map((edge) => edge.start)) > Math.min(...mesh.map((edge) => edge.start)));
});

test("the globe labels keep a pixel offset, so the type does not scale with the grid", () => {
  const globe = buildGlobe(600, 500);
  const [vega, caption] = globe.labels;
  assert.equal(vega.text, "VEGA");
  assert.ok(vega.dx > 0 && vega.dy < 0, "the name sits up and to the right of the star");
  // The star has a 10px ring and an 18px halo. The name stands clear of the ring.
  assert.ok(vega.dx >= 12 && vega.dy <= -12, "the name keeps clear of the ring around Vega");
  assert.equal(caption.align, "center");
});

test("the globe keeps every node inside its box at both build sizes", () => {
  for (const [width, height] of [[600, 500], [280, 233]]) {
    const globe = buildGlobe(width, height);
    for (const node of globe.nodes) {
      assert.ok(node.x >= 0 && node.x <= width, `node x ${node.x} must sit inside ${width}`);
      assert.ok(node.y >= 0 && node.y <= height, `node y ${node.y} must sit inside ${height}`);
    }
  }
});

test("the globe builds the same geometry on every call", () => {
  assert.deepEqual(buildGlobe(600, 500), buildGlobe(600, 500));
});

test("the globe projection keeps the approved desktop crop for the current model", () => {
  const projection = projectGlobe(buildGlobe(600, 500));
  assert.deepEqual(
    { pictureHeight: projection.pictureHeight, pictureTop: projection.pictureTop, boxAspect: projection.boxAspect, ringInset: projection.ringInset, centerReach: projection.centerReach },
    { pictureHeight: 1.2019, pictureTop: -0.1106, boxAspect: 0.9013, ringInset: 0.2468, centerReach: 0.4162 },
  );
  assert.equal(projection.captionLength, "LYRA / NEURAL SPHERE".length);
});

test("the globe projection crop shows the outer ring and the caption at every build size", () => {
  for (const [width, height] of [[600, 500], [720, 560], [600, 600]]) {
    const globe = buildGlobe(width, height);
    const projection = projectGlobe(globe);
    const ring = globe.rings.reduce((outer, candidate) => candidate.rx * candidate.ry > outer.rx * outer.ry ? candidate : outer);
    const caption = globe.labels.find((label) => label.align === "center");
    // Grid units per box height, and the top of the box in grid units.
    const unit = height / projection.pictureHeight;
    const boxTop = -projection.pictureTop * unit;
    const above = (ring.y - ring.ry - boxTop) / ring.ry;
    const below = (boxTop + unit - caption.y) / ring.ry;
    assert.ok(above > 0 && above < 0.06, `${width}x${height}: the box must start just above the outer ring, not ${above}`);
    assert.ok(below > 0 && below < 0.06, `${width}x${height}: the box must end just below the caption, not ${below}`);
  }
});

test("the globe projection writes the desktop values with four decimal places", () => {
  const css = globeProjectionStylesheet(buildGlobe(600, 500));
  assert.match(css, /^\.hero__globe\{(--globe-[a-z-]+:-?[0-9.]+;)+\}$/);
  for (const [, value] of css.matchAll(/--globe-(?:picture-height|picture-top|box-aspect|ring-inset|center-reach):(-?[0-9.]+);/g)) {
    assert.ok(Math.abs(Number(value) * 10_000 - Math.round(Number(value) * 10_000)) < 1e-6, `${value} must have four decimal places or fewer`);
  }
});

