import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { root } from "./helpers.mjs";

// The deployment workflow cannot run on a laptop, so this suite holds it to
// its shape instead: which events run it, that every action is pinned to a
// commit, that Verify never sees a secret, that Deploy production runs only
// for the current main commit with the kill switch on, and that the SSH leg
// stays strict. Each test reads the block for one job, not the whole file, so
// a rule about one job cannot be satisfied by text in the other.

const workflowPath = join(root, ".github", "workflows", "deploy.yml");
const workflow = readFileSync(workflowPath, "utf8");
const dependabot = readFileSync(join(root, ".github", "dependabot.yml"), "utf8");

/** Split a two-space-indented YAML document into its top-level blocks. */
function topLevelBlocks(text) {
  const blocks = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const key = line.match(/^([A-Za-z_][\w-]*):/);
    if (key) {
      current = key[1];
      blocks.set(current, []);
    } else if (current) {
      blocks.get(current).push(line);
    }
  }
  return new Map([...blocks].map(([key, lines]) => [key, lines.join("\n")]));
}

/** The blocks under `jobs:`, keyed by job id. */
function jobBlocks(text) {
  const jobs = topLevelBlocks(text).get("jobs") ?? "";
  const blocks = new Map();
  let current = null;
  for (const line of jobs.split("\n")) {
    const key = line.match(/^  ([A-Za-z_][\w-]*):\s*$/);
    if (key) {
      current = key[1];
      blocks.set(current, []);
    } else if (current) {
      blocks.get(current).push(line);
    }
  }
  return new Map([...blocks].map(([key, lines]) => [key, lines.join("\n")]));
}

const top = topLevelBlocks(workflow);
const jobs = jobBlocks(workflow);
const verify = jobs.get("verify");
const deploy = jobs.get("deploy");

test("the workflow has exactly the two jobs the deployment design names", () => {
  assert.deepEqual([...jobs.keys()], ["verify", "deploy"]);
  assert.match(verify, /^\s+name: Verify$/m, "the Verify job is the required status check");
  assert.match(deploy, /^\s+name: Deploy production$/m);
});

test("the workflow runs on pull requests, pushes to main, and manual dispatch only", () => {
  const events = [...(top.get("on") ?? "").matchAll(/^  ([\w-]+):/gm)].map(([, name]) => name).sort();
  assert.deepEqual(events, ["pull_request", "push", "workflow_dispatch"]);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_run/, "no privileged event may run this workflow");
  assert.match(top.get("on"), /^  push:\n(?:.*\n)*?      - main$/m);
});

test("every action is owned by GitHub and pinned to a full commit SHA", () => {
  const uses = [...workflow.matchAll(/^\s+uses:\s*(\S+)/gm)].map(([, ref]) => ref);
  assert.ok(uses.length >= 4, "expected checkout, setup-node, upload-artifact, and download-artifact");
  for (const ref of uses) {
    assert.match(ref, /^actions\/[\w.-]+@[0-9a-f]{40}$/, `${ref} must be a GitHub-owned action at a 40-character commit SHA`);
  }
});

test("the workflow token is read-only and no job widens it", () => {
  assert.equal(top.get("permissions").trim(), "contents: read");
  assert.doesNotMatch(verify, /^\s+permissions:/m);
  assert.doesNotMatch(deploy, /^\s+permissions:/m);
  assert.doesNotMatch(workflow, /:\s*write\b/, "no permission may be write");
});

test("Verify sees no secret and no environment", () => {
  assert.doesNotMatch(verify, /secrets\./);
  assert.doesNotMatch(verify, /^\s+environment:/m);
  assert.match(verify, /^\s+persist-credentials: false$/m, "the checkout must not leave a token in .git");
});

test("Verify installs from the lockfile, audits, and runs the complete gate", () => {
  for (const command of [
    "npm ci",
    "npm audit --audit-level=high",
    "npm audit signatures",
    "npx playwright install --with-deps chromium",
    "npm run verify",
  ]) {
    const literal = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(verify, new RegExp(`^\\s+run: ${literal}$`, "m"), `Verify must run ${command}`);
  }
});

