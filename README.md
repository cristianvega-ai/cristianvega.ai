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
   install scripts, then runs Wrangler on the verified files. It selects the
   default Wrangler environment. It does not check out source or build the
   site again.
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

### Account setup

Register a `workers.dev` subdomain in the Cloudflare account before the first
upload. GitHub Actions cannot answer the first-time setup prompt. Use
**Workers & Pages** in the dashboard to complete account setup. If that setup
creates a starter Worker, the site workflow still uses the name
`cristianvega-ai` from `wrangler.jsonc`.

### Domain switch

`wrangler.jsonc` declares `cristianvega.ai` and `www.cristianvega.ai` as
custom domains. Cloudflare will serve both from the Worker and manage their
certificates. The `workers.dev` test address stays enabled with
`X-Robots-Tag: noindex`. The workflow summary gives that address and the
deployed commit.

Adding these domain routes is the switch to the new host. Existing web DNS
records can block the connection. Save the old records before merging the
domain change. Do not assume that Wrangler will replace them.

1. Confirm that the deployment and live checks pass on the Cloudflare test
   address. Check the homepage and 404 page at desktop, tablet, and mobile
   widths. Check motion, reduced motion, keyboard access, and the console.
2. Save the current apex and `www` DNS records for rollback. Include their
   type, value, proxy setting, and TTL. Keep this copy private. Preserve mail
   records. Keep the old host available until the switch passes.
3. Set the Single Redirect rule below before the domain change. It preserves
   HTTPS and `www` redirects after Apache stops serving the site.
4. In the domain's **Caching > Configuration**, set **Browser Cache TTL** to
   **Respect Existing Headers**. In **Web Analytics > Manage site** for
   `cristianvega.ai`, select **Enable with JS Snippet installation**. The
   GitHub build adds Cloudflare Web Analytics. Automatic script injection
   must stay off. The homepage also sends `no-transform` so its HTML can
   match the verified build.
5. Merge the domain change after owner approval. If Cloudflare reports
   existing DNS records, follow the steps below. Then run the GitHub
   workflow again.
6. Confirm that both custom domains are active and have valid certificates.
   Run the live gate with
   `CHECK_CANONICAL_REDIRECTS=true npm run verify:deploy`. Set the repository
   variable `CLOUDFLARE_PRODUCTION_READY` to `true`, then run the GitHub
   workflow again. The test address and the production domain must match
   the same verified homepage.
7. After the production run passes, remove the old `DEPLOY_*` GitHub secrets
   and revoke the old deployment key. Retire the old hosting service only
   after the owner confirms that it has no other required services.

Do not set `CLOUDFLARE_PRODUCTION_READY` before the domain switch. The old
host still serves a different build until that switch completes.

### Resolve a DNS record conflict

Cloudflare error `100117` means that an existing DNS record blocks a custom
domain. Connect one address at a time. The address can be unavailable between
record removal and connection.

1. Open the domain's **DNS > Records** in one tab. Use **Export** to save a
   private backup if you have not saved one.
2. In a second tab, open **Workers & Pages > cristianvega-ai > Domains**.
   Some dashboard layouts use **Settings > Domains & Routes**. Use the
   Worker name with the hyphen. GitHub deploys to that Worker.
3. Select **Add Domain**, then select `cristianvega.ai`. Keep the form open.
4. In the DNS tab, delete only the old web record for the address you are
   connecting. For this migration, the old records are type **A**. Preserve
   MX, TXT, CAA, and records for other addresses.
5. Return to the Worker form. Use the value below, then select **Add domain**.
   Wait until the address appears in the Worker's domain list.
6. Repeat for the other address. Select `cristianvega.ai` in both cases.

| Address | Subdomain field |
| --- | --- |
| `cristianvega.ai` | Leave empty. |
| `www.cristianvega.ai` | Enter `www`. |

