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

test("Cursor reads the shared Node version before it installs dependencies", () => {
  const { install } = JSON.parse(readFileSync(join(root, ".cursor", "environment.json"), "utf8"));
  const installNode = install.indexOf("nvm install");
  const useNode = install.indexOf("nvm use");
  const installDependencies = install.indexOf("npm ci");
  assert.ok(installNode >= 0 && useNode > installNode);
  assert.ok(installDependencies > useNode, "Cursor must select Node before dependency installation");
  assert.doesNotMatch(install, /\d+\.\d+\.\d+/, "Cursor must not duplicate the Node version");
});