test("Verify packs the required files and the live verifier, and records both hashes", () => {
  for (const name of [".htaccess", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assert.ok(verify.includes(name), `Verify must require dist/${name} before packing`);
  }
  assert.match(verify, /--format=ustar/);
  assert.match(verify, /cp scripts\/verify-deploy\.mjs/);
  assert.match(verify, /sha256sum site\.tar\.gz verify-deploy\.mjs > SHA256SUMS/);
  assert.match(verify, /package_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.match(verify, /sha256sum scripts\/deploy-receiver\.py/);
  assert.match(verify, /receiver_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.match(verify, /^\s+if: github\.event_name != 'pull_request'$/m, "pull requests must not store a production package");
});

test("Deploy production runs only for the current main commit with the kill switch on", () => {
  assert.match(deploy, /^\s+needs: verify$/m);
  assert.match(deploy, /^\s+environment:\n\s+name: production$/m);
  const condition = deploy.match(/^\s+if: >-\n((?:\s{6}.*\n)+)/m)?.[1] ?? "";
  for (const clause of [
    "needs.verify.result == 'success'",
    "github.event_name == 'push' || github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/main'",
    "github.repository == 'cristianvega-ai/cristianvega.ai'",
    "vars.PRODUCTION_DEPLOY_ENABLED == 'true'",
  ]) {
    assert.ok(condition.includes(clause), `the deploy condition must require ${clause}`);
  }
  assert.match(deploy, /^\s+concurrency:\n\s+group: cristianvega-ai-production\n\s+cancel-in-progress: false$/m);
  assert.match(deploy, /git ls-remote[\s\S]*?refs\/heads\/main/, "the freshness check must read main from GitHub");
  assert.match(deploy, /if: steps\.current\.outputs\.deploy == 'true'/);
});

test("Deploy production never checks out the repository and runs the verifier from the package", () => {
  assert.doesNotMatch(deploy, /actions\/checkout/);
  assert.match(deploy, /node "\$artifact_dir\/verify-deploy\.mjs"/);
  assert.doesNotMatch(deploy, /scripts\/verify-deploy\.mjs/);
  assert.match(deploy, /sha256sum --check SHA256SUMS/);
  assert.match(deploy, /EXPECTED_PACKAGE_SHA256: \$\{\{ needs\.verify\.outputs\.package_sha256 \}\}/);
  assert.match(deploy, /cmp "\$artifact_dir\/expected-index\.html"/);
});

test("the SSH leg is strict and checks the installed receiver before sending", () => {
  for (const option of [
    "BatchMode=yes",
    "IdentitiesOnly=yes",
    "PasswordAuthentication=no",
    "StrictHostKeyChecking=yes",
    "GlobalKnownHostsFile=/dev/null",
    "HostKeyAlgorithms=ssh-ed25519",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
  ]) {
    assert.ok(deploy.includes(option), `ssh must set ${option}`);
  }
  assert.doesNotMatch(workflow, /ssh-keyscan/, "host keys come from the environment secret, never from the network");
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no|StrictHostKeyChecking=accept-new/);
  assert.match(deploy, /"RECEIVER \$EXPECTED_RECEIVER_SHA256"/, "the installed receiver must match the reviewed one");
  assert.match(deploy, /"DEPLOY_OK \$EXPECTED_PACKAGE_SHA256 \$EXPECTED_RECEIVER_SHA256"/);
  assert.match(deploy, /trap cleanup EXIT/, "the key file must be removed when the step ends");
  for (const secret of ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_PORT", "DEPLOY_SSH_PRIVATE_KEY", "DEPLOY_SSH_KNOWN_HOSTS"]) {
    assert.match(deploy, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`), `${secret} must come from the environment`);
  }
});

test("Node is pinned to one exact version everywhere", () => {
  const versions = [...workflow.matchAll(/node-version:\s*(\S+)/g)].map(([, version]) => version);
  assert.ok(versions.length >= 2);
  for (const version of versions) assert.match(version, /^\d+\.\d+\.\d+$/, "node-version must be exact");
  assert.equal(new Set(versions).size, 1, "Verify and the live gate must use the same Node");
});

test("Dependabot keeps the action pins current", () => {
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /interval: weekly/);
});
