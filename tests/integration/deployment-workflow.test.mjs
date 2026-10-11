import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "js-yaml";

import { root as repositoryRoot } from "../shared/node-helpers.mjs";

// Parse workflow structure. Inspect shell commands only when their ordering or arguments define the deployment boundary.
const workflow = load(readFileSync(join(repositoryRoot, ".github", "workflows", "deploy.yml"), "utf8"));
const { verify: verificationJob, deploy: deploymentJob } = workflow.jobs;
const workflowSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);
const readJobCommands = (job) => job.steps.map((step) => step.run ?? "").join("\n");
const deploymentCommands = readJobCommands(deploymentJob);
const packageStep = verificationJob.steps.find((step) => step.id === "package");
const publishStep = deploymentJob.steps.find((step) => step.id === "publish");
const hashVerificationStep = deploymentJob.steps.find((step) => step.env?.EXPECTED_MANIFEST_SHA256);
const deploymentChecks = deploymentJob.steps.filter((step) => step.env?.EXPECTED_INDEX);
const findNodeSetupSteps = (job) => job.steps.filter((step) => step.uses?.startsWith("actions/setup-node@"));

test("the workflow defines the required Verify status and dependent production job", () => {
  assert.deepEqual(Object.keys(workflow.jobs), ["verify", "deploy"]);
  assert.equal(verificationJob.name, "Verify", "the branch rule requires this status check");
});

test("the workflow accepts pull requests, main pushes, and manual dispatch", () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
});

test("workflow actions use GitHub action names and full commit pins", () => {
  const actions = workflowSteps.filter((step) => step.uses).map((step) => step.uses);
  assert.ok(actions.length >= 4, "checkout, Node setup, upload, and download actions must exist");
  for (const action of actions) assert.match(action, /^actions\/[\w.-]+@[0-9a-f]{40}$/);
});

test("the workflow token permits reading repository contents only", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const job of Object.values(workflow.jobs)) assert.equal(job.permissions, undefined, "jobs must not widen permissions");
});

test("the Verify job excludes secrets and the production environment", () => {
  assert.doesNotMatch(JSON.stringify(verificationJob), /secrets\./);
  assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), /secrets\./);
  assert.equal(verificationJob.environment, undefined);
  const checkoutStep = verificationJob.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkoutStep?.with?.["persist-credentials"], false);
});

test("the Verify job installs locked dependencies and runs required audits and verification", () => {
  const shellCommands = verificationJob.steps.map((step) => step.run);
  for (const command of ["npm ci", "npm audit --audit-level=high", "npm audit signatures", "npx playwright install --with-deps chromium", "npm run verify"]) {
    assert.ok(shellCommands.includes(command), `Verify must run ${command}`);
  }
});

test("the Verify job packages the site, verifier, tooling, and integrity hashes", () => {
  const shellCommands = packageStep.run;
  for (const requiredFilename of ["_headers", "_redirects", "index.html", "404.html", "robots.txt", "sitemap-index.xml"]) {
    assert.ok(shellCommands.includes(requiredFilename), `packaging must require dist/${requiredFilename}`);
  }
  assert.match(shellCommands, /--format=ustar/);
  assert.match(shellCommands, /cp scripts\/verify-deployment\.mjs/);
  assert.match(shellCommands, /cp \.nvmrc "\$package_dir\/node-version"/);
  assert.match(shellCommands, /sha256sum site\.tar\.gz verify-deployment\.mjs wrangler\.jsonc package\.json package-lock\.json node-version > SHA256SUMS/);
  assert.match(shellCommands, /package_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.match(shellCommands, /sha256sum "\$package_dir\/SHA256SUMS"/);
  assert.match(shellCommands, /manifest_sha256=.*>> "\$GITHUB_OUTPUT"/);
  assert.deepEqual(verificationJob.outputs, {
    package_sha256: "${{ steps.package.outputs.package_sha256 }}",
    manifest_sha256: "${{ steps.package.outputs.manifest_sha256 }}",
  });
  const uploadStep = verificationJob.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploadStep?.if, "github.event_name != 'pull_request'");
  assert.equal(uploadStep?.with?.name, "production-site-${{ github.sha }}");
});

test("the deployment job requires verified current main, the owner repository, and enabled production settings", () => {
  assert.equal(deploymentJob.needs, "verify");
  assert.equal(deploymentJob.environment.name, "production");
  assert.equal(deploymentJob.if.replace(/\s+/g, " ").trim(),
    "needs.verify.result == 'success' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && " +
    "github.ref == 'refs/heads/main' && github.repository == 'cristianvega-ai/cristianvega.ai' && " +
    "vars.PRODUCTION_DEPLOY_ENABLED == 'true'");
  assert.deepEqual(deploymentJob.concurrency, { group: "cristianvega-ai-production", "cancel-in-progress": false });
  const freshnessCheckStep = deploymentJob.steps.find((step) => step.id === "current");
  assert.equal(freshnessCheckStep.env.EXPECTED_SHA, "${{ github.sha }}");
  assert.match(freshnessCheckStep.run, /git ls-remote[\s\S]*?refs\/heads\/main/);
  assert.match(freshnessCheckStep.run, /"\$current_sha" == "\$EXPECTED_SHA"/);
  for (const step of deploymentJob.steps.filter((step) => step !== freshnessCheckStep)) {
    const expectedCondition = "steps.current.outputs.deploy == 'true'" +
      (step.env?.ORIGIN === "https://cristianvega.ai" ? " && vars.CLOUDFLARE_PRODUCTION_READY == 'true'" : "");
    assert.equal(step.if?.replace(/\s+/g, " ").trim(), expectedCondition, "each deployment step must require fresh main");
  }
});

