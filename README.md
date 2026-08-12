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
description: "One sentence summary for listings, RSS, and metadata."
date: 2026-07-01
category: systems
tags: ["ai", "document-ai"]
draft: false
---

Write the post here.
```

Use `draft: true` to keep a post out of generated pages, indexes, and RSS. The filename becomes the URL slug. For example, `src/content/posts/my-post.md` builds to `/posts/my-post/`.

## Build

```bash
npm run build
npm run check
npm test          # builds, then runs tests against that dist/
```

Or run the full gate with `npm run verify` (one build + type-check + tests). Prefer `verify` or `test` over bare `node --test` so contract tests never read a missing or stale `dist/`.

## Deploy to DreamHost

Build locally, then upload the contents of `dist/` to the DreamHost domain directory.

```bash
npm run build
rsync -avz --delete dist/ USER@SERVER.dreamhost.com:/home/USER/cristianvega.ai/
```

Replace `USER`, `SERVER.dreamhost.com`, and the destination path with the values from DreamHost panel/SFTP settings. Upload the contents of `dist/`, not the `dist` directory itself.

The build copies production Apache config from `public/.htaccess` (single-hop HTTPS + www→apex redirects, security headers including CSP, custom 404, cache rules), plus `public/robots.txt`. After the first deploy, confirm HTTPS, HSTS, and CSP behave as expected in the DreamHost panel (this environment cannot resolve the live host). HSTS ships as a short bootstrap policy (`max-age=300`, no `includeSubDomains`) until HTTPS and the certificate SAN list are confirmed on the live origin; then raise it to `max-age=31536000; includeSubDomains` in a follow-up commit.

**www DNS:** Publish a `www` CNAME (or A record) to the same host as the apex, and ensure the TLS certificate SAN includes `www.cristianvega.ai`. Without that record, `www` fails at DNS and the apex redirect never runs.

Static operational assets:

| Asset | Source | Purpose |
| --- | --- | --- |
| `robots.txt` | `public/robots.txt` | Crawl policy + sitemap URL |
| `404.html` | `src/pages/404.astro` | Custom not-found page |
| `.htaccess` | `public/.htaccess` | HTTPS, security headers + CSP, ErrorDocument, caching |

## Image derivatives

Requires `sharp` (devDependency).

```bash
# About profile strip (264px WebP + AVIF) + OG share card (1200×630 JPEG)
# → public/images/cristian-vega-portrait.* and cristian-vega-og.jpg
npm run generate:portrait
```
