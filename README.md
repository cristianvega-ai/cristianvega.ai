# cristianvega.ai

Astro source for Cristian Vega's personal site: a profile on the homepage and a
custom 404 page.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run check
npm test          # builds, then runs tests against that dist/
```

Or run the full gate with `npm run verify` (one build + type-check + tests). Prefer `verify` or `test` over bare `node --test` so contract tests never read a missing or stale `dist/`.

## Deploy

GitHub Actions is the default deploy path. Every merge to `main` runs
`Verify`, then uploads that verified static build to Cloudflare Workers.
Cloudflare serves the files. The site has no Worker script or server adapter.
Keep Cloudflare's separate Git build integration disabled.

### Verification and publication

1. `Verify` installs locked dependencies, audits them, checks signatures, and
   runs `npm run verify`. Pull requests have no deployment secrets.
2. The job packages `dist/`, the live verifier, the Wrangler configuration,
   and the dependency files. It records the package and manifest hashes.
3. `Deploy production` runs only for the current `main` commit. It requires
   `PRODUCTION_DEPLOY_ENABLED=true` and the GitHub `production` environment.
4. The deploy job checks both hashes. It installs locked tooling without
   install scripts, then runs Wrangler on the verified files. It does not
   check out source or build the site again.
5. The live gate checks the Worker address. It requires an exact homepage
   match, security headers, a real 404, permanent redirects for retired
   pages, gzip for scripts, and the specified cache lifetimes.
6. After the domain switch, `CLOUDFLARE_PRODUCTION_READY=true` also requires
   those checks on `https://cristianvega.ai`. It checks HTTP and `www`
   redirects with their path and query intact.

Every action and the Wrangler version are pinned. Dependabot updates action
pins. The `production` environment holds these secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Publish Workers in the selected account. |
| `CLOUDFLARE_ACCOUNT_ID` | Select the account that owns the site. |

A manual GitHub workflow run rebuilds and verifies the current `main` commit.
Use this to retry a deployment. Do not deploy from a laptop.

### First deployment and domain switch

The initial configuration enables `workers.dev` and declares no custom
domains. The first deployment leaves the public domain on its existing host.
The workflow summary gives the Cloudflare test address and the commit.
The test address sends `X-Robots-Tag: noindex`.

1. Merge the migration pull request after `Verify` passes. Confirm that the
   deployment and live checks pass on the Cloudflare test address.
2. Check the homepage and 404 page at desktop, tablet, and mobile widths.
   Check motion, reduced motion, keyboard access, and the browser console.
3. Save the current web DNS records for rollback. Keep those values private.
   Preserve mail records. Prepare the domain change in a reviewed follow-up
   pull request: add `cristianvega.ai` and `www.cristianvega.ai` as custom
   domains in `wrangler.jsonc`. Update the initial-deployment test with it.
   Remove conflicting web DNS records only when ready to switch.
4. In Cloudflare, create a Single Redirect rule for these hosts when the
   scheme is HTTP or the host is `www.cristianvega.ai`. Use HTTP 301. Set the
   destination to `concat("https://cristianvega.ai", http.request.uri.path)`
   and enable **Preserve query string**. This makes the scheme and host
   change in one step. Confirm that both hosts have valid certificates.
5. Set **Browser Cache TTL** to **Respect Existing Headers**. Disable
   automatic Web Analytics script injection for the site. The homepage also
   sends `no-transform` so its HTML can match the verified build.
6. Merge the domain change. Run the live gate with
   `CHECK_CANONICAL_REDIRECTS=true npm run verify:deploy`. Set the repository
   variable `CLOUDFLARE_PRODUCTION_READY` to `true`, then run the GitHub
   workflow again. Both addresses must match the same verified homepage.
7. After the production run passes, remove the old `DEPLOY_*` GitHub secrets
   and revoke the old deployment key. Retire the old hosting service only
   after the owner confirms that it has no other required services.

Do not set `CLOUDFLARE_PRODUCTION_READY` before the domain switch. The old
host still serves a different build until that switch completes.

### Stop and roll back

Set `PRODUCTION_DEPLOY_ENABLED=false` to stop publication. Verification
continues. Do not work around this switch.

A live check failure marks the workflow as failed. It does not automatically
restore an older Cloudflare version. Use the Worker's deployment history to
restore the last known good version, then revert the defect through a pull
request. A failed first domain switch can also be reversed with the saved
web DNS records while the old host remains available. Disable publication
before an emergency rollback so another run does not replace it.

### Hosting rules and local checks

`public/_headers` preserves the six security headers and CSP. It gives
hashed `/_astro/` assets a one-year immutable cache. Stable images use one
week. The analytics script uses one hour. HTML revalidates. HSTS applies to
the current host only. Do not add `includeSubDomains` until all subdomains
support valid HTTPS.

`public/_redirects` sends `/about` and `/contact`, with or without a trailing
slash, to the homepage. Cloudflare domain rules handle HTTPS and `www`.
`wrangler.jsonc` enables trailing slashes and serves `404.html` with HTTP 404
for a missing path. Cloudflare does not apply Apache `.htaccess` files.

Run `npm run build`, then `npm run preview` to serve the build with Wrangler.
The browser suite uses the same local Cloudflare runtime. It checks headers,
redirects, compression, caching, and the page flows without account access.

Run `npm run verify:deploy` to check the public site. Set `ORIGIN` to check
the Cloudflare test address. Set `EXPECTED_INDEX=dist/index.html` only when
that local build is the exact build deployed by GitHub. A different build
must fail the comparison.

## Image derivatives

Requires `sharp` (devDependency).

```bash
# OG share card (1200×630 JPEG) from assets/cristian-vega.png
# → public/images/cristian-vega-og.jpg
npm run generate:portrait

# Apple touch icon (180×180 PNG) from public/favicon.svg
# → public/images/apple-touch-icon.png
npm run generate:touch-icon
```
