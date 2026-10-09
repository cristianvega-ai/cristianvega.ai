# Account and domain setup

Use these procedures only for approved setup, domain changes, or domain recovery.
They do not imply that existing production setup remains incomplete.
Apply the authorization and publication gates in [AGENTS.md](../../../../AGENTS.md) and [the deploy skill](../SKILL.md).
Read the Worker name and custom domains from [wrangler.jsonc](../../../../wrangler.jsonc).
Use those values in dashboard selections and rules.

## First-time account setup

Check whether the Cloudflare account already has a `workers.dev` subdomain.
If absent, register one through **Workers & Pages** before the first workflow upload.
GitHub Actions cannot answer that setup prompt.
If setup creates a starter Worker, keep the site's Worker name from `wrangler.jsonc`.
Cloudflare documents [workers.dev setup](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Change the host or domain routes

Cloudflare custom domains serve all paths from the Worker and manage certificates.
The `workers.dev` address stays enabled with `X-Robots-Tag: noindex`.
The workflow summary gives its address and deployed commit.
Adding custom domain routes switches those domains to the Worker.
Existing web DNS records can block connection.
Do not assume Wrangler replaces them.

1. Confirm deployment and exact-build live checks pass on the Worker address.
   Check the homepage and 404 page at desktop, tablet, and mobile widths.
   Check motion, reduced motion, keyboard access, and the console.
2. Save the existing apex and `www` web DNS records for rollback.
   Include each record's type, value, proxy setting, and TTL.
   Keep the backup private.
   Preserve mail records and keep the previous host available until the switch passes.
3. Set the canonical redirect rule below before the domain change.
4. In **Caching > Configuration**, set **Browser Cache TTL** to **Respect Existing Headers**.
   In **Web Analytics > Manage site**, select **Enable with JS Snippet installation** for the configured apex.
   Keep automatic injection disabled because GitHub supplies the script.
   Preserve homepage `no-transform` so live HTML matches the verified build.
5. Merge the approved domain change through a pull request and green `Verify` check.
   If DNS records block connection, resolve that conflict below.
   Retry the current `main` commit through the GitHub workflow.
6. Confirm both configured custom domains are active and have valid certificates.
   Run exact-build production verification with canonical checks as described in [Hosting checks](hosting-checks.md#check-the-deployed-build).
   Set `CLOUDFLARE_PRODUCTION_READY=true` only after those checks pass.
   Run the GitHub workflow again.
   Both the Worker address and production domain must match the same verified homepage.
7. After production passes, remove obsolete `DEPLOY_*` GitHub secrets and revoke the previous deployment key, when present and authorized.
   Retire the previous host only after the owner confirms it has no other required services.

Before the switch, the previous host can serve a different build.
Do not enable `CLOUDFLARE_PRODUCTION_READY` before the switch passes its live checks.

## Resolve a DNS record conflict

Cloudflare error `100117` indicates that an existing DNS record blocks the custom domain.
Connect one address at a time.
The address can be unavailable between record removal and connection.

1. Open the domain's **DNS > Records** page.
   Use **Export** for a private backup if no saved backup exists.
2. In another tab, open **Workers & Pages** and select the Worker named in `wrangler.jsonc`.
   Open **Settings > Domains & Routes > Add > Custom Domain**.
   Some dashboard layouts show **Domains > Add Domain**.
3. Enter the full custom domain from the matching route and keep the form open.
4. Delete only the conflicting previous web record for that exact address in the DNS tab.
   Confirm its type from the saved record; do not assume it is an A record.
   Preserve MX, TXT, CAA, and records for other addresses.
5. Return to the Worker form and select **Add Custom Domain**.
   Wait until the address appears in the Worker's domain list.
6. Repeat for the other configured address.

If the form separates zone and subdomain, select the apex zone in both cases.
Leave the apex subdomain empty; enter only `www` for the other address.
Do not duplicate the zone suffix.
Cloudflare creates the custom domain's DNS record and certificate.
Follow the [current custom domain instructions](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) if dashboard controls change.

## Set the canonical redirect rule

Use the apex and `www` domains from `wrangler.jsonc`.
Replace `APEX_DOMAIN` and `WWW_DOMAIN` below with those public values before saving the rule.
These labels are placeholders, not literal hostnames.

Open the apex zone's **Rules > Overview > Create rule > Redirect Rule**.
Name the rule **Canonical HTTPS domain**.
Select **Custom filter expression** and enter:

```text
(http.host in {"APEX_DOMAIN" "WWW_DOMAIN"} and (not ssl or http.host eq "WWW_DOMAIN"))
```

Select a **Dynamic** URL redirect and enter:

```text
concat("https://APEX_DOMAIN", http.request.uri.path)
```

Set status **301** and enable **Preserve query string**.
Deploy the rule before other rules that redirect these hosts.
The rule leaves HTTPS on the apex unchanged.
It redirects HTTP apex, HTTP `www`, and HTTPS `www` to HTTPS apex in one step.
Single Redirects require Cloudflare-proxied traffic for the matched hosts.

Cloudflare documents [redirect controls](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/create-dashboard/) and [the `ssl` field](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ssl/).
Cloudflare also documents [browser cache settings](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/) and [manual analytics installation](https://developers.cloudflare.com/web-analytics/get-started/).

## Reverse a failed domain switch

Reverse a failed switch only while the previous host remains available and the owner authorization permits recovery.
Disable publication with `PRODUCTION_DEPLOY_ENABLED=false` first.
Remove the Worker's affected custom domains in Cloudflare.
Restore the saved web DNS records without changing mail records.
Revert the routes through a pull request before enabling publication again.
Preserve private backups and host details outside this repository.
