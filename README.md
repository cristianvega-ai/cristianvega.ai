# cristianvega.ai

Astro static site for Cristian Vega's portfolio and writing.

## Develop

```bash
npm install
npm run dev
```

## Add a Blog Post

Create a Markdown or MDX file in `src/content/posts/`.

```md
---
title: "Post title"
description: "One sentence summary for listings and metadata."
date: 2026-07-01
category: systems
tags: ["ai", "document-ai"]
draft: false
---

Write the post here.
```

Use `draft: true` to keep a post out of generated pages and indexes. The filename becomes the URL slug. For example, `src/content/posts/my-post.md` builds to `/posts/my-post/`.

## Build

```bash
npm run build
npm run check
npm test          # builds, then runs tests against that dist/
```

Or run the full gate with `npm run verify` (one build + type-check + tests). Prefer `verify` or `test` over bare `node --test` so contract tests never read a missing or stale `dist/`.

## Deploy

Every merge to `main` deploys. GitHub Actions builds and verifies the commit,
packs `dist/` into one archive, and hands it to a receiver on the web host
over SSH. The receiver accepts static site files only, and the key GitHub
holds can run nothing else. `.github/workflows/deploy.yml` is the workflow,
`scripts/deploy-receiver.py` is the receiver, and
`scripts/test_deploy_receiver.py` proves what it refuses.

### The path a change takes

1. A pull request runs the `Verify` job: `npm ci`, `npm audit`, the complete
   `npm run verify` gate, then a package of `dist/`. The job has no secrets.
2. A merge to `main` runs `Verify` again and stores the package as the run
   artifact `production-site-<sha>`, with a `SHA256SUMS` manifest.
3. `Deploy production` runs only for the current commit on `main`, only when
   the repository variable `PRODUCTION_DEPLOY_ENABLED` is `true`, and only
   inside the `production` environment that holds the SSH secrets. It first
   asks the host for the installed receiver's hash and stops if it differs
   from `scripts/deploy-receiver.py`. Then it sends the package and expects
   `DEPLOY_OK <package sha256> <receiver sha256>` back.
4. The receiver checks the command, the size, every path, every suffix, the
   `.htaccess` against the copies approved on the host, and the required
   files. It snapshots the live site, publishes assets before HTML, checks the
   live origin, and restores the snapshot if that check fails.
5. The workflow runs `scripts/verify-deploy.mjs` against the live origin and
   compares the live homepage with the packaged one.

The `main` ruleset requires a pull request and a green `Verify`, so nothing
reaches the host that did not pass the gate.

### Turning deploys off

Set `PRODUCTION_DEPLOY_ENABLED` to `false` in the repository's Actions
variables. `Verify` keeps running; nothing reaches the host. To revoke the key,
delete the `github-actions-production` line from `~/.ssh/authorized_keys` on
the host and replace the `DEPLOY_SSH_PRIVATE_KEY` secret with a new key.

### What lives on the host

All of it is private, outside the document root, mode `0700` or `0600`:

| Path | Purpose |
| --- | --- |
| `~/.local/libexec/cristianvega-deploy-receiver` | The installed receiver. The only program the GitHub key can run. |
| `~/.config/cristianvega-deploy/config.json` | Document root, state paths, limits, allowed suffixes, the origin to check. |
| `~/.local/share/cristianvega-deploy/approved.d/` | Approved `.htaccess` copies. A package's `.htaccess` must match one byte for byte. |
| `~/.local/state/cristianvega-deploy/` | `deploy.lock`, `deploy.log`, `staging/`, and the three newest `snapshots/`. |

The GitHub key's line in `~/.ssh/authorized_keys` starts with
`restrict,command="…"`, so it gets no shell, no forwarding, and no other
program. The receiver's allowlist of suffixes is also in `config.json` on the
host and in the build test in `tests/build.test.mjs`; change both together.

### Changing `.htaccess`

The receiver refuses a `.htaccess` that is not in `approved.d/`. To change it:

1. Change `public/.htaccess` in a pull request and let `Verify` pass.
2. Copy the new file into `approved.d/` on the host under a new name, with
   your own key. Keep the old copy.
3. Merge. The deploy passes because the new file matches.
4. Delete the old copy from `approved.d/`.

### Updating the receiver

The workflow refuses to deploy while the installed receiver differs from
`scripts/deploy-receiver.py`. After a change merges, copy the new file to
`~/.local/libexec/cristianvega-deploy-receiver` with your own key and keep
mode `0700`. The next run confirms the hash.

### Deploying from a laptop

`.claude/skills/deploy/SKILL.md` describes a manual deploy through the same
receiver, for the case where GitHub Actions cannot run. It needs
`.claude/deploy-target.local`, which is untracked because it names the host:

```bash
HOST=<shared host>.dreamhost.com
USER=<shell user>
PORT=22
DOC_ROOT=/home/<shell user>/cristianvega.ai/
SSH_KEY=~/.ssh/dreamhost_cristianvega            # your own key: admin work only
DEPLOY_KEY=~/.ssh/cristianvega-deploy-laptop     # restricted: can only run the receiver
ORIGIN=https://cristianvega.ai
```

Nothing deploys with `rsync` any more. The receiver is the only path into the
document root.

### Live checks

The build copies production Apache config from `public/.htaccess` (single-hop HTTPS + www→apex redirects, security headers including CSP, custom 404, cache rules), plus `public/robots.txt`. Headers live inside `<IfModule mod_headers.c>`, so a host without `mod_headers` drops CSP/HSTS/frame protections silently — build-time tests cannot see that. The workflow runs `npm run verify:deploy` against the live origin after every deploy; run it by hand to re-check (override with `ORIGIN=...` if needed). It requires all six security header names on `GET /`, checks core CSP directives, requires HTTP 404 for a deliberately missing path, and requires live HSTS of at least `max-age=31536000` without `includeSubDomains`. HSTS is a one-year policy on the apex host. It omits `includeSubDomains` because `ftp.cristianvega.ai` is live and does not present a valid HTTPS certificate. Do not add `includeSubDomains` until every subdomain of `cristianvega.ai` presents a valid certificate.

**www DNS:** Publish a `www` CNAME (or A record) to the same host as the apex, and ensure the TLS certificate SAN includes `www.cristianvega.ai`. Without that record, `www` fails at DNS and the apex redirect never runs.

Static operational assets:

| Asset | Source | Purpose |
| --- | --- | --- |
| `robots.txt` | `public/robots.txt` | Crawl policy + sitemap URL |
| `404.html` | `src/pages/404.astro` | Custom not-found page |
| `.htaccess` | `public/.htaccess` | HTTPS, security headers + CSP, ErrorDocument, caching |
| `verify:deploy` | `scripts/verify-deploy.mjs` | Live header + 404 gate after each deploy |
| workflow | `.github/workflows/deploy.yml` | `Verify` on every change; `Deploy production` for `main` |
| receiver | `scripts/deploy-receiver.py` | The one program the deploy key may run on the host |

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
