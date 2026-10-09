---
name: deploy
description: Publish this website through GitHub Actions to Cloudflare. Use for deployment, live verification, rollback, or approved account and domain setup.
---

# Deploy the site

Read [AGENTS.md](../../../AGENTS.md) for canonical policy and owner authorization.
This skill adds no authorization.
Run repository commands from the repository root.

GitHub Actions publishes the verified static build to Cloudflare Workers.
The site has no Worker script or server adapter.
Keep Cloudflare's separate Git build integration disabled.
Read the Worker name and public domain routes from [wrangler.jsonc](../../../wrangler.jsonc).
Read the deployment flags from GitHub repository variables.
Use the workflow summary for the deployed address and commit.
Keep private hostnames, account identifiers, machine paths, credentials, and old host details outside tracked skills.

Read these references when their procedures apply:

- [Domain setup](references/domain-setup.md): first-time account setup, approved domain changes, DNS conflicts, canonical redirects, and domain rollback.
- [Hosting checks](references/hosting-checks.md): hosting rules, local checks, exact-build live verification, and analytics checks.

The skill and its references work without Linear access.

## Publish a change

1. Work on a focused branch.
   Run `npm run verify`.
   Run `npm audit` when dependency files changed.
2. Open a pull request and wait for a green `Verify` check.
   Follow the owner's merge policy in `AGENTS.md`.
3. After merge, watch the [Verify and deploy workflow](../../../.github/workflows/deploy.yml).
   Confirm that its commit is the current `main` commit.
4. Read the deployed address and commit from the workflow summary.
   Confirm that the live gate passes against the verified homepage on that address.
   When `CLOUDFLARE_PRODUCTION_READY=true`, also confirm production checks and canonical redirects pass.
5. Check the affected page and visible content on the deployed address.

If `PRODUCTION_DEPLOY_ENABLED` is not `true`, report the skipped publication.
Do not work around that switch.
A newer `main` commit also prevents an older run from publishing.
Use a manual GitHub workflow run to rebuild, verify, and retry the current `main` commit.
Do not deploy from a laptop.
A successful Worker address does not prove that the public domain has switched.

Report the merged commit, workflow run, deployed address, and live check result.
Report any incomplete account or domain step.

## Preserve the verified artifact

The workflow owns these requirements:

- `Verify` installs Node.js from `.nvmrc` and locked dependencies.
  It audits dependencies, checks package signatures, and runs `npm run verify`.
  Pull requests receive no deployment secrets.
- The package includes `dist/`, the live verifier, Wrangler configuration, and dependency files.
  It includes a hashed `.nvmrc` copy named `node-version`.
  `Verify` records the package and manifest hashes.
- `Deploy production` requires the current `main` commit, `PRODUCTION_DEPLOY_ENABLED=true`, and the GitHub `production` environment.
  It checks the manifest hash, every manifest entry, and the package hash.
  It installs Node.js from the packaged version file.
  It installs locked deployment tooling without install scripts.
  It publishes the verified files with the default Wrangler environment, `--env ""`.
  It does not check out source or rebuild the site.
- The live gate compares the deployed homepage with the packaged homepage.
  It checks approved headers, a real 404, retired-page redirects, gzip, and cache lifetimes.
  `CLOUDFLARE_PRODUCTION_READY=true` also requires production checks and path-preserving, query-preserving canonical redirects.

Keep GitHub actions and the Wrangler version pinned.
Dependabot updates action pins.
The GitHub `production` environment holds these secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Publish Workers in the selected account. |
| `CLOUDFLARE_ACCOUNT_ID` | Select the account that owns the site. |

## Stop and roll back

Set `PRODUCTION_DEPLOY_ENABLED=false` to stop publication within existing owner authorization.
Verification continues.
Do not bypass the switch.

A failed live check fails the workflow.
It does not restore an older version automatically.
Disable publication before rollback so another run cannot replace it.
Open **Workers & Pages**, select the configured Worker, then select **Deployments**.
Use the last known good version's menu to select **Rollback**.
Revert the defect through a pull request.
Follow the publication gates before enabling deployment again.
For domain rollback, read [Domain setup](references/domain-setup.md#reverse-a-failed-domain-switch).

Cloudflare documents the [dashboard rollback procedure](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
