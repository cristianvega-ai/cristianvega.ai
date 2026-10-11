import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { root as repositoryRoot } from "../shared/node-helpers.mjs";

const declaredNodeVersion = readFileSync(join(repositoryRoot, ".nvmrc"), "utf8").trim();

test("the shared .nvmrc file contains one exact Node version", () => {
  assert.match(declaredNodeVersion, /^\d+\.\d+\.\d+$/, ".nvmrc must hold one exact Node version");
});

test("the test runtime matches the Node version declared in .nvmrc", () => {
  assert.equal(process.versions.node, declaredNodeVersion, "the test runtime must match .nvmrc; run nvm use before the tests");
});
