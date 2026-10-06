import test from "node:test";
import assert from "node:assert/strict";

import { LYRA } from "../src/lib/lyra/constellation.ts";
import { segmentHitsRect } from "../src/lib/page-graphics/labels.ts";
import { FIGURE_INSET } from "../src/lib/page-graphics/inset.ts";
import { buildField, hashUnit, overlaps, pathToVega, LYRA_EDGES } from "../src/lib/page-graphics/scenes/writing-layout.ts";
import { starWidthsCssPx } from "./helpers.mjs";

const fieldSizes = [[480, 600], [480, 900], [820, 340], [390, 340], [320, 340]];

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
  const first = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: 480, height: 640 });
  const second = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: 480, height: 640 });
  assert.deepEqual(first.points, second.points);
  assert.deepEqual(first.postLabels, second.postLabels);
  const other = buildField({ ids: ids.map((id) => `${id}-b`), labels, labelWidthsCssPx, starWidthsCssPx, width: 480, height: 640 });
  assert.notDeepEqual(other.points.slice(0, 8), first.points.slice(0, 8), "a different id must give a different spot");
});

test("the reading field keeps every post inside its box and out of the Lyra figure", () => {
  for (const [w, h] of fieldSizes) {
    for (const count of [1, 3, 8, 12]) {
      const { ids, labels, labelWidthsCssPx } = fieldPosts(count);
      const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: w, height: h });
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
      const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: w, height: h });
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
  const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: 480, height: 640 });
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

test("the reading field keeps labels clear of links, synapses, and the 24px edge", () => {
  for (const [w, h] of fieldSizes) {
    const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
    const bounds = { x0: 28, y0: 28, x1: w - 28, y1: h - 28 };
    const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: w, height: h, bounds });
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

test("the reading field keeps every post and field star inside the figure inset", () => {
  for (const [w, h] of fieldSizes) {
    const { ids, labels, labelWidthsCssPx } = fieldPosts(8);
    const field = buildField({ ids, labels, labelWidthsCssPx, starWidthsCssPx, width: w, height: h });
    for (const point of field.points) {
      assert.ok(point.x >= FIGURE_INSET - 1e-9 && point.x <= w - FIGURE_INSET + 1e-9, `${w}x${h}: x ${point.x} must sit inside the inset`);
      assert.ok(point.y >= FIGURE_INSET - 1e-9 && point.y <= h - FIGURE_INSET + 1e-9, `${w}x${h}: y ${point.y} must sit inside the inset`);
    }
  }
});
