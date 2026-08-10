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
npm test
```

Or run the full gate with `npm run verify` (build + type-check + tests). The deployable site is generated in `dist/`.

## Deploy to DreamHost

Build locally, then upload the contents of `dist/` to the DreamHost domain directory.

```bash
npm run build
rsync -avz --delete dist/ USER@SERVER.dreamhost.com:/home/USER/cristianvega.ai/
npm run verify:deploy
```

Replace `USER`, `SERVER.dreamhost.com`, and the destination path with the values from DreamHost panel/SFTP settings. Upload the contents of `dist/`, not the `dist` directory itself.

The build copies production Apache config from `public/.htaccess` (HTTPS redirect, security headers including CSP, custom 404, cache rules), plus `public/robots.txt`. Headers live inside `<IfModule mod_headers.c>`, so a host without `mod_headers` drops CSP/HSTS/frame protections silently — build-time tests cannot see that. After every deploy, run `npm run verify:deploy` against the live origin (override with `ORIGIN=...` if needed). It requires all six security header names on `GET /`, checks core CSP directives, and requires HTTP 404 for a deliberately missing path.

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
# Home-hero halftone dot data → src/halftone-dots.json
npm run generate:halftone

# About profile strip (264px WebP + AVIF) → public/images/cristian-vega-portrait.*
npm run generate:portrait
```
