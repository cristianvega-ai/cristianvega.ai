import test from "node:test";
import assert from "node:assert/strict";

import { HOME_SECTION_SIZE as homeSectionSize, selectLatestEntries } from "../../src/shared/content/latest-entries.ts";

const entry = (id, date) => ({ id, data: { date: new Date(date) } });

test("selectLatestEntries returns the four newest entries, newest first", () => {
  const entries = [
    entry("oldest", "2025-11-20"),
    entry("newest", "2026-09-14"),
    entry("middle", "2026-07-03"),
    entry("second", "2026-08-27"),
    entry("third", "2026-08-09"),
  ];
  assert.equal(homeSectionSize, 4, "the homepage must show four entries in each section");
  assert.deepEqual(selectLatestEntries(entries).map(({ id }) => id), ["newest", "second", "third", "middle"]);
});

test("selectLatestEntries orders entries of the same date by id", () => {
  const entries = [entry("b-entry", "2026-06-18"), entry("a-entry", "2026-06-18"), entry("c-entry", "2026-06-18")];
  assert.deepEqual(selectLatestEntries(entries, 2).map(({ id }) => id), ["a-entry", "b-entry"]);
});

test("selectLatestEntries returns every entry when fewer than four exist, and leaves the input order unchanged", () => {
  const entries = [entry("older", "2026-01-01"), entry("newer", "2026-02-01")];
  assert.deepEqual(selectLatestEntries(entries).map(({ id }) => id), ["newer", "older"]);
  assert.deepEqual(entries.map(({ id }) => id), ["older", "newer"], "the input list must keep its order");
  assert.deepEqual(selectLatestEntries([]), [], "an empty collection must give an empty section");
});
