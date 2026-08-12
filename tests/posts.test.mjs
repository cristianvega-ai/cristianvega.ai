import test from "node:test";
import assert from "node:assert/strict";
import { getPublishedPosts } from "../src/lib/published-posts.mjs";

function post(id, { draft = false, date }) {
  return { id, data: { draft, date: new Date(`${date}T00:00:00.000Z`) } };
}

test("getPublishedPosts drops drafts and sorts newest first", () => {
  const entries = [
    post("older-published", { date: "2026-01-01" }),
    post("draft-notes", { draft: true, date: "2026-12-01" }),
    post("newer-published", { date: "2026-06-01" }),
  ];

  const published = getPublishedPosts(entries);

  assert.deepEqual(
    published.map((entry) => entry.id),
    ["newer-published", "older-published"],
  );
  assert.equal(
    published.some((entry) => entry.id === "draft-notes"),
    false,
    "draft: true entries must not be published",
  );
});
