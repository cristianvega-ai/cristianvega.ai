import test from "node:test";
import assert from "node:assert/strict";

import { clamp, cubicPoint, easeOutCubic } from "../src/lib/motion/easing.ts";

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
