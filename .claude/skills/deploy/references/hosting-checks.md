# Hosting and deployment checks

Use this reference for hosting changes, local checks, live verification, and analytics checks.
Apply existing owner authorization and [the deploy skill](../SKILL.md).
Run commands from the repository root.
Read public domains from [wrangler.jsonc](../../../../wrangler.jsonc) and the deployed Worker address from the workflow summary.

## Preserve hosting rules

[public/_headers](../../../../public/_headers) owns the six approved security headers and CSP.
Hashed `/_astro/` assets use a one-year immutable cache.
The versioned `/globe-projection/*` stylesheet also uses a one-year immutable cache.
Stable images use one week; HTML revalidates.
HSTS applies only to the current host.
Do not add `includeSubDomains` until every subdomain supports valid HTTPS.

[public/_redirects](../../../../public/_redirects) redirects `/contact` and `/contact/` to the homepage.
`/about/` is a real page.
Cloudflare domain rules handle HTTPS and `www`.
`wrangler.jsonc` enforces trailing slashes and serves `404.html` with HTTP 404 for missing paths.
Cloudflare does not apply Apache `.htaccess` files.

Keep **Browser Cache TTL** at **Respect Existing Headers**.
Keep analytics on **Enable with JS Snippet installation**.
Keep automatic script injection disabled and preserve homepage `no-transform`.
These settings preserve the verified HTML and its cache policy.
Cloudflare documents [cache settings](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/) and [manual analytics installation](https://developers.cloudflare.com/web-analytics/get-started/).

## Check locally

Run `npm run build`, then `npm run preview` to serve the build with local Wrangler.
Run `npm run verify` for the complete gate before publication.
The browser suite checks headers, redirects, compression, caching, and page flows without account access.
It selects the `test` environment, which clears domain routes and preserves request hostnames for host-specific checks.
Local preview does not publish the site.

## Check the deployed build

Run `npm run verify:deployment` for a public-site check within existing authorization.
Set `ORIGIN` to the workflow's Worker address to check that deployment.
Set `CHECK_CANONICAL_REDIRECTS=true` for production verification after the domain switch.

Set `EXPECTED_INDEX` only to the homepage from the exact verified GitHub artifact deployed by the selected workflow run.
Use `EXPECTED_INDEX=dist/index.html` only when local `dist/` contains that exact artifact.
A local rebuild or different commit cannot substitute for the deployed artifact.
A different homepage must fail comparison.
The GitHub live gates use the verified packaged homepage automatically.

The [live verifier](../../../../scripts/verify-deployment.mjs) reads same-origin script URLs from the verified homepage when `EXPECTED_INDEX` is set.
Otherwise, it reads the live homepage and cannot prove exact-build identity.
It checks each same-origin script once without relying on component filenames.
The gate checks security headers on `/`, `/about/`, `/writing/`, and the 404 response.
`/writing/` can return 200 or 404 because production omits the section while every article is a draft.
It also checks retired-page redirects, script gzip, and immutable cache lifetimes.
Canonical checks require one-step HTTPS apex redirects with path and query intact.
`npm run verify` runs the gate against the local Wrangler build.

Keep `APPROVED_SECURITY_HEADERS` in the live verifier equal to the global rule in `public/_headers`.
Change both in the same commit when an approved policy change requires it.
Verification rejects changed or removed approved headers.
New headers do not fail this approved-header comparison.

## Check analytics

[CloudflareAnalytics.astro](../../../../src/components/CloudflareAnalytics.astro) loads analytics only on the configured production hostname.
It skips local and Worker addresses.
Its public site identifier is client data, not an API credential.
The site does not load GoatCounter.

In **Web Analytics > Manage site**, keep **Enable with JS Snippet installation** selected.
GitHub supplies the script.
Automatic injection can duplicate it on error pages and violate CSP.
The CSP allows the exact Cloudflare beacon script URL and its HTTPS reporting origin.
The local loader has a content hash and uses the static asset cache.
The build keeps scripts external, so CSP needs no new inline hashes.
Cloudflare updates its external beacon without fixed versions or stable integrity hashes for manual installation.
Cloudflare documents [installation](https://developers.cloudflare.com/web-analytics/get-started/) and [CSP requirements](https://developers.cloudflare.com/web-analytics/faq/#what-do-i-need-to-add-to-my-content-security-policy-csp).

Browser tests use a local probe for the hostname, site identifier, script loading, and CSP.
They send no measurements to Cloudflare.
After authorized deployment, confirm the real script sends a successful request to `https://cloudflareinsights.com/cdn-cgi/rum`.
Check the homepage and 404 page with the script blocked.
Content and navigation must remain usable.
