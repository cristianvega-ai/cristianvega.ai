import test from "node:test";
import assert from "node:assert/strict";

import { clamp, cubicPoint, easeOutCubic } from "../src/lib/motion/easing.ts";
import { LYRA, LYRA_LINKS } from "../src/lib/lyra/constellation.ts";
import { DURATION, entranceProgress, stagger } from "../src/lib/lyra-render/clock.ts";
import { LYRA_MAX_SIZE, layoutLyra } from "../src/lib/lyra-render/lyra.ts";
import { around, placeLabel, rectsOverlap, segmentHitsRect } from "../src/lib/lyra-render/labels.ts";
import { FIGURE_INSET, figureRect } from "../src/lib/lyra-render/inset.ts";
import { RING_MARGIN, aboutLayout } from "../src/lib/lyra-render/pages/about.ts";
import { makeMesh } from "../src/lib/lyra-render/mesh.ts";
import { lerp, smooth, unit } from "../src/lib/lyra-render/math.ts";
import { makeRoute } from "../src/lib/lyra-render/marks.ts";
import { MAX_SLOTS, MIN_SLOTS, fitLyraAtVega, orbitBox, orbitSlot, planOrbit, productProgress } from "../src/lib/lyra-render/pages/products.ts";
import { MISSING, PULSE_MS, PULSE_STARTS, REST_MS, missingLayout, layoutMissing } from "../src/lib/lyra-render/pages/404.ts";
import { buildField, hashUnit, overlaps, pathToVega, LYRA_EDGES } from "../src/lib/lyra-render/pages/writing-layout.ts";
import { buildGlobe, EDGE_SPAN, NODE_SPAN } from "../src/lib/lyra-globe/model.ts";

test("clamp holds a value inside its range", () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(clamp(0.4), 0.4);
  assert.equal(clamp(15, 10, 20), 15);
  assert.equal(clamp(25, 10, 20), 20);
});

test("easeOutCubic starts at zero, ends at one, and never falls", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  let previous = 0;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const value = easeOutCubic(t);
    assert.ok(value >= previous, `easeOutCubic must not fall at ${t}`);
    previous = value;
  }
});

test("cubicPoint writes into the point it receives and hits both ends", () => {
  const out = { x: 0, y: 0 };
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 20 };
  const result = cubicPoint(out, 0, start, { x: 3, y: 0 }, { x: 7, y: 20 }, end);
  assert.equal(result, out, "cubicPoint must reuse the output point");
  assert.deepEqual(out, { x: 0, y: 0 });
  cubicPoint(out, 1, start, { x: 3, y: 0 }, { x: 7, y: 20 }, end);
  assert.deepEqual(out, { x: 10, y: 20 });
});

test("the Lyra figure links only stars that exist", () => {
  assert.equal(LYRA.length, 6);
  for (const [from, to] of LYRA_LINKS) {
    assert.ok(LYRA[from] && LYRA[to], `link ${from}-${to} must name two stars`);
  }
});

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

test("the page graphic entrance clock starts at zero, ends at one, and never falls", () => {
  assert.equal(entranceProgress(0), 0);
  assert.equal(entranceProgress(DURATION), 1);
  assert.equal(entranceProgress(DURATION * 3), 1);
  let previous = 0;
  for (let elapsed = 0; elapsed <= DURATION; elapsed += 50) {
    const value = entranceProgress(elapsed);
    assert.ok(value >= previous, `the clock must not fall at ${elapsed} ms`);
    previous = value;
  }
});

test("stagger, smooth, and lerp stay inside their ranges", () => {
  assert.equal(stagger(0.1, 0.2, 0.4), 0);
  assert.equal(stagger(0.4, 0.2, 0.4), 0.5);
  assert.equal(stagger(0.9, 0.2, 0.4), 1);
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
  assert.equal(smooth(0.5), 0.5);
  assert.equal(lerp(10, 20, 0.25), 12.5);
});

test("unit gives the same value for an index and stays below one", () => {
  for (let i = 0; i < 200; i += 1) {
    const value = unit(i);
    assert.equal(value, unit(i));
    assert.ok(value >= 0 && value < 1, `unit(${i}) must be in [0, 1)`);
  }
});