Cloudflare adds the DNS records for the custom domains. The `www` form field
adds `.cristianvega.ai` to the value you enter. Follow Cloudflare's
[custom domain instructions](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
if the dashboard layout changes.

### Domain redirect rule

In the `cristianvega.ai` domain, open **Rules > Overview > Create rule >
Redirect Rule**. Name the rule **Canonical HTTPS domain**. Select **Custom
filter expression** and enter:

```text
(http.host in {"cristianvega.ai" "www.cristianvega.ai"} and (not ssl or http.host eq "www.cristianvega.ai"))
```

For the URL redirect, select **Dynamic** and enter:

```text
concat("https://cristianvega.ai", http.request.uri.path)
```

Set the status to **301**, enable **Preserve query string**, and deploy the
rule. It must run before any rule that redirects these hosts to another URL.
The rule leaves HTTPS on the apex unchanged. It redirects the other three
host and scheme combinations in one step.

Cloudflare documents the [redirect controls](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-dashboard/),
the [TLS field](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ssl/),
the [browser cache setting](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/),
and the [analytics setting](https://developers.cloudflare.com/web-analytics/get-started/).

### Stop and roll back

Set `PRODUCTION_DEPLOY_ENABLED=false` to stop publication. Verification
continues. Do not work around this switch.

A live check failure marks the workflow as failed. It does not automatically
restore an older Cloudflare version. Use the Worker's deployment history to
restore the last known good version, then revert the defect through a pull
request. Disable publication before a rollback so another run does not
replace it.

A failed first domain switch can also be reversed while the old host remains
available. Disable publication first. Remove the Worker's custom domains in
Cloudflare, then restore the saved web DNS records. Revert the routes through
a pull request before enabling publication again.

### Hosting rules and local checks

`public/_headers` preserves the six security headers and CSP. It gives
hashed `/_astro/` assets a one-year immutable cache. Stable images use one
week. HTML revalidates. HSTS applies to
the current host only. Do not add `includeSubDomains` until all subdomains
support valid HTTPS.

`public/_redirects` sends `/about` and `/contact`, with or without a trailing
slash, to the homepage. Cloudflare domain rules handle HTTPS and `www`.
`wrangler.jsonc` enables trailing slashes and serves `404.html` with HTTP 404
for a missing path. Cloudflare does not apply Apache `.htaccess` files.

Run `npm run build`, then `npm run preview` to serve the build with Wrangler.
The browser suite uses the same local Cloudflare runtime. It checks headers,
redirects, compression, caching, and the page flows without account access.
It selects the `test` environment, which clears local domain routes. This
keeps each request's hostname so the suite can check host-specific headers.

Run `npm run verify:deploy` to check the public site. Set `ORIGIN` to check
the Cloudflare test address. Set `EXPECTED_INDEX=dist/index.html` only when
that local build is the exact build deployed by GitHub. A different build
must fail the comparison.

### Web analytics

`CloudflareAnalytics.astro` loads Cloudflare Web Analytics on
`cristianvega.ai`. It skips local and Worker preview addresses. The public
site identifier is part of the client code. It is not an API credential.
The site no longer loads GoatCounter.

In Cloudflare **Web Analytics > Manage site**, keep **Enable with JS Snippet
installation** selected. GitHub supplies the script. Automatic injection
can add another script to error pages and cause a security policy error.

The CSP allows the exact Cloudflare beacon script URL and its HTTPS reporting
origin. The local loader has a content hash and uses the static asset cache.
The build keeps scripts in files so the CSP does not need new inline hashes.
Cloudflare updates its external beacon script. It does not support a fixed
version or a stable integrity hash for manual installation.

Browser tests use a local probe to check the production hostname, site
identifier, script loading, and CSP. They send no measurements to Cloudflare.
After deployment, check that the real script sends a successful request to
`https://cloudflareinsights.com/cdn-cgi/rum`. Also check the homepage and 404
page when the script is blocked. The content and navigation must still work.

See Cloudflare's [installation guide](https://developers.cloudflare.com/web-analytics/get-started/)
and [security policy guidance](https://developers.cloudflare.com/web-analytics/faq/#what-do-i-need-to-add-to-my-content-security-policy-csp).

## Security maintenance

GitHub dependency alerts, security update pull requests, CodeQL default setup,
and private vulnerability reporting must stay enabled. Dependabot checks npm
packages and GitHub Actions each week. Review each update before merge.

`public/.well-known/security.txt` directs reports to GitHub's private form.
`SECURITY.md` explains that process. Renew the file's `Expires` date before it
passes. Keep the next date within one year. The build and live gates reject
an expired record.

The CSP blocks inline style elements and attributes. Astro writes stylesheets
to files. The motion code sets individual style properties through JavaScript;
the browser permits these changes under the policy. Browser tests confirm that
motion works and that injected inline styles are blocked. The Permissions
Policy also denies unused browser features, including device and payment access.

Cloudflare account settings are separate from the repository. Set the minimum
TLS version to 1.2 and keep TLS 1.3 enabled. Enable DNSSEC in Cloudflare, then
publish its DS record at the domain registrar. Confirm DNSSEC after both steps.
See the [TLS setting](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
and [DNSSEC setup](https://developers.cloudflare.com/dns/dnssec/#enable-dnssec).

Keep HSTS limited to the current host until every subdomain has been checked.
HSTS preload is optional. It is not a requirement for this deployment.
Keep dated audit reports in a private local archive. Do not commit them or
copy them into `public/`.

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
