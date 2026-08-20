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

## Deploy to DreamHost

The site is static, so a deploy is one rsync of `dist/` to the document root,
then a check against the live origin.

The host, account, document root, and key path are not in this repository,
because it is public. They live in `.claude/deploy-target.local`, which is
untracked. Create it once from the DreamHost panel values:

```bash
HOST=<shared host>.dreamhost.com
USER=<shell user>
PORT=22
DOC_ROOT=/home/<shell user>/cristianvega.ai/
SSH_KEY=~/.ssh/dreamhost_cristianvega
ORIGIN=https://cristianvega.ai
```

Deploys authenticate with an SSH key, not the account password. Generate one
and add the public half through the DreamHost panel, or with `ssh-copy-id`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/dreamhost_cristianvega -C "cristianvega.ai deploy"
```

Then load the target and run the deploy:

```bash
set -a; . .claude/deploy-target.local; set +a

npm run verify && npm run build

rsync -avzn --delete --exclude '.dh-diag' \
  -e "ssh -i $SSH_KEY -p $PORT" dist/ "$USER@$HOST:$DOC_ROOT"   # dry run first

rsync -avz --delete --exclude '.dh-diag' \
  -e "ssh -i $SSH_KEY -p $PORT" dist/ "$USER@$HOST:$DOC_ROOT"

npm run verify:deploy
```

Four things that matter:

- Upload the contents of `dist/`, not the `dist` directory itself. The trailing
  slash on `dist/` is what does that.
- Read the dry run before the real run. `--delete` removes anything in the
  document root that is not in `dist/`, so an unexpected deletion means the
  destination path is wrong.
- Keep `--exclude '.dh-diag'`. That is a DreamHost diagnostic symlink owned by
  root, and `--delete` would otherwise try to remove it.
- Confirm `dist/.htaccess` exists before uploading. It carries the production
  security headers, and a deploy without it drops all of them silently.

`.claude/skills/deploy/SKILL.md` holds the same procedure for coding agents.

The build copies production Apache config from `public/.htaccess` (single-hop HTTPS + www→apex redirects, security headers including CSP, custom 404, cache rules), plus `public/robots.txt`. Headers live inside `<IfModule mod_headers.c>`, so a host without `mod_headers` drops CSP/HSTS/frame protections silently — build-time tests cannot see that. After every deploy, run `npm run verify:deploy` against the live origin (override with `ORIGIN=...` if needed). It requires all six security header names on `GET /`, checks core CSP directives, and requires HTTP 404 for a deliberately missing path. HSTS ships as a short bootstrap policy (`max-age=300`, no `includeSubDomains`) until HTTPS and the certificate SAN list are confirmed on the live origin; then raise it to `max-age=31536000; includeSubDomains` in a follow-up commit.

**www DNS:** Publish a `www` CNAME (or A record) to the same host as the apex, and ensure the TLS certificate SAN includes `www.cristianvega.ai`. Without that record, `www` fails at DNS and the apex redirect never runs.

Static operational assets:

| Asset | Source | Purpose |
| --- | --- | --- |
| `robots.txt` | `public/robots.txt` | Crawl policy + sitemap URL |
| `404.html` | `src/pages/404.astro` | Custom not-found page |
| `.htaccess` | `public/.htaccess` | HTTPS, security headers + CSP, ErrorDocument, caching |
| `verify:deploy` | `scripts/verify-deploy.mjs` | Live header + 404 gate after rsync |

## Image derivatives

Requires `sharp` (devDependency).

```bash
# About profile strip (264px WebP + AVIF) + OG share card (1200×630 JPEG)
# → public/images/cristian-vega-portrait.* and cristian-vega-og.jpg
npm run generate:portrait
```