test("layoutLyra fits the Lyra figure inside the padded box and keeps Vega first", () => {
  const points = layoutLyra(400, 200, { pad: 20 });
  assert.equal(points.length, LYRA.length);
  assert.equal(points[0].vega, true);
  assert.equal(points.filter((point) => point.vega).length, 1);
  for (const point of points) {
    assert.ok(point.x >= 19.999 && point.x <= 380.001, `x ${point.x} must sit inside the box`);
    assert.ok(point.y >= 19.999 && point.y <= 180.001, `y ${point.y} must sit inside the box`);
  }
  const reused = layoutLyra(300, 300, { out: points });
  assert.equal(reused, points, "layoutLyra must fill the array it receives");
});

// The size of the figure and its aspect, for a set of stars.
const figureBox = (points) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { width, height, aspect: width / height };
};

test("layoutLyra keeps the same proportions and a capped size on every canvas", () => {
  assert.ok(LYRA_MAX_SIZE <= 320, "the cap must stay near the size of the homepage and Writing figures");
  const native = figureBox(LYRA.map((star) => ({ x: star.x, y: star.y })));
  for (const [w, h] of [[300, 300], [380, 720], [460, 900], [700, 150], [1200, 1200], [2000, 3000], [3000, 400]]) {
    const box = figureBox(layoutLyra(w, h));
    assert.ok(Math.abs(box.aspect - native.aspect) < 1e-9, `${w}x${h}: the aspect must match the figure, not the canvas`);
    assert.ok(Math.max(box.width, box.height) <= LYRA_MAX_SIZE + 1e-9, `${w}x${h}: the figure must not grow past the cap`);
  }
  const small = figureBox(layoutLyra(200, 120, { pad: 10 }));
  assert.ok(Math.max(small.width, small.height) < LYRA_MAX_SIZE, "a small canvas must still shrink the figure");
  const tall = layoutLyra(460, 900);
  const cx = (Math.min(...tall.map((p) => p.x)) + Math.max(...tall.map((p) => p.x))) / 2;
  assert.ok(Math.abs(cx - 230) < 1e-6, "a capped figure must sit centred in the canvas");
});

test("makeRoute keeps running lengths along the points", () => {
  const route = makeRoute([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }]);
  assert.deepEqual([...route.lengths], [0, 5, 11]);
  assert.equal(route.length, 11);
});

// A box of a tall side column, and a box of a wide band, as the page graphic meets them.
const ORBIT_BOXES = [
  { name: "column", w: 380, h: 720, wide: false },
  { name: "band", w: 700, h: 150, wide: true },
];

test("planOrbit keeps six slots and lights one for each product up to the maximum", () => {
  assert.deepEqual(planOrbit(0), { lit: 0, total: MIN_SLOTS });
  assert.deepEqual(planOrbit(1), { lit: 1, total: 6 });
  assert.deepEqual(planOrbit(6), { lit: 6, total: 6 });
  assert.deepEqual(planOrbit(MAX_SLOTS + 5), { lit: MAX_SLOTS, total: MAX_SLOTS });
  assert.deepEqual(planOrbit(Number.NaN), { lit: 0, total: 6 });
});

test("productProgress finishes every active node and link at full progress", () => {
  for (let count = MAX_SLOTS; count > 0; count -= 1) {
    for (let index = 0; index < count; index += 1) {
      for (const part of ["node", "link"]) {
        assert.equal(productProgress(0, index, count, part), 0, `${count} products: ${part} ${index} must start empty`);
        assert.equal(productProgress(1, index, count, part), 1, `${count} products: ${part} ${index} must finish`);
        let previous = 0;
        for (let progress = 0; progress <= 1; progress += 0.05) {
          const value = productProgress(progress, index, count, part);
          assert.ok(value >= previous, `${count} products: ${part} ${index} must not lose progress`);
          if (index > 0) {
            assert.ok(value <= productProgress(progress, index - 1, count, part), `${count} products: ${part} ${index} must wait its turn`);
          }
          previous = value;
        }
      }
    }
  }
});

test("productProgress keeps the entrance timing for one product", () => {
  for (const progress of [0, 0.42, 0.5, 0.55, 0.58, 0.7, 1]) {
    assert.ok(Math.abs(productProgress(progress, 0, 1, "node") - stagger(progress, 0.42, 0.16)) < 1e-12);
    assert.ok(Math.abs(productProgress(progress, 0, 1, "link") - stagger(progress, 0.5, 0.2)) < 1e-12);
  }
});

