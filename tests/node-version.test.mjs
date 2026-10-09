import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { root } from "./helpers.mjs";

const version = readFileSync(join(root, ".nvmrc"), "utf8").trim();

test("the shared file declares one exact Node version", () => {
  assert.match(version, /^\d+\.\d+\.\d+$/, ".nvmrc must hold one exact Node version");
});

test("the tests run with the declared Node version", () => {
  assert.equal(process.versions.node, version, "run nvm use before you run the tests");
});
