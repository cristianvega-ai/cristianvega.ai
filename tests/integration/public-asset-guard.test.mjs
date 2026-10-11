import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { root as repositoryRoot } from "../shared/node-helpers.mjs";

async function createPublicAssetFixture(testContext) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "public-input-"));
  testContext.after(() => rm(fixtureDirectory, { recursive: true, force: true }));

  await mkdir(join(fixtureDirectory, "scripts"));
  await copyFile(join(repositoryRoot, "package.json"), join(fixtureDirectory, "package.json"));
  await copyFile(join(repositoryRoot, "scripts/check-public-metadata.mjs"), join(fixtureDirectory, "scripts/check-public-metadata.mjs"));
  await mkdir(join(fixtureDirectory, "node_modules/.bin"), { recursive: true });
  // Record when npm reaches Astro without running a second site build.
  await writeFile(join(fixtureDirectory, "node_modules/.bin/astro"),
    '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("astro-ran", "");\n',
    { mode: 0o755 });

  await mkdir(join(fixtureDirectory, "public/.well-known"), { recursive: true });
  await writeFile(join(fixtureDirectory, "public/.well-known/security.txt"), "Contact: https://example.invalid/security\n");
  await writeFile(join(fixtureDirectory, "public/favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return fixtureDirectory;
}

function buildPublicAssetFixture(fixtureDirectory) {
  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd: fixtureDirectory,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(buildResult.error, undefined);
  return { code: buildResult.status, output: buildResult.stdout + buildResult.stderr };
}

test("the public asset guard allows site files and preserves the security contact", async (testContext) => {
  const fixtureDirectory = await createPublicAssetFixture(testContext);
  const buildResult = buildPublicAssetFixture(fixtureDirectory);
  assert.equal(buildResult.code, 0, buildResult.output);
  assert.equal(existsSync(join(fixtureDirectory, "astro-ran")), true, "the build must reach Astro");
  assert.equal(await readFile(join(fixtureDirectory, "public/.well-known/security.txt"), "utf8"),
    "Contact: https://example.invalid/security\n");
});

// Cover macOS metadata, Windows metadata, and nested AppleDouble files.
for (const metadataFilename of [
  ".DS_Store", "images/Thumbs.db", "images/._portrait.jpg",
]) {
  test(`the public asset guard stops Astro when ${metadataFilename} appears in public assets`, async (testContext) => {
    const fixtureDirectory = await createPublicAssetFixture(testContext);
    const metadataPath = join(fixtureDirectory, "public", metadataFilename);
    await mkdir(dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, "metadata fixture");

    const buildResult = buildPublicAssetFixture(fixtureDirectory);
    assert.equal(buildResult.code, 1, buildResult.output);
    assert.ok(buildResult.output.includes(join("public", metadataFilename)), "the guard must name the metadata file");
    assert.equal(existsSync(join(fixtureDirectory, "astro-ran")), false, "the guard must stop Astro");
    assert.equal(await readFile(metadataPath, "utf8"), "metadata fixture", "the guard must preserve the metadata file");
  });
}
