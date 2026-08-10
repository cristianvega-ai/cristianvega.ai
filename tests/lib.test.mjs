import test from "node:test";
import assert from "node:assert/strict";

import {
  formatMachineDate,
  formatPostDate,
  formatReadableDate,
  getPostHref,
  getPublishedPosts,
} from "../src/lib/posts.ts";
import { projects } from "../src/lib/projects.ts";

/** Minimal stand-in for a content-collection entry: the fields the helpers read. */
function post(id, date, draft = false) {
  return { id, data: { title: id, date: new Date(date), draft } };
}

// Timestamps that straddle UTC midnight from both sides. Together they fail in
// every non-UTC timezone if the helpers ever drop their UTC pinning, so the
// suite catches the regression regardless of where it runs.
const justAfterUtcMidnight = new Date("2026-01-01T00:00:00.000Z");
const justBeforeUtcMidnight = new Date("2025-12-31T23:59:59.999Z");

test("getPublishedPosts drops drafts and orders newest first", () => {
  const older = post("older", "2026-02-27");
  const newest = post("newest", "2026-06-12");
  const middle = post("middle", "2026-04-18");
  const hidden = post("hidden", "2026-07-01", true);

  const published = getPublishedPosts([older, newest, hidden, middle]);

  assert.deepEqual(
    published.map((entry) => entry.id),
    ["newest", "middle", "older"],
  );
});

test("getPublishedPosts leaves the caller's array untouched", () => {
  const input = [post("older", "2026-02-27"), post("newest", "2026-06-12")];

  getPublishedPosts(input);

  assert.deepEqual(
    input.map((entry) => entry.id),
    ["older", "newest"],
    "sorting must not mutate the collection the caller passed in",
  );
});

test("getPostHref keeps the leading and trailing slash the site config requires", () => {
  assert.equal(getPostHref(post("from-bert-to-agents", "2026-06-12")), "/posts/from-bert-to-agents/");
});

test("formatPostDate zero-pads the month and reads the date in UTC", () => {
  assert.equal(formatPostDate(new Date("2026-04-18T00:00:00.000Z")), "2026.04");
  assert.equal(formatPostDate(new Date("2026-11-02T00:00:00.000Z")), "2026.11");
  assert.equal(formatPostDate(justAfterUtcMidnight), "2026.01");
  assert.equal(formatPostDate(justBeforeUtcMidnight), "2025.12");
});

test("formatMachineDate emits a UTC ISO calendar date", () => {
  assert.equal(formatMachineDate(new Date("2026-06-12T00:00:00.000Z")), "2026-06-12");
  assert.equal(formatMachineDate(justAfterUtcMidnight), "2026-01-01");
  assert.equal(formatMachineDate(justBeforeUtcMidnight), "2025-12-31");
});

test("formatReadableDate renders the long-form date in UTC", () => {
  assert.equal(formatReadableDate(new Date("2026-06-12T00:00:00.000Z")), "June 12, 2026");
  assert.equal(formatReadableDate(justAfterUtcMidnight), "January 1, 2026");
  assert.equal(formatReadableDate(justBeforeUtcMidnight), "December 31, 2025");
});

test("projects declare the fields the cards render", () => {
  assert.ok(projects.length > 0, "portfolio must not be empty");

  for (const project of projects) {
    assert.ok(project.name?.trim(), "project needs a name");
    assert.ok(project.initials?.trim(), `${project.name} needs initials for the card mark`);
    assert.ok(project.blurb?.trim(), `${project.name} needs a blurb`);
    assert.ok(
      ["live", "beta", "wip"].includes(project.status),
      `${project.name} has an unknown status: ${project.status}`,
    );
    assert.ok(Array.isArray(project.tags), `${project.name} tags must be an array`);
    for (const tag of project.tags) {
      assert.ok(typeof tag === "string" && tag.trim(), `${project.name} has a blank tag`);
    }
  }
});

test("projects state availability instead of a placeholder destination", () => {
  // AGENTS.md: never imply that private work is publicly available, and never
  // stand in a generic archive for a case study that does not exist yet.
  const fakeDestinations = new Set(["/", "/writing/", "#"]);

  for (const project of projects) {
    const destinations = Object.values(project)
      .flat()
      .filter((value) => typeof value === "string" && /^(?:https?:\/\/|\/|#)/.test(value));

    for (const destination of destinations) {
      assert.ok(
        !fakeDestinations.has(destination),
        `${project.name} points at a placeholder destination: ${destination}`,
      );
    }

    if (destinations.length === 0) {
      assert.equal(
        typeof project.availability,
        "string",
        `${project.name} has no destination, so it must state availability in words`,
      );
      assert.ok(project.availability.trim(), `${project.name} availability must not be blank`);
    }
  }
});