test("orbitSlot gives every supported product its own place inside the box", () => {
  for (const box of ORBIT_BOXES) {
    const cx = box.w / 2;
    const cy = box.h / 2;
    const hw = box.w * 0.46;
    const hh = box.h * 0.46;
    for (let count = 1; count <= MAX_SLOTS; count += 1) {
      const { total } = planOrbit(count);
      const spots = Array.from({ length: total }, (_, i) => orbitSlot({ x: 0, y: 0 }, i, box.wide, cx, cy, hw, hh));
      for (const [i, spot] of spots.entries()) {
        assert.ok(spot.x > 0 && spot.x < box.w && spot.y > 0 && spot.y < box.h, `${box.name}: slot ${i} must sit inside the box`);
        assert.ok(Math.hypot(spot.x - cx, spot.y - cy) > 8, `${box.name}: slot ${i} must not sit on Vega`);
        for (let j = 0; j < i; j += 1) {
          const apart = Math.hypot(spot.x - spots[j].x, spot.y - spots[j].y);
          assert.ok(apart >= 16, `${box.name}: slots ${j} and ${i} must be 16 px apart or more, not ${apart}`);
        }
      }
    }
  }
});

test("orbitSlot puts a slot on its orbit ellipse", () => {
  const spot = orbitSlot({ x: 0, y: 0 }, 2, false, 100, 200, 50, 80);
  // Slot 2 is on the innermost orbit, at 0.36 of the half box.
  const share = ((spot.x - 100) / 50) ** 2 + ((spot.y - 200) / 80) ** 2;
  assert.ok(Math.abs(share - 0.36 ** 2) < 1e-9);
});

test("fitLyraAtVega keeps Vega at the centre and the figure inside the half box", () => {
  for (const box of ORBIT_BOXES) {
    const cx = box.w / 2;
    const cy = box.h / 2;
    const rx = box.w * 0.46 * 0.8;
    const ry = box.h * 0.46 * 0.8;
    const points = fitLyraAtVega([], cx, cy, rx, ry, box.wide);
    assert.equal(points.length, LYRA.length);
    assert.deepEqual(points[0], { x: cx, y: cy });
    for (const point of points) {
      assert.ok(Math.abs(point.x - cx) <= rx + 1e-9, `${box.name}: x ${point.x} must stay inside the half width`);
      assert.ok(Math.abs(point.y - cy) <= ry + 1e-9, `${box.name}: y ${point.y} must stay inside the half height`);
    }
  }
});

test("fitLyraAtVega never grows the figure past the cap, and keeps its proportions", () => {
  assert.ok(LYRA_MAX_SIZE <= 320, "the cap must stay near the size of the homepage and Writing figures");
  const native = figureBox(LYRA.map((star) => ({ x: star.x, y: star.y })));
  for (const [rx, ry] of [[100, 150], [500, 900], [2000, 2000]]) {
    const box = figureBox(fitLyraAtVega([], 0, 0, rx, ry, false));
    assert.ok(Math.abs(box.aspect - native.aspect) < 1e-9, `${rx}x${ry}: the aspect must match the figure`);
    assert.ok(Math.max(box.width, box.height) <= LYRA_MAX_SIZE + 1e-9, `${rx}x${ry}: the figure must not grow past the cap`);
  }
});

test("fitLyraAtVega turns the figure only in a wide box, and reuses the array it receives", () => {
  const upright = fitLyraAtVega([], 0, 0, 100, 100, false);
  const turned = fitLyraAtVega(upright.map((point) => ({ ...point })), 0, 0, 100, 100, true);
  assert.ok(Math.abs(turned[5].x) > Math.abs(turned[5].y) * 0.5, "the long side of the figure must run across a wide box");
  const reused = fitLyraAtVega(upright, 0, 0, 50, 50, false);
  assert.equal(reused, upright);
});

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

const fieldSizes = [[480, 600], [480, 900], [820, 340], [390, 340], [320, 340]];
const starWidthsCssPx = [66, 0, 0, 0, 42, 42];
const fieldPosts = (count) => {
  const ids = Array.from({ length: count }, (_, i) => `post-${i}-lorem-ipsum`);
  return { ids, labels: ids.map((_, i) => `N\u00b0 ${String(count - i).padStart(2, "0")}`), labelWidthsCssPx: new Array(count).fill(30) };
};

