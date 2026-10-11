import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";

import { root } from "../shared/helpers.mjs";

// Parse workflow structure. Inspect shell commands only when their ordering or arguments define the deployment boundary.
const workflow = yaml.load(readFileSync(join(root, ".github", "workflows", "deploy.yml"), "utf8"));
const { verify, deploy } = workflow.jobs;
const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const jobCommands = (job) => job.steps.map((step) => step.run ?? "").join("\n");
const deployCommands = jobCommands(deploy);
const packageStep = verify.steps.find((step) => step.id === "package");
const publishStep = deploy.steps.find((step) => step.id === "publish");
const hashStep = deploy.steps.find((step) => step.env?.EXPECTED_MANIFEST_SHA256);
const liveChecks = deploy.steps.filter((step) => step.env?.EXPECTED_INDEX);
const nodeSteps = (job) => job.steps.filter((step) => step.uses?.startsWith("actions/setup-node@"));

test("the workflow names Verify and its dependent production job", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["verify", "deploy"]);
  assert.equal(verify.name, "Verify", "the branch rule requires this status check");
});

test("the workflow accepts pull requests, main pushes, and manual dispatch", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
});

test("every action belongs to GitHub and has a full commit pin", () => {
  const actions = allSteps.filter((step) => step.uses).map((step) => step.uses);
  assert.ok(actions.length >= 4, "checkout, Node setup, upload, and download actions must exist");
  for (const action of actions) assert.match(action, /^actions\/[\w.-]+@[0-9a-f]{40}$/);
});

test("the workflow token permits reading repository contents only", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions, undefined, "jobs must not widen permissions");
});

test("Verify receives no secrets or production environment", () => {
  assert.doesNotMatch(JSON.stringify(verify), /secrets\./);
  assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), /secrets\./);
  assert.equal(verify.environment, undefined);
  const checkout = verify.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout?.with?.["persist-credentials"], false);
});

test("Verify installs locked dependencies and runs audits and the complete gate", () => {
  const commands = verify.steps.map((step) => step.run);
  for (const command of ["npm ci", "npm audit --audit-level=high", "npm audit signatures", "npx playwright install --with-deps chromium", "npm run verify"]) {
    assert.ok(commands.includes(command), `Verify must run ${command}`);
  }
});

