import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { root } from "./helpers.mjs";

// Each probe has an error that the checker reports when the file is in scope.
const brokenScript = "export const broken = ;\n";
const brokenPage = "---\nconst count: number = \"text\";\n---\n<p>{count}</p>\n";

// Run the real Astro checker. It exits with 1 when it finds an error, so keep the output either way.
function astroCheck(projectRoot) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(root, "node_modules", "astro", "bin", "astro.mjs"), "check", "--root", projectRoot], {
      cwd: projectRoot,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      timeout: 60_000,
      maxBuffer: 5_000_000,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, output: `${stdout}\n${stderr}`.replace(/\x1b\[[0-9;]*m/g, "") }));
  });
}

test("astro check reports source files and skips generated output", { timeout: 90_000 }, async (t) => {
  const projectRoot = await realpath(await mkdtemp(join(tmpdir(), "diagnostics-scope-")));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  // The checker must report every one of these files.
  const sourceFiles = {
    "src/pages/index.astro": brokenPage,
    "src/lib/probe.ts": brokenScript,
    "scripts/probe.mjs": brokenScript,
    "tests/probe.test.mjs": brokenScript,
  };
  // The checker must report none of these. The dot directories stand for the local tool state.
  const generatedFiles = {
    "dist/assets/probe.js": brokenScript,
    "playwright-report/data/probe.js": brokenScript,
    "test-results/browser/probe.ts": brokenScript,
    "coverage/assets/probe.js": brokenScript,
    ".nyc_output/probe.js": brokenScript,
    "docs/superpowers/plans/probe.js": brokenScript,
    "worktrees/feature/src/lib/probe.ts": brokenScript,
    "worktrees/feature/src/pages/index.astro": brokenPage,
    ".superpowers/probe.js": brokenScript,
    ".wrangler/tmp/probe.js": brokenScript,
  };

  await Promise.all([
    cp(join(root, "tsconfig.json"), join(projectRoot, "tsconfig.json")),
    cp(join(root, "package.json"), join(projectRoot, "package.json")),
    symlink(join(root, "node_modules"), join(projectRoot, "node_modules"), "junction"),
    ...Object.entries({ ...sourceFiles, ...generatedFiles }).map(async ([file, content]) => {
      await mkdir(dirname(join(projectRoot, file)), { recursive: true });
      await writeFile(join(projectRoot, file), content);
    }),
  ]);
  // Use the site configuration, keep the caches in the temporary project, and add one type error.
  const configUrl = pathToFileURL(join(root, "astro.config.mjs")).href;
  await writeFile(join(projectRoot, "astro.config.mjs"), [
    "// @ts-check",
    `import config from ${JSON.stringify(configUrl)};`,
    "/** @type {number} */",
    "export const probe = \"text\";",
    "export default { ...config, cacheDir: \"./.cache/\", vite: { ...config.vite, cacheDir: \"./.cache/vite/\" } };",
    "",
  ].join("\n"));

  const { code, output } = await astroCheck(projectRoot);
  const reported = [...new Set([...output.matchAll(/^(\S+):\d+:\d+ - error\b/gm)].map(([, file]) => file))].sort();
  assert.equal(code, 1, `astro check must fail on the source probes:\n${output}`);
  assert.deepEqual(reported, ["astro.config.mjs", ...Object.keys(sourceFiles)].sort(), `astro check must report exactly the source probes:\n${output}`);
});