test("hashUnit gives one stable value in [0, 1) for a text and a salt", () => {
  assert.equal(hashUnit("a-post", 1), hashUnit("a-post", 1));
  assert.notEqual(hashUnit("a-post", 1), hashUnit("a-post", 2));
  assert.notEqual(hashUnit("a-post", 1), hashUnit("b-post", 1));
  for (const id of ["", "x", "a-long-post-id-with-many-words"]) {
    const value = hashUnit(id, 3);
    assert.ok(value >= 0 && value < 1, `hashUnit(${id}) must be in [0, 1)`);
  }
});

test("pathToVega walks the Lyra links from a star to Vega", () => {
  assert.deepEqual(pathToVega(0, LYRA_EDGES, LYRA.length), [0]);
  for (let start = 1; start < LYRA.length; start += 1) {
    const path = pathToVega(start, LYRA_EDGES, LYRA.length);
    assert.equal(path[0], start);
    assert.equal(path[path.length - 1], 0);
    for (let i = 1; i < path.length; i += 1) {
      const linked = LYRA_EDGES.some(([a, b]) => (a === path[i - 1] && b === path[i]) || (b === path[i - 1] && a === path[i]));
      assert.ok(linked, `step ${path[i - 1]} to ${path[i]} must follow a Lyra link`);
    }
  }
});

test("the reading field places the same posts in the same spots on every call", () => {
  const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
  const first = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w: 480, h: 640 });
  const second = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w: 480, h: 640 });
  assert.deepEqual(first.points, second.points);
  assert.deepEqual(first.postLabels, second.postLabels);
  const other = buildField({ ids: ids.map((id) => `${id}-b`), labels, labelWidthsCssPx, starWidthsCssPx, w: 480, h: 640 });
  assert.notDeepEqual(other.points.slice(0, 8), first.points.slice(0, 8), "a different id must give a different spot");
});

test("the reading field keeps every post inside its box and out of the Lyra figure", () => {
  for (const [w, h] of fieldSizes) {
    for (const count of [1, 3, 8, 12]) {
      const { ids, labels, labelWidthsCssPx } = fieldPosts(count);
      const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w, h });
      assert.equal(field.points.filter((point) => point.post).length, count);
      assert.ok(field.points.slice(0, count).every((point) => point.post), "posts must come first");
      for (const post of field.points.slice(0, count)) {
        assert.ok(post.x > 0 && post.x < w && post.y > 0 && post.y < h, `${w}x${h}, ${count} posts: a post must sit inside the box`);
        for (const star of field.stars) {
          assert.ok(Math.hypot(post.x - star.x, post.y - star.y) > 12, `${w}x${h}, ${count} posts: a post must not sit on a Lyra star`);
        }
      }
    }
  }
});

test("the reading field labels never collide, never leave the box, and never cover a star", () => {
  for (const [w, h] of fieldSizes) {
    for (const count of [1, 3, 8, 12]) {
      const { ids, labels, labelWidthsCssPx } = fieldPosts(count);
      const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w, h });
      const where = `${w}x${h}, ${count} posts`;
      const shown = [...field.postLabels, ...field.starLabels.filter(Boolean)];
      assert.equal(field.postLabels.length, count, `${where}: every post keeps a label`);
      shown.forEach((label, i) => {
        assert.ok(label.rect.x0 >= 0 && label.rect.x1 <= w && label.rect.y0 >= 0 && label.rect.y1 <= h, `${where}: "${label.text}" must stay inside the box`);
        for (const other of shown.slice(i + 1)) assert.ok(!overlaps(label.rect, other.rect), `${where}: "${label.text}" must not touch "${other.text}"`);
        const marks = [...field.stars, ...field.points.slice(0, count)];
        for (const mark of marks) {
          const box = { x0: mark.x - 10, y0: mark.y - 10, x1: mark.x + 10, y1: mark.y + 10 };
          assert.ok(!overlaps(label.rect, box), `${where}: "${label.text}" must not cover a star`);
        }
      });
    }
  }
});

