import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { root } from "./helpers.mjs";

async function publicFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "public-input-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  await mkdir(join(directory, "scripts"));
  await copyFile(join(root, "package.json"), join(directory, "package.json"));
  await copyFile(join(root, "scripts/check-public.mjs"), join(directory, "scripts/check-public.mjs"));
  await mkdir(join(directory, "node_modules/.bin"), { recursive: true });
  // Record when npm reaches Astro without running a second site build.
  await writeFile(join(directory, "node_modules/.bin/astro"),
    '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("astro-ran", "");\n',
    { mode: 0o755 });

  await mkdir(join(directory, "public/.well-known"), { recursive: true });
  await writeFile(join(directory, "public/.well-known/security.txt"), "Contact: https://example.invalid/security\n");
  await writeFile(join(directory, "public/favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return directory;
}

function buildFixture(directory) {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return { code: result.status, output: result.stdout + result.stderr };
}

test("the public guard permits site files and the security contact", async (t) => {
  const directory = await publicFixture(t);
  const result = buildFixture(directory);
  assert.equal(result.code, 0, result.output);
  assert.equal(existsSync(join(directory, "astro-ran")), true, "the build must reach Astro");
  assert.equal(await readFile(join(directory, "public/.well-known/security.txt"), "utf8"),
    "Contact: https://example.invalid/security\n");
});

for (const file of [".DS_Store", "images/.DS_Store", "images/Thumbs.db"]) {
  test(`the public guard stops the build for ${file}`, async (t) => {
    const directory = await publicFixture(t);
    const path = join(directory, "public", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "metadata fixture");

    const result = buildFixture(directory);
    assert.equal(result.code, 1, result.output);
    assert.ok(result.output.includes(join("public", file)), "the guard must name the metadata file");
    assert.equal(existsSync(join(directory, "astro-ran")), false, "the guard must stop Astro");
    assert.equal(await readFile(path, "utf8"), "metadata fixture", "the guard must preserve the metadata file");
  });
}