test("Verify packages the site, verifier, tooling, and content hashes", () => {
  const commands = packageStep.run;
  for (const name of ["_headers", "_redirects", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assert.ok(commands.includes(name), `packaging must require dist/${name}`);
  }
  assert.match(commands, /--format=ustar/);
  assert.match(commands, /cp scripts\/verify-deployment\.mjs/);
  assert.match(commands, /cp \.nvmrc "\$package_dir\/node-version"/);
  assert.match(commands, /sha256sum site\.tar\.gz verify-deployment\.mjs wrangler\.jsonc package\.json package-lock\.json node-version > SHA256SUMS/);
  assert.match(commands, /package_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.match(commands, /sha256sum "\$package_dir\/SHA256SUMS"/);
  assert.match(commands, /manifest_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.deepEqual(verify.outputs, {
    package_sha256: "${{ steps.package.outputs.package_sha256 }}",
    manifest_sha256: "${{ steps.package.outputs.manifest_sha256 }}",
  });
  const upload = verify.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload?.if, "github.event_name != 'pull_request'");
  assert.equal(upload?.with?.name, "production-site-${{ github.sha }}");
});

test("production requires verified current main, owner repository, and the enabled switch", () => {
  assert.equal(deploy.needs, "verify");
  assert.equal(deploy.environment.name, "production");
  assert.equal(deploy.if.replace(/\s+/g, " ").trim(),
    "needs.verify.result == 'success' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
    "github.ref == 'refs/heads/main' && github.repository == 'cristianvega-ai/cristianvega.ai' && " +
    "vars.PRODUCTION_DEPLOY_ENABLED == 'true'");
  assert.deepEqual(deploy.concurrency, { group: "cristianvega-ai-production", "cancel-in-progress": false });
  const current = deploy.steps.find((step) => step.id === "current");
  assert.equal(current.env.EXPECTED_SHA, "${{ github.sha }}");
  assert.match(current.run, /git ls-remote[\s\S]*?refs\/heads\/main/);
  assert.match(current.run, /"\$current_sha" == "\$EXPECTED_SHA"/);
  for (const step of deploy.steps.filter((step) => step !== current)) {
    const expected = "steps.current.outputs.deploy == 'true'" +
      (step.env?.ORIGIN === "https://cristianvega.ai" ? " && vars.CLOUDFLARE_PRODUCTION_READY == 'true'" : "");
    assert.equal(step.if?.replace(/\s+/g, " ").trim(), expected, "each deployment step must require fresh main");
  }
});

test("Deploy uses the verified package without checking out or rebuilding source", () => {
  assert.ok(!deploy.steps.some((step) => step.uses?.startsWith("actions/checkout@")));
  assert.doesNotMatch(deployCommands, /npm run build|astro build|scripts\/verify-deployment\.mjs/);
  assert.match(hashStep.run, /sha256sum --check SHA256SUMS/);
  assert.equal(hashStep.env.EXPECTED_PACKAGE_SHA256, "${{ needs.verify.outputs.package_sha256 }}");
  assert.equal(hashStep.env.EXPECTED_MANIFEST_SHA256, "${{ needs.verify.outputs.manifest_sha256 }}");
  assert.match(hashStep.run, /"\$manifest" != "\$EXPECTED_MANIFEST_SHA256"/);
  const download = deploy.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(download?.with?.name, "production-site-${{ github.sha }}");
  assert.equal(liveChecks.length, 2, "both deployed origins must use the packaged verifier");
  for (const step of liveChecks) {
    assert.match(step.run, /node verify-deployment\.mjs/);
    assert.equal(step.env.EXPECTED_INDEX, "dist/index.html");
  }
});

test("only the publish step receives Cloudflare secrets", () => {
  const install = deploy.steps.find((step) => step.run === "npm ci --ignore-scripts");
  assert.ok(install, "deployment installation must disable dependency scripts");
  assert.match(publishStep.run, /npx --no-install wrangler deploy --config wrangler\.jsonc --no-autoconfig --env ""/);
  assert.doesNotMatch(deployCommands, /DEPLOY_SSH|ssh-keyscan/);
  for (const secret of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    assert.equal(publishStep.env[secret], "${{ secrets." + secret + " }}");
  }
  assert.doesNotMatch(JSON.stringify(deploy.env ?? {}), /secrets\./);
  for (const step of deploy.steps.filter((step) => step !== publishStep)) assert.doesNotMatch(JSON.stringify(step), /secrets\./);
  assert.ok(publishStep.env.WRANGLER_OUTPUT_FILE_PATH);
  assert.match(publishStep.run, /record.type === "deploy"/);
  assert.ok(liveChecks.some((step) => step.env.ORIGIN === "${{ steps.publish.outputs.origin }}"));
});

test("production domain checks require completed Cloudflare cutover", () => {
  const production = liveChecks.find((step) => step.env.ORIGIN === "https://cristianvega.ai");
  assert.ok(production.if.includes("vars.CLOUDFLARE_PRODUCTION_READY == 'true'"));
  assert.equal(production.env.CHECK_CANONICAL_REDIRECTS, "true");
  const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
  assert.equal(config.workers_dev, true);
  assert.equal(config.main, undefined, "the site must remain static");
  assert.deepEqual(config.routes, [
    { pattern: "cristianvega.ai", custom_domain: true },
    { pattern: "www.cristianvega.ai", custom_domain: true },
  ]);
  assert.equal(config.assets.directory, "./dist");
  assert.equal(config.assets.not_found_handling, "404-page");
  assert.equal(config.assets.html_handling, "force-trailing-slash");
  const dependencies = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies;
  assert.match(dependencies.wrangler, /^\d+\.\d+\.\d+$/);
});

test("both jobs read exactly one shared Node version", () => {
  for (const job of [verify, deploy]) {
    const steps = nodeSteps(job);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].with["node-version-file"], ".nvmrc");
    assert.equal(steps[0].with["node-version"], undefined);
  }
});

test("Deploy verifies artifact hashes before it supplies the Node version", () => {
  const commands = hashStep.run;
  const manifestCheck = commands.indexOf('"$manifest" != "$EXPECTED_MANIFEST_SHA256"');
  const fileCheck = commands.indexOf("sha256sum --check SHA256SUMS");
  const packageCheck = commands.indexOf('"$actual" != "$EXPECTED_PACKAGE_SHA256"');
  const versionCopy = commands.indexOf('cp node-version "$GITHUB_WORKSPACE/.nvmrc"');
  assert.ok(manifestCheck >= 0);
  assert.ok(fileCheck > manifestCheck);
  assert.ok(packageCheck > fileCheck);
  assert.ok(versionCopy > packageCheck);
  assert.ok(deploy.steps.indexOf(nodeSteps(deploy)[0]) > deploy.steps.indexOf(hashStep));
});