test("the reading field links each point once, and every link joins two real points", () => {
  const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
  const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w: 480, h: 640 });
  const seen = new Set();
  for (const link of field.links) {
    assert.ok(link.from !== link.to);
    assert.ok(field.points[link.from] && field.points[link.to]);
    const key = [Math.min(link.from, link.to), Math.max(link.from, link.to)].join("-");
    assert.ok(!seen.has(key), `link ${key} must appear once`);
    seen.add(key);
  }
  assert.ok(field.links.length > 8, "the field must hold synapses");
});

const HERE = { x0: 0, y0: 0, x1: 400, y1: 300 };

test("segmentHitsRect finds a segment that crosses, touches, or lies inside a box", () => {
  const box = { x0: 10, y0: 10, x1: 20, y1: 20 };
  assert.equal(segmentHitsRect({ ax: 0, ay: 15, bx: 30, by: 15 }, box), true, "a line through the box");
  assert.equal(segmentHitsRect({ ax: 12, ay: 12, bx: 14, by: 14 }, box), true, "a line inside the box");
  assert.equal(segmentHitsRect({ ax: 0, ay: 0, bx: 30, by: 5 }, box), false, "a line above the box");
  assert.equal(segmentHitsRect({ ax: 25, ay: 0, bx: 25, by: 40 }, box), false, "a vertical line beside the box");
});

test("placeLabel takes the first side that no edge crosses", () => {
  const free = placeLabel("VEGA", 200, 150, { widthCssPx: 24, bounds: HERE });
  assert.equal(free.side, "right", "with nothing in the way, the label goes right");
  assert.equal(free.align, "left");
  const blocked = [{ ax: 200, ay: 150, bx: 320, by: 150 }];
  const around = placeLabel("VEGA", 200, 150, { widthCssPx: 24, bounds: HERE, segments: blocked });
  assert.notEqual(around.side, "right", "an edge to the right must move the label");
  assert.ok(!blocked.some((segment) => segmentHitsRect(segment, around.rect)), "the chosen box must not touch the edge");
  assert.equal(around.clear, true);
});

