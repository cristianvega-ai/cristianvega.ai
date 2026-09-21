---
name: deploy
description: Publish the site through GitHub Actions to Cloudflare, or check the deployed build.
---

# Deploy the site

Read `AGENTS.md` for repository policy. Follow `README.md` for the deployment
and domain switch. GitHub Actions is the default publication path.

1. Work on a focused branch. Run `npm run verify`. Run `npm audit` when
   dependency files changed.
2. Open a pull request and wait for `Verify`. Follow the owner's merge policy.
3. After merge, watch the `Verify and deploy` workflow. The deploy job checks
   the artifact hashes and publishes the verified build to Cloudflare.
4. Read the Cloudflare address and commit from the workflow summary. Confirm
   that the live gate passes there. Once `CLOUDFLARE_PRODUCTION_READY=true`,
   the workflow must also pass the gate on the production domain.
5. Check the affected page and its visible content on the deployed address.

If deployment is skipped because `PRODUCTION_DEPLOY_ENABLED` is not `true`,
report that state. Do not work around it. Use a manual GitHub workflow run
to retry the current `main` commit. Do not deploy from a laptop.

A successful test address does not prove that the public domain has moved.
Domain routes live in `wrangler.jsonc`. Follow the domain switch steps in
README.md before calling the migration complete.

Report the merged commit, workflow run, deployed address, and live check
result. Report any incomplete domain or account step.
