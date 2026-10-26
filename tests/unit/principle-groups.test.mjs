import test from "node:test";
import assert from "node:assert/strict";

import { groupPrinciples, PRINCIPLE_GROUPS as principleGroups, selectHomePrinciples, sortPrinciples } from "../../src/shared/content/principle-groups.ts";

const principle = (id, group, order, featured = false) => ({ id, data: { group, order, featured } });

test("sortPrinciples orders the principles by group, then by order, then by id", () => {
  const principles = [
    principle("model-second", "working-with-models", 2),
    principle("build-zulu", "building", 1),
    principle("model-first", "working-with-models", 1),
    principle("build-alpha", "building", 1),
    principle("build-first", "building", 0),
  ];
  assert.deepEqual(sortPrinciples(principles).map((entry) => entry.id), ["build-first", "build-alpha", "build-zulu", "model-first", "model-second"]);
  assert.deepEqual(principles.map((entry) => entry.id), ["model-second", "build-zulu", "model-first", "build-alpha", "build-first"], "sortPrinciples must not reorder its input");
});

test("groupPrinciples returns only the groups that hold a principle, in page order", () => {
  assert.deepEqual(principleGroups.map((group) => group.id), ["building", "working-with-models"]);
  const groups = groupPrinciples([principle("model-first", "working-with-models", 1), principle("model-zero", "working-with-models", 0)]);
  assert.deepEqual(groups.map((group) => [group.id, group.label, group.principles.map((entry) => entry.id)]), [["working-with-models", "Working with models", ["model-zero", "model-first"]]]);
  assert.deepEqual(groupPrinciples([]), []);
});

test("selectHomePrinciples returns the featured principles in page order, at most four", () => {
  const principles = [
    principle("model-featured", "working-with-models", 1, true),
    principle("build-plain", "building", 0),
    principle("build-featured", "building", 2, true),
    principle("model-late", "working-with-models", 9, true),
    principle("build-early", "building", 1, true),
    principle("model-early", "working-with-models", 0, true),
  ];
  assert.deepEqual(selectHomePrinciples(principles).map((entry) => entry.id), ["build-early", "build-featured", "model-early", "model-featured"]);
  assert.deepEqual(selectHomePrinciples(principles, 2).map((entry) => entry.id), ["build-early", "build-featured"]);
  assert.deepEqual(selectHomePrinciples(principles, -1), []);
});

test("selectHomePrinciples returns the first four principles in page order when none is featured", () => {
  const principles = ["e", "d", "c", "b", "a"].map((id, index) => principle(id, "building", index));
  assert.deepEqual(selectHomePrinciples(principles).map((entry) => entry.id), ["e", "d", "c", "b"]);
  assert.deepEqual(selectHomePrinciples([]), []);
});