test("placeLabel stays inside the bounds and keeps clear of earlier labels", () => {
  const bounds = { x0: 30, y0: 30, x1: 170, y1: 100 };
  const nearRight = placeLabel("VEGA · α LYR", 160, 60, { widthCssPx: 66, bounds });
  assert.ok(nearRight.rect.x0 >= bounds.x0 && nearRight.rect.x1 <= bounds.x1, "the label must not pass the right bound");
  assert.notEqual(nearRight.side, "right");
  const avoid = [];
  const first = placeLabel("ONE", 100, 60, { widthCssPx: 18, bounds: HERE, avoid });
  const second = placeLabel("TWO", 100, 60, { widthCssPx: 18, bounds: HERE, avoid });
  assert.equal(avoid.length, 2, "each label must reserve its box");
  assert.ok(!rectsOverlap(first.rect, second.rect), "two labels must not overlap");
  const none = placeLabel("VEGA", 5, 5, { widthCssPx: 24, bounds: { x0: 0, y0: 0, x1: 20, y1: 20 } });
  assert.equal(none.clear, false, "a label with no free place must say so");
  assert.ok(around(5, 5, 3).x1 === 8);
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

test("the reading field labels never sit on a figure link, post labels never on a synapse, and all keep 24px from the edge", () => {
  for (const [w, h] of fieldSizes) {
    const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
    const bounds = { x0: 28, y0: 28, x1: w - 28, y1: h - 28 };
    const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w, h, bounds });
    const hits = (label, a, b) => segmentHitsRect({ ax: a.x, ay: a.y, bx: b.x, by: b.y }, label.rect);
    const shown = [...field.postLabels.map((label) => [label, true]), ...field.starLabels.filter(Boolean).map((label) => [label, false])];
    for (const [label, isPost] of shown) {
      if (!label.clear) continue;
      assert.ok(label.rect.x0 >= 24 && label.rect.x1 <= w - 24 && label.rect.y0 >= 24 && label.rect.y1 <= h - 24, `${w}x${h}: "${label.text}" must keep 24px from the edge`);
      for (const [a, b] of LYRA_EDGES) assert.equal(hits(label, field.stars[a], field.stars[b]), false, `${w}x${h}: a figure link must not cross "${label.text}"`);
      if (!isPost) continue;
      for (const link of field.links) assert.equal(hits(label, field.points[link.from], field.points[link.to]), false, `${w}x${h}: a synapse must not cross "${label.text}"`);
    }
  }
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

test("the shared mesh density holds about half the nodes of the old dense mesh, and the diagonal arcs come last and are few", () => {
  // The old cell was 68px. The one shared density on every page is sparser.
  for (const [w, h, seed] of [[460, 760, 5], [700, 940, 3], [520, 800, 11]]) {
    const dense = makeMesh(w, h, seed, 68);
    const shared = makeMesh(w, h, seed);
    assert.ok(shared.count <= dense.count * 0.62, `${w}x${h}: ${shared.count} nodes must be about half of ${dense.count}`);
    assert.ok(shared.diagonalFrom > 0 && shared.diagonalFrom <= shared.linkCount);
    assert.ok(shared.linkCount - shared.diagonalFrom < shared.diagonalFrom, `${w}x${h}: the diagonal arcs must be fewer than the straight links`);
  }
});

test("the figure inset is 32px, larger than the 24px edge fade, and figureRect follows it", () => {
  assert.equal(FIGURE_INSET, 32);
  assert.deepEqual(figureRect(456, 762), { x0: 32, y0: 32, x1: 424, y1: 730 });
});

const aboutBoxes = [[456, 762], [696, 942], [680, 136], [326, 136], [326, 150], [560, 800]];

test("aboutLayout keeps Vega and its outer ring inside the box, with the ring radius plus 24px from the right edge and the top", () => {
  assert.equal(RING_MARGIN, 24);
  for (const [w, h] of aboutBoxes) {
    const { vx, vy, ring } = aboutLayout(w, h);
    assert.ok(ring >= 20, `${w}x${h}: the rings must stay readable`);
    assert.ok(vx + ring + RING_MARGIN <= w + 1e-9, `${w}x${h}: the outer ring must keep 24px from the right edge`);
    assert.ok(vy - ring - RING_MARGIN >= -1e-9, `${w}x${h}: the outer ring must keep 24px from the top`);
    assert.ok(vy + ring <= h - FIGURE_INSET + 1e-9 || h < 300, `${w}x${h}: the outer ring must not leave the bottom`);
    assert.ok(vx - ring >= 0, `${w}x${h}: the outer ring must not leave the left edge`);
  }
});

test("aboutLayout keeps the whole path and its control points inside the figure inset", () => {
  for (const [w, h] of aboutBoxes) {
    const { curve } = aboutLayout(w, h);
    assert.equal(curve.length, 8);
    for (let i = 0; i < 8; i += 2) {
      assert.ok(curve[i] >= FIGURE_INSET - 1e-9 && curve[i] <= w - FIGURE_INSET + 1e-9, `${w}x${h}: x ${curve[i]} must sit inside the inset`);
      assert.ok(curve[i + 1] >= FIGURE_INSET - 1e-9 && curve[i + 1] <= h - FIGURE_INSET + 1e-9, `${w}x${h}: y ${curve[i + 1]} must sit inside the inset`);
    }
  }
});

test("aboutLayout runs the path sideways in a band and upright in a column", () => {
  assert.equal(aboutLayout(680, 136).horizontal, true);
  assert.equal(aboutLayout(456, 762).horizontal, false);
});

test("the products orbits keep the outer ellipse inside the figure inset", () => {
  for (const [w, h] of [[456, 762], [696, 942], [680, 136], [326, 136]]) {
    const { hw, hh } = orbitBox(w, h);
    assert.ok(w / 2 - hw * 0.95 >= FIGURE_INSET - 1e-9, `${w}x${h}: the outer orbit must keep the inset on the sides`);
    assert.ok(h / 2 - hh * 0.95 >= FIGURE_INSET - 1e-9, `${w}x${h}: the outer orbit must keep the inset above and below`);
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

test("the reading field keeps every post and field star inside the figure inset", () => {
  for (const [w, h] of fieldSizes) {
    const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
    const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, w, h });
    for (const point of field.points) {
      assert.ok(point.x >= FIGURE_INSET - 1e-9 && point.x <= w - FIGURE_INSET + 1e-9, `${w}x${h}: x ${point.x} must sit inside the inset`);
      assert.ok(point.y >= FIGURE_INSET - 1e-9 && point.y <= h - FIGURE_INSET + 1e-9, `${w}x${h}: y ${point.y} must sit inside the inset`);
    }
  }
});