test("the deployment job uses the verified package and checks its hashes before live verification", () => {
  assert.ok(!deploymentJob.steps.some((step) => step.uses?.startsWith("actions/checkout@")));
  assert.doesNotMatch(deploymentCommands, /npm run build|astro build|scripts\/verify-deployment\.mjs/);
  assert.match(hashVerificationStep.run, /sha256sum --check SHA256SUMS/);
  assert.equal(hashVerificationStep.env.EXPECTED_PACKAGE_SHA256, "${{ needs.verify.outputs.package_sha256 }}");
  assert.equal(hashVerificationStep.env.EXPECTED_MANIFEST_SHA256, "${{ needs.verify.outputs.manifest_sha256 }}");
  assert.match(hashVerificationStep.run, /"\$manifest" != "\$EXPECTED_MANIFEST_SHA256"/);
  const downloadStep = deploymentJob.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.equal(downloadStep?.with?.name, "production-site-${{ github.sha }}");
  assert.equal(deploymentChecks.length, 2, "both deployed origins must use the packaged verifier");
  for (const step of deploymentChecks) {
    assert.match(step.run, /node verify-deployment\.mjs/);
    assert.equal(step.env.EXPECTED_INDEX, "dist/index.html");
  }
});

test("the publish step receives Cloudflare secrets while other deployment steps exclude secrets", () => {
  const installationStep = deploymentJob.steps.find((step) => step.run === "npm ci --ignore-scripts");
  assert.ok(installationStep, "deployment installation must disable dependency scripts");
  assert.match(publishStep.run, /npx --no-install wrangler deploy --config wrangler\.jsonc --no-autoconfig --env ""/);
  assert.doesNotMatch(deploymentCommands, /DEPLOY_SSH|ssh-keyscan/);
  for (const secretName of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    assert.equal(publishStep.env[secretName], "${{ secrets." + secretName + " }}");
  }
  assert.doesNotMatch(JSON.stringify(deploymentJob.env ?? {}), /secrets\./);
  for (const step of deploymentJob.steps.filter((step) => step !== publishStep)) assert.doesNotMatch(JSON.stringify(step), /secrets\./);
  assert.ok(publishStep.env.WRANGLER_OUTPUT_FILE_PATH);
  assert.match(publishStep.run, /record.type === "deploy"/);
  assert.ok(deploymentChecks.some((step) => step.env.ORIGIN === "${{ steps.publish.outputs.origin }}"));
});

test("production domain checks run only after the Cloudflare cutover is complete", () => {
  const productionCheckStep = deploymentChecks.find((step) => step.env.ORIGIN === "https://cristianvega.ai");
  assert.ok(productionCheckStep.if.includes("vars.CLOUDFLARE_PRODUCTION_READY == 'true'"));
  assert.equal(productionCheckStep.env.CHECK_CANONICAL_REDIRECTS, "true");
  const cloudflareConfiguration = JSON.parse(readFileSync(join(repositoryRoot, "wrangler.jsonc"), "utf8"));
  assert.equal(cloudflareConfiguration.workers_dev, true);
  assert.equal(cloudflareConfiguration.main, undefined, "the site must remain static");
  assert.deepEqual(cloudflareConfiguration.routes, [
    { pattern: "cristianvega.ai", custom_domain: true },
    { pattern: "www.cristianvega.ai", custom_domain: true },
  ]);
  assert.equal(cloudflareConfiguration.assets.directory, "./dist");
  assert.equal(cloudflareConfiguration.assets.not_found_handling, "404-page");
  assert.equal(cloudflareConfiguration.assets.html_handling, "force-trailing-slash");
  const developmentDependencies = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).devDependencies;
  assert.match(developmentDependencies.wrangler, /^\d+\.\d+\.\d+$/);
});

test("each workflow job reads the shared Node version through one setup action", () => {
  for (const job of [verificationJob, deploymentJob]) {
    const nodeSetupSteps = findNodeSetupSteps(job);
    assert.equal(nodeSetupSteps.length, 1);
    assert.equal(nodeSetupSteps[0].with["node-version-file"], ".nvmrc");
    assert.equal(nodeSetupSteps[0].with["node-version"], undefined);
  }
});

test("the deployment job verifies artifact hashes before copying and setting the Node version", () => {
  const shellCommands = hashVerificationStep.run;
  const manifestCheckPosition = shellCommands.indexOf('"$manifest" != "$EXPECTED_MANIFEST_SHA256"');
  const fileCheckPosition = shellCommands.indexOf("sha256sum --check SHA256SUMS");
  const packageCheckPosition = shellCommands.indexOf('"$actual" != "$EXPECTED_PACKAGE_SHA256"');
  const versionCopyPosition = shellCommands.indexOf('cp node-version "$GITHUB_WORKSPACE/.nvmrc"');
  assert.ok(manifestCheckPosition >= 0);
  assert.ok(fileCheckPosition > manifestCheckPosition);
  assert.ok(packageCheckPosition > fileCheckPosition);
  assert.ok(versionCopyPosition > packageCheckPosition);
  assert.ok(deploymentJob.steps.indexOf(findNodeSetupSteps(deploymentJob)[0]) > deploymentJob.steps.indexOf(hashVerificationStep));
});
