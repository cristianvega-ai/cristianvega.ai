import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";

import { root } from "./helpers.mjs";

test("diagnostics include source files and skip generated output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "diagnostics-scope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, "tsconfig.json");
  await copyFile(join(root, "tsconfig.json"), configPath);
  await symlink(join(root, "node_modules"), join(directory, "node_modules"), "junction");

  const sourceFiles = [
    "src/pages/index.astro",
    "src/lib/probe.ts",
    "astro.config.mjs",
    "scripts/probe.mjs",
    "tests/probe.test.mjs",
    ".astro/types.d.ts",
  ];
  const generatedFiles = [
    "dist/assets/probe.js",
    "playwright-report/data/probe.js",
    "test-results/browser/probe.js",
    "coverage/assets/probe.js",
    ".nyc_output/probe.js",
  ];
  await Promise.all([...sourceFiles, ...generatedFiles].map(async (file) => {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "");
  }));

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    directory,
    undefined,
    configPath,
    undefined,
    [{ extension: ".astro", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred }],
  );
  assert.deepEqual(parsed.errors, []);
  const included = new Set(parsed.fileNames);

  for (const file of sourceFiles) {
    assert.ok(included.has(join(directory, file)), `${file} must remain in the diagnostics scope`);
  }
  for (const file of generatedFiles) {
    assert.ok(!included.has(join(directory, file)), `${file} must stay out of the diagnostics scope`);
  }
});
